//! Running the game: starts the `nova` runtime as a child process, relays its output line by line
//! and can stop it. Only one game runs at a time.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
pub struct Runner {
    child: Arc<Mutex<Option<Child>>>,
}

/// Where the `nova` binary lives: `NOVA_BIN`, next to the studio's own executable (a bundled app),
/// or the repository's build output (development).
pub fn find_nova_binary() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("NOVA_BIN") {
        let path = PathBuf::from(path);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!(
                "NOVA_BIN points at '{}', which is not a file",
                path.display()
            ))
        };
    }
    let name = if cfg!(windows) { "nova.exe" } else { "nova" };
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        candidates.push(dir.join(name));
    }
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
    candidates.push(repo.join("release").join(name));
    candidates.push(repo.join("debug").join(name));
    // Prefer the most recently built of the repository's two builds.
    candidates.retain(|p| p.is_file());
    candidates.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    candidates.pop().ok_or_else(|| {
        "the Nova runtime is not built yet. Run `scripts/env.sh cargo build -p nova-runtime --bin nova` and try again".to_string()
    })
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct LogLine {
    pub stream: &'static str,
    pub line: String,
}

impl Runner {
    pub fn is_running(&self) -> bool {
        let mut guard = self.child.lock().expect("runner lock");
        match guard.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }

    /// Starts `command`, calling `on_line` for each line of output and `on_exit` once when it ends.
    pub fn start(
        &self,
        mut command: Command,
        on_line: impl Fn(LogLine) + Send + Sync + 'static,
        on_exit: impl FnOnce(Option<i32>) + Send + 'static,
    ) -> Result<(), String> {
        if self.is_running() {
            return Err("a game is already running; stop it first".into());
        }
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("cannot start the game: {e}"))?;
        let on_line = Arc::new(on_line);
        let mut readers = Vec::new();
        for (stream, pipe) in [
            (
                "stdout",
                child
                    .stdout
                    .take()
                    .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
            ),
            (
                "stderr",
                child
                    .stderr
                    .take()
                    .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
            ),
        ] {
            if let Some(pipe) = pipe {
                let on_line = on_line.clone();
                readers.push(std::thread::spawn(move || {
                    for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                        on_line(LogLine { stream, line });
                    }
                }));
            }
        }
        *self.child.lock().expect("runner lock") = Some(child);
        let slot = self.child.clone();
        std::thread::spawn(move || {
            let code = loop {
                {
                    let mut guard = slot.lock().expect("runner lock");
                    match guard.as_mut().map(Child::try_wait) {
                        Some(Ok(Some(status))) => break status.code(),
                        Some(Ok(None)) => {}
                        _ => break None, // stopped from outside
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            for r in readers {
                let _ = r.join();
            }
            on_exit(code);
        });
        Ok(())
    }

    /// Ends the running game, if any. Returns whether one was running.
    pub fn stop(&self) -> bool {
        let mut guard = self.child.lock().expect("runner lock");
        match guard.take() {
            Some(mut child) => {
                let running = matches!(child.try_wait(), Ok(None));
                let _ = child.kill();
                let _ = child.wait();
                running
            }
            None => false,
        }
    }
}

/// Runs `nova check <root> --json` and returns its report (exit status 1 just means errors were found).
pub fn check(root: &Path) -> Result<serde_json::Value, String> {
    let bin = find_nova_binary()?;
    let out = Command::new(bin)
        .arg("check")
        .arg(root)
        .arg("--json")
        .output()
        .map_err(|e| format!("cannot run the checker: {e}"))?;
    serde_json::from_slice(&out.stdout).map_err(|e| {
        format!(
            "the checker gave an unreadable report ({e}): {}",
            String::from_utf8_lossy(&out.stderr)
                .lines()
                .next()
                .unwrap_or("")
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    fn shell(script: &str) -> Command {
        let mut c = Command::new("sh");
        c.arg("-c").arg(script);
        c
    }

    #[test]
    fn output_lines_and_the_exit_code_are_relayed() {
        let runner = Runner::default();
        let (lines_tx, lines_rx) = channel();
        let (exit_tx, exit_rx) = channel();
        runner
            .start(
                shell("echo hello; echo oops 1>&2; exit 3"),
                move |l| lines_tx.send(l).unwrap(),
                move |c| exit_tx.send(c).unwrap(),
            )
            .unwrap();
        assert_eq!(
            exit_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            Some(3)
        );
        let mut lines: Vec<_> = lines_rx.try_iter().collect();
        lines.sort_by_key(|l| l.stream);
        assert_eq!(
            lines,
            [
                LogLine {
                    stream: "stderr",
                    line: "oops".into()
                },
                LogLine {
                    stream: "stdout",
                    line: "hello".into()
                }
            ]
        );
        assert!(!runner.is_running());
    }

    #[test]
    fn a_running_game_blocks_a_second_start_and_can_be_stopped() {
        let runner = Runner::default();
        let (exit_tx, exit_rx) = channel();
        runner
            .start(shell("sleep 30"), |_| {}, move |c| exit_tx.send(c).unwrap())
            .unwrap();
        assert!(runner.is_running());
        let e = runner.start(shell("echo x"), |_| {}, |_| {}).unwrap_err();
        assert!(e.contains("already running"), "{e}");
        assert!(runner.stop(), "it was running");
        assert!(
            exit_rx.recv_timeout(Duration::from_secs(5)).is_ok(),
            "on_exit still fires after a stop"
        );
        assert!(!runner.is_running());
        assert!(!runner.stop(), "nothing to stop now");
        // And it can start again.
        let (tx, rx) = channel();
        runner
            .start(shell("true"), |_| {}, move |c| tx.send(c).unwrap())
            .unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Some(0));
    }

    #[test]
    fn a_missing_program_is_a_clear_error() {
        let runner = Runner::default();
        let e = runner
            .start(Command::new("/definitely/not/here"), |_| {}, |_| {})
            .unwrap_err();
        assert!(e.contains("cannot start the game"), "{e}");
    }
}

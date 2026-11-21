//! Quitting cleanly, end to end with the real binary headless: a game that calls `nova.quit()` ends after that frame with
//! status 0 and its save written; SIGTERM, SIGINT and SIGHUP end a run the same way, promptly (`src/shutdown.rs`).

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nova-quit-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn project(dir: &Path, main: &str) {
    std::fs::write(dir.join("nova.json"), r#"{"format":1,"name":"Quit"}"#).unwrap();
    std::fs::write(dir.join("main.lua"), main).unwrap();
}

#[test]
fn a_game_that_calls_quit_ends_after_that_frame_with_its_save_written() {
    let dir = scratch("lua");
    project(
        &dir,
        "local n = 0\nfunction update() n = n + 1; if n == 10 then nova.save.set('n', n); nova.quit() end end\nfunction draw() end\n",
    );
    let saves = dir.join("saves");
    let started = Instant::now();
    let out = Command::new(env!("CARGO_BIN_EXE_nova"))
        .args([
            "run",
            &dir.to_string_lossy(),
            "--headless",
            "--frames",
            "100000",
            "--save-dir",
        ])
        .arg(&saves)
        .output()
        .expect("runs nova");
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "{text}{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        text.contains("quit after 10 frames: the game called nova.quit()"),
        "{text}"
    );
    assert!(started.elapsed() < Duration::from_secs(20));
    let save = std::fs::read_to_string(saves.join("save.json")).expect("the save was written");
    assert!(save.contains("\"n\""), "{save}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_signal_ends_a_run_cleanly_and_promptly() {
    for signal in ["TERM", "INT", "HUP"] {
        let dir = scratch(signal);
        project(&dir, "function update() end\nfunction draw() end\n");
        let mut child = Command::new(env!("CARGO_BIN_EXE_nova"))
            .args([
                "run",
                &dir.to_string_lossy(),
                "--headless",
                "--frames",
                "100000000",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("runs nova");
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        // (running: the title is printed just before the first frame)
        for line in lines.by_ref() {
            if line.unwrap().starts_with("content:") {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
        let sent = Instant::now();
        let kill = Command::new("kill")
            .args([&format!("-{signal}"), &child.id().to_string()])
            .status()
            .unwrap();
        assert!(kill.success());
        let status = child.wait().unwrap();
        let took = sent.elapsed();
        let rest: Vec<String> = lines.map_while(Result::ok).collect();
        assert!(status.success(), "SIG{signal}: {status:?} {rest:?}");
        assert!(took < Duration::from_secs(1), "SIG{signal} took {took:?}");
        assert!(
            rest.iter()
                .any(|l| l.contains("the system asked (a signal)")),
            "SIG{signal}: {rest:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

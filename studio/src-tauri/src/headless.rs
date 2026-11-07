//! Running the game headless for the studio's tools: a picture of a screen (store art), a scripted play session that
//! prints lines (the simulation screen). One run is one `nova run <project> --headless ...` child process; the front end
//! calls it as often as it needs.

use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::paths::confine;

/// A run that takes longer than this is stopped (a headless run is not paced by a display, so a minute of play is seconds).
const TIME_LIMIT: Duration = Duration::from_secs(600);
const MAX_FRAMES: u32 = 1_000_000;
const MAX_LOG_LINES: usize = 20_000;

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct HeadlessOptions {
    /// How many frames to run (60 = a second). 90 when left out.
    pub frames: Option<u32>,
    /// The size of the picture (and of the window it is drawn for), `[width, height]`.
    pub size: Option<[u32; 2]>,
    /// Taps, each `source@frame` (for example `key:Enter@30`).
    pub press: Vec<String>,
    /// Actions held every frame (for example `throttle` or `steer=0.3`).
    pub hold: Vec<String>,
    /// A recorded input script in the project (for example `sims/play.json`).
    pub input: Option<String>,
    /// Return a picture of the last frame.
    pub capture: bool,
    /// Draw the speed numbers over the picture.
    pub hud: bool,
}

#[derive(Debug, Serialize)]
pub struct HeadlessReport {
    /// The program ended by itself with success.
    pub ok: bool,
    pub exit: Option<i32>,
    /// Everything the game and the runtime printed, one entry a line.
    pub log: Vec<String>,
    /// With `capture`: the last frame as a `data:image/png;base64,` URL.
    pub image: Option<String>,
    /// The run was stopped for taking too long.
    pub timed_out: bool,
}

/// The command line for one run. `picture` is where the capture goes.
pub fn build_args(
    root: &Path,
    options: &HeadlessOptions,
    picture: &Path,
) -> Result<Vec<OsString>, String> {
    let frames = options.frames.unwrap_or(90);
    if frames == 0 || frames > MAX_FRAMES {
        return Err(format!("frames must be from 1 to {MAX_FRAMES}"));
    }
    let mut args: Vec<OsString> = vec![
        "run".into(),
        root.into(),
        "--headless".into(),
        "--no-audio".into(),
        "--frames".into(),
        frames.to_string().into(),
    ];
    if let Some([w, h]) = options.size {
        if !(16..=4096).contains(&w) || !(16..=4096).contains(&h) {
            return Err("the picture must be from 16 to 4096 pixels each way".into());
        }
        args.push("--size".into());
        args.push(format!("{w}x{h}").into());
    }
    for entry in &options.press {
        let ok = entry
            .rsplit_once('@')
            .is_some_and(|(source, frame)| !source.is_empty() && frame.parse::<u32>().is_ok());
        if !ok || entry.contains(',') {
            return Err(format!(
                "'{entry}' is not a key press: use SOURCE@FRAME, for example key:Enter@30"
            ));
        }
    }
    if !options.press.is_empty() {
        args.push("--press".into());
        args.push(options.press.join(",").into());
    }
    if let Some(bad) = options
        .hold
        .iter()
        .find(|h| h.is_empty() || h.contains(',') || h.starts_with('-'))
    {
        return Err(format!("'{bad}' is not something that can be held"));
    }
    if !options.hold.is_empty() {
        args.push("--hold".into());
        args.push(options.hold.join(",").into());
    }
    if let Some(input) = &options.input {
        let path = confine(root, input)?;
        if !path.is_file() {
            return Err(format!("the input script '{input}' does not exist"));
        }
        args.push("--input".into());
        args.push(path.into());
    }
    if options.hud {
        args.push("--hud".into());
    }
    if options.capture {
        args.push("--capture".into());
        args.push(picture.into());
    }
    Ok(args)
}

fn picture_path() -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    std::env::temp_dir().join(format!(
        "nova-studio-{}-{}.png",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Runs `bin` (the `nova` program) on the project once and collects what it printed.
pub fn run_with(
    bin: &Path,
    root: &Path,
    options: &HeadlessOptions,
    limit: Duration,
) -> Result<HeadlessReport, String> {
    let picture = picture_path();
    let args = build_args(root, options, &picture)?;
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start the game: {e}"))?;
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut readers = Vec::new();
    let pipes: [Option<Box<dyn std::io::Read + Send>>; 2] = [
        child.stdout.take().map(|p| Box::new(p) as _),
        child.stderr.take().map(|p| Box::new(p) as _),
    ];
    for pipe in pipes.into_iter().flatten() {
        let log = log.clone();
        readers.push(std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let mut log = log.lock().expect("log lock");
                if log.len() < MAX_LOG_LINES {
                    log.push(line);
                }
            }
        }));
    }
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() > limit => {
                timed_out = true;
                let _ = child.kill();
                break child.wait().ok();
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(format!("lost the game process: {e}")),
        }
    };
    for r in readers {
        let _ = r.join();
    }
    let image = if options.capture {
        let bytes = std::fs::read(&picture).ok();
        let _ = std::fs::remove_file(&picture);
        bytes.map(|b| format!("data:image/png;base64,{}", crate::project_files::base64(&b)))
    } else {
        None
    };
    let log = std::mem::take(&mut *log.lock().expect("log lock"));
    Ok(HeadlessReport {
        ok: status.is_some_and(|s| s.success()) && !timed_out,
        exit: status.and_then(|s| s.code()),
        log,
        image,
        timed_out,
    })
}

pub fn run(root: &Path, options: &HeadlessOptions) -> Result<HeadlessReport, String> {
    let bin = crate::runner::find_nova_binary()?;
    run_with(&bin, root, options, TIME_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn the_command_line_carries_every_option() {
        let dir = std::env::temp_dir().join(format!("nova-headless-args-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sims")).unwrap();
        std::fs::write(dir.join("sims/play.json"), "[]").unwrap();
        let options = HeadlessOptions {
            frames: Some(300),
            size: Some([512, 512]),
            press: vec!["key:Enter@30".into(), "pad:south@60".into()],
            hold: vec!["throttle".into(), "steer=0.3".into()],
            input: Some("sims/play.json".into()),
            capture: true,
            hud: true,
        };
        let args = strings(&build_args(&dir, &options, Path::new("/tmp/x.png")).unwrap());
        let joined = args.join(" ");
        assert!(
            joined.contains("--headless --no-audio --frames 300"),
            "{joined}"
        );
        assert!(joined.contains("--size 512x512"), "{joined}");
        assert!(
            joined.contains("--press key:Enter@30,pad:south@60"),
            "{joined}"
        );
        assert!(joined.contains("--hold throttle,steer=0.3"), "{joined}");
        assert!(joined.contains("sims/play.json"), "{joined}");
        assert!(
            joined.contains("--hud") && joined.ends_with("--capture /tmp/x.png"),
            "{joined}"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn bad_options_are_refused_before_anything_runs() {
        let root = Path::new("/nowhere");
        let pic = Path::new("/tmp/x.png");
        let refuse = |o: HeadlessOptions| build_args(root, &o, pic).unwrap_err();
        assert!(
            refuse(HeadlessOptions {
                frames: Some(0),
                ..Default::default()
            })
            .contains("frames")
        );
        assert!(
            refuse(HeadlessOptions {
                press: vec!["Enter".into()],
                ..Default::default()
            })
            .contains("key press")
        );
        assert!(
            refuse(HeadlessOptions {
                press: vec!["key:A@x".into()],
                ..Default::default()
            })
            .contains("key press")
        );
        assert!(
            refuse(HeadlessOptions {
                hold: vec!["--hud".into()],
                ..Default::default()
            })
            .contains("held")
        );
        assert!(
            refuse(HeadlessOptions {
                size: Some([2, 2]),
                ..Default::default()
            })
            .contains("pixels")
        );
        // a script outside the project is refused
        let e = refuse(HeadlessOptions {
            input: Some("../secret.json".into()),
            ..Default::default()
        });
        assert!(e.contains("leaves the project"), "{e}");
    }

    #[cfg(unix)]
    #[test]
    fn a_run_collects_the_log_and_the_picture_and_a_slow_one_is_stopped() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("nova-headless-run-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // a stand-in for `nova`: prints a line to each stream and "captures" a picture to the path after --capture
        let fake = dir.join("fake-nova");
        std::fs::write(
            &fake,
            "#!/bin/sh\necho out-line\necho err-line 1>&2\nwhile [ $# -gt 0 ]; do if [ \"$1\" = --capture ]; then printf PNGDATA > \"$2\"; fi; shift; done\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let options = HeadlessOptions {
            capture: true,
            ..Default::default()
        };
        let report = run_with(&fake, &dir, &options, Duration::from_secs(10)).unwrap();
        assert!(report.ok && report.exit == Some(0));
        let mut log = report.log.clone();
        log.sort();
        assert_eq!(log, ["err-line", "out-line"]);
        assert_eq!(
            report.image.as_deref(),
            Some("data:image/png;base64,UE5HREFUQQ==")
        );
        // a program that never ends is killed
        let slow = dir.join("slow-nova");
        std::fs::write(&slow, "#!/bin/sh\nexec sleep 30\n").unwrap();
        std::fs::set_permissions(&slow, std::fs::Permissions::from_mode(0o755)).unwrap();
        let report = run_with(
            &slow,
            &dir,
            &HeadlessOptions::default(),
            Duration::from_millis(200),
        )
        .unwrap();
        assert!(report.timed_out && !report.ok);
        let _ = std::fs::remove_dir_all(dir);
    }
}

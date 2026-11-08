//! Play on device: builds the game as an APK (`nova export android`), installs it over adb, starts it and relays
//! the game's own log lines (logcat for its process) as play-log lines; Stop ends it on the device.
//!
//! Every failure a person can fix is said in plain words: adb missing, no device, a device that has not allowed this
//! computer, a build that failed, an install the device refused.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::runner::LogLine;

/// A device adb can see.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Device {
    pub serial: String,
    /// adb's word for it: `device` (ready), `unauthorized`, `offline`, `no permissions`, ...
    pub state: String,
    /// The model, readable (`Retroid Pocket 6`), or the serial when adb does not say.
    pub name: String,
    pub emulator: bool,
}

/// What a device run tells the front end while it works.
pub enum Event {
    Log(LogLine),
    /// The start of a step, in plain words ("Installing on Retroid Pocket 6").
    Step(String),
    /// The game ended on the device (or was stopped).
    Exit(Option<i32>),
}

pub const ADB_MISSING: &str = "The Android tools (adb) are not on this computer. Install Android Studio, or just its \
     \"SDK Platform-Tools\", or set ANDROID_HOME to the Android SDK folder.";
pub const NO_DEVICE: &str = "No device is connected. Plug the handheld in with a USB cable and turn on USB debugging \
     (Settings › System › Developer options), then look again.";

/// Where adb is: in the Android SDK (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, or where Android Studio puts it), or on PATH.
pub fn find_adb() -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "adb.exe" } else { "adb" };
    let mut dirs: Vec<PathBuf> = ["ANDROID_HOME", "ANDROID_SDK_ROOT"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|d| PathBuf::from(d).join("platform-tools"))
        .collect();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for sdk in [
            "Library/Android/sdk",
            "Android/Sdk",
            "AppData/Local/Android/Sdk",
        ] {
            dirs.push(home.join(sdk).join("platform-tools"));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.into_iter()
        .map(|d| d.join(name))
        .find(|p| p.is_file())
        .ok_or_else(|| ADB_MISSING.to_string())
}

/// Reads `adb devices -l`.
pub fn parse_devices(text: &str) -> Vec<Device> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("List of devices") && !l.starts_with('*'))
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            let serial = words.next()?.to_string();
            let rest: Vec<&str> = words.collect();
            // the state is every word up to the first `key:value` (`no permissions` is two words)
            let state_words: Vec<&str> = rest
                .iter()
                .take_while(|w| !w.contains(':'))
                .copied()
                .collect();
            let field = |key: &str| {
                rest.iter()
                    .find_map(|w| w.strip_prefix(key).and_then(|v| v.strip_prefix(':')))
            };
            let model = field("model").map(|m| m.replace('_', " "));
            let emulator = serial.starts_with("emulator-");
            let name = match (model, emulator) {
                (Some(m), true) => format!("{m} (emulator)"),
                (Some(m), false) => m,
                (None, true) => "Android emulator".to_string(),
                (None, false) => serial.clone(),
            };
            Some(Device {
                state: if state_words.is_empty() {
                    "unknown".into()
                } else {
                    state_words.join(" ")
                },
                serial,
                name,
                emulator,
            })
        })
        .collect()
}

/// Why a device cannot be used yet, in plain words (`None`: it is ready).
pub fn not_ready(device: &Device) -> Option<String> {
    let name = &device.name;
    match device.state.as_str() {
        "device" => None,
        "unauthorized" => Some(format!(
            "{name} has not allowed this computer yet. Look at its screen, tick \"Always allow\" and accept \
             \"Allow USB debugging?\", then try again."
        )),
        "offline" => Some(format!(
            "{name} is connected but not answering. Unplug it and plug it back in (or restart it)."
        )),
        "no permissions" => Some(format!(
            "This computer is not allowed to talk to {name} over USB (on Linux, add a udev rule for it)."
        )),
        "authorizing" | "connecting" => Some(format!(
            "{name} is still connecting. Wait a moment and try again."
        )),
        other => Some(format!("{name} is not ready ({other}).")),
    }
}

fn output(command: &mut Command) -> Result<Output, String> {
    command
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("cannot run {:?}: {e}", command.get_program()))
}

fn text_of(out: &Output) -> String {
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    text.trim().to_string()
}

/// The connected devices.
pub fn list_devices() -> Result<Vec<Device>, String> {
    let adb = find_adb()?;
    let out = output(Command::new(&adb).args(["devices", "-l"]))?;
    if !out.status.success() {
        return Err(format!("adb could not list the devices: {}", text_of(&out)));
    }
    Ok(parse_devices(&String::from_utf8_lossy(&out.stdout)))
}

/// What `adb install` said, in plain words, when it failed.
pub fn install_problem(said: &str, device: &str) -> String {
    let reason = said
        .lines()
        .find(|l| l.contains("Failure") || l.contains("INSTALL_"))
        .unwrap_or_else(|| said.lines().last().unwrap_or(""))
        .trim();
    if said.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE")
        || said.contains("signatures do not match")
    {
        format!(
            "{device} already has this game, signed on another computer (or by another copy of Nova). Uninstall it on \
             the device (its saved games go with it), then play again. ({reason})"
        )
    } else if said.contains("INSTALL_FAILED_INSUFFICIENT_STORAGE")
        || said.contains("not enough space")
    {
        format!("{device} is out of storage space. Free some, then play again.")
    } else if said.contains("INSTALL_FAILED_VERSION_DOWNGRADE") {
        format!("{device} has a newer copy of this game. Uninstall it there first. ({reason})")
    } else if said.contains("INSTALL_FAILED_USER_RESTRICTED")
        || said.contains("INSTALL_CANCELED_BY_USER")
    {
        format!(
            "{device} refused the install: allow \"Install via USB\" in its developer options. ({reason})"
        )
    } else if said.contains("INSTALL_FAILED_NO_MATCHING_ABIS") {
        format!("{device} cannot run this game: Nova builds for 64-bit ARM only. ({reason})")
    } else {
        format!("{device} did not install the game: {reason}")
    }
}

/// One logcat line in `-v tag` form (`I/nova: lua: hello`, `E/libc    : ...`): level, tag and message.
pub fn parse_logcat(line: &str) -> Option<(char, &str, &str)> {
    let (head, message) = line.split_once(": ").or_else(|| line.split_once(':'))?;
    let (level, tag) = head.split_once('/')?;
    let level = level.trim().chars().next()?;
    // `-v tag` can add a `(pid)` after the tag on some Android versions
    let tag = tag.split('(').next().unwrap_or(tag).trim();
    Some((level, tag, message))
}

/// The line to show in the console, or `None` for another library's chatter. The game's own lines (tag `nova`)
/// always show, without the tag; other tags only at warning and above.
pub fn console_line(line: &str) -> Option<LogLine> {
    let (level, tag, message) = parse_logcat(line)?;
    let stream = if matches!(level, 'W' | 'E' | 'F' | 'A') {
        "stderr"
    } else {
        "stdout"
    };
    if tag == "nova" {
        return Some(LogLine {
            stream,
            line: message.to_string(),
        });
    }
    (stream == "stderr").then(|| LogLine {
        stream,
        line: format!("{tag}: {message}"),
    })
}

/// From the crash buffer: the lines about `package` (a native crash report names it `>>> package <<<`).
pub fn crash_lines(buffer: &str, package: &str) -> Vec<String> {
    let marker = format!(">>> {package} <<<");
    let Some(start) = buffer
        .lines()
        .position(|l| l.contains(&marker) || l.contains(&format!("Process: {package}")))
    else {
        return vec![];
    };
    buffer
        .lines()
        .skip(start.saturating_sub(2))
        .take(40)
        .map(str::to_string)
        .collect()
}

/// What `nova export android` printed at the end: the APK and the package.
pub fn built_from(lines: &[String]) -> Option<(PathBuf, String)> {
    let apk = lines.iter().find_map(|l| l.strip_prefix("apk: "))?;
    let package = lines
        .iter()
        .find_map(|l| l.strip_prefix("package: "))?
        .split_whitespace()
        .next()?;
    Some((PathBuf::from(apk.trim()), package.to_string()))
}

/// Plain words for a build that failed, from what it printed.
pub fn build_problem(lines: &[String]) -> String {
    if lines.iter().any(|l| l.contains("was not exported")) {
        return "The game has errors, so it was not put on the device. The Problems list shows them.".into();
    }
    let reason = lines
        .iter()
        .rev()
        .find_map(|l| l.strip_prefix("nova: "))
        .or_else(|| {
            lines
                .iter()
                .rev()
                .find(|l| l.starts_with("error"))
                .map(String::as_str)
        })
        .unwrap_or("see the messages above");
    format!("The game could not be built for Android: {reason}")
}

#[derive(Default)]
struct Session {
    /// The build or the logcat reader that is running now (Stop kills it).
    child: Option<Child>,
    /// adb, the device's serial and the game's package once it is installed.
    target: Option<(PathBuf, String, String)>,
    active: bool,
    stopped: bool,
    /// Counts runs, so a watcher from an earlier run does nothing to a later one.
    run: u64,
}

#[derive(Default, Clone)]
pub struct DeviceRunner {
    session: Arc<Mutex<Session>>,
}

/// How the build is run: the `nova` program, and the Nova source tree when there is one (its `scripts/env.sh`
/// sets up the Android tools).
pub struct BuildWith {
    pub nova: PathBuf,
    pub repo: Option<PathBuf>,
    /// Where the APK goes.
    pub out: PathBuf,
}

const STOPPED: &str = "Stopped.";

impl DeviceRunner {
    pub fn is_running(&self) -> bool {
        self.session.lock().expect("device lock").active
    }

    fn stopped(&self) -> bool {
        self.session.lock().expect("device lock").stopped
    }

    fn finish(&self) {
        let mut s = self.session.lock().expect("device lock");
        s.active = false;
        s.child = None;
    }

    /// Builds, installs and starts the game on the device `serial`, then relays its log until it ends or is stopped.
    /// Returns once the game has started (the log carries on in the background) or with what went wrong.
    pub fn play(
        &self,
        project: &Path,
        serial: &str,
        with: &BuildWith,
        emit: Arc<dyn Fn(Event) + Send + Sync>,
    ) -> Result<String, String> {
        let run = {
            let mut s = self.session.lock().expect("device lock");
            if s.active {
                return Err("a game is already running; stop it first".into());
            }
            s.active = true;
            s.stopped = false;
            s.target = None;
            s.run += 1;
            s.run
        };
        let result = self.start(project, serial, with, emit.clone(), run);
        if result.is_err() {
            self.finish();
        }
        result
    }

    fn start(
        &self,
        project: &Path,
        serial: &str,
        with: &BuildWith,
        emit: Arc<dyn Fn(Event) + Send + Sync>,
        run: u64,
    ) -> Result<String, String> {
        let adb = find_adb()?;
        let devices = list_devices()?;
        let device = devices
            .iter()
            .find(|d| d.serial == serial)
            .ok_or_else(|| {
                if devices.is_empty() {
                    NO_DEVICE.to_string()
                } else {
                    format!("The device {serial} is not connected any more. Plug it in, or pick another.")
                }
            })?
            .clone();
        if let Some(problem) = not_ready(&device) {
            return Err(problem);
        }
        let name = device.name.clone();

        // 1. Build (only the game is repacked when the engine has not changed).
        emit(Event::Step("Building the game for Android".into()));
        let lines = self.build(project, with, &emit)?;
        let (apk, package) = built_from(&lines).ok_or_else(|| build_problem(&lines))?;
        let adb_cmd = |args: &[&str]| {
            let mut c = Command::new(&adb);
            c.arg("-s").arg(serial).args(args);
            c
        };

        // 2. Install.
        if self.stopped() {
            return Err(STOPPED.into());
        }
        emit(Event::Step(format!("Installing on {name}")));
        let out = output(adb_cmd(&["install", "-r"]).arg(&apk))?;
        let said = text_of(&out);
        if !out.status.success() || !said.contains("Success") {
            return Err(install_problem(&said, &name));
        }

        // 3. The cover for the Lantern launcher, when the game has one and the device has Lantern's folder.
        if let Some(cover) = ["boxart-wide.png", "boxart.png"]
            .iter()
            .map(|f| project.join(f))
            .find(|p| p.is_file())
            && output(&mut adb_cmd(&["shell", "ls", "-d", "/sdcard/Lantern"]))
                .is_ok_and(|o| o.status.success())
        {
            emit(Event::Step("Sending the cover picture to Lantern".into()));
            let dest = format!("/sdcard/Lantern/art/androidgames/{package}.png");
            let _ = output(&mut adb_cmd(&[
                "shell",
                "mkdir",
                "-p",
                "/sdcard/Lantern/art/androidgames",
            ]));
            let pushed = output(adb_cmd(&["push"]).arg(&cover).arg(&dest));
            if !pushed.as_ref().is_ok_and(|o| o.status.success()) {
                emit(Event::Log(LogLine {
                    stream: "stderr",
                    line: "(the cover picture could not be copied to Lantern's folder; the game is installed)".into(),
                }));
            }
        }

        // 4. Start it, fresh.
        if self.stopped() {
            return Err(STOPPED.into());
        }
        emit(Event::Step(format!("Starting the game on {name}")));
        let _ = output(&mut adb_cmd(&["shell", "am", "force-stop", &package]));
        let since = output(&mut adb_cmd(&["shell", "date", "+%s"]))
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|t| t.chars().all(|c| c.is_ascii_digit()) && !t.is_empty());
        let activity = format!("{package}/{}", "android.app.NativeActivity");
        let out = output(&mut adb_cmd(&[
            "shell", "am", "start", "-W", "-n", &activity,
        ]))?;
        let said = text_of(&out);
        if said.contains("Error") {
            return Err(format!("{name} did not start the game: {said}"));
        }
        let pid = wait_for_pid(&adb_cmd, &package, Duration::from_secs(10)).ok_or_else(|| {
            format!("The game started on {name} but closed at once. Look at the device's screen; the log may say why.")
        })?;
        {
            let mut s = self.session.lock().expect("device lock");
            if s.stopped {
                drop(s);
                let _ = output(&mut adb_cmd(&["shell", "am", "force-stop", &package]));
                return Err(STOPPED.into());
            }
            s.target = Some((adb.clone(), serial.to_string(), package.clone()));
        }

        // 5. Its log, until it ends.
        let mut logcat = adb_cmd(&["logcat", "-v", "tag", &format!("--pid={pid}")]);
        let mut child = logcat
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("cannot read the device's log: {e}"))?;
        let stdout = child.stdout.take();
        self.session.lock().expect("device lock").child = Some(child);
        if let Some(pipe) = stdout {
            let emit = emit.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    if let Some(l) = console_line(&line) {
                        emit(Event::Log(l));
                    }
                }
            });
        }
        let me = self.clone();
        let (adb2, serial2, package2) = (adb.clone(), serial.to_string(), package.clone());
        std::thread::spawn(move || {
            let cmd = |args: &[&str]| {
                let mut c = Command::new(&adb2);
                c.arg("-s").arg(&serial2).args(args);
                c
            };
            loop {
                std::thread::sleep(Duration::from_millis(700));
                let gone = {
                    let s = me.session.lock().expect("device lock");
                    s.run != run || s.stopped || !s.active
                } || current_pid(&cmd, &package2).as_deref() != Some(pid.as_str());
                if gone {
                    break;
                }
            }
            if me.session.lock().expect("device lock").run != run {
                return;
            }
            std::thread::sleep(Duration::from_millis(300)); // the last lines
            if let Some(mut c) = me.session.lock().expect("device lock").child.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
            let stopped = me.stopped();
            if !stopped {
                // a native crash is written by another process: look for this game in the crash buffer
                let mut args = vec!["logcat", "-d", "-b", "crash", "-v", "tag"];
                let since_arg;
                if let Some(t) = &since {
                    since_arg = format!("{t}.000");
                    args.extend(["-T", since_arg.as_str()]);
                }
                if let Ok(out) = output(&mut cmd(&args)) {
                    for line in crash_lines(&String::from_utf8_lossy(&out.stdout), &package2) {
                        emit(Event::Log(LogLine {
                            stream: "stderr",
                            line,
                        }));
                    }
                }
                emit(Event::Log(LogLine {
                    stream: "stderr",
                    line: "— the game closed on the device —".into(),
                }));
            }
            me.finish();
            emit(Event::Exit(if stopped { Some(0) } else { None }));
        });
        Ok(package)
    }

    /// Runs `nova export android`, relaying its lines; `[step] ...` lines become steps.
    fn build(
        &self,
        project: &Path,
        with: &BuildWith,
        emit: &Arc<dyn Fn(Event) + Send + Sync>,
    ) -> Result<Vec<String>, String> {
        let env = with
            .repo
            .as_ref()
            .map(|r| r.join("scripts/env.sh"))
            .filter(|p| p.is_file());
        let mut command = match &env {
            Some(env) => {
                let mut c = Command::new("bash");
                c.arg(env).arg(&with.nova);
                c
            }
            None => Command::new(&with.nova),
        };
        command
            .arg("export")
            .arg("android")
            .arg(project)
            .arg("--out")
            .arg(&with.out);
        if let Some(repo) = &with.repo {
            command.env("NOVA_REPO", repo).current_dir(repo);
        }
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("cannot start the Android build: {e}"))?;
        let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
        {
            let mut s = self.session.lock().expect("device lock");
            if s.stopped {
                let _ = child.kill();
                return Err(STOPPED.into());
            }
            s.child = Some(child);
        }
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut readers = vec![];
        for (stream, pipe) in [
            (
                "stdout",
                stdout.map(|p| Box::new(p) as Box<dyn Read + Send>),
            ),
            (
                "stderr",
                stderr.map(|p| Box::new(p) as Box<dyn Read + Send>),
            ),
        ] {
            let Some(pipe) = pipe else { continue };
            let (lines, emit) = (lines.clone(), emit.clone());
            readers.push(std::thread::spawn(move || {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    if let Some(step) = line.strip_prefix("[step] ") {
                        emit(Event::Step(step.to_string()));
                    }
                    emit(Event::Log(LogLine {
                        stream,
                        line: line.clone(),
                    }));
                    lines.lock().expect("lines").push(line);
                }
            }));
        }
        for r in readers {
            let _ = r.join();
        }
        let status = {
            let mut s = self.session.lock().expect("device lock");
            match s.child.take() {
                Some(mut c) => c.wait().ok(),
                None => None, // killed by Stop
            }
        };
        let lines = std::mem::take(&mut *lines.lock().expect("lines"));
        if self.stopped() {
            return Err(STOPPED.into());
        }
        match status {
            Some(s) if s.success() => Ok(lines),
            _ => Err(build_problem(&lines)),
        }
    }

    /// Stops what is happening: the build, or the game on the device. Returns whether anything was running.
    pub fn stop(&self) -> bool {
        let (target, was) = {
            let mut s = self.session.lock().expect("device lock");
            let was = s.active;
            if was {
                s.stopped = true;
            }
            if let Some(mut c) = s.child.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
            (s.target.clone(), was)
        };
        if was && let Some((adb, serial, package)) = target {
            let _ = output(Command::new(adb).args([
                "-s",
                &serial,
                "shell",
                "am",
                "force-stop",
                &package,
            ]));
        }
        was
    }
}

fn current_pid(cmd: &dyn Fn(&[&str]) -> Command, package: &str) -> Option<String> {
    let out = output(&mut cmd(&["shell", "pidof", package])).ok()?;
    let pid = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!pid.is_empty()).then(|| pid.split_whitespace().next().unwrap_or("").to_string())
}

fn wait_for_pid(
    cmd: &dyn Fn(&[&str]) -> Command,
    package: &str,
    limit: Duration,
) -> Option<String> {
    let start = Instant::now();
    while start.elapsed() < limit {
        if let Some(pid) = current_pid(cmd, package) {
            return Some(pid);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn devices_are_read_with_their_state_and_a_readable_name() {
        let text = "List of devices attached\n\
            bc8565a3               device usb:1-1 product:RP6 model:Retroid_Pocket_6 device:RP6 transport_id:3\n\
            emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\n\
            R58N123ABC             unauthorized usb:1-2 transport_id:4\n\
            0123456789             no permissions (user in plugdev group); see [http://developer.android.com/tools/device.html] usb:3-1\n\
            \n";
        let d = parse_devices(text);
        assert_eq!(d.len(), 4);
        assert_eq!(
            d[0],
            Device {
                serial: "bc8565a3".into(),
                state: "device".into(),
                name: "Retroid Pocket 6".into(),
                emulator: false
            }
        );
        assert_eq!(d[1].name, "sdk gphone64 arm64 (emulator)");
        assert!(d[1].emulator);
        assert_eq!(d[2].state, "unauthorized");
        assert_eq!(d[2].name, "R58N123ABC");
        assert!(d[3].state.starts_with("no permissions"), "{}", d[3].state);
        assert!(parse_devices("List of devices attached\n\n").is_empty());
        assert!(parse_devices("* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n").is_empty());
    }

    #[test]
    fn a_device_that_is_not_ready_says_what_to_do() {
        let mut d = parse_devices("bc8565a3 unauthorized usb:1-1\n").remove(0);
        assert!(not_ready(&d).unwrap().contains("Allow USB debugging"));
        d.state = "offline".into();
        assert!(not_ready(&d).unwrap().contains("plug it back in"));
        d.state = "device".into();
        assert_eq!(not_ready(&d), None);
    }

    #[test]
    fn install_failures_are_plain_words() {
        let p = install_problem(
            "Performing Streamed Install\nadb: failed to install x.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.nova.games.x signatures do not match newer version; ignoring!]",
            "Retroid Pocket 6",
        );
        assert!(p.contains("Uninstall it on the device"), "{p}");
        assert!(
            install_problem("Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]", "X")
                .contains("storage")
        );
        assert!(install_problem("adb: device offline", "X").contains("adb: device offline"));
    }

    #[test]
    fn the_games_lines_show_and_other_chatter_only_when_it_matters() {
        assert_eq!(
            console_line("I/nova    : lua: hello"),
            Some(LogLine {
                stream: "stdout",
                line: "lua: hello".into()
            })
        );
        assert_eq!(
            console_line("E/nova: panic: oh no"),
            Some(LogLine {
                stream: "stderr",
                line: "panic: oh no".into()
            })
        );
        assert_eq!(console_line("D/AdrenoGLES-0: some driver detail"), None);
        assert_eq!(
            console_line("W/libc    ( 1234): Access denied"),
            Some(LogLine {
                stream: "stderr",
                line: "libc: Access denied".into()
            })
        );
        assert_eq!(console_line("--------- beginning of main"), None);
        // the speed line keeps the shape the studio's speed strip reads
        let perf = console_line("I/nova: fps=60.0 p95=16.9ms max=17.2ms").unwrap();
        assert!(perf.line.starts_with("fps=60.0"));
    }

    #[test]
    fn a_crash_report_is_found_by_the_games_name() {
        let buffer = "F/libc: Fatal signal 11 (SIGSEGV)\n\
            F/DEBUG: *** *** ***\n\
            F/DEBUG: Build fingerprint: 'x'\n\
            F/DEBUG: pid: 4242, tid: 4250, name: GameThread  >>> com.nova.games.x <<<\n\
            F/DEBUG: signal 11 (SIGSEGV)\n";
        let lines = crash_lines(buffer, "com.nova.games.x");
        assert_eq!(lines.len(), 4);
        assert!(lines[2].contains(">>> com.nova.games.x <<<"));
        assert!(crash_lines(buffer, "com.nova.games.other").is_empty());
    }

    #[test]
    fn the_build_says_where_the_apk_is_or_why_it_failed() {
        let lines: Vec<String> = [
            "[step] Packing the game",
            "apk: /tmp/out/x-debug.apk",
            "package: com.nova.games.x   label: X   version: 1.0",
        ]
        .map(String::from)
        .into();
        assert_eq!(
            built_from(&lines),
            Some((
                PathBuf::from("/tmp/out/x-debug.apk"),
                "com.nova.games.x".into()
            ))
        );
        let failed: Vec<String> = [
            "error: main.lua:3: oops",
            "nova: the game has errors, so it was not exported (fix them, or run `nova check`)",
        ]
        .map(String::from)
        .into();
        assert!(build_problem(&failed).contains("Problems"));
        let sdk: Vec<String> = ["nova: the Android SDK was not found: install it"]
            .map(String::from)
            .into();
        assert_eq!(
            build_problem(&sdk),
            "The game could not be built for Android: the Android SDK was not found: install it"
        );
    }

    #[test]
    fn stop_with_nothing_running_is_harmless() {
        let runner = DeviceRunner::default();
        assert!(!runner.is_running());
        assert!(!runner.stop());
    }

    /// The whole path against a real device: `NOVA_DEVICE=bc8565a3 cargo test -p nova-studio --lib device -- --ignored --nocapture`
    /// builds examples/crate-dash, installs and starts it, waits for its log, then stops it.
    #[test]
    #[ignore = "needs a connected Android device (NOVA_DEVICE=<serial>)"]
    fn plays_on_a_real_device() {
        let serial = std::env::var("NOVA_DEVICE").expect("set NOVA_DEVICE to the device's serial");
        let game =
            std::env::var("NOVA_DEVICE_GAME").unwrap_or_else(|_| "examples/crate-dash".into());
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let with = BuildWith {
            nova: crate::runner::find_nova_binary().unwrap(),
            repo: Some(repo.clone()),
            out: repo.join("build/android"),
        };
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let tx = Mutex::new(tx);
        let emit: Arc<dyn Fn(Event) + Send + Sync> = Arc::new(move |e| {
            let text = match e {
                Event::Step(s) => format!("step: {s}"),
                Event::Log(l) => format!("{}: {}", l.stream, l.line),
                Event::Exit(c) => format!("exit: {c:?}"),
            };
            println!("{text}");
            let _ = tx.lock().unwrap().send(text);
        });
        let runner = DeviceRunner::default();
        let package = runner
            .play(&repo.join(game), &serial, &with, emit)
            .expect("plays");
        assert!(package.starts_with("com.nova.games."));
        assert!(runner.is_running());
        // the build's own lines come before the "Starting" step; the game's after it
        let mut started = false;
        let mut saw_game_line = false;
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline && !saw_game_line {
            if let Ok(l) = rx.recv_timeout(Duration::from_millis(500)) {
                started |= l.starts_with("step: Starting the game");
                saw_game_line = started && l.starts_with("stdout: ");
            }
        }
        assert!(saw_game_line, "a line from the game's own log arrived");
        assert!(runner.stop());
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut exited = false;
        while Instant::now() < deadline && !exited {
            exited = rx
                .recv_timeout(Duration::from_millis(500))
                .is_ok_and(|l| l.starts_with("exit:"));
        }
        assert!(exited, "the exit was reported after Stop");
        assert!(!runner.is_running());
    }
}

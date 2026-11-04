//! Desktop entry point.
//!
//!   nova run <project-folder>        play a Nova project (F3 toggles the stats, Esc quits)
//!   nova run --pak game.npk          play a packed project
//!   nova pack <project-folder> out.npk    pack a project into one file (what the APK carries)
//!   nova export desktop <project-folder> [--out dir]   a folder that plays the game on a computer
//!   nova export android <project-folder> [--out dir]   a debug-signed APK (needs the Android toolchain)
//!   nova                             the built-in M1 benchmark scene
//!   nova --world-height 0            render the world at native resolution (default: project, or 540)
//!   nova --headless --frames 300 --capture out.png    offscreen run and capture
//!   nova --frames 600 --uncapped --no-audio           windowed benchmark without vsync
//!   nova --script path.lua           benchmark scene driven by a script from disk (hot reload)

use std::path::PathBuf;
use std::sync::Arc;

use nova_runtime::app::{self, Options, PakBytes};
use nova_runtime::export;
use nova_runtime::pak;
use nova_runtime::vfs::DirVfs;

const USAGE: &str = "usage:
  nova run <project-folder> [options]    play a Nova project
  nova run --pak <file.npk> [options]    play a packed project
  nova pack <project-folder> <out.npk>   pack a project into one file
  nova info <project-folder>             print the project's name, version and id (for build scripts)
  nova export desktop <project-folder> [--out <dir>]   check the game, then write <dir>/<id>/ that plays it on a computer
  nova export android <project-folder> [--out <dir>]   check the game, then build a debug-signed APK (needs the Android toolchain)
  nova check <project-folder> [--json] [--frames N]   load and run a project headless, list its problems
  nova [options]                         built-in benchmark scene
options: [--headless] [--frames N] [--capture out.png] [--size WxH] [--world-height N]
         [--uncapped] [--no-audio] [--hud] [--hold jump,move_x=1] [--press key:Enter@30,key:KeyD@45]
         [--profile]   (headless: list the script functions that took the most time)
         [--input play.json] [--record play.json]   (play back recorded input / write this run's input; see inputscript.rs)
         [--save-dir folder]
         [--script file.lua (benchmark scene only)]";

enum Command {
    Play(Box<Options>),
    Check {
        folder: PathBuf,
        json: bool,
        frames: u32,
    },
    Pack {
        folder: PathBuf,
        out: PathBuf,
    },
    Info {
        folder: PathBuf,
    },
    Export {
        target: String,
        folder: PathBuf,
        out: PathBuf,
    },
}

fn parse() -> Result<Command, String> {
    let mut opts = Options::default();
    let mut args = std::env::args().skip(1).peekable();
    if args.peek().map(String::as_str) == Some("pack") {
        args.next();
        let folder = args
            .next()
            .ok_or("`nova pack` needs a project folder and an output file")?;
        let out = args
            .next()
            .ok_or("`nova pack` needs an output file, for example game.npk")?;
        if let Some(extra) = args.next() {
            return Err(format!("`nova pack`: unexpected argument '{extra}'"));
        }
        return Ok(Command::Pack {
            folder: folder.into(),
            out: out.into(),
        });
    }
    if args.peek().map(String::as_str) == Some("check") {
        args.next();
        let folder = args.next().ok_or("`nova check` needs a project folder")?;
        let (mut json, mut frames) = (false, 60u32);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--json" => json = true,
                "--frames" => {
                    frames = args
                        .next()
                        .and_then(|v| v.parse().ok())
                        .ok_or("--frames needs a number")?
                }
                other => return Err(format!("`nova check`: unexpected argument '{other}'")),
            }
        }
        return Ok(Command::Check {
            folder: folder.into(),
            json,
            frames,
        });
    }
    if args.peek().map(String::as_str) == Some("export") {
        args.next();
        let target = args
            .next()
            .ok_or("`nova export` needs a target: desktop or android")?;
        if target != "desktop" && target != "android" {
            return Err(format!(
                "`nova export`: unknown target '{target}' (desktop or android)"
            ));
        }
        let folder = args
            .next()
            .ok_or("`nova export` needs a project folder after the target")?;
        let mut out = PathBuf::from("build/export");
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--out" => out = args.next().ok_or("--out needs a folder")?.into(),
                other => return Err(format!("`nova export`: unexpected argument '{other}'")),
            }
        }
        return Ok(Command::Export {
            target,
            folder: folder.into(),
            out,
        });
    }
    if args.peek().map(String::as_str) == Some("info") {
        args.next();
        let folder = args.next().ok_or("`nova info` needs a project folder")?;
        return Ok(Command::Info {
            folder: folder.into(),
        });
    }
    // A game exported for a computer is the program with `game.npk` beside it: started with nothing, it plays that.
    if args.peek().is_none()
        && let Some(pak_path) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|d| d.join("game.npk")))
            .filter(|p| p.is_file())
    {
        let bytes = std::fs::read(&pak_path)
            .map_err(|e| format!("cannot read {}: {e}", pak_path.display()))?;
        opts.pak = Some(PakBytes(Arc::new(bytes)));
        return Ok(Command::Play(Box::new(opts)));
    }
    let running = args.peek().map(String::as_str) == Some("run");
    if running {
        args.next();
        if args.peek().map(String::as_str) != Some("--pak") {
            let folder = args.next().ok_or("`nova run` needs a project folder")?;
            opts.project = Some(folder.into());
        }
    }
    while let Some(arg) = args.next() {
        let mut value = |name: &str| args.next().ok_or(format!("{name} needs a value"));
        match arg.as_str() {
            "--headless" => opts.headless = true,
            "--uncapped" => opts.uncapped = true,
            "--no-audio" => opts.no_audio = true,
            "--hud" => opts.hud = true,
            "--save-dir" => opts.save_dir = Some(value("--save-dir")?.into()),
            "--pak" => {
                let path = value("--pak")?;
                let bytes = std::fs::read(&path).map_err(|e| format!("cannot read {path}: {e}"))?;
                opts.pak = Some(PakBytes(Arc::new(bytes)));
            }
            "--press" => {
                // Source@frame: the source is held for two frames starting at that frame (a tap), for headless runs.
                for entry in value("--press")?.split(',') {
                    let (source, frame) = entry.rsplit_once('@').ok_or_else(|| {
                        format!("--press {entry}: use SOURCE@FRAME, for example key:Enter@30")
                    })?;
                    let frame = frame
                        .parse()
                        .map_err(|_| format!("--press {entry}: '{frame}' is not a frame number"))?;
                    opts.press.push((source.to_string(), frame));
                }
            }
            "--profile" => opts.profile = true,
            "--input" => opts.input = Some(PathBuf::from(value("--input")?)),
            "--record" => opts.record = Some(PathBuf::from(value("--record")?)),
            "--hold" => {
                opts.hold = value("--hold")?.split(',').map(str::to_string).collect();
            }
            "--frames" => {
                opts.frames = Some(
                    value("--frames")?
                        .parse()
                        .map_err(|_| "--frames needs a number")?,
                )
            }
            "--capture" => opts.capture = Some(value("--capture")?.into()),
            "--script" => opts.script = Some(value("--script")?.into()),
            "--world-height" => {
                opts.world_height = Some(
                    value("--world-height")?
                        .parse()
                        .map_err(|_| "--world-height needs a number (0 = native)")?,
                )
            }
            "--size" => {
                let v = value("--size")?;
                let (w, h) = v.split_once('x').ok_or("--size needs WIDTHxHEIGHT")?;
                opts.size = (
                    w.parse().map_err(|_| "bad width")?,
                    h.parse().map_err(|_| "bad height")?,
                );
            }
            "--help" | "-h" => {
                println!("{USAGE}");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument '{other}'\n{USAGE}")),
        }
    }
    if running && opts.project.is_none() && opts.pak.is_none() {
        return Err("`nova run` needs a project folder or --pak <file>".into());
    }
    if opts.project.is_some() && opts.pak.is_some() {
        return Err("give either a project folder or --pak, not both".into());
    }
    if (opts.project.is_some() || opts.pak.is_some()) && opts.script.is_some() {
        return Err("--script only applies to the benchmark scene, not `nova run`".into());
    }
    Ok(Command::Play(Box::new(opts)))
}

fn pack(folder: PathBuf, out: PathBuf) -> Result<(), String> {
    let vfs = DirVfs::new(&folder)?;
    // Validate first: a project that does not open is not worth packing.
    let project = nova_runtime::project::Project::open(&vfs)?;
    for warning in &project.warnings {
        eprintln!("warning: {warning}");
    }
    let bytes = pak::pack(&vfs)?;
    std::fs::write(&out, &bytes).map_err(|e| format!("cannot write {}: {e}", out.display()))?;
    println!(
        "packed '{}': {} files, {} bytes -> {}",
        project.manifest.name,
        project.assets.len() + 1,
        bytes.len(),
        out.display()
    );
    Ok(())
}

/// `key=value` lines for scripts: the game's name and version and an Android-safe id.
fn info(folder: PathBuf) -> Result<(), String> {
    let vfs = DirVfs::new(&folder)?;
    let project = nova_runtime::project::Project::open(&vfs)?;
    let slug: String = project
        .manifest
        .name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    let slug = if slug.is_empty() {
        "game".to_string()
    } else {
        slug
    };
    // A Java package segment cannot start with a digit.
    let id = if slug.starts_with(|c: char| c.is_ascii_digit()) {
        format!("g{slug}")
    } else {
        slug
    };
    println!("name={}", project.manifest.name);
    println!(
        "version={}",
        project.manifest.version.as_deref().unwrap_or("0.0.0")
    );
    println!("id={id}");
    Ok(())
}

/// Loads a project without a GPU, runs it for a short time and reports every problem found.
/// Exit status 1 when there are errors. With `--json` the report is machine-readable (the
/// studio's Problems panel reads it).
fn check(folder: &std::path::Path, json: bool, frames: u32) -> Result<bool, String> {
    log::set_max_level(log::LevelFilter::Off); // the report is the output
    let report = export::check_project(folder, frames);
    if json {
        let out = serde_json::json!({
            "ok": report.ok,
            "name": report.name,
            "frames_run": report.frames_run,
            "diagnostics": report.problems,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&out).expect("report serialises")
        );
    } else {
        print_problems(&report.problems);
        println!(
            "{}",
            if report.ok {
                "no errors"
            } else {
                "errors found"
            }
        );
    }
    Ok(report.ok)
}

fn print_problems(problems: &[nova_runtime::diagnostics::Diagnostic]) {
    for p in problems {
        let place = match (&p.file, p.line, &p.place) {
            (Some(f), Some(l), _) => format!("{f}:{l}: "),
            (Some(f), None, Some(pl)) => format!("{f} ({pl}): "),
            (Some(f), None, None) => format!("{f}: "),
            _ => String::new(),
        };
        println!("{}: {place}{}", p.severity, p.message);
    }
}

/// Checks the game, then writes what a person can hand to someone else.
fn export_game(
    target: &str,
    folder: &std::path::Path,
    out: &std::path::Path,
) -> Result<(), String> {
    log::set_max_level(log::LevelFilter::Off);
    let report = export::check_project(folder, 60);
    print_problems(&report.problems);
    if !report.ok {
        return Err(
            "the game has errors, so it was not exported (fix them, or run `nova check`)".into(),
        );
    }
    let exe = std::env::current_exe().map_err(|e| format!("cannot find this program: {e}"))?;
    let notices = std::fs::read_to_string(
        exe.parent()
            .map(|d| d.join("THIRD-PARTY.txt"))
            .unwrap_or_default(),
    )
    .ok()
    .or_else(|| Some(include_str!("../../../licenses/rust-dependencies.txt").to_string()));
    if target == "desktop" {
        let done = export::export_desktop(folder, out, &exe, notices.as_deref())?;
        println!("exported to {}:", done.dir.display());
        for f in &done.files {
            println!("  {f}");
        }
        return Ok(());
    }
    // Android: the APK is built by the repository's script, which needs cargo-ndk and the Android SDK.
    let mut starts = vec![std::env::current_dir().unwrap_or_default()];
    if let Ok(repo) = std::env::var("NOVA_REPO") {
        starts.insert(0, repo.into());
    }
    starts.push(exe.clone());
    let script = export::find_apk_script(&starts).ok_or(
        "building an APK needs the Nova source tree with the Android toolchain (scripts/build-apk.sh): \
         run this from inside it, or set NOVA_REPO to its folder",
    )?;
    let status = std::process::Command::new("bash")
        .arg(&script)
        .arg("--project")
        .arg(folder)
        .status()
        .map_err(|e| format!("cannot run {}: {e}", script.display()))?;
    if !status.success() {
        return Err("the APK build failed (see the messages above)".into());
    }
    let root = script
        .parent()
        .and_then(|p| p.parent())
        .ok_or("odd script location")?;
    let id = export::game_id(&report.name.unwrap_or_default());
    let apk = root.join("build/android").join(format!("{id}-debug.apk"));
    std::fs::create_dir_all(out).map_err(|e| format!("cannot create {}: {e}", out.display()))?;
    let dest = out.join(apk.file_name().unwrap_or_default());
    std::fs::copy(&apk, &dest).map_err(|e| format!("cannot copy {}: {e}", apk.display()))?;
    println!(
        "exported {} (debug-signed: release signing and installing on a device are yours to do)",
        dest.display()
    );
    Ok(())
}

fn main() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("nova_runtime=info,warn"),
    )
    .init();
    let command = match parse() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("nova: {e}");
            std::process::exit(2);
        }
    };
    let result = match command {
        Command::Pack { folder, out } => pack(folder, out),
        Command::Info { folder } => info(folder),
        Command::Export {
            target,
            folder,
            out,
        } => export_game(&target, &folder, &out),
        Command::Check {
            folder,
            json,
            frames,
        } => match check(&folder, json, frames) {
            Ok(true) => Ok(()),
            Ok(false) => std::process::exit(1),
            Err(e) => Err(e),
        },
        Command::Play(opts) if opts.headless => app::run_headless(*opts),
        Command::Play(opts) => app::run_windowed(*opts),
    };
    if let Err(e) = result {
        eprintln!("nova: {e}");
        std::process::exit(1);
    }
}

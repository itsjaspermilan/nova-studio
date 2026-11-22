//! Desktop entry point.
//!
//!   nova run <project-folder>        play a Nova project (F3 toggles the stats, Esc quits)
//!   nova run --pak game.npk          play a packed project
//!   nova pack <project-folder> out.npk    pack a project into one file (what the APK carries)
//!   nova export desktop <project-folder> [--out dir] [--exe program]   a folder that plays the game on a computer (--exe: package another build, e.g. ARM Linux)
//!   nova export android <project-folder> [--out dir]   a debug-signed APK (needs the Android SDK: see android.rs)
//!   nova                             the built-in M1 benchmark scene
//!   nova --world-height 0            render the world at native resolution (default: project, or 540)
//!   nova --headless --frames 300 --capture out.png    offscreen run and capture
//!   nova --frames 600 --uncapped --no-audio           windowed benchmark without vsync
//!   nova --script path.lua           benchmark scene driven by a script from disk (hot reload)

use std::path::PathBuf;
use std::sync::Arc;

use nova_runtime::android;
use nova_runtime::app::{self, Options, PakBytes};
use nova_runtime::export;
use nova_runtime::pak;
use nova_runtime::vfs::DirVfs;

const USAGE: &str = "usage:
  nova run <project-folder> [options]    play a Nova project
  nova run --pak <file.npk> [options]    play a packed project
  nova pack <project-folder> <out.npk>   pack a project into one file
  nova ktx2 [--linear] in.png out.ktx2   compress a picture for the GPU (ETC2; sides a multiple of 4)
  nova info <project-folder>             print the project's name, version and id (for build scripts)
  nova export desktop <project-folder> [--out <dir>] [--exe <program>]   check the game, then write <dir>/<id>/ that plays it on a computer
  nova export android <project-folder> [--out <dir>] [--rebuild] [--debug-build] [--fast]
                                         check the game, then build a debug-signed APK (needs the Android SDK; the
                                         engine is built with cargo ndk in the Nova source tree when it changed)
  nova export android --benchmark [--out <dir>]   the built-in benchmark scene as an APK
                                         (--no-check: build without running the game first)
  nova check <project-folder> [--json] [--frames N]   load and run a project headless, list its problems
  nova [options]                         built-in benchmark scene
options: [--headless] [--frames N] [--capture out.png] [--size WxH] [--world-height N]
         [--uncapped] [--no-audio] [--hud] [--hold jump,move_x=1] [--press key:Enter@30,key:KeyD@45]
         [--profile]   (headless: list the script functions that took the most time)
         [--input play.json] [--record play.json]   (play back recorded input / write this run's input; see inputscript.rs)
         headless runs of a project, for checking a game without a window (docs/agent-guide.md):
         [--play plan.json]      follow a route of steps, take pictures on the way, write report.json (see playtest.rs)
         [--start-scene name]    start in this scene instead of the one main.lua names
         [--run-lua file.lua]    run this Lua once after the first frame (place the player, set the health)
         [--seed N]              the seed of math.random (headless runs use 1 unless told otherwise)
         [--audio-out run.wav]   write what the run sounds like (headless runs have no sound device)
         [--save-dir folder]
         [--debug PORT [--debug-wait]]   (listen for the studio's debugger on 127.0.0.1; 0 = any port; see docs/debugger.md)
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
    /// `nova ktx2 in.png out.ktx2`: a picture compressed for the GPU (ETC2).
    Ktx2 {
        input: PathBuf,
        out: PathBuf,
        linear: bool,
    },
    /// `nova wav in.ogg out.wav`: a sound decoded the way the game decodes it, as a 16-bit stereo WAV (for tools that measure it).
    Wav {
        input: PathBuf,
        out: PathBuf,
    },
    /// `nova glyphs <font> <px> <out.png> [--text words] [--project folder]`: text as a picture of its coverage (`glyphs.rs`).
    Glyphs {
        font: String,
        px: f32,
        out: PathBuf,
        text: String,
        project: Option<PathBuf>,
    },
    Info {
        folder: PathBuf,
    },
    Export {
        target: String,
        /// `None` only for `--benchmark` (android).
        folder: Option<PathBuf>,
        out: PathBuf,
        android: AndroidFlags,
    },
}

#[derive(Default)]
struct AndroidFlags {
    debug_build: bool,
    fast_build: bool,
    rebuild: bool,
    benchmark: bool,
    /// Skip `nova check` (scripts that test the engine on a device build games as they are).
    no_check: bool,
    /// `export desktop --exe <program>`: package this program (for example the ARM Linux build) instead of the one running.
    exe: Option<PathBuf>,
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
    if args.peek().map(String::as_str) == Some("ktx2") {
        args.next();
        let (mut files, mut linear) = (Vec::new(), false);
        for arg in args.by_ref() {
            match arg.as_str() {
                "--linear" => linear = true,
                _ => files.push(arg),
            }
        }
        let [input, out] = <[String; 2]>::try_from(files).map_err(
            |_| "`nova ktx2` needs a PNG and an output file: nova ktx2 [--linear] in.png out.ktx2",
        )?;
        return Ok(Command::Ktx2 {
            input: input.into(),
            out: out.into(),
            linear,
        });
    }
    if args.peek().map(String::as_str) == Some("glyphs") {
        args.next();
        let usage = "`nova glyphs` needs a font, a size in pixels and an output file: nova glyphs sans 64 out.png --text \"Pine Ridge\" [--project folder]";
        let (mut plain, mut text, mut project) = (Vec::new(), String::new(), None);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--text" => text = args.next().ok_or(usage)?,
                "--project" => project = Some(PathBuf::from(args.next().ok_or(usage)?)),
                _ => plain.push(arg),
            }
        }
        let [font, px, out] = <[String; 3]>::try_from(plain).map_err(|_| usage)?;
        return Ok(Command::Glyphs {
            font,
            px: px.parse().map_err(|_| usage)?,
            out: out.into(),
            text,
            project,
        });
    }
    if args.peek().map(String::as_str) == Some("wav") {
        args.next();
        let files: Vec<String> = args.by_ref().collect();
        let [input, out] = <[String; 2]>::try_from(files)
            .map_err(|_| "`nova wav` needs a sound and an output file: nova wav in.ogg out.wav")?;
        return Ok(Command::Wav {
            input: input.into(),
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
        let mut folder = None;
        let mut out = PathBuf::from("build/export");
        let mut android = AndroidFlags::default();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--out" => out = args.next().ok_or("--out needs a folder")?.into(),
                "--debug-build" if target == "android" => android.debug_build = true,
                "--fast" if target == "android" => android.fast_build = true,
                "--rebuild" if target == "android" => android.rebuild = true,
                "--benchmark" if target == "android" => android.benchmark = true,
                "--no-check" if target == "android" => android.no_check = true,
                "--exe" if target == "desktop" => {
                    android.exe = Some(args.next().ok_or("--exe needs a program")?.into())
                }
                other if folder.is_none() && !other.starts_with("--") => {
                    folder = Some(PathBuf::from(other))
                }
                other => return Err(format!("`nova export`: unexpected argument '{other}'")),
            }
        }
        if folder.is_none() && !android.benchmark {
            return Err("`nova export` needs a project folder after the target".into());
        }
        if folder.is_some() && android.benchmark {
            return Err("give either a project folder or --benchmark, not both".into());
        }
        return Ok(Command::Export {
            target,
            folder,
            out,
            android,
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
            "--debug" => {
                opts.debug = Some(
                    value("--debug")?
                        .parse()
                        .map_err(|_| "--debug needs a port number (0 = any free port)")?,
                )
            }
            "--debug-wait" => opts.debug_wait = true,
            "--play" => opts.play = Some(PathBuf::from(value("--play")?)),
            "--start-scene" => opts.start_scene = Some(value("--start-scene")?),
            "--run-lua" => opts.run_lua = Some(PathBuf::from(value("--run-lua")?)),
            "--audio-out" => opts.audio_out = Some(PathBuf::from(value("--audio-out")?)),
            "--seed" => {
                opts.seed = Some(
                    value("--seed")?
                        .parse()
                        .map_err(|_| "--seed needs a whole number")?,
                )
            }
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

fn ktx2(input: PathBuf, out: PathBuf, linear: bool) -> Result<(), String> {
    let bytes =
        std::fs::read(&input).map_err(|e| format!("cannot read {}: {e}", input.display()))?;
    let image = nova_runtime::assets::decode_png(&bytes)?;
    let file = nova_runtime::ktx2::encode_etc2(&image, !linear)?;
    std::fs::write(&out, &file).map_err(|e| format!("cannot write {}: {e}", out.display()))?;
    println!(
        "{} x {} ETC2 -> {}: {} bytes (the picture was {} in RGBA8)",
        image.width,
        image.height,
        out.display(),
        file.len(),
        image.rgba.len()
    );
    Ok(())
}

fn wav(input: PathBuf, out: PathBuf) -> Result<(), String> {
    let bytes =
        std::fs::read(&input).map_err(|e| format!("cannot read {}: {e}", input.display()))?;
    let sample = nova_runtime::assets::decode_sound(&input.to_string_lossy(), &bytes)
        .map_err(|e| format!("{}: {e}", input.display()))?;
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: sample.rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&out, spec)
        .map_err(|e| format!("cannot write {}: {e}", out.display()))?;
    for frame in &sample.frames {
        for s in frame {
            writer.write_sample(*s).map_err(|e| e.to_string())?;
        }
    }
    writer.finalize().map_err(|e| e.to_string())?;
    println!(
        "{}: {:.2} s at {} Hz -> {}",
        input.display(),
        sample.seconds(),
        sample.rate,
        out.display()
    );
    Ok(())
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
    println!(
        "network={}",
        if project.manifest.local_network {
            "yes"
        } else {
            "no"
        }
    );
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
    folder: Option<&std::path::Path>,
    out: &std::path::Path,
    android: &AndroidFlags,
) -> Result<(), String> {
    log::set_max_level(log::LevelFilter::Off);
    let report = folder
        .filter(|_| !android.no_check)
        .map(|f| export::check_project(f, 60));
    if let Some(report) = &report {
        print_problems(&report.problems);
        if !report.ok {
            return Err(
                "the game has errors, so it was not exported (fix them, or run `nova check`)"
                    .into(),
            );
        }
    }
    let exe = match &android.exe {
        Some(exe) => exe.clone(),
        None => std::env::current_exe().map_err(|e| format!("cannot find this program: {e}"))?,
    };
    if target == "desktop" {
        let folder = folder.ok_or("`nova export desktop` needs a project folder")?;
        let notices = std::fs::read_to_string(
            exe.parent()
                .map(|d| d.join("THIRD-PARTY.txt"))
                .unwrap_or_default(),
        )
        .ok()
        .or_else(|| Some(include_str!("../../../licenses/rust-dependencies.txt").to_string()));
        let done = export::export_desktop(folder, out, &exe, notices.as_deref())?;
        println!("exported to {}:", done.dir.display());
        for f in &done.files {
            println!("  {f}");
        }
        return Ok(());
    }
    export_android(folder, out, android, &exe)
}

/// The Nova source tree (where the engine is built for Android): `NOVA_REPO`, or a folder above the working
/// directory or this program that has the runtime's crate.
fn find_repo(exe: &std::path::Path) -> Option<PathBuf> {
    let is_repo = |d: &std::path::Path| d.join("crates/nova-runtime/Cargo.toml").is_file();
    if let Some(repo) = std::env::var_os("NOVA_REPO").map(PathBuf::from) {
        return is_repo(&repo).then_some(repo);
    }
    let starts = [
        std::env::current_dir().unwrap_or_default(),
        exe.to_path_buf(),
    ];
    starts
        .iter()
        .flat_map(|s| s.ancestors())
        .find(|d| is_repo(d))
        .map(std::path::Path::to_path_buf)
}

/// Builds the APK. Each step is printed as `[step] ...` (the studio shows these as progress), and the last lines
/// name the file and the package (`scripts/device-smoke.sh` reads the `package:` line).
fn export_android(
    folder: Option<&std::path::Path>,
    out: &std::path::Path,
    flags: &AndroidFlags,
    exe: &std::path::Path,
) -> Result<(), String> {
    use std::io::Write as _;
    let repo = find_repo(exe);
    // A studio bundle can carry a prebuilt engine beside the program instead of the source tree.
    let library = exe
        .parent()
        .map(|d| {
            d.join("android")
                .join(android::ABI)
                .join("libnova_runtime.so")
        })
        .filter(|p| repo.is_none() && p.is_file());
    if repo.is_none() && library.is_none() {
        return Err(
            "building an APK needs the Nova source tree (to build the engine for Android): run this from \
             inside it, or set NOVA_REPO to its folder"
                .into(),
        );
    }
    let build = android::AndroidBuild {
        project: folder.map(std::path::Path::to_path_buf),
        out: out.to_path_buf(),
        repo,
        library,
        debug_build: flags.debug_build,
        fast_build: flags.fast_build,
        rebuild: flags.rebuild,
    };
    let started = std::time::Instant::now();
    let built = android::build_apk(&build, &mut |step| {
        println!("[step] {step}");
        let _ = std::io::stdout().flush();
    })?;
    println!(
        "built in {:.1} s{}",
        started.elapsed().as_secs_f32(),
        if built.base_reused {
            " (only the game was repacked)"
        } else {
            ""
        }
    );
    println!("apk: {}", built.apk.display());
    println!(
        "package: {}   label: {}   version: {}",
        built.package, built.label, built.version
    );
    println!("(debug-signed: release signing is yours to do)");
    Ok(())
}

fn main() {
    // Linux with PipeWire (Armada, Zaviya, SteamOS): the ALSA plugin's default period is 262144 frames (5.5 s per audio callback, so
    // sound arrives seconds late and the music stream starves). Ask for 256-frame periods in a 1024-frame buffer (2048 and 8192 bytes of 32-bit stereo; ALSA fills the whole buffer ahead, so its default size is seconds of delay) unless the person
    // set their own. Done first, while the program is still single-threaded (set_var is unsafe for that reason).
    #[cfg(target_os = "linux")]
    if std::env::var_os("PIPEWIRE_ALSA").is_none() {
        // SAFETY: nothing else runs yet.
        unsafe {
            std::env::set_var(
                "PIPEWIRE_ALSA",
                "{ alsa.period-bytes=2048 alsa.buffer-bytes=8192 node.latency=256/48000 }",
            )
        };
    }
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
        Command::Ktx2 { input, out, linear } => ktx2(input, out, linear),
        Command::Wav { input, out } => wav(input, out),
        Command::Glyphs {
            font,
            px,
            out,
            text,
            project,
        } => nova_runtime::glyphs::command(&font, px, &text, &out, project.as_deref()),
        Command::Info { folder } => info(folder),
        Command::Export {
            target,
            folder,
            out,
            android,
        } => export_game(&target, folder.as_deref(), &out, &android),
        Command::Check {
            folder,
            json,
            frames,
        } => match check(&folder, json, frames) {
            Ok(true) => Ok(()),
            Ok(false) => std::process::exit(1),
            Err(e) => Err(e),
        },
        Command::Play(opts) if opts.headless => {
            nova_runtime::shutdown::install();
            app::run_headless(*opts)
        }
        Command::Play(opts) => {
            nova_runtime::shutdown::install();
            app::run_windowed(*opts)
        }
    };
    if let Err(e) = result {
        eprintln!("nova: {e}");
        std::process::exit(1);
    }
}

//! Desktop entry point.
//!
//!   nova run <project-folder>        play a Nova project (F3 toggles the stats, Esc quits)
//!   nova run --pak game.npk          play a packed project
//!   nova pack <project-folder> out.npk    pack a project into one file (what the APK carries)
//!   nova                             the built-in M1 benchmark scene
//!   nova --world-height 0            render the world at native resolution (default: project, or 540)
//!   nova --headless --frames 300 --capture out.png    offscreen run and capture
//!   nova --frames 600 --uncapped --no-audio           windowed benchmark without vsync
//!   nova --script path.lua           benchmark scene driven by a script from disk (hot reload)

use std::path::PathBuf;
use std::sync::Arc;

use nova_runtime::app::{self, Options, PakBytes};
use nova_runtime::pak;
use nova_runtime::vfs::DirVfs;

const USAGE: &str = "usage:
  nova run <project-folder> [options]    play a Nova project
  nova run --pak <file.npk> [options]    play a packed project
  nova pack <project-folder> <out.npk>   pack a project into one file
  nova info <project-folder>             print the project's name, version and id (for build scripts)
  nova [options]                         built-in benchmark scene
options: [--headless] [--frames N] [--capture out.png] [--size WxH] [--world-height N]
         [--uncapped] [--no-audio] [--hud] [--hold throttle,steer=1] [--save-dir folder]
         [--script file.lua (benchmark scene only)]";

enum Command {
    Play(Box<Options>),
    Pack { folder: PathBuf, out: PathBuf },
    Info { folder: PathBuf },
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
    if args.peek().map(String::as_str) == Some("info") {
        args.next();
        let folder = args.next().ok_or("`nova info` needs a project folder")?;
        return Ok(Command::Info {
            folder: folder.into(),
        });
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
        Command::Play(opts) if opts.headless => app::run_headless(*opts),
        Command::Play(opts) => app::run_windowed(*opts),
    };
    if let Err(e) = result {
        eprintln!("nova: {e}");
        std::process::exit(1);
    }
}

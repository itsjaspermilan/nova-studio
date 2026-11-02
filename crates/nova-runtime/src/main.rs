//! Desktop entry point.
//!
//!   nova run <project-folder>    play a Nova project (F3 toggles the stats, Esc quits)
//!   nova                         the built-in M1 benchmark scene
//!   nova --world-height 0        render the world at native resolution (default: project, or 540)
//!   nova --headless --frames 300 --capture out.png    offscreen run and capture
//!   nova --frames 600 --uncapped --no-audio           windowed benchmark without vsync
//!   nova --script path.lua       benchmark scene driven by a script from disk (hot reload)

use nova_runtime::app::{self, Options};

const USAGE: &str = "usage:
  nova run <project-folder> [options]    play a Nova project
  nova [options]                         built-in benchmark scene
options: [--headless] [--frames N] [--capture out.png] [--size WxH] [--world-height N]
         [--uncapped] [--no-audio] [--hud] [--script file.lua (benchmark scene only)]";

fn parse() -> Result<Options, String> {
    let mut opts = Options::default();
    let mut args = std::env::args().skip(1).peekable();
    if args.peek().map(String::as_str) == Some("run") {
        args.next();
        let folder = args.next().ok_or("`nova run` needs a project folder")?;
        opts.project = Some(folder.into());
    }
    while let Some(arg) = args.next() {
        let mut value = |name: &str| args.next().ok_or(format!("{name} needs a value"));
        match arg.as_str() {
            "--headless" => opts.headless = true,
            "--uncapped" => opts.uncapped = true,
            "--no-audio" => opts.no_audio = true,
            "--hud" => opts.hud = true,
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
    if opts.project.is_some() && opts.script.is_some() {
        return Err("--script only applies to the benchmark scene, not `nova run`".into());
    }
    Ok(opts)
}

fn main() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("nova_runtime=info,warn"),
    )
    .init();
    let opts = match parse() {
        Ok(o) => o,
        Err(e) => {
            eprintln!("nova: {e}");
            std::process::exit(2);
        }
    };
    let result = if opts.headless {
        app::run_headless(opts)
    } else {
        app::run_windowed(opts)
    };
    if let Err(e) = result {
        eprintln!("nova: {e}");
        std::process::exit(1);
    }
}

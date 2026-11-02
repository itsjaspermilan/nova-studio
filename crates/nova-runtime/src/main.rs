//! Desktop entry point for the M1 spike.
//!
//!   nova                         open a window (Esc quits)
//!   nova --script path.lua       use (and hot-reload) a script from disk
//!   nova --headless --frames 300 --capture out.png    offscreen benchmark and capture
//!   nova --frames 600 --uncapped --no-audio           windowed benchmark without vsync

use nova_runtime::app::{self, Options};

fn parse() -> Result<Options, String> {
    let mut opts = Options::default();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = |name: &str| args.next().ok_or(format!("{name} needs a value"));
        match arg.as_str() {
            "--headless" => opts.headless = true,
            "--uncapped" => opts.uncapped = true,
            "--no-audio" => opts.no_audio = true,
            "--frames" => {
                opts.frames = Some(
                    value("--frames")?
                        .parse()
                        .map_err(|_| "--frames needs a number")?,
                )
            }
            "--capture" => opts.capture = Some(value("--capture")?.into()),
            "--script" => opts.script = Some(value("--script")?.into()),
            "--size" => {
                let v = value("--size")?;
                let (w, h) = v.split_once('x').ok_or("--size needs WIDTHxHEIGHT")?;
                opts.size = (
                    w.parse().map_err(|_| "bad width")?,
                    h.parse().map_err(|_| "bad height")?,
                );
            }
            "--help" | "-h" => {
                println!(
                    "usage: nova [--headless] [--frames N] [--capture out.png] [--script file.lua] [--size WxH] [--uncapped] [--no-audio]"
                );
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument '{other}' (try --help)")),
        }
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

//! `nova-ogg in.wav out.ogg [quality]`: the studio's WAV-to-Ogg encoder as a command, for tools that make music
//! outside the app (the Nova MCP server). It is the same function the studio calls when it saves a song.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output, rest @ ..] = args.as_slice() else {
        eprintln!("usage: nova-ogg in.wav out.ogg [quality -0.1..1]");
        return ExitCode::from(2);
    };
    let quality = rest
        .first()
        .and_then(|q| q.parse().ok())
        .unwrap_or(studio_lib::audio_files::DEFAULT_QUALITY);
    let result = std::fs::read(input)
        .map_err(|e| format!("cannot read {input}: {e}"))
        .and_then(|wav| studio_lib::audio_files::wav_to_ogg(&wav, quality))
        .and_then(|ogg| {
            std::fs::write(output, ogg).map_err(|e| format!("cannot write {output}: {e}"))
        });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

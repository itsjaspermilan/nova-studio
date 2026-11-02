//! `cargo run -p nova-studio --example wav2ogg -- in.wav out.ogg [quality]`: the studio's WAV-to-Ogg encoder as a tool.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (Some(input), Some(output)) = (args.first(), args.get(1)) else {
        eprintln!("usage: wav2ogg in.wav out.ogg [quality -0.1..1.0]");
        std::process::exit(2);
    };
    let quality = args
        .get(2)
        .and_then(|q| q.parse().ok())
        .unwrap_or(studio_lib::audio_files::DEFAULT_QUALITY);
    let wav = std::fs::read(input).unwrap_or_else(|e| panic!("cannot read {input}: {e}"));
    let ogg = studio_lib::audio_files::wav_to_ogg(&wav, quality).unwrap_or_else(|e| panic!("{e}"));
    std::fs::write(output, &ogg).unwrap_or_else(|e| panic!("cannot write {output}: {e}"));
    println!(
        "{} -> {}: {} bytes (from {})",
        input,
        output,
        ogg.len(),
        wav.len()
    );
}

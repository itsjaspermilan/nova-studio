//! Prints the loudness of Pine Ridge Rally's sounds and music (RMS of the loud parts, and the peak, in dBFS), to balance them by ear and by number.
//! `cargo test --release -p nova-runtime --test loudness -- --ignored --nocapture`
use std::path::Path;

fn db(x: f64) -> f64 {
    20.0 * x.max(1e-9).log10()
}

fn stats(samples: &[f32]) -> (f64, f64) {
    // RMS over 100 ms windows, keeping the windows that are not near silence, so that a short effect is not averaged away over its tail
    let win = 4800;
    let mut peak = 0.0f64;
    let mut sums = vec![];
    for chunk in samples.chunks(win) {
        let e: f64 = chunk.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / chunk.len() as f64;
        sums.push(e);
        for s in chunk {
            peak = peak.max((*s as f64).abs());
        }
    }
    let max = sums.iter().cloned().fold(0.0, f64::max);
    let loud: Vec<f64> = sums.iter().cloned().filter(|e| *e > max * 0.05).collect();
    let rms = (loud.iter().sum::<f64>() / loud.len().max(1) as f64).sqrt();
    (db(rms), db(peak))
}

fn wav(bytes: &[u8]) -> Vec<f32> {
    let mut i = 12;
    let (mut fmt, mut bits, mut ch) = (1u16, 16u16, 1u16);
    while i + 8 <= bytes.len() {
        let id = &bytes[i..i + 4];
        let n = u32::from_le_bytes(bytes[i + 4..i + 8].try_into().unwrap()) as usize;
        let body = &bytes[i + 8..(i + 8 + n).min(bytes.len())];
        if id == b"fmt " {
            fmt = u16::from_le_bytes([body[0], body[1]]);
            ch = u16::from_le_bytes([body[2], body[3]]);
            bits = u16::from_le_bytes([body[14], body[15]]);
        } else if id == b"data" {
            let _ = ch;
            return match (fmt, bits) {
                (3, 32) => body.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect(),
                (_, 16) => body.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect(),
                _ => vec![],
            };
        }
        i += 8 + n + (n & 1);
    }
    vec![]
}

fn ogg(path: &Path) -> Vec<f32> {
    let mut r = lewton::inside_ogg::OggStreamReader::new(std::fs::File::open(path).unwrap()).unwrap();
    let mut out = vec![];
    while let Some(p) = r.read_dec_packet_itl().unwrap() {
        out.extend(p.iter().map(|s| *s as f32 / 32768.0));
    }
    out
}

#[test]
#[ignore]
fn loudness() {
    let project = std::env::var("LOUDNESS_PROJECT").unwrap_or_else(|_| "pine-ridge-rally".into());
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples").join(project);
    for dir in ["sounds", "music"] {
        let mut names: Vec<_> = std::fs::read_dir(root.join(dir)).unwrap().map(|e| e.unwrap().path()).collect();
        names.sort();
        for p in names {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            let s = match ext {
                "wav" => wav(&std::fs::read(&p).unwrap()),
                "ogg" => ogg(&p),
                _ => continue,
            };
            if s.is_empty() {
                continue;
            }
            let name = p.file_name().unwrap().to_str().unwrap();
            if name.starts_with("eng_") && !name.starts_with("eng_car_sedan") && !name.starts_with("eng_car_1") {
                continue;
            }
            let (rms, peak) = stats(&s);
            println!("{dir}/{name:32} rms {rms:6.1} dB  peak {peak:6.1} dB");
        }
    }
}

//! Audio conversion for the studio: WAV to Ogg Vorbis (so music can be small and streamed by the game) and Ogg back to
//! WAV (so the studio's webview, which cannot play Ogg Vorbis itself, can play it). Pure functions on bytes.

use std::io::Cursor;
use std::num::{NonZeroU8, NonZeroU32};

use vorbis_rs::{VorbisBitrateManagementStrategy, VorbisEncoderBuilder};

/// Default Vorbis quality: -0.1 (smallest) to 1.0 (best). 0.5 is about 160 kbit/s: transparent for game music.
pub const DEFAULT_QUALITY: f32 = 0.5;

struct Decoded {
    rate: u32,
    /// One vector per channel (1 or 2), samples in -1..1.
    channels: Vec<Vec<f32>>,
}

fn read_wav(bytes: &[u8]) -> Result<Decoded, String> {
    let mut reader = hound::WavReader::new(Cursor::new(bytes))
        .map_err(|e| format!("not a readable WAV file: {e}"))?;
    let spec = reader.spec();
    if spec.channels == 0 || spec.channels > 2 {
        return Err(format!(
            "{} channels is not supported; use mono or stereo",
            spec.channels
        ));
    }
    if !(8_000..=192_000).contains(&spec.sample_rate) {
        return Err(format!(
            "{} Hz is outside the supported 8000 to 192000 Hz",
            spec.sample_rate
        ));
    }
    let interleaved: Vec<f32> = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Float, 32) => reader.samples::<f32>().collect::<Result<_, _>>(),
        (hound::SampleFormat::Int, 8) => reader
            .samples::<i8>()
            .map(|s| s.map(|v| v as f32 / 128.0))
            .collect(),
        (hound::SampleFormat::Int, 16) => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / 32768.0))
            .collect(),
        (hound::SampleFormat::Int, 24) => reader
            .samples::<i32>()
            .map(|s| s.map(|v| v as f32 / 8_388_608.0))
            .collect(),
        (hound::SampleFormat::Int, 32) => reader
            .samples::<i32>()
            .map(|s| s.map(|v| v as f32 / 2_147_483_648.0))
            .collect(),
        (format, bits) => return Err(format!("{bits}-bit {format:?} WAV is not supported")),
    }
    .map_err(|e| format!("WAV data is damaged: {e}"))?;
    let n = spec.channels as usize;
    let mut channels = vec![Vec::with_capacity(interleaved.len() / n); n];
    for frame in interleaved.chunks_exact(n) {
        for (c, v) in channels.iter_mut().zip(frame) {
            c.push(v.clamp(-1.0, 1.0));
        }
    }
    if channels[0].is_empty() {
        return Err("the WAV file has no audio".into());
    }
    Ok(Decoded {
        rate: spec.sample_rate,
        channels,
    })
}

/// The loop of a WAV file's `smpl` chunk (start frame, end frame), if it has one: where the game should loop the music back to.
pub fn wav_loop_points(wav: &[u8]) -> Option<(u32, u32)> {
    if wav.len() < 12 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return None;
    }
    let mut at = 12;
    while at + 8 <= wav.len() {
        let size = u32::from_le_bytes(wav[at + 4..at + 8].try_into().ok()?) as usize;
        let body = at + 8;
        if &wav[at..at + 4] == b"smpl" && size >= 36 + 24 && body + 36 + 24 <= wav.len() {
            let loops = u32::from_le_bytes(wav[body + 28..body + 32].try_into().ok()?);
            if loops >= 1 {
                let l = body + 36;
                let start = u32::from_le_bytes(wav[l + 8..l + 12].try_into().ok()?);
                let end = u32::from_le_bytes(wav[l + 12..l + 16].try_into().ok()?);
                return (end > start).then_some((start, end));
            }
        }
        at = body + size + (size & 1);
    }
    None
}

/// Encodes WAV bytes (8, 16, 24 or 32-bit PCM or float; mono or stereo) as Ogg Vorbis at `quality` (-0.1 to 1). A loop in the WAV's `smpl` chunk is written as the
/// Vorbis comments `LOOPSTART` and `LOOPLENGTH` (in frames), which the game reads to loop back to the loop's start instead of the beginning.
pub fn wav_to_ogg(wav: &[u8], quality: f32) -> Result<Vec<u8>, String> {
    let audio = read_wav(wav)?;
    let mut out = Vec::new();
    let rate = NonZeroU32::new(audio.rate).ok_or("the sample rate is 0")?;
    let channels = NonZeroU8::new(audio.channels.len() as u8).ok_or("no channels")?;
    let mut builder = VorbisEncoderBuilder::new(rate, channels, &mut out)
        .map_err(|e| format!("cannot start the Ogg encoder: {e}"))?;
    if let Some((start, end)) = wav_loop_points(wav) {
        builder
            .comment_tag("LOOPSTART", start.to_string())
            .map_err(|e| format!("cannot write the loop points: {e}"))?;
        builder
            .comment_tag("LOOPLENGTH", (end - start).to_string())
            .map_err(|e| format!("cannot write the loop points: {e}"))?;
    }
    let mut encoder = builder
        .bitrate_management_strategy(VorbisBitrateManagementStrategy::QualityVbr {
            target_quality: quality.clamp(-0.1, 1.0),
        })
        .build()
        .map_err(|e| format!("cannot start the Ogg encoder: {e}"))?;
    // Feed it in blocks so memory stays modest for long songs.
    let total = audio.channels[0].len();
    let block = 1 << 16;
    let mut at = 0;
    while at < total {
        let end = (at + block).min(total);
        let slices: Vec<&[f32]> = audio.channels.iter().map(|c| &c[at..end]).collect();
        encoder
            .encode_audio_block(slices)
            .map_err(|e| format!("Ogg encoding failed: {e}"))?;
        at = end;
    }
    encoder
        .finish()
        .map_err(|e| format!("Ogg encoding failed: {e}"))?;
    Ok(out)
}

/// Decodes Ogg Vorbis (mono or stereo) to 16-bit WAV bytes.
pub fn ogg_to_wav(ogg: &[u8]) -> Result<Vec<u8>, String> {
    use lewton::inside_ogg::OggStreamReader;
    let mut reader = OggStreamReader::new(Cursor::new(ogg))
        .map_err(|e| format!("not a readable Ogg Vorbis file: {e}"))?;
    let channels = reader.ident_hdr.audio_channels as u16;
    if channels == 0 || channels > 2 {
        return Err(format!(
            "{channels} channels is not supported; use mono or stereo"
        ));
    }
    let spec = hound::WavSpec {
        channels,
        sample_rate: reader.ident_hdr.audio_sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec).map_err(|e| e.to_string())?;
        while let Some(packet) = reader
            .read_dec_packet_itl()
            .map_err(|e| format!("Ogg Vorbis data is damaged: {e}"))?
        {
            for s in packet {
                writer.write_sample(s).map_err(|e| e.to_string())?;
            }
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(channels: u16, rate: u32, seconds: f32, hz: f32, bits: u16, float: bool) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let spec = hound::WavSpec {
                channels,
                sample_rate: rate,
                bits_per_sample: bits,
                sample_format: if float {
                    hound::SampleFormat::Float
                } else {
                    hound::SampleFormat::Int
                },
            };
            let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
            for i in 0..(rate as f32 * seconds) as usize {
                let v = (i as f32 / rate as f32 * hz * std::f32::consts::TAU).sin() * 0.6;
                for c in 0..channels {
                    let v = if c == 1 { -v } else { v };
                    match (float, bits) {
                        (true, _) => w.write_sample(v).unwrap(),
                        (false, 8) => w.write_sample((v * 127.0) as i8).unwrap(),
                        (false, 16) => w.write_sample((v * 32767.0) as i16).unwrap(),
                        (false, 24) => w.write_sample((v * 8_388_607.0) as i32).unwrap(),
                        _ => w.write_sample((v * 2_147_483_647.0) as i32).unwrap(),
                    }
                }
            }
            w.finalize().unwrap();
        }
        cursor.into_inner()
    }

    fn crossings(samples: &[i16]) -> usize {
        samples
            .windows(2)
            .filter(|w| (w[0] < 0) != (w[1] < 0))
            .count()
    }

    fn decode_i16(wav_bytes: &[u8]) -> (hound::WavSpec, Vec<i16>) {
        let mut r = hound::WavReader::new(Cursor::new(wav_bytes)).unwrap();
        (r.spec(), r.samples::<i16>().map(|s| s.unwrap()).collect())
    }

    #[test]
    fn a_stereo_song_becomes_a_much_smaller_ogg_that_decodes_to_the_same_sound() {
        let source = wav(2, 44100, 4.0, 440.0, 16, false);
        let ogg = wav_to_ogg(&source, DEFAULT_QUALITY).unwrap();
        assert!(&ogg[..4] == b"OggS", "an Ogg container");
        assert!(
            ogg.len() * 5 < source.len(),
            "{} bytes of Ogg for {} of WAV",
            ogg.len(),
            source.len()
        );
        let (spec, samples) = decode_i16(&ogg_to_wav(&ogg).unwrap());
        assert_eq!((spec.channels, spec.sample_rate), (2, 44100));
        let frames = samples.len() / 2;
        assert!(
            (frames as i64 - 4 * 44100).abs() < 4096,
            "about 4 seconds back, got {frames} frames"
        );
        let left: Vec<i16> = samples.iter().step_by(2).copied().collect();
        let hz = crossings(&left) as f32 / 2.0 / (frames as f32 / 44100.0);
        assert!(
            (hz - 440.0).abs() < 8.0,
            "still a 440 Hz tone, measured {hz}"
        );
        let peak = left.iter().map(|s| s.unsigned_abs()).max().unwrap();
        assert!(
            (15000..24000).contains(&peak),
            "about the original loudness, peak {peak}"
        );
    }

    #[test]
    fn mono_and_every_wav_depth_encode() {
        for (channels, bits, float) in [
            (1, 16, false),
            (1, 8, false),
            (2, 24, false),
            (1, 32, false),
            (2, 32, true),
        ] {
            let ogg = wav_to_ogg(&wav(channels, 22050, 0.5, 300.0, bits, float), 0.3)
                .unwrap_or_else(|e| panic!("{channels}ch {bits}bit float={float}: {e}"));
            let (spec, samples) = decode_i16(&ogg_to_wav(&ogg).unwrap());
            assert_eq!((spec.channels, spec.sample_rate), (channels, 22050));
            assert!(
                samples.len() >= 22050 / 2 * channels as usize / 2,
                "{channels}ch {bits}bit: {} samples",
                samples.len()
            );
        }
    }

    #[test]
    fn better_quality_costs_more_bytes() {
        let source = wav(2, 44100, 2.0, 1000.0, 16, false);
        let low = wav_to_ogg(&source, 0.0).unwrap().len();
        let high = wav_to_ogg(&source, 1.0).unwrap().len();
        assert!(
            high > low,
            "quality 1.0 ({high}) should be bigger than 0.0 ({low})"
        );
    }

    #[test]
    fn silence_and_very_short_clips_work() {
        let mut cursor = Cursor::new(Vec::new());
        {
            let spec = hound::WavSpec {
                channels: 1,
                sample_rate: 8000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };
            let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
            for _ in 0..100 {
                w.write_sample(0i16).unwrap();
            }
            w.finalize().unwrap();
        }
        let ogg = wav_to_ogg(&cursor.into_inner(), DEFAULT_QUALITY).unwrap();
        assert!(!decode_i16(&ogg_to_wav(&ogg).unwrap()).1.is_empty());
    }

    #[test]
    fn unusable_input_is_explained() {
        assert!(
            wav_to_ogg(b"nope", 0.5)
                .unwrap_err()
                .contains("not a readable WAV")
        );
        assert!(
            wav_to_ogg(&wav(2, 4000, 0.1, 100.0, 16, false), 0.5)
                .unwrap_err()
                .contains("outside the supported")
        );
        assert!(
            ogg_to_wav(b"OggSnonsense")
                .unwrap_err()
                .contains("not a readable Ogg")
        );
        let mut cursor = Cursor::new(Vec::new());
        {
            let spec = hound::WavSpec {
                channels: 1,
                sample_rate: 8000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };
            hound::WavWriter::new(&mut cursor, spec)
                .unwrap()
                .finalize()
                .unwrap();
        }
        assert!(
            wav_to_ogg(&cursor.into_inner(), 0.5)
                .unwrap_err()
                .contains("no audio")
        );
    }

    /// Appends a `smpl` chunk with one loop (start and end frames) to WAV bytes.
    fn with_loop(mut wav: Vec<u8>, start: u32, end: u32) -> Vec<u8> {
        let mut chunk = Vec::new();
        chunk.extend(b"smpl");
        chunk.extend(60u32.to_le_bytes());
        for v in [0u32, 0, 22_675, 60, 0, 0, 0, 1, 0] {
            chunk.extend(v.to_le_bytes());
        }
        for v in [0u32, 0, start, end, 0, 0] {
            chunk.extend(v.to_le_bytes());
        }
        wav.extend(chunk);
        let riff = (wav.len() - 8) as u32;
        wav[4..8].copy_from_slice(&riff.to_le_bytes());
        wav
    }

    #[test]
    fn a_wav_loop_is_read_and_written_as_vorbis_loop_comments() {
        let plain = wav(1, 44_100, 0.5, 440.0, 16, false);
        assert_eq!(wav_loop_points(&plain), None);
        let looped = with_loop(plain, 11_025, 22_050);
        assert_eq!(wav_loop_points(&looped), Some((11_025, 22_050)));
        let ogg = wav_to_ogg(&looped, 0.3).unwrap();
        let reader = lewton::inside_ogg::OggStreamReader::new(Cursor::new(&ogg)).unwrap();
        let tags: std::collections::HashMap<String, String> =
            reader.comment_hdr.comment_list.iter().cloned().collect();
        assert_eq!(tags.get("LOOPSTART").map(String::as_str), Some("11025"));
        assert_eq!(tags.get("LOOPLENGTH").map(String::as_str), Some("11025"));
        // without a loop there are no such comments
        let ogg = wav_to_ogg(&wav(1, 44_100, 0.2, 440.0, 16, false), 0.3).unwrap();
        let reader = lewton::inside_ogg::OggStreamReader::new(Cursor::new(&ogg)).unwrap();
        assert!(
            reader
                .comment_hdr
                .comment_list
                .iter()
                .all(|(k, _)| k != "LOOPSTART")
        );
    }

    /// Writes the fixture the game's tests use: a 3 second mono 8 kHz Ogg with a loop from frame 8000 to 16000 (`NOVA_WRITE_LOOP_FIXTURE=path`).
    #[test]
    fn writes_the_loop_fixture_when_asked() {
        let Ok(path) = std::env::var("NOVA_WRITE_LOOP_FIXTURE") else {
            return;
        };
        let looped = with_loop(wav(1, 8_000, 3.0, 440.0, 16, false), 8_000, 16_000);
        std::fs::write(path, wav_to_ogg(&looped, 0.0).unwrap()).unwrap();
    }
}

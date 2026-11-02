//! Image decoding and the sprite atlas packer.
//!
//! All of a project's PNGs are decoded once, packed into one atlas texture (a shelf
//! packer with a 1px transparent gutter) and uploaded once; nothing is decoded or
//! uploaded per frame. A 4x4 white block is always included for solid shapes and text.

use std::collections::BTreeMap;
use std::io::Cursor;

use crate::model::Image;

pub const WHITE: &str = "nova:white";
pub const MAX_ATLAS: u32 = 4096;
const GUTTER: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AtlasRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Clone, Debug)]
pub struct AtlasLayout {
    pub size: (u32, u32),
    pub rects: BTreeMap<String, AtlasRect>,
}

impl AtlasLayout {
    /// UV rectangle `[u0, v0, u1, v1]`, inset by a hundredth of a texel against bleeding.
    pub fn uv(&self, rect: &AtlasRect) -> [f32; 4] {
        let (w, h) = (self.size.0 as f32, self.size.1 as f32);
        let inset = 0.01;
        [
            (rect.x as f32 + inset) / w,
            (rect.y as f32 + inset) / h,
            ((rect.x + rect.w) as f32 - inset) / w,
            ((rect.y + rect.h) as f32 - inset) / h,
        ]
    }

    /// A UV rectangle strictly inside the white block, safe for any scaling.
    pub fn white_uv(&self) -> [f32; 4] {
        let r = self.rects[WHITE];
        let (w, h) = (self.size.0 as f32, self.size.1 as f32);
        [
            (r.x as f32 + 1.0) / w,
            (r.y as f32 + 1.0) / h,
            (r.x as f32 + 3.0) / w,
            (r.y as f32 + 3.0) / h,
        ]
    }
}

pub fn decode_png(bytes: &[u8]) -> Result<Image, String> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("not a readable PNG: {e}"))?;
    let size = reader
        .output_buffer_size()
        .ok_or("PNG is too large to decode")?;
    let mut buffer = vec![0u8; size];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|e| format!("PNG data is damaged: {e}"))?;
    let data = &buffer[..info.buffer_size()];
    let rgba: Vec<u8> = match info.color_type {
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Rgb => data
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|c| [c[0], c[1], c[2], 255])
            .collect(),
        png::ColorType::Grayscale => data.iter().flat_map(|&v| [v, v, v, 255]).collect(),
        png::ColorType::GrayscaleAlpha => data
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|c| [c[0], c[0], c[0], c[1]])
            .collect(),
        png::ColorType::Indexed => return Err("indexed PNG was not expanded".into()),
    };
    if info.width == 0 || info.height == 0 {
        return Err("PNG has no pixels".into());
    }
    Ok(Image {
        width: info.width,
        height: info.height,
        rgba,
    })
}

fn try_pack(items: &[(usize, u32, u32)], side: u32) -> Option<Vec<(usize, u32, u32)>> {
    let mut placed = Vec::with_capacity(items.len());
    let (mut x, mut y, mut shelf) = (0u32, 0u32, 0u32);
    for &(index, w, h) in items {
        let (pw, ph) = (w + GUTTER, h + GUTTER);
        if pw > side {
            return None;
        }
        if x + pw > side {
            y += shelf;
            x = 0;
            shelf = 0;
        }
        if y + ph > side {
            return None;
        }
        placed.push((index, x, y));
        x += pw;
        shelf = shelf.max(ph);
    }
    Some(placed)
}

/// Packs the images (plus the built-in white block) into one atlas of at most `max` pixels square.
pub fn build_atlas(images: Vec<(String, Image)>, max: u32) -> Result<(Image, AtlasLayout), String> {
    let mut all: Vec<(String, Image)> = Vec::with_capacity(images.len() + 1);
    all.push((
        WHITE.to_string(),
        Image {
            width: 4,
            height: 4,
            rgba: vec![255; 4 * 4 * 4],
        },
    ));
    all.extend(images);
    if let Some((id, image)) = all
        .iter()
        .find(|(_, i)| i.width + GUTTER > max || i.height + GUTTER > max)
    {
        return Err(format!(
            "image '{id}' is {}x{}, too large for the {max}x{max} sprite atlas; make it smaller",
            image.width, image.height
        ));
    }
    let mut order: Vec<(usize, u32, u32)> = all
        .iter()
        .enumerate()
        .map(|(i, (_, im))| (i, im.width, im.height))
        .collect();
    order.sort_by(|a, b| b.2.cmp(&a.2).then(b.1.cmp(&a.1)).then(a.0.cmp(&b.0)));
    let mut side = 64u32;
    let placed = loop {
        if let Some(p) = try_pack(&order, side) {
            break p;
        }
        if side >= max {
            let total: u64 = all
                .iter()
                .map(|(_, i)| i.width as u64 * i.height as u64)
                .sum();
            return Err(format!(
                "the sprites do not fit one {max}x{max} atlas ({} images, about {} pixels in total). Remove or shrink some images.",
                all.len() - 1,
                total
            ));
        }
        side *= 2;
    };
    let mut pixels = vec![0u8; (side * side * 4) as usize];
    let mut rects = BTreeMap::new();
    for (index, x, y) in placed {
        let (id, image) = &all[index];
        for row in 0..image.height {
            let src = (row * image.width * 4) as usize;
            let dst = (((y + row) * side + x) * 4) as usize;
            pixels[dst..dst + (image.width * 4) as usize]
                .copy_from_slice(&image.rgba[src..src + (image.width * 4) as usize]);
        }
        rects.insert(
            id.clone(),
            AtlasRect {
                x,
                y,
                w: image.width,
                h: image.height,
            },
        );
    }
    Ok((
        Image {
            width: side,
            height: side,
            rgba: pixels,
        },
        AtlasLayout {
            size: (side, side),
            rects,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(w: u32, h: u32, c: [u8; 4]) -> Image {
        Image {
            width: w,
            height: h,
            rgba: c.repeat((w * h) as usize),
        }
    }

    fn encode(width: u32, height: u32, color: png::ColorType, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(color);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(data)
            .unwrap();
        out
    }

    #[test]
    fn decodes_rgba_rgb_and_gray_pngs_to_rgba() {
        let rgba = decode_png(&encode(1, 1, png::ColorType::Rgba, &[1, 2, 3, 4])).unwrap();
        assert_eq!(rgba.rgba, [1, 2, 3, 4]);
        let rgb = decode_png(&encode(1, 1, png::ColorType::Rgb, &[9, 8, 7])).unwrap();
        assert_eq!(rgb.rgba, [9, 8, 7, 255]);
        let gray = decode_png(&encode(2, 1, png::ColorType::Grayscale, &[5, 6])).unwrap();
        assert_eq!(gray.rgba, [5, 5, 5, 255, 6, 6, 6, 255]);
        let ga = decode_png(&encode(1, 1, png::ColorType::GrayscaleAlpha, &[5, 77])).unwrap();
        assert_eq!(ga.rgba, [5, 5, 5, 77]);
    }

    #[test]
    fn bad_png_data_gives_a_clear_error() {
        assert!(
            decode_png(b"definitely not a png")
                .unwrap_err()
                .contains("not a readable PNG")
        );
        let mut truncated = encode(4, 4, png::ColorType::Rgba, &[0; 64]);
        truncated.truncate(truncated.len() - 20);
        assert!(decode_png(&truncated).is_err());
    }

    #[test]
    fn atlas_places_everything_without_overlap_or_out_of_bounds() {
        let images: Vec<(String, Image)> = (0..40)
            .map(|i| {
                (
                    format!("img{i}.png"),
                    solid(10 + i % 7 * 5, 8 + i % 5 * 9, [i as u8, 0, 0, 255]),
                )
            })
            .collect();
        let (atlas, layout) = build_atlas(images, MAX_ATLAS).unwrap();
        assert_eq!(layout.rects.len(), 41, "40 images plus the white block");
        let rects: Vec<_> = layout.rects.values().collect();
        for r in &rects {
            assert!(r.x + r.w <= atlas.width && r.y + r.h <= atlas.height);
        }
        for (i, a) in rects.iter().enumerate() {
            for b in &rects[i + 1..] {
                let apart = a.x + a.w + GUTTER <= b.x
                    || b.x + b.w + GUTTER <= a.x
                    || a.y + a.h + GUTTER <= b.y
                    || b.y + b.h + GUTTER <= a.y;
                assert!(apart, "{a:?} overlaps {b:?}");
            }
        }
        let r = layout.rects["img3.png"];
        let i = ((r.y * atlas.width + r.x) * 4) as usize;
        assert_eq!(atlas.rgba[i], 3, "pixels were copied into place");
    }

    #[test]
    fn white_block_is_opaque_white_and_uv_is_inside_it() {
        let (atlas, layout) = build_atlas(vec![], MAX_ATLAS).unwrap();
        let uv = layout.white_uv();
        for (u, v) in [(uv[0], uv[1]), (uv[2], uv[3])] {
            let (x, y) = (
                (u * atlas.width as f32) as u32,
                (v * atlas.height as f32) as u32,
            );
            let i = ((y * atlas.width + x) * 4) as usize;
            assert_eq!(&atlas.rgba[i..i + 4], &[255, 255, 255, 255]);
        }
    }

    #[test]
    fn oversized_and_overfull_atlases_name_the_problem() {
        let e = build_atlas(
            vec![("huge.png".into(), solid(5000, 10, [0; 4]))],
            MAX_ATLAS,
        )
        .err()
        .unwrap();
        assert!(e.contains("'huge.png'") && e.contains("too large"), "{e}");
        let many: Vec<_> = (0..40)
            .map(|i| (format!("big{i}.png"), solid(900, 900, [1; 4])))
            .collect();
        let e = build_atlas(many, MAX_ATLAS).err().unwrap();
        assert!(e.contains("do not fit") && e.contains("40 images"), "{e}");
    }

    #[test]
    fn atlas_grows_only_as_needed() {
        let (small, _) =
            build_atlas(vec![("a.png".into(), solid(20, 20, [1; 4]))], MAX_ATLAS).unwrap();
        assert_eq!(small.width, 64);
        let (bigger, _) =
            build_atlas(vec![("a.png".into(), solid(100, 100, [1; 4]))], MAX_ATLAS).unwrap();
        assert_eq!(bigger.width, 128);
    }
}

/// Longest sound the mixer will hold in memory, and the total across a project.
pub const MAX_SOUND_SECONDS: f32 = 600.0;
pub const MAX_SOUND_BYTES: usize = 256 << 20;

/// Decodes a WAV file (8, 16, 24 or 32-bit integer or 32-bit float PCM; mono or stereo) to the
/// mixer's 16-bit stereo format.
pub fn decode_wav(bytes: &[u8]) -> Result<crate::mixer::Sample, String> {
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
    let channels = spec.channels as usize;
    let to_i16 = |v: f32| (v.clamp(-1.0, 1.0) * 32767.0).round() as i16;
    let samples: Vec<i16> = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Int, 8) => reader.samples::<i8>().map(|s| s.map(|v| (v as i16) << 8)).collect::<Result<_, _>>(),
        (hound::SampleFormat::Int, 16) => reader.samples::<i16>().collect::<Result<_, _>>(),
        (hound::SampleFormat::Int, 24) => reader.samples::<i32>().map(|s| s.map(|v| (v >> 8) as i16)).collect::<Result<_, _>>(),
        (hound::SampleFormat::Int, 32) => reader.samples::<i32>().map(|s| s.map(|v| (v >> 16) as i16)).collect::<Result<_, _>>(),
        (hound::SampleFormat::Float, 32) => reader.samples::<f32>().map(|s| s.map(to_i16)).collect::<Result<_, _>>(),
        (format, bits) => return Err(format!("{bits}-bit {format:?} WAV is not supported (8, 16, 24 or 32-bit PCM, or 32-bit float)")),
    }
    .map_err(|e| format!("WAV data is damaged: {e}"))?;
    sample_from_interleaved(&samples, channels, spec.sample_rate, "WAV")
}

/// Mono or stereo interleaved samples to the mixer's stereo frames, with the project's limits.
fn sample_from_interleaved(
    samples: &[i16],
    channels: usize,
    rate: u32,
    what: &str,
) -> Result<crate::mixer::Sample, String> {
    let frames: Vec<[i16; 2]> = if channels == 1 {
        samples.iter().map(|&s| [s, s]).collect()
    } else {
        samples.as_chunks::<2>().0.to_vec()
    };
    let seconds = frames.len() as f32 / rate as f32;
    if seconds > MAX_SOUND_SECONDS {
        return Err(format!(
            "{seconds:.0} seconds is longer than the {MAX_SOUND_SECONDS:.0} second limit"
        ));
    }
    if frames.is_empty() {
        return Err(format!("the {what} file has no audio"));
    }
    Ok(crate::mixer::Sample { rate, frames })
}

/// Decodes an Ogg Vorbis file (mono or stereo) fully into memory, as 16-bit stereo like WAV.
/// (It is not streamed: a long music track still takes memory, but costs far less to ship.)
pub fn decode_ogg(bytes: &[u8]) -> Result<crate::mixer::Sample, String> {
    use lewton::inside_ogg::OggStreamReader;
    let mut reader = OggStreamReader::new(Cursor::new(bytes))
        .map_err(|e| format!("not a readable Ogg Vorbis file: {e}"))?;
    let channels = reader.ident_hdr.audio_channels as usize;
    let rate = reader.ident_hdr.audio_sample_rate;
    if channels == 0 || channels > 2 {
        return Err(format!(
            "{channels} channels is not supported; use mono or stereo"
        ));
    }
    if !(8_000..=192_000).contains(&rate) {
        return Err(format!(
            "{rate} Hz is outside the supported 8000 to 192000 Hz"
        ));
    }
    let limit = (MAX_SOUND_SECONDS * rate as f32) as usize * channels;
    let mut samples: Vec<i16> = Vec::new();
    while let Some(packet) = reader
        .read_dec_packet_itl()
        .map_err(|e| format!("Ogg Vorbis data is damaged: {e}"))?
    {
        samples.extend_from_slice(&packet);
        if samples.len() > limit {
            return Err(format!(
                "longer than the {MAX_SOUND_SECONDS:.0} second limit"
            ));
        }
    }
    sample_from_interleaved(&samples, channels, rate, "Ogg Vorbis")
}

/// Decodes a project sound by its file extension (`.wav` or `.ogg`).
pub fn decode_sound(id: &str, bytes: &[u8]) -> Result<crate::mixer::Sample, String> {
    if id.to_ascii_lowercase().ends_with(".ogg") {
        decode_ogg(bytes)
    } else {
        decode_wav(bytes)
    }
}

#[cfg(test)]
mod ogg_tests {
    use super::*;

    #[test]
    fn garbage_and_truncated_files_are_clear_errors_not_panics() {
        assert!(
            decode_ogg(b"")
                .unwrap_err()
                .contains("not a readable Ogg Vorbis")
        );
        assert!(
            decode_ogg(b"OggS\0\x02nonsense")
                .unwrap_err()
                .contains("not a readable Ogg Vorbis")
        );
        assert!(decode_sound("x.ogg", b"RIFF....WAVE").is_err());
        assert!(decode_sound("x.wav", b"OggS").unwrap_err().contains("WAV"));
    }

    /// Decodes a real file when `NOVA_TEST_OGG` names one (no encoder is available to make a fixture,
    /// and no third-party audio is checked in). Run: `NOVA_TEST_OGG=/path/a.ogg cargo test ogg`.
    #[test]
    fn decodes_a_real_file_when_one_is_provided() {
        let Ok(path) = std::env::var("NOVA_TEST_OGG") else {
            return;
        };
        let sample = decode_ogg(&std::fs::read(&path).unwrap()).unwrap();
        assert!(sample.frames.len() > 100, "{} frames", sample.frames.len());
        assert!(sample.frames.iter().any(|f| f[0] != 0), "not silent");
        eprintln!(
            "decoded {path}: {} Hz, {} frames",
            sample.rate,
            sample.frames.len()
        );
    }
}

#[cfg(test)]
mod wav_tests {
    use super::*;

    fn wav(
        channels: u16,
        rate: u32,
        bits: u16,
        format: hound::SampleFormat,
        write: impl FnOnce(&mut hound::WavWriter<&mut Cursor<Vec<u8>>>),
    ) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let spec = hound::WavSpec {
                channels,
                sample_rate: rate,
                bits_per_sample: bits,
                sample_format: format,
            };
            let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
            write(&mut w);
            w.finalize().unwrap();
        }
        cursor.into_inner()
    }

    #[test]
    fn decodes_every_supported_format_to_16_bit_stereo() {
        let mono16 = wav(1, 22050, 16, hound::SampleFormat::Int, |w| {
            w.write_sample(1000i16).unwrap();
            w.write_sample(-2000i16).unwrap();
        });
        let s = decode_wav(&mono16).unwrap();
        assert_eq!(
            (s.rate, s.frames.as_slice()),
            (22050, &[[1000, 1000], [-2000, -2000]][..])
        );

        let stereo16 = wav(2, 44100, 16, hound::SampleFormat::Int, |w| {
            for v in [1i16, 2, 3, 4] {
                w.write_sample(v).unwrap();
            }
        });
        assert_eq!(decode_wav(&stereo16).unwrap().frames, [[1, 2], [3, 4]]);

        let pcm24 = wav(1, 44100, 24, hound::SampleFormat::Int, |w| {
            w.write_sample(0x123400i32).unwrap()
        });
        assert_eq!(decode_wav(&pcm24).unwrap().frames, [[0x1234, 0x1234]]);

        let pcm32 = wav(1, 44100, 32, hound::SampleFormat::Int, |w| {
            w.write_sample(0x4000_0000i32).unwrap()
        });
        assert_eq!(decode_wav(&pcm32).unwrap().frames, [[0x4000, 0x4000]]);

        let pcm8 = wav(1, 22050, 8, hound::SampleFormat::Int, |w| {
            w.write_sample(64i8).unwrap()
        });
        assert_eq!(decode_wav(&pcm8).unwrap().frames, [[64 << 8, 64 << 8]]);

        let float = wav(1, 48000, 32, hound::SampleFormat::Float, |w| {
            w.write_sample(0.5f32).unwrap();
            w.write_sample(-3.0f32).unwrap();
        });
        assert_eq!(
            decode_wav(&float).unwrap().frames,
            [[16384, 16384], [-32767, -32767]],
            "floats clamp to full scale"
        );
    }

    #[test]
    fn unsupported_or_broken_wav_files_are_explained() {
        assert!(
            decode_wav(b"RIFF nope")
                .unwrap_err()
                .contains("not a readable WAV")
        );
        let six = wav(6, 44100, 16, hound::SampleFormat::Int, |w| {
            for _ in 0..6 {
                w.write_sample(0i16).unwrap();
            }
        });
        assert!(decode_wav(&six).unwrap_err().contains("6 channels"));
        let slow = wav(1, 4000, 16, hound::SampleFormat::Int, |w| {
            w.write_sample(0i16).unwrap()
        });
        assert!(decode_wav(&slow).unwrap_err().contains("4000 Hz"));
        let empty = wav(1, 44100, 16, hound::SampleFormat::Int, |_| {});
        assert!(decode_wav(&empty).unwrap_err().contains("no audio"));
        let mut truncated = wav(1, 44100, 16, hound::SampleFormat::Int, |w| {
            for _ in 0..100 {
                w.write_sample(5i16).unwrap();
            }
        });
        truncated.truncate(60);
        assert!(
            decode_wav(&truncated).is_err(),
            "a cut-off file is an error, not silence"
        );
    }
}

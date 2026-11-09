//! KTX2 textures: a picture already compressed for the GPU (ETC2 or ASTC, which every phone GPU reads),
//! with its smaller copies, kept in the project and put on the GPU as it is. A compressed texture is a quarter to an eighth of the
//! size of the same picture in RGBA8, in the APK and in memory, and the GPU reads it that way too.
//!
//! A model `models/car.glb` takes the base colour picture from `models/car.ktx2` beside it when there is one (the picture in the
//! file is then not used, so the `.glb` may carry a 1 x 1 stand-in; see `docs/switch-class-graphics.md`). `nova ktx2 in.png out.ktx2`
//! makes one (ETC2, opaque pictures whose sides are multiples of 4).
//!
//! Read: the plain container (no supercompression, no Basis Universal), one layer, one face, 2D; the formats of [`Ktx2::format`].
//! A GPU that lacks the format cannot show the texture (the model then uses the picture in its `.glb`, else white).

use crate::model::Image;

/// A KTX2 file's picture: its size, the GPU format and every level's bytes (level 0, the full size, first).
#[derive(Clone, Debug, PartialEq)]
pub struct Ktx2 {
    pub width: u32,
    pub height: u32,
    pub format: wgpu::TextureFormat,
    pub levels: Vec<Vec<u8>>,
}

const IDENTIFIER: [u8; 12] = [
    0xAB, b'K', b'T', b'X', b' ', b'2', b'0', 0xBB, b'\r', b'\n', 0x1A, b'\n',
];
/// `VK_FORMAT_ETC2_R8G8B8_SRGB_BLOCK` and its linear twin: the format [`encode_etc2`] writes.
const VK_ETC2_RGB_UNORM: u32 = 147;
const VK_ETC2_RGB_SRGB: u32 = 148;

/// The GPU format of a Vulkan format number, for the formats read here.
fn format_of(vk: u32) -> Option<wgpu::TextureFormat> {
    use wgpu::{AstcBlock as B, AstcChannel as C, TextureFormat as F};
    let astc = |block, srgb| F::Astc {
        block,
        channel: if srgb { C::UnormSrgb } else { C::Unorm },
    };
    Some(match vk {
        37 => F::Rgba8Unorm,
        43 => F::Rgba8UnormSrgb,
        147 => F::Etc2Rgb8Unorm,
        148 => F::Etc2Rgb8UnormSrgb,
        149 => F::Etc2Rgb8A1Unorm,
        150 => F::Etc2Rgb8A1UnormSrgb,
        151 => F::Etc2Rgba8Unorm,
        152 => F::Etc2Rgba8UnormSrgb,
        157 | 158 => astc(B::B4x4, vk == 158),
        159 | 160 => astc(B::B5x4, vk == 160),
        161 | 162 => astc(B::B5x5, vk == 162),
        163 | 164 => astc(B::B6x5, vk == 164),
        165 | 166 => astc(B::B6x6, vk == 166),
        167 | 168 => astc(B::B8x5, vk == 168),
        169 | 170 => astc(B::B8x6, vk == 170),
        171 | 172 => astc(B::B8x8, vk == 172),
        173 | 174 => astc(B::B10x5, vk == 174),
        175 | 176 => astc(B::B10x6, vk == 176),
        177 | 178 => astc(B::B10x8, vk == 178),
        179 | 180 => astc(B::B10x10, vk == 180),
        181 | 182 => astc(B::B12x10, vk == 182),
        183 | 184 => astc(B::B12x12, vk == 184),
        _ => return None,
    })
}

/// The GPU feature a format needs (None for the ones every GPU has).
pub fn feature_of(format: wgpu::TextureFormat) -> Option<wgpu::Features> {
    match format {
        wgpu::TextureFormat::Astc { .. } => Some(wgpu::Features::TEXTURE_COMPRESSION_ASTC),
        f if format_name(f).starts_with("Etc2") => Some(wgpu::Features::TEXTURE_COMPRESSION_ETC2),
        _ => None,
    }
}

fn format_name(f: wgpu::TextureFormat) -> String {
    format!("{f:?}")
}

fn u32_at(b: &[u8], at: usize) -> Result<u32, String> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
        .ok_or_else(|| "the file is cut short".to_string())
}

fn u64_at(b: &[u8], at: usize) -> Result<u64, String> {
    b.get(at..at + 8)
        .map(|s| u64::from_le_bytes(s.try_into().unwrap()))
        .ok_or_else(|| "the file is cut short".to_string())
}

/// Reads a KTX2 file.
pub fn parse(bytes: &[u8]) -> Result<Ktx2, String> {
    if bytes.len() < 80 || bytes[..12] != IDENTIFIER {
        return Err("not a KTX2 file".into());
    }
    let vk = u32_at(bytes, 12)?;
    let (width, height, depth) = (u32_at(bytes, 20)?, u32_at(bytes, 24)?, u32_at(bytes, 28)?);
    let (layers, faces, levels) = (u32_at(bytes, 32)?, u32_at(bytes, 36)?, u32_at(bytes, 40)?);
    let supercompression = u32_at(bytes, 44)?;
    let format = format_of(vk).ok_or_else(|| {
        format!("the pixel format {vk} is not supported (ETC2, ASTC and RGBA8 are)")
    })?;
    if supercompression != 0 {
        return Err("supercompressed KTX2 (Basis Universal, Zstandard, zlib) is not supported: write it plain".into());
    }
    if width == 0 || height == 0 || depth > 1 || layers > 1 || faces > 1 {
        return Err(
            "only a single 2D picture is supported (no arrays, cube maps or volumes)".into(),
        );
    }
    let count = levels.max(1) as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let at = 80 + i * 24;
        let offset = u64_at(bytes, at)? as usize;
        let length = u64_at(bytes, at + 8)? as usize;
        let data = bytes
            .get(
                offset
                    ..offset
                        .checked_add(length)
                        .ok_or("a level is out of range")?,
            )
            .ok_or_else(|| "a level lies outside the file".to_string())?;
        out.push(data.to_vec());
    }
    // every level must be exactly the blocks its size needs
    let (bw, bh) = format.block_dimensions();
    let block_bytes = format.block_copy_size(None).ok_or("unsupported format")? as usize;
    for (i, level) in out.iter().enumerate() {
        let (w, h) = ((width >> i).max(1), (height >> i).max(1));
        let expected = w.div_ceil(bw) as usize * h.div_ceil(bh) as usize * block_bytes;
        if level.len() != expected {
            return Err(format!(
                "level {i} is {} bytes, but {w} x {h} in this format is {expected}",
                level.len()
            ));
        }
    }
    if width % bw != 0 || height % bh != 0 {
        return Err(format!(
            "the picture's sides ({width} x {height}) must be multiples of the block ({bw} x {bh})"
        ));
    }
    Ok(Ktx2 {
        width,
        height,
        format,
        levels: out,
    })
}

/// Writes a KTX2 file (no supercompression, no metadata): `levels` are the blocks of each level, the largest first.
pub fn write(
    width: u32,
    height: u32,
    vk_format: u32,
    type_size: u32,
    levels: &[Vec<u8>],
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&IDENTIFIER);
    for v in [
        vk_format,
        type_size,
        width,
        height,
        0,
        0,
        1,
        levels.len() as u32,
        0,
    ] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    // data format descriptor and key-value data: none (offset 0, length 0); super-compression global data: none
    for v in [0u32, 0, 0, 0] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for v in [0u64, 0] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    // the level index, then the data: the smallest level first in the file, as the format asks
    let index_end = 80 + levels.len() * 24;
    let mut offsets = vec![0usize; levels.len()];
    let mut at = index_end;
    for i in (0..levels.len()).rev() {
        at = at.next_multiple_of(8);
        offsets[i] = at;
        at += levels[i].len();
    }
    for (i, level) in levels.iter().enumerate() {
        for v in [offsets[i] as u64, level.len() as u64, level.len() as u64] {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out.resize(at, 0);
    for (i, level) in levels.iter().enumerate() {
        out[offsets[i]..offsets[i] + level.len()].copy_from_slice(level);
    }
    out
}

// ---- ETC2 (opaque) encoder ----
// The blocks written are ETC1's modes (individual and differential colours, a table of eight intensity modifiers, a flip), which an ETC2
// decoder reads as they are: the best of the two splits of a 4 x 4 block, by exhaustive search over the tables. About 4 bits a pixel;
// plain, but without the visible banding of a coarse encoder.

const MODIFIERS: [[i32; 2]; 8] = [
    [2, 8],
    [5, 17],
    [9, 29],
    [13, 42],
    [18, 60],
    [24, 80],
    [33, 106],
    [47, 183],
];

fn expand4(v: i32) -> i32 {
    (v << 4) | v
}

fn expand5(v: i32) -> i32 {
    (v << 3) | (v >> 2)
}

/// The best table and pixel choices for eight pixels around one base colour: (error, table, per-pixel index 0..3).
fn best_table(pixels: &[[i32; 3]; 8], base: [i32; 3]) -> (u32, usize, [u8; 8]) {
    let mut best = (u32::MAX, 0usize, [0u8; 8]);
    for (table, mods) in MODIFIERS.iter().enumerate() {
        let mut error = 0u32;
        let mut picks = [0u8; 8];
        for (i, p) in pixels.iter().enumerate() {
            let mut least = (u32::MAX, 0u8);
            // pixel index: 0 +small, 1 +large, 2 -small, 3 -large
            for (index, m) in [mods[0], mods[1], -mods[0], -mods[1]]
                .into_iter()
                .enumerate()
            {
                let e: u32 = (0..3)
                    .map(|c| {
                        let v = (base[c] + m).clamp(0, 255);
                        ((v - p[c]) * (v - p[c])) as u32
                    })
                    .sum();
                if e < least.0 {
                    least = (e, index as u8);
                }
            }
            error += least.0;
            picks[i] = least.1;
        }
        if error < best.0 {
            best = (error, table, picks);
        }
    }
    best
}

/// A sub-block of eight pixels as two candidate bases (4 and 5 bits a channel): the mean, quantised.
fn mean(pixels: &[[i32; 3]; 8]) -> [f32; 3] {
    let mut sum = [0.0f32; 3];
    for p in pixels {
        for c in 0..3 {
            sum[c] += p[c] as f32;
        }
    }
    sum.map(|s| s / 8.0)
}

/// Encodes one 4 x 4 block (`px[y * 4 + x]`, RGB) as 8 bytes.
fn encode_block(px: &[[i32; 3]; 16]) -> [u8; 8] {
    let mut best: Option<(u32, [u8; 8])> = None;
    for flip in [false, true] {
        // flip = 0: two blocks side by side (columns 0-1 and 2-3); flip = 1: one above the other (rows 0-1 and 2-3)
        let mut halves = [[[0i32; 3]; 8]; 2];
        let mut where_ = [[0usize; 8]; 2];
        let mut n = [0usize; 2];
        for y in 0..4 {
            for x in 0..4 {
                let half = if flip {
                    (y >= 2) as usize
                } else {
                    (x >= 2) as usize
                };
                halves[half][n[half]] = px[y * 4 + x];
                where_[half][n[half]] = x * 4 + y; // the pixel's index in the file's column-major order
                n[half] += 1;
            }
        }
        let means = [mean(&halves[0]), mean(&halves[1])];
        // individual: both bases in 4 bits
        let q4 = |m: [f32; 3]| m.map(|v| (v / 17.0).round().clamp(0.0, 15.0) as i32);
        let (b0, b1) = (q4(means[0]), q4(means[1]));
        let base_of = |q: [i32; 3], expand: fn(i32) -> i32| q.map(expand);
        let r0 = best_table(&halves[0], base_of(b0, expand4));
        let r1 = best_table(&halves[1], base_of(b1, expand4));
        let mut candidates = vec![(r0.0 + r1.0, false, [b0, b1], [r0.1, r1.1], [r0.2, r1.2])];
        // differential: the first base in 5 bits, the second within -4..3 of it
        let q5 = |m: [f32; 3]| m.map(|v| (v / 255.0 * 31.0).round().clamp(0.0, 31.0) as i32);
        let (c0, c1) = (q5(means[0]), q5(means[1]));
        if (0..3).all(|c| (-4..=3).contains(&(c1[c] - c0[c]))) {
            let r0 = best_table(&halves[0], base_of(c0, expand5));
            let r1 = best_table(&halves[1], base_of(c1, expand5));
            candidates.push((r0.0 + r1.0, true, [c0, c1], [r0.1, r1.1], [r0.2, r1.2]));
        }
        for (error, diff, bases, tables, picks) in candidates {
            let mut block = [0u8; 8];
            if diff {
                for c in 0..3 {
                    block[c] = ((bases[0][c] << 3) | ((bases[1][c] - bases[0][c]) & 7)) as u8;
                }
            } else {
                for c in 0..3 {
                    block[c] = ((bases[0][c] << 4) | bases[1][c]) as u8;
                }
            }
            block[3] =
                ((tables[0] << 5) | (tables[1] << 2) | ((diff as usize) << 1) | flip as usize)
                    as u8;
            let mut word = 0u32;
            for half in 0..2 {
                for i in 0..8 {
                    let index = picks[half][i] as u32;
                    let k = where_[half][i] as u32;
                    word |= ((index >> 1) << (16 + k)) | ((index & 1) << k);
                }
            }
            block[4..8].copy_from_slice(&word.to_be_bytes());
            if best.is_none_or(|(e, _)| error < e) {
                best = Some((error, block));
            }
        }
    }
    best.expect("a candidate").1
}

/// One level as ETC2 RGB8 blocks (rows of blocks, left to right); `rgba` is the picture, sampled with its edge repeated past the sides.
fn encode_level(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let (w, h) = (width as usize, height as usize);
    let mut out = Vec::with_capacity(w.div_ceil(4) * h.div_ceil(4) * 8);
    for by in 0..h.div_ceil(4) {
        for bx in 0..w.div_ceil(4) {
            let mut px = [[0i32; 3]; 16];
            for y in 0..4 {
                for x in 0..4 {
                    let (sx, sy) = ((bx * 4 + x).min(w - 1), (by * 4 + y).min(h - 1));
                    let i = (sy * w + sx) * 4;
                    px[y * 4 + x] = [rgba[i] as i32, rgba[i + 1] as i32, rgba[i + 2] as i32];
                }
            }
            out.extend_from_slice(&encode_block(&px));
        }
    }
    out
}

/// A picture as an ETC2 RGB8 KTX2 file with its whole chain of smaller copies. The sides must be multiples of 4 and the picture opaque
/// (a see-through one needs the alpha formats, which this does not write). `srgb`: the colours are sRGB (a base colour picture).
pub fn encode_etc2(image: &Image, srgb: bool) -> Result<Vec<u8>, String> {
    if !image.width.is_multiple_of(4) || !image.height.is_multiple_of(4) {
        return Err(format!(
            "the picture is {} x {}: its sides must be multiples of 4",
            image.width, image.height
        ));
    }
    if image.rgba.as_chunks::<4>().0.iter().any(|p| p[3] != 255) {
        return Err("the picture is see-through: only opaque pictures are encoded".into());
    }
    let count = 32 - image.width.max(image.height).leading_zeros();
    let chain = crate::gfx::mip_chain(image, count);
    let mut levels = Vec::new();
    let mut at = 0usize;
    for level in 0..count {
        let (w, h) = (
            (image.width >> level).max(1),
            (image.height >> level).max(1),
        );
        let bytes = w as usize * h as usize * 4;
        levels.push(encode_level(&chain[at..at + bytes], w, h));
        at += bytes;
    }
    Ok(write(
        image.width,
        image.height,
        if srgb {
            VK_ETC2_RGB_SRGB
        } else {
            VK_ETC2_RGB_UNORM
        },
        1,
        &levels,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gradient(w: u32, h: u32) -> Image {
        let mut rgba = Vec::new();
        for y in 0..h {
            for x in 0..w {
                rgba.extend_from_slice(&[
                    (x * 255 / (w - 1)) as u8,
                    (y * 255 / (h - 1)) as u8,
                    120,
                    255,
                ]);
            }
        }
        Image {
            width: w,
            height: h,
            rgba,
        }
    }

    #[test]
    fn a_written_file_reads_back_with_every_level() {
        let file = encode_etc2(&gradient(32, 16), true).unwrap();
        let k = parse(&file).unwrap();
        assert_eq!((k.width, k.height), (32, 16));
        assert_eq!(k.format, wgpu::TextureFormat::Etc2Rgb8UnormSrgb);
        // 32 x 16 down to 1 x 1: six levels; the full one is 8 x 4 blocks of 8 bytes
        assert_eq!(k.levels.len(), 6);
        assert_eq!(k.levels[0].len(), 8 * 4 * 8);
        assert_eq!(k.levels[5].len(), 8);
    }

    #[test]
    fn a_picture_of_an_unusable_size_or_with_alpha_is_refused() {
        assert!(encode_etc2(&gradient(30, 16), true).is_err());
        let mut p = gradient(8, 8);
        p.rgba[3] = 10;
        assert!(encode_etc2(&p, true).unwrap_err().contains("see-through"));
    }

    #[test]
    fn damaged_files_are_refused_not_trusted() {
        assert!(parse(b"hello").is_err());
        let mut file = encode_etc2(&gradient(8, 8), true).unwrap();
        file.truncate(100);
        assert!(parse(&file).is_err());
        let mut file = encode_etc2(&gradient(8, 8), true).unwrap();
        file[44] = 1; // supercompression
        assert!(parse(&file).unwrap_err().contains("supercompressed"));
    }
}

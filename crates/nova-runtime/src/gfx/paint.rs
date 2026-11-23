//! The picture painted surfaces read their patterns from (mesh.wgsl, "Painted surfaces"; docs/project-format.md): a small square
//! of smooth value noise that repeats seamlessly, four independent noises in its four channels, with its whole chain of mip levels.
//! A painted ground, crown or stream reads it a few times a pixel at different scales and slants instead of working noise out in
//! arithmetic (a texture read costs a mobile GPU far less than the thirty-odd instructions of a value noise), and the mip levels
//! average a pattern away by themselves where it would be finer than a pixel, so far ground is calm and nothing shimmers.

/// The noise picture's side in texels, and how many noise cells it holds across (each channel repeats after this many).
pub const SIDE: u32 = 128;
pub const CELLS: u32 = 16;

/// The noise picture on the GPU and the sampler it is read with (repeating, filtered between texels and mip levels).
pub struct PaintNoise {
    pub view: wgpu::TextureView,
    pub sampler: wgpu::Sampler,
}

/// A repeatable random number, 0 to 1, for a lattice point of channel `c` (wrapped to the picture's period).
fn lattice(c: u32, x: u32, y: u32) -> f32 {
    let mut h = (x % CELLS)
        .wrapping_mul(0x8da6_b343)
        .wrapping_add((y % CELLS).wrapping_mul(0xd816_3841))
        .wrapping_add(c.wrapping_mul(0xcb1a_b31f))
        .wrapping_add(0x9e37_79b9);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297a_2d39);
    h ^= h >> 15;
    (h & 0xffff) as f32 / 65535.0
}

/// The noise's texels, RGBA8, level 0: in each channel a value noise of `CELLS` cells across with smooth (cubic) steps between
/// lattice points, stretched over its whole 0 to 255 range so that a threshold in the shader means the same in every channel.
pub fn texels() -> Vec<u8> {
    let cell = (SIDE / CELLS) as f32;
    let mut raw = vec![0f32; (SIDE * SIDE * 4) as usize];
    for y in 0..SIDE {
        for x in 0..SIDE {
            let (fx, fy) = (x as f32 / cell, y as f32 / cell);
            let (ix, iy) = (fx.floor() as u32, fy.floor() as u32);
            let (tx, ty) = (fx - fx.floor(), fy - fy.floor());
            let (ux, uy) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
            for c in 0..4 {
                let a = lattice(c, ix, iy);
                let b = lattice(c, ix + 1, iy);
                let d = lattice(c, ix, iy + 1);
                let e = lattice(c, ix + 1, iy + 1);
                let top = a + (b - a) * ux;
                let bottom = d + (e - d) * ux;
                raw[((y * SIDE + x) * 4 + c) as usize] = top + (bottom - top) * uy;
            }
        }
    }
    let mut out = vec![0u8; raw.len()];
    for c in 0..4 {
        let (mut lo, mut hi) = (f32::MAX, f32::MIN);
        for v in raw.iter().skip(c).step_by(4) {
            lo = lo.min(*v);
            hi = hi.max(*v);
        }
        for (o, v) in out.iter_mut().zip(raw.iter()).skip(c).step_by(4) {
            *o = ((v - lo) / (hi - lo).max(1e-6) * 255.0).round() as u8;
        }
    }
    out
}

/// The next mip level down: each texel the mean of four (the picture repeats, so its side halves cleanly to 1).
fn half(level: &[u8], side: u32) -> Vec<u8> {
    let h = side / 2;
    let mut out = vec![0u8; (h * h * 4) as usize];
    for y in 0..h {
        for x in 0..h {
            for c in 0..4 {
                let at = |xx: u32, yy: u32| level[((yy * side + xx) * 4 + c) as usize] as u32;
                let s = at(2 * x, 2 * y)
                    + at(2 * x + 1, 2 * y)
                    + at(2 * x, 2 * y + 1)
                    + at(2 * x + 1, 2 * y + 1);
                out[((y * h + x) * 4 + c) as usize] = ((s + 2) / 4) as u8;
            }
        }
    }
    out
}

/// Makes the noise picture with its mip chain and the sampler, on this device.
pub fn make(device: &wgpu::Device, queue: &wgpu::Queue) -> PaintNoise {
    let levels = SIDE.ilog2() + 1;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("paint noise"),
        size: wgpu::Extent3d {
            width: SIDE,
            height: SIDE,
            depth_or_array_layers: 1,
        },
        mip_level_count: levels,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let mut level = texels();
    let mut side = SIDE;
    for mip in 0..levels {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: mip,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &level,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(side * 4),
                rows_per_image: Some(side),
            },
            wgpu::Extent3d {
                width: side,
                height: side,
                depth_or_array_layers: 1,
            },
        );
        if side > 1 {
            level = half(&level, side);
            side /= 2;
        }
    }
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("paint noise"),
        address_mode_u: wgpu::AddressMode::Repeat,
        address_mode_v: wgpu::AddressMode::Repeat,
        address_mode_w: wgpu::AddressMode::Repeat,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        mipmap_filter: wgpu::MipmapFilterMode::Linear,
        ..Default::default()
    });
    PaintNoise {
        view: texture.create_view(&wgpu::TextureViewDescriptor::default()),
        sampler,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_noise_repeats_seamlessly_and_fills_its_range() {
        let t = texels();
        let at =
            |x: u32, y: u32, c: u32| t[(((y % SIDE) * SIDE + (x % SIDE)) * 4 + c) as usize] as i32;
        for c in 0..4 {
            // across the picture's edge a step is as small as one inside it (no seam where it repeats)
            let mut worst_edge = 0;
            let mut worst_inside = 0;
            for y in 0..SIDE {
                worst_edge = worst_edge.max((at(SIDE - 1, y, c) - at(0, y, c)).abs());
                worst_edge = worst_edge.max((at(y, SIDE - 1, c) - at(y, 0, c)).abs());
                for x in 0..SIDE - 1 {
                    worst_inside = worst_inside.max((at(x, y, c) - at(x + 1, y, c)).abs());
                }
            }
            assert!(
                worst_edge <= worst_inside,
                "channel {c}: a step of {worst_edge} at the seam, {worst_inside} inside"
            );
            let (lo, hi) = (0..SIDE * SIDE)
                .map(|i| at(i % SIDE, i / SIDE, c))
                .fold((255, 0), |(l, h), v| (l.min(v), h.max(v)));
            assert_eq!((lo, hi), (0, 255), "channel {c} spans the whole range");
        }
        // the four channels are different noises
        let corr = |a: u32, b: u32| -> f64 {
            let n = (SIDE * SIDE) as f64;
            let (mut sa, mut sb, mut sab, mut saa, mut sbb) = (0.0, 0.0, 0.0, 0.0, 0.0);
            for i in 0..SIDE * SIDE {
                let (x, y) = (
                    at(i % SIDE, i / SIDE, a) as f64,
                    at(i % SIDE, i / SIDE, b) as f64,
                );
                sa += x;
                sb += y;
                sab += x * y;
                saa += x * x;
                sbb += y * y;
            }
            (sab / n - sa * sb / n / n)
                / ((saa / n - (sa / n).powi(2)).sqrt() * (sbb / n - (sb / n).powi(2)).sqrt())
        };
        for (a, b) in [(0, 1), (0, 2), (1, 3), (2, 3)] {
            assert!(
                corr(a, b).abs() < 0.3,
                "channels {a} and {b} correlate {}",
                corr(a, b)
            );
        }
    }
}

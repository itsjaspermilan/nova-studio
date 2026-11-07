//! Designed terrain: a grid of heights from a PNG (`nova.terrain{ heightmap = ... }`). The renderer uploads the grid as an `R32Float`
//! texture and the vertex shaders read it with `textureLoad` (no sampler: vertex-stage filtering is not dependable on every mobile
//! GPU) and blend the four nearest samples themselves; [`HeightMap::height`] and [`HeightMap::slope`] make the same numbers on the CPU.
//! Keep the two in step (`shaders/mesh.wgsl`, `shaders/shadow.wgsl`: `map_height`, `map_slope`).
//!
//! Reading the picture (the first matching rule):
//! * 16-bit grey (or grey with alpha): the value is `v / 65535`: full 16-bit precision.
//! * 8-bit RGB or RGBA: the value is `(R * 256 + G) / 65535`, so a picture with red as the high byte and green as the low byte is
//!   16-bit too, and an ordinary grey picture (R = G) gives `grey / 255`.
//! * 16-bit RGB or RGBA: the red channel, `R / 65535`.
//! * 8-bit grey: `v / 255`.
//!
//! Black is height 0 and white is `height` metres. Each pixel is a sample at a grid point; the ground between four samples is their
//! bilinear blend. Outside the picture the ground keeps the height of the nearest edge sample (no cliff at the border).

use std::io::Cursor;

/// The most samples along one side (the texture limit every phone has, and 64 MB of heights at most).
pub const MAX_SIDE: u32 = 4096;

#[derive(Clone, Debug, PartialEq)]
pub struct HeightMap {
    pub width: u32,
    pub rows: u32,
    /// Metres between two samples.
    pub cell: f32,
    /// The ground's x and z at the first sample (top-left pixel).
    pub x0: f32,
    pub z0: f32,
    /// Heights in metres, row by row (row 0 is at `z0`).
    pub heights: Vec<f32>,
    pub max: f32,
    pub min: f32,
}

impl HeightMap {
    /// Decodes a PNG into heights in metres. `size` is the metres from the first sample to the last along x.
    pub fn from_png(
        bytes: &[u8],
        x0: f32,
        z0: f32,
        size: f32,
        height: f32,
    ) -> Result<HeightMap, String> {
        let mut decoder = png::Decoder::new(Cursor::new(bytes));
        decoder.set_transformations(png::Transformations::EXPAND);
        let mut reader = decoder
            .read_info()
            .map_err(|e| format!("not a readable PNG: {e}"))?;
        let mut buffer = vec![0u8; reader.output_buffer_size().ok_or("PNG is too large")?];
        let info = reader
            .next_frame(&mut buffer)
            .map_err(|e| format!("PNG data is damaged: {e}"))?;
        let (w, h) = (info.width, info.height);
        if w < 2 || h < 2 || w > MAX_SIDE || h > MAX_SIDE {
            return Err(format!(
                "a heightmap is from 2 to {MAX_SIDE} pixels on a side, this one is {w} by {h}"
            ));
        }
        let data = &buffer[..info.buffer_size()];
        let sixteen = info.bit_depth == png::BitDepth::Sixteen;
        let channels = info.color_type.samples();
        let bytes_per = if sixteen { 2 } else { 1 };
        let mut heights = Vec::with_capacity((w * h) as usize);
        for px in data.chunks_exact(channels * bytes_per) {
            let unit = match (sixteen, channels) {
                (true, _) => f32::from(u16::from_be_bytes([px[0], px[1]])) / 65535.0,
                (false, 1 | 2) => f32::from(px[0]) / 255.0,
                (false, _) => (f32::from(px[0]) * 256.0 + f32::from(px[1])) / 65535.0,
            };
            heights.push(unit * height);
        }
        let max = heights.iter().copied().fold(f32::MIN, f32::max);
        let min = heights.iter().copied().fold(f32::MAX, f32::min);
        Ok(HeightMap {
            width: w,
            rows: h,
            cell: size / (w - 1) as f32,
            x0,
            z0,
            heights,
            max,
            min,
        })
    }

    fn at(&self, i: u32, j: u32) -> f32 {
        self.heights[(j * self.width + i) as usize]
    }

    /// Where a spot falls in the grid: the clamped sample coordinates and whether each is inside the picture.
    fn locate(&self, x: f32, z: f32) -> (f32, f32, bool, bool) {
        let (fx, fz) = ((x - self.x0) / self.cell, (z - self.z0) / self.cell);
        let (mx, mz) = ((self.width - 1) as f32, (self.rows - 1) as f32);
        (
            fx.clamp(0.0, mx),
            fz.clamp(0.0, mz),
            fx > 0.0 && fx < mx,
            fz > 0.0 && fz < mz,
        )
    }

    /// The four samples around a spot and the fractions: (h00, h10, h01, h11, tx, tz).
    fn cell_at(&self, fx: f32, fz: f32) -> (f32, f32, f32, f32, f32, f32) {
        let i = (fx.floor() as u32).min(self.width - 2);
        let j = (fz.floor() as u32).min(self.rows - 2);
        (
            self.at(i, j),
            self.at(i + 1, j),
            self.at(i, j + 1),
            self.at(i + 1, j + 1),
            fx - i as f32,
            fz - j as f32,
        )
    }

    /// The ground's height there: the bilinear blend of the four nearest samples, the edge's height outside.
    pub fn height(&self, x: f32, z: f32) -> f32 {
        let (fx, fz, _, _) = self.locate(x, z);
        let (a, b, c, d, tx, tz) = self.cell_at(fx, fz);
        let top = a + (b - a) * tx;
        let bottom = c + (d - c) * tx;
        top + (bottom - top) * tz
    }

    /// How fast the height grows with x and with z (0 along an axis outside the picture).
    pub fn slope(&self, x: f32, z: f32) -> [f32; 2] {
        let (fx, fz, in_x, in_z) = self.locate(x, z);
        let (a, b, c, d, tx, tz) = self.cell_at(fx, fz);
        let gx = if in_x {
            ((b - a) * (1.0 - tz) + (d - c) * tz) / self.cell
        } else {
            0.0
        };
        let gz = if in_z {
            ((c - a) * (1.0 - tx) + (d - b) * tx) / self.cell
        } else {
            0.0
        };
        [gx, gz]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png16(w: u32, h: u32, values: &[u16]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Grayscale);
        enc.set_depth(png::BitDepth::Sixteen);
        let mut wr = enc.write_header().unwrap();
        let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_be_bytes()).collect();
        wr.write_image_data(&bytes).unwrap();
        drop(wr);
        out
    }

    fn png_rgb(w: u32, h: u32, values: &[[u8; 3]]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().unwrap();
        let bytes: Vec<u8> = values.iter().flatten().copied().collect();
        wr.write_image_data(&bytes).unwrap();
        drop(wr);
        out
    }

    #[test]
    fn sixteen_bit_grey_keeps_its_precision_and_scales_to_metres() {
        let map = HeightMap::from_png(&png16(2, 2, &[0, 1, 32768, 65535]), -10.0, 5.0, 20.0, 100.0)
            .unwrap();
        assert_eq!((map.width, map.rows, map.cell), (2, 2, 20.0));
        assert!((map.heights[1] - 100.0 / 65535.0).abs() < 1e-6);
        assert!((map.max - 100.0).abs() < 1e-4 && map.min == 0.0);
        assert!((map.height(-10.0, 5.0)).abs() < 1e-6);
        assert!((map.height(10.0, 25.0) - 100.0).abs() < 1e-4);
    }

    #[test]
    fn rgb_packs_high_and_low_bytes() {
        let map = HeightMap::from_png(
            &png_rgb(2, 2, &[[0, 0, 9], [1, 0, 9], [0, 255, 9], [255, 255, 9]]),
            0.0,
            0.0,
            1.0,
            65535.0,
        )
        .unwrap();
        assert_eq!(map.heights, vec![0.0, 256.0, 255.0, 65535.0]);
        // a plain grey picture (R = G) is grey / 255
        let grey =
            HeightMap::from_png(&png_rgb(2, 2, &[[255; 3]; 4]), 0.0, 0.0, 1.0, 10.0).unwrap();
        assert!((grey.heights[0] - 10.0).abs() < 1e-4);
    }

    #[test]
    fn bilinear_between_samples_and_clamped_outside() {
        let map =
            HeightMap::from_png(&png16(2, 2, &[0, 65535, 0, 65535]), 0.0, 0.0, 10.0, 4.0).unwrap();
        assert!((map.height(5.0, 3.0) - 2.0).abs() < 1e-4);
        assert!((map.height(-50.0, 3.0)).abs() < 1e-4);
        assert!((map.height(99.0, -7.0) - 4.0).abs() < 1e-4);
        assert_eq!(map.slope(5.0, 3.0), [0.4, 0.0]);
        assert_eq!(map.slope(-5.0, 3.0), [0.0, 0.0]);
    }

    #[test]
    fn slope_matches_finite_differences_on_a_grid() {
        let values: Vec<u16> = (0..64u32).map(|i| ((i * 7919) % 65536) as u16).collect();
        let map = HeightMap::from_png(&png16(8, 8, &values), -3.0, 2.0, 70.0, 30.0).unwrap();
        let e = 0.01;
        for ix in 0..30 {
            for iz in 0..30 {
                // keep off the cell edges, where the slope jumps
                let (x, z) = (-2.9 + ix as f32 * 2.31, 2.1 + iz as f32 * 2.27);
                let s = map.slope(x, z);
                let nx = (map.height(x + e, z) - map.height(x - e, z)) / (2.0 * e);
                let nz = (map.height(x, z + e) - map.height(x, z - e)) / (2.0 * e);
                assert!(
                    (s[0] - nx).abs() < 0.05 && (s[1] - nz).abs() < 0.05,
                    "{x} {z}: {s:?} {nx} {nz}"
                );
            }
        }
    }
}

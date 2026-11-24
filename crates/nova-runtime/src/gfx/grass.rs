//! Grass (`nova.grass`, docs/project-format.md "Grass"): clumps of blades grown on the GPU round the camera, dense near it and
//! thinning out to `distance`, swaying in the wind, coloured from the ground under them and bending away from a few points the game
//! sends each frame (a walker, a vehicle's wheels).
//!
//! Nothing is stored per blade. The ground round the camera is cut into squares of [`TILE`] metres; each square in view and in reach
//! is one instanced draw of the same small index list (a clump of [`BLADES`] blades of five points each, made in the vertex shader
//! from the vertex number, no vertex buffer). Clump `k` of a square stands at the `k`-th point of an R2 low-discrepancy sequence
//! (offset by the square's own seed), so any first `n` clumps are spread evenly over the square: a far square draws only its first
//! few, and a clump whose number is past the count for its own distance sinks into the ground, so the grass thins smoothly with no
//! line where it changes. Where it grows (a picture: none on roads, water, porches) and its colour (a grid, the ground's own colours)
//! are read in the vertex shader, which also lights each point (sun, shadow, ambient, fog), so the fragment shader only writes a
//! colour. Grass casts no shadow. `shaders/grass.wgsl` is appended to `mesh.wgsl` (the terrain, wind, paint noise and shadow
//! functions are shared).

use bytemuck::{Pod, Zeroable};
use glam::Vec3;
use std::sync::Arc;

/// The side of the squares the ground round the camera is cut into (metres).
pub const TILE: f32 = 8.0;
/// How many squares can be drawn in a frame (the nearest first).
pub const MAX_TILES: usize = 160;
/// How many points a frame can bend the grass (`nova.grass_bend`).
pub const MAX_BENDS: usize = 8;
/// Blades in a clump, and the points and the triangles of a blade.
pub const BLADES: u32 = 6;
const BLADE_POINTS: u32 = 5;
const BLADE_TRIANGLES: u32 = 3;

/// A picture laid over the ground: sample `(i, j)` stands at `x0 + i * cell, z0 + j * cell`, and between samples it is blended.
/// `texels` are one byte a sample for where grass grows, four (sRGB RGBA) for colours.
#[derive(Clone, Debug, PartialEq)]
pub struct GroundPicture {
    pub width: u32,
    pub rows: u32,
    pub x0: f32,
    pub z0: f32,
    pub cell: f32,
    pub texels: Vec<u8>,
}

/// The game's grass (`nova.grass{ ... }`); `None` in [`super::Lighting`] draws none.
#[derive(Clone, Debug, PartialEq)]
pub struct Grass {
    /// Where it grows: 0 none, 255 full (between: fewer and shorter clumps). None: everywhere.
    pub map: Option<Arc<GroundPicture>>,
    /// The ground's colours under the grass (sRGB RGBA bytes, as `nova.mesh.make`'s `colors`); None: `color` everywhere.
    pub colors: Option<Arc<GroundPicture>>,
    /// The colour where there is no colour grid (linear).
    pub color: [f32; 3],
    /// A blade's height (metres; each clump varies round it).
    pub height: f32,
    /// A blade's width at its root (metres).
    pub width: f32,
    /// Clumps a square metre near the camera.
    pub density: f32,
    /// How far from the camera grass grows (metres); it thins from a quarter of this.
    pub distance: f32,
    /// How much it sways in the wind (`nova.wind`): 1 is a meadow's.
    pub sway: f32,
    /// This frame's bending points: x, y, z and the radius (metres). Cleared after each frame.
    pub bends: Vec<[f32; 4]>,
    /// Flowers and small plants drawn as painted pictures among the blades (`flowers = { ... }`); None draws none.
    pub flora: Option<Flora>,
}

/// How many garden spots (`flowers.spots`) the flora takes.
pub const MAX_FLORA_SPOTS: usize = 16;
/// The most plants a square can hold.
pub const MAX_FLORA_PER_TILE: u32 = 1024;

/// A picture of the flora's kinds side by side, each a square cell (sRGB RGBA), with its mip levels made for alpha-tested drawing.
#[derive(Clone, Debug, PartialEq)]
pub struct FloraPicture {
    pub width: u32,
    pub height: u32,
    /// Level 0 and each smaller level, RGBA bytes.
    pub levels: Vec<Vec<u8>>,
}

impl FloraPicture {
    /// From the RGBA bytes of a picture `kinds` cells across: the see-through texels take their cell's average colour (so a
    /// filtered edge neither darkens nor whitens) and each smaller level averages four texels weighted by their cover, down to
    /// cells of 4 texels.
    pub fn new(width: u32, height: u32, rgba: Vec<u8>, kinds: u32) -> Self {
        let kinds = kinds.max(1);
        let cell = (width / kinds).clamp(1, height.max(1));
        let mut base = rgba;
        for k in 0..kinds {
            let (mut acc, mut wsum) = ([0.0f64; 3], 0.0f64);
            let xs = (k * cell).min(width)..((k + 1) * cell).min(width);
            for y in 0..height {
                for x in xs.clone() {
                    let i = ((y * width + x) * 4) as usize;
                    let a = base[i + 3] as f64;
                    for c in 0..3 {
                        acc[c] += base[i + c] as f64 * a;
                    }
                    wsum += a;
                }
            }
            if wsum <= 0.0 {
                continue;
            }
            for y in 0..height {
                for x in xs.clone() {
                    let i = ((y * width + x) * 4) as usize;
                    if base[i + 3] < 8 {
                        for c in 0..3 {
                            base[i + c] = (acc[c] / wsum).round() as u8;
                        }
                    }
                }
            }
        }
        let mut levels = vec![base];
        let (mut w, mut h, mut c) = (width, height, cell);
        while c > 4 && w >= 2 && h >= 2 {
            let prev = levels.last().unwrap();
            let (nw, nh) = (w / 2, h / 2);
            let mut next = vec![0u8; (nw * nh * 4) as usize];
            for y in 0..nh {
                for x in 0..nw {
                    let (mut acc, mut plain, mut asum) = ([0.0f32; 3], [0.0f32; 3], 0.0f32);
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                        let i = (((y * 2 + dy) * w + x * 2 + dx) * 4) as usize;
                        let a = prev[i + 3] as f32;
                        for k in 0..3 {
                            acc[k] += prev[i + k] as f32 * a;
                            plain[k] += prev[i + k] as f32 * 0.25;
                        }
                        asum += a;
                    }
                    let o = ((y * nw + x) * 4) as usize;
                    for k in 0..3 {
                        next[o + k] =
                            if asum > 0.0 { acc[k] / asum } else { plain[k] }.round() as u8;
                    }
                    next[o + 3] = (asum / 4.0).round() as u8;
                }
            }
            levels.push(next);
            (w, h, c) = (nw, nh, c / 2);
        }
        Self {
            width,
            height,
            levels,
        }
    }
}

/// Flowers and small plants among the grass (`nova.grass { flowers = { ... } }`): painted pictures stood upright and turned to the
/// camera, grown on the GPU round it as the blades are, gathered in patches, lit like the ground, swaying and bending with the
/// grass, and fading in and out with the distance.
#[derive(Clone, Debug, PartialEq)]
pub struct Flora {
    pub picture: Arc<FloraPicture>,
    /// Cells across the picture: one kind of plant each.
    pub kinds: u32,
    /// Plants a square metre where a patch is thickest.
    pub density: f32,
    /// A plant's height in metres (each varies from 0.7 to 1.3 times it); its width is the same (the cells are square).
    pub size: f32,
    /// How far from the camera plants grow (metres); they fade out over the last third, each at its own distance.
    pub distance: f32,
    /// Metres across a patch: plants gather in patches about this big, mostly of one kind.
    pub patch: f32,
    /// The share of the ground the patches cover (0 to 1).
    pub cover: f32,
    /// Gardens: x, z, radius (metres) and plants a square metre; inside them plants grow wherever the map has any grass (half or more), not only where it is full.
    pub spots: Vec<[f32; 4]>,
}

impl Flora {
    /// The most plants a square metre anywhere (the patches' or a spot's).
    pub fn most(&self) -> f32 {
        self.spots.iter().fold(self.density, |m, s| m.max(s[3]))
    }

    /// Plants a square holds at the thickest.
    pub fn per_tile(&self) -> u32 {
        (self.most() * TILE * TILE)
            .ceil()
            .clamp(1.0, MAX_FLORA_PER_TILE as f32) as u32
    }

    /// The most plants a square metre in the square `(i, j)`: the patches', or a spot's that reaches into it. A square draws only
    /// that many plants a square metre's worth (most squares hold no garden: they cost the patches' few, not a garden's many).
    pub fn most_in(&self, i: i32, j: i32) -> f32 {
        let (x0, z0) = (i as f32 * TILE, j as f32 * TILE);
        self.spots.iter().fold(self.density, |m, s| {
            let nx = s[0].clamp(x0, x0 + TILE);
            let nz = s[1].clamp(z0, z0 + TILE);
            if (s[0] - nx).hypot(s[1] - nz) < s[2] {
                m.max(s[3])
            } else {
                m
            }
        })
    }

    /// Plants the square `(i, j)` holds at the thickest.
    pub fn per_tile_in(&self, i: i32, j: i32) -> u32 {
        (self.most_in(i, j) * TILE * TILE)
            .ceil()
            .clamp(1.0, MAX_FLORA_PER_TILE as f32) as u32
    }

    /// The share of a square's plants kept at `d` metres: all to a third of the distance, then thinning (the same curve is
    /// `flora_share` in grass.wgsl).
    pub fn share(&self, d: f32) -> f32 {
        let near = self.distance * 0.35;
        if d <= near { 1.0 } else { (near / d).powf(0.7) }
    }
}

impl Default for Grass {
    fn default() -> Self {
        Self {
            map: None,
            colors: None,
            color: [0.11, 0.26, 0.04],
            height: 0.42,
            width: 0.07,
            density: 10.0,
            distance: 32.0,
            sway: 1.0,
            bends: Vec::new(),
            flora: None,
        }
    }
}

impl Grass {
    /// Where the grass starts to thin (metres from the camera).
    pub fn thin_from(&self) -> f32 {
        (self.distance * 0.25).max(1.0)
    }

    /// How many clumps a square holds at full density.
    pub fn per_tile(&self) -> u32 {
        (self.density * TILE * TILE).ceil().clamp(1.0, 4096.0) as u32
    }

    /// The share of clumps kept at `d` metres from the camera (1 near, falling as the distance grows, 0 at `distance`). The same
    /// curve is in grass.wgsl (`grass_share`).
    pub fn share(&self, d: f32) -> f32 {
        let near = self.thin_from();
        let base = if d <= near { 1.0 } else { near / d };
        let end = self.distance;
        let t = ((d - end * 0.7) / (end * 0.3)).clamp(0.0, 1.0);
        base * (1.0 - t * t * (3.0 - 2.0 * t))
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Params {
    /// The map: x0, z0, 1 / cell, 1 when there is one.
    map_area: [f32; 4],
    /// The map's samples across and rows (and the colour grid's), for the texture coordinates.
    sizes: [f32; 4],
    /// The colour grid: x0, z0, 1 / cell, 1 when there is one.
    colors_area: [f32; 4],
    /// rgb: the colour without a grid (linear); w: the blade height.
    base: [f32; 4],
    /// x: clumps a square at full density; y: where it starts to thin; z: where it ends; w: the square's side.
    shape: [f32; 4],
    /// x: the blade's width; y: the sway; z: how many bends; w: blades a clump.
    misc: [f32; 4],
    bends: [[f32; 4]; MAX_BENDS],
    /// Each square drawn: its corner's x and z, the most flora plants a square metre in it, its seed.
    tiles: [[f32; 4]; MAX_TILES],
    /// The flora: x plants a square at the thickest, y its distance, z a plant's height, w the kinds.
    flora: [f32; 4],
    /// x plants a square metre in the patches, y 1 / the patches' size, z their cover, w how many spots.
    flora_b: [f32; 4],
    /// x the most plants a square metre, y 1 when fading is by coverage (multisampling), z 1 when there is flora.
    flora_c: [f32; 4],
    spots: [[f32; 4]; MAX_FLORA_SPOTS],
}

/// One frame's grass draws: the instance range of each square, nearest first (and the flora's).
pub struct GrassFrame {
    draws: Vec<std::ops::Range<u32>>,
    flora: Vec<std::ops::Range<u32>>,
}

impl GrassFrame {
    pub fn triangles(&self) -> u32 {
        self.draws.iter().map(|r| r.len() as u32).sum::<u32>() * BLADES * BLADE_TRIANGLES
            + self.flora.iter().map(|r| r.len() as u32).sum::<u32>() * 2
    }
}

/// The hash grass.wgsl uses (`grass_hash`), for the CPU's copy of where plants stand.
pub fn hash(a: u32, b: u32) -> f32 {
    let mut h = a
        .wrapping_mul(0x8da6_b343)
        .wrapping_add(b.wrapping_mul(0xd816_3841))
        .wrapping_add(0x9e37_79b9);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297a_2d39);
    h ^= h >> 15;
    (h & 0xffff) as f32 / 65535.0
}

/// Value noise over the ground (`flora_noise` in grass.wgsl): 0 to 1, one cell a unit.
pub fn value_noise(x: f32, z: f32) -> f32 {
    let (ix, iz) = (x.floor(), z.floor());
    let (fx, fz) = (x - ix, z - iz);
    let (ux, uz) = (fx * fx * (3.0 - 2.0 * fx), fz * fz * (3.0 - 2.0 * fz));
    let (a, b) = (ix as i32 as u32, iz as i32 as u32);
    let c = |i: u32, j: u32| hash(a.wrapping_add(i), b.wrapping_add(j).wrapping_add(7919));
    let top = c(0, 0) + (c(1, 0) - c(0, 0)) * ux;
    let bottom = c(0, 1) + (c(1, 1) - c(0, 1)) * ux;
    top + (bottom - top) * uz
}

/// The seed of the square `(i, j)` (a share of 2^24, exact in an f32): its clumps' and plants' places are drawn from it.
pub fn tile_seed(i: i32, j: i32) -> f32 {
    (((i as u32).wrapping_mul(0x9E37_79B1) ^ (j as u32).wrapping_mul(0x85EB_CA77)) >> 8) as f32
        / 16_777_216.0
}

impl GroundPicture {
    /// The picture's first channel at a spot on the ground (0 to 1), blended between samples as the GPU does.
    pub fn sample(&self, x: f32, z: f32) -> f32 {
        let channels = (self.texels.len() / (self.width * self.rows).max(1) as usize).max(1);
        let fx = ((x - self.x0) / self.cell).clamp(0.0, (self.width - 1) as f32);
        let fz = ((z - self.z0) / self.cell).clamp(0.0, (self.rows - 1) as f32);
        let (i, j) = (fx.floor() as u32, fz.floor() as u32);
        let (i1, j1) = ((i + 1).min(self.width - 1), (j + 1).min(self.rows - 1));
        let (tx, tz) = (fx - i as f32, fz - j as f32);
        let at =
            |i: u32, j: u32| self.texels[(j * self.width + i) as usize * channels] as f32 / 255.0;
        let top = at(i, j) + (at(i1, j) - at(i, j)) * tx;
        let bottom = at(i, j1) + (at(i1, j1) - at(i, j1)) * tx;
        top + (bottom - top) * tz
    }
}

/// The least of the map (0 to 1) where a plant of the patches grows: where the grass is full, so never on a road's thinning edge.
pub const FLORA_MAP_MIN: f32 = 0.95;
/// The least of the map in a garden spot: where there is grass at all.
pub const FLORA_SPOT_MIN: f32 = 0.5;

impl Grass {
    /// Where the flora's plants stand in the square `(i, j)` (its corner at `i * TILE, j * TILE`), with each plant's kind, as the
    /// GPU places them when the camera is near (further off fewer of them are drawn). The CPU's copy of `vs_flora`'s choice, for tests
    /// and tools.
    pub fn flora_places(&self, i: i32, j: i32) -> Vec<(f32, f32, u32)> {
        let Some(f) = &self.flora else {
            return Vec::new();
        };
        let seed = tile_seed(i, j);
        let su = (seed * 16_777_216.0) as u32;
        let off = [(seed * 3.7 + 0.31).fract(), (seed * 5.3 + 0.67).fract()];
        let most = f.most_in(i, j);
        let mut out = Vec::new();
        for k in 0..f.per_tile_in(i, j) {
            let r = [
                (off[0] + k as f32 * 0.754_877_7).fract(),
                (off[1] + k as f32 * 0.569_840_3).fract(),
            ];
            let (x, z) = (i as f32 * TILE + r[0] * TILE, j as f32 * TILE + r[1] * TILE);
            let (dens, kind) = flora_here(self, f, x, z, hash(k, su.wrapping_add(31)));
            if hash(k, su.wrapping_add(77)) * most < dens {
                out.push((x, z, kind));
            }
        }
        out
    }
}

/// Plants a square metre at `(x, z)` and the kind there (`h` a plant's own random number): `flora_here` in grass.wgsl.
fn flora_here(grass: &Grass, f: &Flora, x: f32, z: f32, h: f32) -> (f32, u32) {
    let mut dens = 0.0f32;
    let mut in_spot = false;
    for s in &f.spots {
        let d = (x - s[0]).hypot(z - s[1]);
        if d < s[2] {
            in_spot = true;
            let t = ((d - s[2] * 0.6) / (s[2] * 0.4)).clamp(0.0, 1.0);
            dens = dens.max(s[3] * (1.0 - t * t * (3.0 - 2.0 * t)));
        }
    }
    let cover = grass.map.as_ref().map_or(1.0, |m| m.sample(x, z));
    if in_spot && cover < FLORA_SPOT_MIN {
        dens = 0.0;
    }
    if !in_spot && cover >= FLORA_MAP_MIN {
        let inv = 1.0 / f.patch.max(0.5);
        let n = value_noise(x * inv, z * inv);
        let edge = 1.0 - f.cover;
        let t = ((n - (edge - 0.1)) / 0.2).clamp(0.0, 1.0);
        dens = f.density * t * t * (3.0 - 2.0 * t);
    }
    let inv = 1.0 / (f.patch.max(0.5) * 1.7);
    let n2 = value_noise(x * inv + 31.7, z * inv + 17.3);
    let pick = (n2 * 1.3 - 0.15 + (h - 0.5) * 0.35).clamp(0.0, 0.999);
    (dens, (pick * f.kinds as f32) as u32)
}

pub struct GrassGpu {
    flora_pipeline: wgpu::RenderPipeline,
    flora_sampler: wgpu::Sampler,
    flora_loaded: Option<Arc<FloraPicture>>,
    a2c: bool,
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    empty_group: wgpu::BindGroup,
    params: wgpu::Buffer,
    sampler: wgpu::Sampler,
    indices: wgpu::Buffer,
    group: Option<wgpu::BindGroup>,
    map_loaded: Option<Arc<GroundPicture>>,
    colors_loaded: Option<Arc<GroundPicture>>,
}

fn picture_view(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    picture: Option<&GroundPicture>,
    format: wgpu::TextureFormat,
) -> wgpu::TextureView {
    let bytes_per = format.block_copy_size(None).unwrap_or(4);
    let fallback = vec![255u8; bytes_per as usize];
    let (w, h, data) = match picture {
        Some(p) => (p.width, p.rows, &p.texels[..]),
        None => (1, 1, &fallback[..]),
    };
    let size = wgpu::Extent3d {
        width: w,
        height: h,
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("grass picture"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(w * bytes_per),
            rows_per_image: Some(h),
        },
        size,
    );
    texture.create_view(&wgpu::TextureViewDescriptor::default())
}

/// The flora's picture on the GPU with its levels (a see-through texel when there is none).
fn flora_view(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    picture: Option<&FloraPicture>,
) -> wgpu::TextureView {
    let empty = FloraPicture {
        width: 1,
        height: 1,
        levels: vec![vec![0, 0, 0, 0]],
    };
    let p = picture.unwrap_or(&empty);
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("flora picture"),
        size: wgpu::Extent3d {
            width: p.width,
            height: p.height,
            depth_or_array_layers: 1,
        },
        mip_level_count: p.levels.len() as u32,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    for (level, data) in p.levels.iter().enumerate() {
        let (w, h) = ((p.width >> level).max(1), (p.height >> level).max(1));
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: level as u32,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(w * 4),
                rows_per_image: Some(h),
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
    }
    texture.create_view(&wgpu::TextureViewDescriptor::default())
}

impl GrassGpu {
    pub fn new(
        device: &wgpu::Device,
        world_format: wgpu::TextureFormat,
        samples: u32,
        globals: &wgpu::BindGroupLayout,
        shadow: &wgpu::BindGroupLayout,
        depth_format: wgpu::TextureFormat,
    ) -> Self {
        let source = concat!(
            include_str!("../shaders/mesh.wgsl"),
            "\n",
            include_str!("../shaders/grass.wgsl")
        );
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("grass"),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });
        let texture_entry =
            |binding: u32, visibility: wgpu::ShaderStages| wgpu::BindGroupLayoutEntry {
                binding,
                visibility,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            };
        let sampler_entry =
            |binding: u32, visibility: wgpu::ShaderStages| wgpu::BindGroupLayoutEntry {
                binding,
                visibility,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            };
        let (vertex, fragment) = (wgpu::ShaderStages::VERTEX, wgpu::ShaderStages::FRAGMENT);
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("grass layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 20,
                    visibility: vertex | fragment,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                texture_entry(21, vertex),
                texture_entry(22, vertex),
                sampler_entry(23, vertex),
                texture_entry(24, fragment),
                sampler_entry(25, fragment),
            ],
        });
        let empty_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("grass empty layout"),
            entries: &[],
        });
        let empty_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("grass empty"),
            layout: &empty_layout,
            entries: &[],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("grass pipeline layout"),
            bind_group_layouts: &[
                Some(globals),
                Some(&empty_layout),
                Some(shadow),
                Some(&layout),
            ],
            immediate_size: 0,
        });
        // (with multisampling a fading blade or plant, and a picture's edge, are drawn by coverage: soft, never a hard cut-out;
        // without it, by a fixed screen-door)
        let a2c = samples > 1;
        let make = |label: &'static str, vs: &'static str, fs: &'static str| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some(vs),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(fs),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: world_format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::COLOR, // (the alpha is the coverage, not kept)
                    })],
                }),
                primitive: wgpu::PrimitiveState {
                    cull_mode: None,
                    ..Default::default()
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: depth_format,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::Less),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: wgpu::MultisampleState {
                    count: samples,
                    alpha_to_coverage_enabled: a2c,
                    ..Default::default()
                },
                multiview_mask: None,
                cache: None,
            })
        };
        let pipeline = make("grass", "vs_grass", "fs_grass");
        let flora_pipeline = make("flora", "vs_flora", "fs_flora");
        let flora_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("flora sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("grass params"),
            size: std::mem::size_of::<Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("grass sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        // a blade: points 0 and 1 at the root (left, right), 2 and 3 half way up, 4 the tip
        let mut list: Vec<u32> = Vec::with_capacity((BLADES * BLADE_TRIANGLES * 3) as usize);
        for b in 0..BLADES {
            let o = b * BLADE_POINTS;
            list.extend_from_slice(&[o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4]);
        }
        let indices = wgpu::util::DeviceExt::create_buffer_init(
            device,
            &wgpu::util::BufferInitDescriptor {
                label: Some("grass clump"),
                contents: bytemuck::cast_slice(&list),
                usage: wgpu::BufferUsages::INDEX,
            },
        );
        Self {
            flora_pipeline,
            flora_sampler,
            flora_loaded: None,
            a2c,
            pipeline,
            layout,
            empty_group,
            params,
            sampler,
            indices,
            group: None,
            map_loaded: None,
            colors_loaded: None,
        }
    }

    /// Puts the pictures on the GPU when they changed (by identity), works out which squares are drawn and how many clumps each,
    /// and writes the frame's parameters. None when there is no grass or nothing of it is in view.
    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        grass: Option<&Grass>,
        eye: Vec3,
        planes: &[glam::Vec4; 6],
        terrain: &super::Terrain,
    ) -> Option<GrassFrame> {
        let grass = grass?;
        let same = |a: &Option<Arc<GroundPicture>>, b: &Option<Arc<GroundPicture>>| match (a, b) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            _ => false,
        };
        let flora_picture = grass.flora.as_ref().map(|f| f.picture.clone());
        let same_flora = match (&self.flora_loaded, &flora_picture) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            _ => false,
        };
        if self.group.is_none()
            || !same(&self.map_loaded, &grass.map)
            || !same(&self.colors_loaded, &grass.colors)
            || !same_flora
        {
            let atlas = flora_view(device, queue, flora_picture.as_deref());
            let map = picture_view(
                device,
                queue,
                grass.map.as_deref(),
                wgpu::TextureFormat::R8Unorm,
            );
            let colors = picture_view(
                device,
                queue,
                grass.colors.as_deref(),
                wgpu::TextureFormat::Rgba8UnormSrgb,
            );
            self.group = Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("grass"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 20,
                        resource: self.params.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 21,
                        resource: wgpu::BindingResource::TextureView(&map),
                    },
                    wgpu::BindGroupEntry {
                        binding: 22,
                        resource: wgpu::BindingResource::TextureView(&colors),
                    },
                    wgpu::BindGroupEntry {
                        binding: 23,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                    wgpu::BindGroupEntry {
                        binding: 24,
                        resource: wgpu::BindingResource::TextureView(&atlas),
                    },
                    wgpu::BindGroupEntry {
                        binding: 25,
                        resource: wgpu::BindingResource::Sampler(&self.flora_sampler),
                    },
                ],
            }));
            self.map_loaded = grass.map.clone();
            self.colors_loaded = grass.colors.clone();
            self.flora_loaded = flora_picture;
        }
        // the squares in reach and in view, nearest first. (A clump's own distance is jittered by up to 9% either way, so that the
        // grass does not thin or end along a ring: a square counts its clumps as if 9% nearer, and the reach is 10% further.)
        let reach = grass.distance * 1.1;
        let per_tile = grass.per_tile();
        let flora = grass.flora.as_ref();
        let flora_per = flora.map_or(0, Flora::per_tile);
        let flora_reach = flora.map_or(0.0, |f| f.distance * 1.1);
        let (i0, i1) = (
            ((eye.x - reach) / TILE).floor() as i32,
            ((eye.x + reach) / TILE).floor() as i32,
        );
        let (j0, j1) = (
            ((eye.z - reach) / TILE).floor() as i32,
            ((eye.z + reach) / TILE).floor() as i32,
        );
        let mut tiles: Vec<(f32, i32, i32, u32, u32)> = Vec::new();
        let tall = (grass.height * 1.6).max(flora.map_or(0.0, |f| f.size * 1.4)) + 0.3;
        for j in j0..=j1 {
            for i in i0..=i1 {
                let (x, z) = (i as f32 * TILE, j as f32 * TILE);
                // the nearest point of the square to the eye, on the ground
                let nx = eye.x.clamp(x, x + TILE);
                let nz = eye.z.clamp(z, z + TILE);
                let d = Vec3::new(nx - eye.x, 0.0, nz - eye.z).length();
                if d >= reach {
                    continue;
                }
                let count =
                    ((per_tile as f32 * grass.share(d * 0.91) * 1.2).ceil() as u32).min(per_tile);
                let flora_count = match flora {
                    Some(f) if d < flora_reach => {
                        let per = f.per_tile_in(i, j);
                        ((per as f32 * f.share(d * 0.91) * 1.4).ceil() as u32).min(per)
                    }
                    _ => 0,
                };
                if count == 0 && flora_count == 0 {
                    continue;
                }
                let hs = [
                    terrain.height(x, z),
                    terrain.height(x + TILE, z),
                    terrain.height(x, z + TILE),
                    terrain.height(x + TILE, z + TILE),
                    terrain.height(x + TILE * 0.5, z + TILE * 0.5),
                ];
                let lo = hs.iter().copied().fold(f32::MAX, f32::min) - 0.5;
                let hi = hs.iter().copied().fold(f32::MIN, f32::max) + tall;
                // (the square's box against each plane of the view: the corner furthest along the plane's normal must be
                // inside it; a bounding sphere would keep the squares under the camera's own feet when it looks up)
                let (bl, bh) = (
                    Vec3::new(x - 0.5, lo, z - 0.5),
                    Vec3::new(x + TILE + 0.5, hi, z + TILE + 0.5),
                );
                let inside = planes.iter().all(|p| {
                    let n = p.truncate();
                    let far = Vec3::new(
                        if n.x >= 0.0 { bh.x } else { bl.x },
                        if n.y >= 0.0 { bh.y } else { bl.y },
                        if n.z >= 0.0 { bh.z } else { bl.z },
                    );
                    n.dot(far) + p.w >= 0.0
                });
                if !inside {
                    continue;
                }
                tiles.push((d, i, j, count, flora_count));
            }
        }
        tiles.sort_by(|a, b| a.0.total_cmp(&b.0));
        tiles.truncate(MAX_TILES);
        if tiles.is_empty() {
            return None;
        }
        let mut params = Params::zeroed();
        let area = |p: &Option<Arc<GroundPicture>>| match p {
            Some(p) => [p.x0, p.z0, 1.0 / p.cell.max(1e-6), 1.0],
            None => [0.0; 4],
        };
        params.map_area = area(&grass.map);
        params.colors_area = area(&grass.colors);
        let dims = |p: &Option<Arc<GroundPicture>>| {
            p.as_ref()
                .map_or((1.0, 1.0), |p| (p.width as f32, p.rows as f32))
        };
        let (mw, mh) = dims(&grass.map);
        let (cw, ch) = dims(&grass.colors);
        params.sizes = [mw, mh, cw, ch];
        params.base = [grass.color[0], grass.color[1], grass.color[2], grass.height];
        params.shape = [per_tile as f32, grass.thin_from(), grass.distance, TILE];
        let bends = grass.bends.len().min(MAX_BENDS);
        params.misc = [grass.width, grass.sway, bends as f32, BLADES as f32];
        params.bends[..bends].copy_from_slice(&grass.bends[..bends]);
        let a2c = if self.a2c { 1.0 } else { 0.0 };
        params.flora_c = [0.0, a2c, 0.0, 0.0];
        if let Some(f) = flora {
            let spots = f.spots.len().min(MAX_FLORA_SPOTS);
            params.flora = [flora_per as f32, f.distance, f.size, f.kinds as f32];
            params.flora_b = [f.density, f.patch, f.cover, spots as f32];
            params.flora_c = [f.most(), a2c, 1.0, 0.0];
            params.spots[..spots].copy_from_slice(&f.spots[..spots]);
        }
        let mut draws = Vec::with_capacity(tiles.len());
        let mut flora_draws = Vec::new();
        for (slot, (_, i, j, count, flora_count)) in tiles.iter().enumerate() {
            params.tiles[slot] = [
                *i as f32 * TILE,
                *j as f32 * TILE,
                flora.map_or(0.0, |f| f.most_in(*i, *j)), // (the grass does not read its count: the flora reads its most here)
                tile_seed(*i, *j),
            ];
            let first = slot as u32 * per_tile;
            if *count > 0 {
                draws.push(first..first + count);
            }
            if *flora_count > 0 {
                let first = slot as u32 * flora_per;
                flora_draws.push(first..first + flora_count);
            }
        }
        queue.write_buffer(&self.params, 0, bytemuck::bytes_of(&params));
        Some(GrassFrame {
            draws,
            flora: flora_draws,
        })
    }

    /// Draws the frame's squares (after the solid models, so the ground under the grass is already in the depth buffer), then the
    /// flora among them. Returns the draw calls made.
    pub fn draw(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        frame: &GrassFrame,
        globals: &wgpu::BindGroup,
        shadow: &wgpu::BindGroup,
    ) -> u32 {
        let Some(group) = &self.group else { return 0 };
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, globals, &[]);
        pass.set_bind_group(1, &self.empty_group, &[]);
        pass.set_bind_group(2, shadow, &[]);
        pass.set_bind_group(3, group, &[]);
        pass.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint32);
        for r in &frame.draws {
            pass.draw_indexed(0..BLADES * BLADE_TRIANGLES * 3, 0, r.clone());
        }
        if !frame.flora.is_empty() {
            pass.set_pipeline(&self.flora_pipeline);
            for r in &frame.flora {
                pass.draw(0..6, r.clone());
            }
        }
        (frame.draws.len() + frame.flora.len()) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_grass_shader_parses_and_validates() {
        let source = concat!(
            include_str!("../shaders/mesh.wgsl"),
            "\n",
            include_str!("../shaders/grass.wgsl")
        );
        let module = naga::front::wgsl::parse_str(source).expect("grass.wgsl parses");
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        )
        .validate(&module)
        .expect("grass.wgsl validates");
    }

    #[test]
    fn the_share_is_whole_near_and_nothing_at_the_end() {
        let g = Grass::default();
        assert_eq!(g.share(0.0), 1.0);
        assert_eq!(g.share(g.thin_from()), 1.0);
        assert!(g.share(g.distance * 0.5) < 1.0 && g.share(g.distance * 0.5) > 0.3);
        assert!(g.share(g.distance) < 1e-6);
        let mut last = 1.0;
        for k in 0..100 {
            let s = g.share(k as f32 * g.distance / 100.0);
            assert!(s <= last + 1e-6, "the share never grows with distance");
            last = s;
        }
    }
}

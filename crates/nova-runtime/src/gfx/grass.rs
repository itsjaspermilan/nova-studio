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
    /// Each square drawn: its corner's x and z, the clumps drawn, its seed.
    tiles: [[f32; 4]; MAX_TILES],
}

/// One frame's grass draws: the instance range of each square, nearest first.
pub struct GrassFrame {
    draws: Vec<std::ops::Range<u32>>,
}

impl GrassFrame {
    pub fn triangles(&self) -> u32 {
        self.draws.iter().map(|r| r.len() as u32).sum::<u32>() * BLADES * BLADE_TRIANGLES
    }
}

pub struct GrassGpu {
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
        let texture_entry = |binding: u32| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::VERTEX,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("grass layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 20,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                texture_entry(21),
                texture_entry(22),
                wgpu::BindGroupLayoutEntry {
                    binding: 23,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
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
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("grass"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs_grass"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_grass"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: world_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
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
                ..Default::default()
            },
            multiview_mask: None,
            cache: None,
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
        if self.group.is_none()
            || !same(&self.map_loaded, &grass.map)
            || !same(&self.colors_loaded, &grass.colors)
        {
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
                ],
            }));
            self.map_loaded = grass.map.clone();
            self.colors_loaded = grass.colors.clone();
        }
        // the squares in reach and in view, nearest first
        let reach = grass.distance;
        let per_tile = grass.per_tile();
        let (i0, i1) = (
            ((eye.x - reach) / TILE).floor() as i32,
            ((eye.x + reach) / TILE).floor() as i32,
        );
        let (j0, j1) = (
            ((eye.z - reach) / TILE).floor() as i32,
            ((eye.z + reach) / TILE).floor() as i32,
        );
        let mut tiles: Vec<(f32, i32, i32, u32)> = Vec::new();
        let tall = grass.height * 1.6 + 0.3;
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
                let count = (per_tile as f32 * grass.share(d)).ceil() as u32;
                if count == 0 {
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
                tiles.push((d, i, j, count));
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
        let mut draws = Vec::with_capacity(tiles.len());
        for (slot, (_, i, j, count)) in tiles.iter().enumerate() {
            let seed = (((*i as u32).wrapping_mul(0x9E37_79B1)
                ^ (*j as u32).wrapping_mul(0x85EB_CA77))
                >> 8) as f32
                / 16_777_216.0;
            params.tiles[slot] = [*i as f32 * TILE, *j as f32 * TILE, *count as f32, seed];
            let first = slot as u32 * per_tile;
            draws.push(first..first + count);
        }
        queue.write_buffer(&self.params, 0, bytemuck::bytes_of(&params));
        Some(GrassFrame { draws })
    }

    /// Draws the frame's squares (after the solid models, so the ground under the grass is already in the depth buffer).
    /// Returns the draw calls made.
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
        frame.draws.len() as u32
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

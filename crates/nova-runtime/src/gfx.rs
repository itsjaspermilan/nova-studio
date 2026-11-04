//! wgpu renderer: batched 2D sprites and instanced low-poly meshes in one pass.
//!
//! The renderer draws into any `TextureView`, so the same code serves the window
//! surface, headless captures and (later) editor viewports.

use bytemuck::{Pod, Zeroable};
use glam::Vec3;
use std::collections::HashMap;
use wgpu::util::DeviceExt;

use crate::model::{Image, MeshData, MeshVertex};

pub const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct SpriteInstance {
    pub center: [f32; 2],
    pub size: [f32; 2],
    pub uv: [f32; 4],
    pub color: [u8; 4],
    pub rotation: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct ModelInstance {
    pub matrix: [[f32; 4]; 4],
    pub tint: [f32; 4],
}

impl ModelInstance {
    /// An instance of a skinned mesh: its joints' matrices start at `joint_base` in the frame's palette (see
    /// [`FrameInput::joints`]). The base rides in the one slot of an affine matrix that is always zero.
    pub fn skinned(mut matrix: [[f32; 4]; 4], tint: [f32; 4], joint_base: u32) -> Self {
        matrix[0][3] = joint_base as f32;
        Self { matrix, tint }
    }
}

/// Per vertex of a skinned mesh: which joints pull it (numbers within the skin) and how hard.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct SkinVertex {
    pub joints: [u16; 4],
    pub weights: [f32; 4],
}

/// The joint palette is a texture of 4-texel matrices, this many texels across (256 matrices a row).
pub const JOINT_TEXTURE_WIDTH: u32 = 1024;
const JOINT_TEXTURE_ROWS: u32 = 64;
/// Most joint matrices a frame can hold: 16,384, about 680 characters of 24 joints. Draws past it are skipped.
pub const MAX_JOINT_MATRICES: usize = (JOINT_TEXTURE_WIDTH / 4 * JOINT_TEXTURE_ROWS) as usize;

/// Most point lights drawn at once (a frame's extra ones are ignored).
pub const MAX_POINT_LIGHTS: usize = 16;

/// A light that fades to nothing at `radius` world units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointLight {
    pub position: [f32; 3],
    pub radius: f32,
    /// Linear multipliers, 1.0 = full.
    pub color: [f32; 3],
}

/// A sky behind everything: `horizon` at and below the horizon line, blending up to `top` overhead. Colours are linear.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sky {
    pub top: [f32; 3],
    pub horizon: [f32; 3],
    /// The direction towards the sun (any length), when the sky shows a sun and, opposite it, a moon.
    pub sun: Option<[f32; 3]>,
    /// How many stars show, 0 to 1.
    pub stars: f32,
    /// How much of the sky is cloud, 0 (none) to 1.
    pub clouds: f32,
    /// Seconds, for twinkling and drifting; set by the game each frame.
    pub time: f32,
}

/// The sun's shadows, in a square of ground `radius` metres either side of what the camera looks at (more is blurrier).
/// `strength` is how dark a shadow is: 0 none, 1 down to the ambient light.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadows {
    pub radius: f32,
    pub strength: f32,
}

impl Default for Shadows {
    fn default() -> Self {
        Self {
            radius: 60.0,
            strength: 0.6,
        }
    }
}

/// Distance fog: models fade into `color` between `near` and `far` world units from the camera. Colour is linear.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fog {
    pub color: [f32; 3],
    pub near: f32,
    pub far: f32,
}

/// How 3D models are lit and seen: one directional light, an ambient floor, a few point lights, and optionally a sky
/// and fog.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lighting {
    /// Direction the light travels (normalised).
    pub direction: [f32; 3],
    pub color: [f32; 3],
    pub ambient: [f32; 3],
    pub points: [PointLight; MAX_POINT_LIGHTS],
    pub point_count: usize,
    pub sky: Option<Sky>,
    pub fog: Option<Fog>,
    pub shadows: Option<Shadows>,
    /// How bright the sky's light is for voxel worlds (`nova.voxel.daylight`): 1 at noon, near 0 at night.
    pub day: f32,
}

impl Default for Lighting {
    fn default() -> Self {
        Self {
            direction: Vec3::new(-0.4, -1.0, -0.3).normalize().to_array(),
            color: [1.0; 3],
            ambient: [0.38, 0.4, 0.46],
            points: [PointLight {
                position: [0.0; 3],
                radius: 1.0,
                color: [0.0; 3],
            }; MAX_POINT_LIGHTS],
            point_count: 0,
            sky: None,
            fog: None,
            shadows: None,
            day: 1.0,
        }
    }
}

impl Lighting {
    /// Adds a point light for this frame; beyond [`MAX_POINT_LIGHTS`] it is ignored.
    pub fn push_point(&mut self, light: PointLight) -> bool {
        if self.point_count >= MAX_POINT_LIGHTS {
            return false;
        }
        self.points[self.point_count] = light;
        self.point_count += 1;
        true
    }
}

#[derive(Clone, Copy)]
pub struct ModelDraw {
    /// Whether it casts a shadow (when shadows are on); translucent meshes never do.
    pub casts: bool,
    pub mesh: usize,
    pub instance: ModelInstance,
}

#[derive(Clone, Copy)]
pub struct Camera {
    pub eye: Vec3,
    pub target: Vec3,
    pub fov_y_degrees: f32,
}

/// Meshes a script makes while it runs (a voxel world's chunks), applied before the frame draws. Their ids start at
/// [`DYN_MESH_BASE`] so they never clash with meshes loaded from model files.
pub enum MeshOp {
    /// The picture all voxel meshes sample (one atlas of block faces).
    SetAtlas(Image),
    /// Makes or replaces a mesh. `plain` meshes are drawn with a white texture (colours only), the others with the voxel atlas.
    Upload {
        id: usize,
        vertices: Vec<MeshVertex>,
        indices: Vec<u32>,
        plain: bool,
    },
    Free(usize),
}

pub const DYN_MESH_BASE: usize = 1 << 30;

pub struct FrameInput<'a> {
    pub clear: [f64; 4],
    pub camera: Camera,
    pub sprites_back: &'a [SpriteInstance],
    /// Draws using the same mesh must be contiguous; each run becomes one instanced draw.
    pub models: &'a [ModelDraw],
    /// Joint matrices for skinned meshes (model space of each joint, bind pose included): a skinned instance's
    /// [`ModelInstance::skinned`] base says where its joints start. At most [`MAX_JOINT_MATRICES`].
    pub joints: &'a [[[f32; 4]; 4]],
    /// Meshes to make or drop before drawing (see [`MeshOp`]).
    pub mesh_ops: &'a [MeshOp],
    /// Meshes drawn in the UI layer, over the UI's shapes and under its text, with an orthographic camera whose units are
    /// the UI's: a model's x and y are screen right and up, its z toward the viewer. No depth: for small convex shapes
    /// (an inventory icon of a block), whose faces do not overlap.
    pub ui_models: &'a [ModelDraw],
    pub lighting: Lighting,
    pub sprites_front: &'a [SpriteInstance],
    /// Text quads (UI layer, native resolution, drawn after `sprites_front`); the UVs index the
    /// glyph atlas set with [`Gfx::update_glyph_atlas`].
    pub text: &'a [SpriteInstance],
    /// Height in pixels of the world (sprites_back + models) render target; 0 or >= the
    /// screen height renders the world at native resolution. The width follows the screen
    /// aspect. `sprites_front` (HUD/UI) always renders at native resolution.
    pub world_height: u32,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct FrameStats {
    /// How long the GPU took over a recent frame (the last one whose timing has come back), in milliseconds; 0 where the GPU
    /// cannot say. Unlike `Perf`'s render time, which is the CPU's cost of recording the frame, this is the GPU's own.
    pub gpu_ms: f32,
    /// Model draws left out of the world pass because they are outside the camera's view.
    pub culled: u32,
    pub draw_calls: u32,
    pub sprites: u32,
    pub triangles: u32,
    pub world_size: (u32, u32),
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SpriteView {
    size: [f32; 2],
    pad: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
    /// xyz: direction the light travels; w: how many point lights are in use.
    light_dir: [f32; 4],
    light_color: [f32; 4],
    ambient: [f32; 4],
    /// xyz: position; w: radius.
    point_pos: [[f32; 4]; MAX_POINT_LIGHTS],
    point_color: [[f32; 4]; MAX_POINT_LIGHTS],
    inv_view_proj: [[f32; 4]; 4],
    /// xyz: the camera.
    eye: [f32; 4],
    /// rgb: colour overhead; w: 1 when there is a sky.
    sky_top: [f32; 4],
    sky_horizon: [f32; 4],
    /// rgb: colour; w: 1 when there is fog.
    fog_color: [f32; 4],
    /// x: where fog starts; y: where it is complete.
    fog_range: [f32; 4],
    light_view_proj: [[f32; 4]; 4],
    /// x: 1 when shadows are on; y: one texel of the shadow map, as a fraction; z: bias; w: how dark a shadow is.
    shadow: [f32; 4],
    /// x: sky brightness for voxel meshes (0 to 1).
    voxel: [f32; 4],
    /// xyz: the way to the sun (unit); w: stars, 0 to 1.
    sky_sun: [f32; 4],
    /// x: cloud cover; y: time; z: 1 when there is a sun and moon.
    sky_extra: [f32; 4],
}

/// Side of the (square) shadow map in texels.
const SHADOW_SIZE: u32 = 2048;

struct DynBuffer {
    buffer: wgpu::Buffer,
    capacity: u64,
    usage: wgpu::BufferUsages,
    label: &'static str,
}

impl DynBuffer {
    fn new(
        device: &wgpu::Device,
        label: &'static str,
        usage: wgpu::BufferUsages,
        capacity: u64,
    ) -> Self {
        let usage = usage | wgpu::BufferUsages::COPY_DST;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size: capacity,
            usage,
            mapped_at_creation: false,
        });
        Self {
            buffer,
            capacity,
            usage,
            label,
        }
    }

    fn write(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, data: &[u8]) {
        let needed = (data.len() as u64).max(4);
        if needed > self.capacity {
            let capacity = needed.next_power_of_two();
            *self = DynBuffer::new(device, self.label, self.usage, capacity);
        }
        if !data.is_empty() {
            queue.write_buffer(&self.buffer, 0, data);
        }
    }
}

struct WorldTarget {
    view: wgpu::TextureView,
    size: (u32, u32),
    group: wgpu::BindGroup,
}

struct GpuMesh {
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    index_count: u32,
    texture: wgpu::BindGroup,
    /// Some vertex is see-through: the mesh is drawn after the solid ones, blended.
    translucent: bool,
    /// Joints and weights, for a skinned mesh (drawn by the skinned pipelines, never see-through).
    skin: Option<wgpu::Buffer>,
    /// A sphere that holds the whole mesh (centre, radius), in the mesh's own space, for culling.
    bounds: ([f32; 3], f32),
}

/// Times the GPU's work on a frame with two timestamps (the start of the first pass, the end of the last) and reads them back a
/// frame later, so that nothing waits. Only where the adapter has timestamp queries.
struct GpuTimer {
    queries: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    readback: wgpu::Buffer,
    /// Nanoseconds a tick is.
    period: f32,
    /// 0: free, 1: a read is in flight, 2: it has finished and can be read.
    state: std::sync::Arc<std::sync::atomic::AtomicU8>,
    last_ms: f32,
}

impl GpuTimer {
    fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        Self {
            queries: device.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("frame timestamps"),
                ty: wgpu::QueryType::Timestamp,
                count: 2,
            }),
            resolve: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("timestamps resolve"),
                size: 16,
                usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }),
            readback: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("timestamps readback"),
                size: 16,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            period: queue.get_timestamp_period(),
            state: std::sync::Arc::new(std::sync::atomic::AtomicU8::new(0)),
            last_ms: 0.0,
        }
    }

    fn idle(&self) -> bool {
        self.state.load(std::sync::atomic::Ordering::Acquire) == 0
    }

    /// Takes a finished reading, if there is one.
    fn collect(&mut self, device: &wgpu::Device) {
        use std::sync::atomic::Ordering;
        if self.state.load(Ordering::Acquire) == 1 {
            let _ = device.poll(wgpu::PollType::Poll);
        }
        if self.state.load(Ordering::Acquire) == 2 {
            {
                if let Ok(range) = self.readback.slice(..).get_mapped_range() {
                    let t: &[u64] = bytemuck::cast_slice(&range);
                    if t.len() >= 2 && t[1] >= t[0] {
                        self.last_ms = (t[1] - t[0]) as f32 * self.period / 1.0e6;
                    }
                }
            }
            self.readback.unmap();
            self.state.store(0, Ordering::Release);
        }
    }

    /// After the frame was submitted: asks for the two timestamps.
    fn request(&self) {
        use std::sync::atomic::Ordering;
        self.state.store(1, Ordering::Release);
        let state = self.state.clone();
        self.readback
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                state.store(if result.is_ok() { 2 } else { 0 }, Ordering::Release);
            });
    }
}

/// A sphere around the vertices (the middle of their box and the distance to its corner): cheap and never too small.
fn bounding_sphere(vertices: &[MeshVertex]) -> ([f32; 3], f32) {
    if vertices.is_empty() {
        return ([0.0; 3], 0.0);
    }
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for v in vertices {
        for k in 0..3 {
            lo[k] = lo[k].min(v.position[k]);
            hi[k] = hi[k].max(v.position[k]);
        }
    }
    let centre = [
        (lo[0] + hi[0]) / 2.0,
        (lo[1] + hi[1]) / 2.0,
        (lo[2] + hi[2]) / 2.0,
    ];
    let half = [
        (hi[0] - lo[0]) / 2.0,
        (hi[1] - lo[1]) / 2.0,
        (hi[2] - lo[2]) / 2.0,
    ];
    (
        centre,
        (half[0] * half[0] + half[1] * half[1] + half[2] * half[2]).sqrt(),
    )
}

/// The six planes of the view volume (normals pointing in), for wgpu's 0..1 depth: from a view-projection matrix.
fn frustum_planes(view_proj: &glam::Mat4) -> [glam::Vec4; 6] {
    let row = |i: usize| {
        glam::Vec4::new(
            view_proj.x_axis[i],
            view_proj.y_axis[i],
            view_proj.z_axis[i],
            view_proj.w_axis[i],
        )
    };
    let (r0, r1, r2, r3) = (row(0), row(1), row(2), row(3));
    [r3 + r0, r3 - r0, r3 + r1, r3 - r1, r2, r3 - r2].map(|p| {
        let n = p.truncate().length();
        if n > 0.0 { p / n } else { p }
    })
}

/// Whether a sphere is at least partly inside the view volume.
fn sphere_visible(planes: &[glam::Vec4; 6], centre: Vec3, radius: f32) -> bool {
    planes
        .iter()
        .all(|p| p.truncate().dot(centre) + p.w >= -radius)
}

/// Whether an instance of a mesh with these bounds can be seen: its sphere moved and scaled by the instance's matrix. A skinned
/// mesh's sphere is the rest pose's, grown by half to allow for limbs that swing out.
fn instance_visible(
    planes: &[glam::Vec4; 6],
    bounds: ([f32; 3], f32),
    skinned: bool,
    matrix: &[[f32; 4]; 4],
) -> bool {
    let m = glam::Mat4::from_cols_array_2d(matrix);
    let scale = m
        .x_axis
        .truncate()
        .length()
        .max(m.y_axis.truncate().length())
        .max(m.z_axis.truncate().length());
    let centre = m.transform_point3(Vec3::from(bounds.0));
    let radius = bounds.1 * scale * if skinned { 1.5 } else { 1.0 };
    sphere_visible(planes, centre, radius)
}

pub struct Gfx {
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub format: wgpu::TextureFormat,
    pub adapter_info: wgpu::AdapterInfo,
    sprite_pipeline: wgpu::RenderPipeline,
    sprite_ui_pipeline: wgpu::RenderPipeline,
    text_pipeline: wgpu::RenderPipeline,
    glyph_texture: wgpu::Texture,
    glyph_group: wgpu::BindGroup,
    sprites_text: DynBuffer,
    blit_pipeline: wgpu::RenderPipeline,
    blit_uniform: wgpu::Buffer,
    blit_group: wgpu::BindGroup,
    linear_sampler: wgpu::Sampler,
    world: Option<WorldTarget>,
    sprite_view: wgpu::Buffer,
    sprite_view_group: wgpu::BindGroup,
    texture_layout: wgpu::BindGroupLayout,
    sampler_nearest: wgpu::Sampler,
    atlas: wgpu::BindGroup,
    sprites_back: DynBuffer,
    sprites_front: DynBuffer,
    mesh_pipeline: wgpu::RenderPipeline,
    mesh_blend_pipeline: wgpu::RenderPipeline,
    skinned_pipeline: wgpu::RenderPipeline,
    skinned_shadow_pipeline: wgpu::RenderPipeline,
    joint_texture: wgpu::Texture,
    joint_group: wgpu::BindGroup,
    sky_pipeline: wgpu::RenderPipeline,
    shadow_pipeline: wgpu::RenderPipeline,
    shadow_view: wgpu::TextureView,
    shadow_group: wgpu::BindGroup,
    globals: wgpu::Buffer,
    globals_group: wgpu::BindGroup,
    meshes: Vec<GpuMesh>,
    dyn_meshes: HashMap<usize, GpuMesh>,
    voxel_atlas: Option<wgpu::BindGroup>,
    sampler_voxel: wgpu::Sampler,
    /// Buffers of meshes that were freed, kept for the next mesh that fits (a rebuilt chunk piece is about the same size).
    spare_vertices: Vec<wgpu::Buffer>,
    spare_indices: Vec<wgpu::Buffer>,
    /// How many GPU buffers script-made meshes have needed to create, and how many uploads reused one.
    pub mesh_buffers_created: u32,
    pub mesh_buffers_reused: u32,
    ui_mesh_pipeline: wgpu::RenderPipeline,
    ui_globals: wgpu::Buffer,
    ui_globals_group: wgpu::BindGroup,
    ui_instances: DynBuffer,
    model_instances: DynBuffer,
    /// The instances that are in view, for the world pass (the shadow pass takes every one of `model_instances`).
    view_instances: DynBuffer,
    /// Texture bind groups of model meshes by the picture's contents, so that models that carry the same picture (a kit's shared
    /// palette, embedded in every file) share one texture.
    texture_cache: HashMap<u64, wgpu::BindGroup>,
    /// GPU timing, where the adapter can do it.
    gpu_timer: Option<GpuTimer>,
    /// How many textures that sharing has saved (for the tests and the log).
    pub textures_shared: u32,
    depth: Option<(wgpu::TextureView, (u32, u32))>,
}

/// The picture and its smaller copies, one after another (each half the size, averaged with see-through texels counting
/// for less), for `levels` levels. A tile 16 pixels wide stays whole down to level 4, so blocks in an atlas do not
/// bleed into each other.
pub fn mip_chain(image: &Image, levels: u32) -> Vec<u8> {
    let mut out = image.rgba.clone();
    let (mut w, mut h) = (image.width as usize, image.height as usize);
    let mut prev = image.rgba.clone();
    for _ in 1..levels {
        let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
        let mut next = vec![0u8; nw * nh * 4];
        for y in 0..nh {
            for x in 0..nw {
                let (mut r, mut g, mut b, mut a) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let (sx, sy) = ((x * 2 + dx).min(w - 1), (y * 2 + dy).min(h - 1));
                    let i = (sy * w + sx) * 4;
                    let al = prev[i + 3] as f32 / 255.0;
                    r += prev[i] as f32 * al;
                    g += prev[i + 1] as f32 * al;
                    b += prev[i + 2] as f32 * al;
                    a += al;
                }
                let o = (y * nw + x) * 4;
                if a > 0.0 {
                    next[o] = (r / a).round() as u8;
                    next[o + 1] = (g / a).round() as u8;
                    next[o + 2] = (b / a).round() as u8;
                }
                next[o + 3] = (a / 4.0 * 255.0).round() as u8;
            }
        }
        out.extend_from_slice(&next);
        prev = next;
        (w, h) = (nw, nh);
    }
    out
}

fn texture_group(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    label: &str,
    image: &Image,
) -> wgpu::BindGroup {
    texture_group_mips(device, queue, layout, sampler, label, image, 1)
}

fn texture_group_mips(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    label: &str,
    image: &Image,
    levels: u32,
) -> wgpu::BindGroup {
    let data = if levels > 1 {
        mip_chain(image, levels)
    } else {
        image.rgba.clone()
    };
    let texture = device.create_texture_with_data(
        queue,
        &wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: image.width,
                height: image.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: levels,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        },
        wgpu::util::TextureDataOrder::LayerMajor,
        &data,
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}

impl Gfx {
    pub fn new(
        instance: &wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
    ) -> Result<Self, String> {
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: surface,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("no suitable GPU adapter: {e}"))?;
        let adapter_info = adapter.get_info();
        log::info!(
            "adapter: {} ({:?}, {:?})",
            adapter_info.name,
            adapter_info.backend,
            adapter_info.device_type
        );
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("nova device"),
            // timestamp queries (the GPU's own frame time) where the adapter has them
            required_features: adapter.features() & wgpu::Features::TIMESTAMP_QUERY,
            // The lowest common denominator (GLES 3.0 class), with the texture sizes the GPU offers.
            required_limits:
                wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits()),
            ..Default::default()
        }))
        .map_err(|e| format!("cannot create GPU device: {e}"))?;
        let format = surface
            .map(|surface| {
                let formats = surface.get_capabilities(&adapter).formats;
                formats
                    .iter()
                    .copied()
                    .find(|f| f.is_srgb())
                    .unwrap_or(formats[0])
            })
            .unwrap_or(wgpu::TextureFormat::Rgba8UnormSrgb);

        let sampler_nearest = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("nearest"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });
        // pixelated up close, blended between smaller copies far away
        let sampler_voxel = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("voxel"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("texture layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let uniform_layout = |label: &str, visibility| {
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some(label),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            })
        };
        let sprite_view_layout = uniform_layout("sprite view layout", wgpu::ShaderStages::VERTEX);
        let globals_layout = uniform_layout("globals layout", wgpu::ShaderStages::VERTEX_FRAGMENT);

        let sprite_view = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("sprite view"),
            size: std::mem::size_of::<SpriteView>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sprite_view_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sprite view"),
            layout: &sprite_view_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: sprite_view.as_entire_binding(),
            }],
        });
        let globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("globals"),
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let globals_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("globals"),
            layout: &globals_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: globals.as_entire_binding(),
            }],
        });

        let white = Image {
            width: 1,
            height: 1,
            rgba: vec![255; 4],
        };
        let atlas = texture_group(
            &device,
            &queue,
            &texture_layout,
            &sampler_nearest,
            "empty atlas",
            &white,
        );

        let sprite_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/sprite.wgsl"));
        let mesh_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/mesh.wgsl"));

        let sprite_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("sprite pipeline layout"),
            bind_group_layouts: &[Some(&sprite_view_layout), Some(&texture_layout)],
            immediate_size: 0,
        });
        let sprite_attributes = wgpu::vertex_attr_array![
            0 => Float32x2, 1 => Float32x2, 2 => Float32x4, 3 => Unorm8x4, 4 => Float32
        ];
        let blend = wgpu::BlendState::ALPHA_BLENDING;
        let make_sprite_pipeline =
            |label: &'static str, shader: &wgpu::ShaderModule, depth: bool| {
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(label),
                    layout: Some(&sprite_layout),
                    vertex: wgpu::VertexState {
                        module: shader,
                        entry_point: Some("vs_main"),
                        compilation_options: Default::default(),
                        buffers: &[Some(wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<SpriteInstance>() as u64,
                            step_mode: wgpu::VertexStepMode::Instance,
                            attributes: &sprite_attributes,
                        })],
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: shader,
                        entry_point: Some("fs_main"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format,
                            blend: Some(blend),
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    primitive: wgpu::PrimitiveState::default(),
                    depth_stencil: depth.then_some(wgpu::DepthStencilState {
                        format: DEPTH_FORMAT,
                        depth_write_enabled: Some(false),
                        depth_compare: Some(wgpu::CompareFunction::Always),
                        stencil: Default::default(),
                        bias: Default::default(),
                    }),
                    multisample: wgpu::MultisampleState::default(),
                    multiview_mask: None,
                    cache: None,
                })
            };
        let sprite_pipeline = make_sprite_pipeline("sprites", &sprite_shader, true);
        let sprite_ui_pipeline = make_sprite_pipeline("ui sprites", &sprite_shader, false);
        let text_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/text.wgsl"));
        let text_pipeline = make_sprite_pipeline("text", &text_shader, false);
        let glyph_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("glyph atlas"),
            size: wgpu::Extent3d {
                width: crate::text::ATLAS_SIZE,
                height: crate::text::ATLAS_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let glyph_view = glyph_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let glyph_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("glyph atlas"),
            layout: &texture_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&glyph_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler_nearest),
                },
            ],
        });

        let blit_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/blit.wgsl"));
        let blit_uniform_layout =
            uniform_layout("blit uniform layout", wgpu::ShaderStages::FRAGMENT);
        let blit_uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("blit uniform"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let blit_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("blit uniform"),
            layout: &blit_uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: blit_uniform.as_entire_binding(),
            }],
        });
        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("linear"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let blit_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("blit pipeline layout"),
            bind_group_layouts: &[Some(&blit_uniform_layout), Some(&texture_layout)],
            immediate_size: 0,
        });
        let blit_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("blit"),
            layout: Some(&blit_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &blit_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &blit_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        // The sun's shadow map: a depth texture the world is drawn into from the sun's side, then sampled by every mesh.
        let shadow_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("shadow map"),
            size: wgpu::Extent3d {
                width: SHADOW_SIZE,
                height: SHADOW_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let shadow_view = shadow_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let shadow_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("shadow sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            compare: Some(wgpu::CompareFunction::LessEqual),
            ..Default::default()
        });
        let shadow_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("shadow layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                    count: None,
                },
            ],
        });
        let shadow_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("shadow"),
            layout: &shadow_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&shadow_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&shadow_sampler),
                },
            ],
        });
        let mesh_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("mesh pipeline layout"),
            bind_group_layouts: &[
                Some(&globals_layout),
                Some(&texture_layout),
                Some(&shadow_layout),
            ],
            immediate_size: 0,
        });
        let vertex_attributes = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Unorm8x4, 3 => Float32x2, 9 => Float32];
        let instance_attributes = wgpu::vertex_attr_array![
            4 => Float32x4, 5 => Float32x4, 6 => Float32x4, 7 => Float32x4, 8 => Float32x4
        ];
        // Opaque meshes write depth and overwrite; meshes with see-through colours (vertex alpha) are drawn after them, blended,
        // without writing depth, so a puff of dust shows the ground behind it.
        let make_mesh_pipeline =
            |label: &'static str, blend: Option<wgpu::BlendState>, depth_write: bool| {
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(label),
                    layout: Some(&mesh_layout),
                    vertex: wgpu::VertexState {
                        module: &mesh_shader,
                        entry_point: Some("vs_main"),
                        compilation_options: Default::default(),
                        buffers: &[
                            Some(wgpu::VertexBufferLayout {
                                array_stride: std::mem::size_of::<MeshVertex>() as u64,
                                step_mode: wgpu::VertexStepMode::Vertex,
                                attributes: &vertex_attributes,
                            }),
                            Some(wgpu::VertexBufferLayout {
                                array_stride: std::mem::size_of::<ModelInstance>() as u64,
                                step_mode: wgpu::VertexStepMode::Instance,
                                attributes: &instance_attributes,
                            }),
                        ],
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &mesh_shader,
                        entry_point: Some("fs_main"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format,
                            blend,
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    primitive: wgpu::PrimitiveState {
                        cull_mode: Some(wgpu::Face::Back),
                        ..Default::default()
                    },
                    depth_stencil: Some(wgpu::DepthStencilState {
                        format: DEPTH_FORMAT,
                        depth_write_enabled: Some(depth_write),
                        depth_compare: Some(wgpu::CompareFunction::Less),
                        stencil: Default::default(),
                        bias: Default::default(),
                    }),
                    multisample: wgpu::MultisampleState::default(),
                    multiview_mask: None,
                    cache: None,
                })
            };
        let shadow_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/shadow.wgsl"));
        let shadow_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("shadow pipeline layout"),
                bind_group_layouts: &[Some(&globals_layout)],
                immediate_size: 0,
            });
        // Depth only: the same vertices and instances as the meshes, from the sun's side. Both faces are drawn (thin
        // shapes like the ground box and flat quads would otherwise leak light) and the bias lives in the sampling.
        let shadow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("shadow"),
            layout: Some(&shadow_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shadow_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<MeshVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &vertex_attributes,
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<ModelInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &instance_attributes,
                    }),
                ],
            },
            fragment: None,
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let sky_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/sky.wgsl"));
        let sky_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("sky pipeline layout"),
            bind_group_layouts: &[Some(&globals_layout)],
            immediate_size: 0,
        });
        // One triangle over the whole screen, behind everything: no depth test or write.
        let sky_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("sky"),
            layout: Some(&sky_layout),
            vertex: wgpu::VertexState {
                module: &sky_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &sky_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let mesh_pipeline = make_mesh_pipeline("meshes", None, true);
        // Skinned meshes: the same shading, with the vertex stage bending the mesh by the frame's joint palette (a texture).
        let joint_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("joints"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let joint_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("joint palette"),
            size: wgpu::Extent3d {
                width: JOINT_TEXTURE_WIDTH,
                height: JOINT_TEXTURE_ROWS,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba32Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let joint_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("joints"),
            layout: &joint_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(
                    &joint_texture.create_view(&wgpu::TextureViewDescriptor::default()),
                ),
            }],
        });
        let skin_attributes = wgpu::vertex_attr_array![10 => Uint16x4, 11 => Float32x4];
        let skinned_mesh_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("skinned mesh pipeline layout"),
            bind_group_layouts: &[
                Some(&globals_layout),
                Some(&texture_layout),
                Some(&shadow_layout),
                Some(&joint_layout),
            ],
            immediate_size: 0,
        });
        let skinned_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("skinned meshes"),
            layout: Some(&skinned_mesh_layout),
            vertex: wgpu::VertexState {
                module: &mesh_shader,
                entry_point: Some("vs_skinned"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<MeshVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &vertex_attributes,
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<ModelInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &instance_attributes,
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<SkinVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &skin_attributes,
                    }),
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &mesh_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let skinned_shadow_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("skinned shadow pipeline layout"),
                bind_group_layouts: &[Some(&globals_layout), Some(&joint_layout)],
                immediate_size: 0,
            });
        let skinned_shadow_pipeline =
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("skinned shadow"),
                layout: Some(&skinned_shadow_layout),
                vertex: wgpu::VertexState {
                    module: &shadow_shader,
                    entry_point: Some("vs_skinned"),
                    compilation_options: Default::default(),
                    buffers: &[
                        Some(wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<MeshVertex>() as u64,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &vertex_attributes,
                        }),
                        Some(wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<ModelInstance>() as u64,
                            step_mode: wgpu::VertexStepMode::Instance,
                            attributes: &instance_attributes,
                        }),
                        Some(wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<SkinVertex>() as u64,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &skin_attributes,
                        }),
                    ],
                },
                fragment: None,
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: DEPTH_FORMAT,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::Less),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            });
        // the same meshes drawn into the UI pass (which has no depth): see FrameInput::ui_models
        let ui_mesh_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ui meshes"),
            layout: Some(&mesh_layout),
            vertex: wgpu::VertexState {
                module: &mesh_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<MeshVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &vertex_attributes,
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<ModelInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &instance_attributes,
                    }),
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &mesh_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let ui_globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ui globals"),
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let ui_globals_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ui globals"),
            layout: &globals_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: ui_globals.as_entire_binding(),
            }],
        });
        let ui_instances = DynBuffer::new(
            &device,
            "ui model instances",
            wgpu::BufferUsages::VERTEX,
            1 << 12,
        );
        let mesh_blend_pipeline = make_mesh_pipeline(
            "translucent meshes",
            Some(wgpu::BlendState::ALPHA_BLENDING),
            false,
        );

        let sprites_back =
            DynBuffer::new(&device, "sprites back", wgpu::BufferUsages::VERTEX, 1 << 16);
        let sprites_front = DynBuffer::new(
            &device,
            "sprites front",
            wgpu::BufferUsages::VERTEX,
            1 << 14,
        );
        let sprites_text =
            DynBuffer::new(&device, "sprites text", wgpu::BufferUsages::VERTEX, 1 << 14);
        let model_instances = DynBuffer::new(
            &device,
            "model instances",
            wgpu::BufferUsages::VERTEX,
            1 << 16,
        );

        let view_instances = DynBuffer::new(
            &device,
            "visible model instances",
            wgpu::BufferUsages::VERTEX,
            1 << 16,
        );

        let gpu_timer = device
            .features()
            .contains(wgpu::Features::TIMESTAMP_QUERY)
            .then(|| GpuTimer::new(&device, &queue));

        Ok(Self {
            adapter,
            device,
            queue,
            format,
            adapter_info,
            sprite_pipeline,
            sprite_ui_pipeline,
            text_pipeline,
            glyph_texture,
            glyph_group,
            sprites_text,
            blit_pipeline,
            blit_uniform,
            blit_group,
            linear_sampler,
            world: None,
            sprite_view,
            sprite_view_group,
            texture_layout,
            sampler_nearest,
            atlas,
            sprites_back,
            sprites_front,
            mesh_pipeline,
            mesh_blend_pipeline,
            skinned_pipeline,
            skinned_shadow_pipeline,
            joint_texture,
            joint_group,
            sky_pipeline,
            shadow_pipeline,
            shadow_view,
            shadow_group,
            globals,
            globals_group,
            meshes: Vec::new(),
            dyn_meshes: HashMap::new(),
            voxel_atlas: None,
            sampler_voxel,
            spare_vertices: Vec::new(),
            spare_indices: Vec::new(),
            mesh_buffers_created: 0,
            mesh_buffers_reused: 0,
            ui_mesh_pipeline,
            ui_globals,
            ui_globals_group,
            ui_instances,
            model_instances,
            view_instances,
            texture_cache: HashMap::new(),
            gpu_timer,
            textures_shared: 0,
            depth: None,
        })
    }

    pub fn set_sprite_atlas(&mut self, image: &Image) {
        self.atlas = texture_group(
            &self.device,
            &self.queue,
            &self.texture_layout,
            &self.sampler_nearest,
            "atlas",
            image,
        );
    }

    /// Replaces the glyph atlas contents (`text::ATLAS_SIZE` squared coverage bytes).
    pub fn update_glyph_atlas(&mut self, coverage: &[u8]) {
        let side = crate::text::ATLAS_SIZE;
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.glyph_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            coverage,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(side),
                rows_per_image: Some(side),
            },
            wgpu::Extent3d {
                width: side,
                height: side,
                depth_or_array_layers: 1,
            },
        );
    }

    /// A buffer of at least `bytes` for a mesh: the one it had if that fits without being much too big, else a spare that
    /// fits, else a new one with a little room to grow.
    fn buffer_for(&mut self, had: Option<wgpu::Buffer>, bytes: u64, vertex: bool) -> wgpu::Buffer {
        let fits = |b: &wgpu::Buffer| b.size() >= bytes && b.size() <= bytes * 2 + 4096;
        let spare = if vertex {
            &mut self.spare_vertices
        } else {
            &mut self.spare_indices
        };
        let mut had = had;
        if let Some(b) = had.take() {
            if fits(&b) {
                self.mesh_buffers_reused += 1;
                return b;
            }
            if spare.len() < 64 {
                spare.push(b);
            }
        }
        if let Some(i) = spare.iter().position(fits) {
            self.mesh_buffers_reused += 1;
            return spare.swap_remove(i);
        }
        self.mesh_buffers_created += 1;
        let size = (bytes + bytes / 4 + 256).next_multiple_of(4);
        self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(if vertex {
                "voxel vertices"
            } else {
                "voxel indices"
            }),
            size,
            usage: (if vertex {
                wgpu::BufferUsages::VERTEX
            } else {
                wgpu::BufferUsages::INDEX
            }) | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }

    /// A mesh by id: loaded from a model file, or made by a script (ids from [`DYN_MESH_BASE`]).
    fn mesh(&self, id: usize) -> Option<&GpuMesh> {
        if id >= DYN_MESH_BASE {
            self.dyn_meshes.get(&id)
        } else {
            self.meshes.get(id)
        }
    }

    /// Uploads a mesh once; the returned id is used by [`ModelDraw`].
    pub fn upload_mesh(&mut self, mesh: &MeshData) -> usize {
        let vertices = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("mesh vertices"),
                contents: bytemuck::cast_slice(&mesh.vertices),
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            });
        let indices = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("mesh indices"),
                contents: bytemuck::cast_slice(&mesh.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
        let texture = match &mesh.texture {
            Some(image) => {
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                (image.width, image.height, &image.rgba).hash(&mut hasher);
                let key = hasher.finish();
                if let Some(group) = self.texture_cache.get(&key) {
                    self.textures_shared += 1;
                    group.clone()
                } else {
                    let group = texture_group(
                        &self.device,
                        &self.queue,
                        &self.texture_layout,
                        &self.sampler_nearest,
                        "mesh texture",
                        image,
                    );
                    self.texture_cache.insert(key, group.clone());
                    group
                }
            }
            None => self.white_group(),
        };
        self.meshes.push(GpuMesh {
            vertices,
            indices,
            index_count: mesh.indices.len() as u32,
            texture,
            translucent: mesh.vertices.iter().any(|v| v.color[3] < 255),
            skin: None,
            bounds: bounding_sphere(&mesh.vertices),
        });
        self.meshes.len() - 1
    }

    /// Uploads a mesh that bends with joints: `influences` has, for each vertex, up to four joint numbers and weights.
    pub fn upload_skinned_mesh(
        &mut self,
        mesh: &MeshData,
        influences: &[([u16; 4], [f32; 4])],
    ) -> usize {
        let id = self.upload_mesh(mesh);
        let skin: Vec<SkinVertex> = (0..mesh.vertices.len())
            .map(|i| {
                let (joints, weights) = influences.get(i).copied().unwrap_or(([0; 4], [0.0; 4]));
                SkinVertex { joints, weights }
            })
            .collect();
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("mesh skin"),
                contents: bytemuck::cast_slice(&skin),
                usage: wgpu::BufferUsages::VERTEX,
            });
        let mesh = &mut self.meshes[id];
        mesh.skin = Some(buffer);
        mesh.translucent = false;
        id
    }

    fn white_group(&self) -> wgpu::BindGroup {
        let white = Image {
            width: 1,
            height: 1,
            rgba: vec![255; 4],
        };
        texture_group(
            &self.device,
            &self.queue,
            &self.texture_layout,
            &self.sampler_nearest,
            "white",
            &white,
        )
    }

    fn ensure_depth(&mut self, size: (u32, u32)) {
        if matches!(&self.depth, Some((_, s)) if *s == size) {
            return;
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("depth"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        self.depth = Some((
            texture.create_view(&wgpu::TextureViewDescriptor::default()),
            size,
        ));
    }

    fn ensure_world(&mut self, size: (u32, u32)) {
        if matches!(&self.world, Some(w) if w.size == size) {
            return;
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("world target"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("world target"),
            layout: &self.texture_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.linear_sampler),
                },
            ],
        });
        self.world = Some(WorldTarget { view, size, group });
    }

    /// Logical height 540 maps to the target height, so 2D art keeps its size on any screen.
    pub fn ui_scale(size: (u32, u32)) -> f32 {
        size.1 as f32 / 540.0
    }

    pub fn render(
        &mut self,
        target: &wgpu::TextureView,
        size: (u32, u32),
        input: &FrameInput,
    ) -> FrameStats {
        let aspect = size.0 as f32 / size.1 as f32;
        let world_size = if input.world_height != 0 && input.world_height < size.1 {
            (
                ((input.world_height as f32 * aspect).round() as u32).max(1),
                input.world_height,
            )
        } else {
            size
        };
        let separate = world_size != size;
        self.ensure_depth(world_size);
        if separate {
            self.ensure_world(world_size);
            let blit = [
                world_size.0 as f32,
                world_size.1 as f32,
                size.0 as f32 / world_size.0 as f32,
                size.1 as f32 / world_size.1 as f32,
            ];
            self.queue
                .write_buffer(&self.blit_uniform, 0, bytemuck::cast_slice(&blit));
        }
        let scale = Self::ui_scale(size);
        let view = SpriteView {
            size: [size.0 as f32 / scale, size.1 as f32 / scale],
            pad: [0.0; 2],
        };
        self.queue
            .write_buffer(&self.sprite_view, 0, bytemuck::bytes_of(&view));

        // Where the view ends: 400 m, or just past where the fog has covered everything (what is beyond is the fog's colour
        // already, so it is neither drawn nor missed, and the depth buffer keeps more precision).
        let far = match input.lighting.fog {
            Some(f) if f.far.is_finite() && f.far > 1.0 => (f.far * 1.05).clamp(20.0, 400.0),
            _ => 400.0,
        };
        // wgpu clip space is 0..1 in depth with y up, which is glam's "directx" projection.
        let view_proj = glam::camera::rh::proj::directx::perspective(
            input.camera.fov_y_degrees.to_radians(),
            aspect,
            0.1,
            far,
        ) * glam::camera::rh::view::look_at_mat4(
            input.camera.eye,
            input.camera.target,
            Vec3::Y,
        );
        let lit = &input.lighting;
        let mut point_pos = [[0.0f32; 4]; MAX_POINT_LIGHTS];
        let mut point_color = [[0.0f32; 4]; MAX_POINT_LIGHTS];
        for (i, p) in lit.points.iter().take(lit.point_count).enumerate() {
            point_pos[i] = [
                p.position[0],
                p.position[1],
                p.position[2],
                p.radius.max(0.0001),
            ];
            point_color[i] = [p.color[0], p.color[1], p.color[2], 1.0];
        }
        let (sky, fog) = (lit.sky, lit.fog);
        // The sun's view of the ground around what the camera looks at: a square box seen along the light, moved in whole
        // texels so that shadows do not crawl as the camera moves.
        let (light_view_proj, shadow) = match lit.shadows {
            Some(sh) => {
                let dir = Vec3::from(lit.direction).normalize_or_zero();
                let dir = if dir == Vec3::ZERO { -Vec3::Y } else { dir };
                let r = sh.radius.max(0.5);
                let up = if dir.y.abs() > 0.99 { Vec3::X } else { Vec3::Y };
                let look = glam::camera::rh::view::look_to_mat4(Vec3::ZERO, dir, up);
                let texel = 2.0 * r / SHADOW_SIZE as f32;
                let mut centre = look.transform_point3(input.camera.target);
                centre.x = (centre.x / texel).round() * texel;
                centre.y = (centre.y / texel).round() * texel;
                let proj = glam::camera::rh::proj::directx::orthographic(
                    centre.x - r,
                    centre.x + r,
                    centre.y - r,
                    centre.y + r,
                    -centre.z - r * 4.0,
                    -centre.z + r * 4.0,
                );
                (
                    (proj * look).to_cols_array_2d(),
                    [1.0, 1.0 / SHADOW_SIZE as f32, 0.0015, sh.strength],
                )
            }
            None => ([[0.0; 4]; 4], [0.0; 4]),
        };
        let globals = Globals {
            view_proj: view_proj.to_cols_array_2d(),
            light_dir: [
                lit.direction[0],
                lit.direction[1],
                lit.direction[2],
                lit.point_count.min(MAX_POINT_LIGHTS) as f32,
            ],
            light_color: [lit.color[0], lit.color[1], lit.color[2], 1.0],
            ambient: [lit.ambient[0], lit.ambient[1], lit.ambient[2], 1.0],
            point_pos,
            point_color,
            inv_view_proj: view_proj.inverse().to_cols_array_2d(),
            eye: [
                input.camera.eye.x,
                input.camera.eye.y,
                input.camera.eye.z,
                0.0,
            ],
            sky_top: sky.map_or([0.0; 4], |k| [k.top[0], k.top[1], k.top[2], 1.0]),
            sky_horizon: sky.map_or([0.0; 4], |k| {
                [k.horizon[0], k.horizon[1], k.horizon[2], 1.0]
            }),
            fog_color: fog.map_or([0.0; 4], |f| [f.color[0], f.color[1], f.color[2], 1.0]),
            fog_range: fog.map_or([0.0; 4], |f| [f.near, f.far.max(f.near + 0.001), 0.0, 0.0]),
            light_view_proj,
            shadow,
            voxel: [lit.day, 0.0, 0.0, 0.0],
            sky_sun: sky.map_or([0.0, 1.0, 0.0, 0.0], |k| {
                let d = k
                    .sun
                    .map_or(Vec3::Y, |s| Vec3::from(s).normalize_or(Vec3::Y));
                [d.x, d.y, d.z, k.stars]
            }),
            sky_extra: sky.map_or([0.0; 4], |k| {
                [
                    k.clouds,
                    k.time,
                    if k.sun.is_some() { 1.0 } else { 0.0 },
                    0.0,
                ]
            }),
        };
        self.queue
            .write_buffer(&self.globals, 0, bytemuck::bytes_of(&globals));
        if !input.ui_models.is_empty() {
            // an orthographic camera in the UI's units (y down), looking along -z: clip x = 2X/W - 1, clip y = 1 - 2Y/H,
            // depth from z (nearer is smaller; nothing is depth tested, but it must stay inside 0 to 1)
            let ui_scale = Self::ui_scale(size);
            let (uw, uh) = (size.0 as f32 / ui_scale, size.1 as f32 / ui_scale);
            let ortho = glam::Mat4::from_cols(
                glam::Vec4::new(2.0 / uw, 0.0, 0.0, 0.0),
                glam::Vec4::new(0.0, -2.0 / uh, 0.0, 0.0),
                glam::Vec4::new(0.0, 0.0, -1.0 / 2000.0, 0.0),
                glam::Vec4::new(-1.0, 1.0, 0.5, 1.0),
            );
            let ui_globals = Globals {
                view_proj: ortho.to_cols_array_2d(),
                light_dir: [-0.3, -0.55, -0.78, 0.0],
                light_color: [1.0, 1.0, 1.0, 1.0],
                ambient: [0.6, 0.6, 0.6, 1.0],
                point_pos: [[0.0; 4]; MAX_POINT_LIGHTS],
                point_color: [[0.0; 4]; MAX_POINT_LIGHTS],
                inv_view_proj: ortho.inverse().to_cols_array_2d(),
                eye: [0.0; 4],
                sky_top: [0.0; 4],
                sky_horizon: [0.0; 4],
                fog_color: [0.0; 4],
                fog_range: [0.0; 4],
                light_view_proj: [[0.0; 4]; 4],
                shadow: [0.0; 4],
                voxel: [1.0, 0.0, 0.0, 0.0],
                sky_sun: [0.0, 1.0, 0.0, 0.0],
                sky_extra: [0.0; 4],
            };
            self.queue
                .write_buffer(&self.ui_globals, 0, bytemuck::bytes_of(&ui_globals));
            let instances: Vec<ModelInstance> =
                input.ui_models.iter().map(|m| m.instance).collect();
            self.ui_instances
                .write(&self.device, &self.queue, bytemuck::cast_slice(&instances));
        }

        self.sprites_back.write(
            &self.device,
            &self.queue,
            bytemuck::cast_slice(input.sprites_back),
        );
        self.sprites_front.write(
            &self.device,
            &self.queue,
            bytemuck::cast_slice(input.sprites_front),
        );
        self.sprites_text
            .write(&self.device, &self.queue, bytemuck::cast_slice(input.text));
        for op in input.mesh_ops {
            match op {
                MeshOp::SetAtlas(image) => {
                    // five levels: a 16-pixel tile stays whole down to the last, so far blocks blend instead of shimmering
                    let levels = if image.width.min(image.height) >= 16 {
                        5
                    } else {
                        1
                    };
                    self.voxel_atlas = Some(texture_group_mips(
                        &self.device,
                        &self.queue,
                        &self.texture_layout,
                        &self.sampler_voxel,
                        "voxel atlas",
                        image,
                        levels,
                    ));
                    // meshes made earlier keep the old picture until they are rebuilt, which the game does
                }
                MeshOp::Upload {
                    id,
                    vertices,
                    indices,
                    plain,
                } => {
                    let atlas = if *plain {
                        self.white_group()
                    } else {
                        let Some(atlas) = self.voxel_atlas.clone() else {
                            continue;
                        };
                        atlas
                    };
                    if indices.is_empty() {
                        self.dyn_meshes.remove(id);
                        continue;
                    }
                    // the buffers this mesh had, if they still fit (and are not wastefully big), or a spare that fits, or new ones
                    let old = self.dyn_meshes.remove(id);
                    let (vbytes, ibytes): (&[u8], &[u8]) = (
                        bytemuck::cast_slice(vertices),
                        bytemuck::cast_slice(indices),
                    );
                    let (old_v, old_i) = match old {
                        Some(m) => (Some(m.vertices), Some(m.indices)),
                        None => (None, None),
                    };
                    let vertex_buffer = self.buffer_for(old_v, vbytes.len() as u64, true);
                    let index_buffer = self.buffer_for(old_i, ibytes.len() as u64, false);
                    self.queue.write_buffer(&vertex_buffer, 0, vbytes);
                    self.queue.write_buffer(&index_buffer, 0, ibytes);
                    self.dyn_meshes.insert(
                        *id,
                        GpuMesh {
                            vertices: vertex_buffer,
                            indices: index_buffer,
                            index_count: indices.len() as u32,
                            texture: atlas,
                            translucent: vertices.iter().any(|v| v.color[3] < 255),
                            skin: None,
                            bounds: bounding_sphere(vertices),
                        },
                    );
                }
                MeshOp::Free(id) => {
                    if let Some(m) = self.dyn_meshes.remove(id) {
                        if self.spare_vertices.len() < 64 {
                            self.spare_vertices.push(m.vertices);
                        }
                        if self.spare_indices.len() < 64 {
                            self.spare_indices.push(m.indices);
                        }
                    }
                }
            }
        }
        if !input.joints.is_empty() {
            // the palette: whole rows of the joint texture, only as many as are used
            let count = input.joints.len().min(MAX_JOINT_MATRICES);
            let per_row = (JOINT_TEXTURE_WIDTH / 4) as usize;
            let rows = count.div_ceil(per_row);
            let mut bytes: Vec<u8> = bytemuck::cast_slice(&input.joints[..count]).to_vec();
            bytes.resize(rows * per_row * 64, 0);
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.joint_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(JOINT_TEXTURE_WIDTH * 16),
                    rows_per_image: Some(rows as u32),
                },
                wgpu::Extent3d {
                    width: JOINT_TEXTURE_WIDTH,
                    height: rows as u32,
                    depth_or_array_layers: 1,
                },
            );
        }
        // What the camera can see. The sun's shadow pass still takes everything (a thing out of view can cast a shadow into it).
        let planes = frustum_planes(&view_proj);
        let world_models: Vec<ModelDraw> = input
            .models
            .iter()
            .filter(|m| match self.mesh(m.mesh) {
                Some(mesh) => instance_visible(
                    &planes,
                    mesh.bounds,
                    mesh.skin.is_some(),
                    &m.instance.matrix,
                ),
                None => true,
            })
            .copied()
            .collect();
        let culled = (input.models.len() - world_models.len()) as u32;
        let view_list: Vec<ModelInstance> = world_models.iter().map(|m| m.instance).collect();
        self.view_instances
            .write(&self.device, &self.queue, bytemuck::cast_slice(&view_list));
        if lit.shadows.is_some() {
            let instances: Vec<ModelInstance> = input.models.iter().map(|m| m.instance).collect();
            self.model_instances
                .write(&self.device, &self.queue, bytemuck::cast_slice(&instances));
        }

        let mut stats = FrameStats {
            world_size,
            culled,
            ..Default::default()
        };
        if let Some(t) = &mut self.gpu_timer {
            t.collect(&self.device);
            stats.gpu_ms = t.last_ms;
        }
        // time this frame only if the last reading has come back (the timer is one set of two slots)
        let timing = self.gpu_timer.as_ref().is_some_and(GpuTimer::idle);
        let shadow_pass = lit.shadows.is_some() && !input.models.is_empty();
        let stamps = |begin: bool, end: bool| {
            self.gpu_timer
                .as_ref()
                .filter(|_| timing && (begin || end))
                .map(|t| wgpu::RenderPassTimestampWrites {
                    query_set: &t.queries,
                    beginning_of_pass_write_index: begin.then_some(0),
                    end_of_pass_write_index: end.then_some(1),
                })
        };
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame"),
            });
        if lit.shadows.is_some() && !input.models.is_empty() {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("shadow pass"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.shadow_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: stamps(true, false),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.shadow_pipeline);
            pass.set_bind_group(0, &self.globals_group, &[]);
            let mut skinned_now = false;
            let stride = std::mem::size_of::<ModelInstance>() as u64;
            let mut start = 0usize;
            while start < input.models.len() {
                let (mesh_id, casts) = (input.models[start].mesh, input.models[start].casts);
                let mut end = start;
                while end < input.models.len()
                    && input.models[end].mesh == mesh_id
                    && input.models[end].casts == casts
                {
                    end += 1;
                }
                let Some(mesh) = self.mesh(mesh_id) else {
                    start = end;
                    continue;
                };
                if casts && !mesh.translucent {
                    if mesh.skin.is_some() != skinned_now {
                        skinned_now = mesh.skin.is_some();
                        if skinned_now {
                            pass.set_pipeline(&self.skinned_shadow_pipeline);
                            pass.set_bind_group(1, &self.joint_group, &[]);
                        } else {
                            pass.set_pipeline(&self.shadow_pipeline);
                        }
                        pass.set_bind_group(0, &self.globals_group, &[]);
                    }
                    if let Some(skin) = &mesh.skin {
                        pass.set_vertex_buffer(2, skin.slice(..));
                    }
                    pass.set_vertex_buffer(0, mesh.vertices.slice(..));
                    pass.set_vertex_buffer(
                        1,
                        self.model_instances
                            .buffer
                            .slice(start as u64 * stride..end as u64 * stride),
                    );
                    pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..mesh.index_count, 0, 0..(end - start) as u32);
                    stats.draw_calls += 1;
                }
                start = end;
            }
        }
        {
            let depth_view = &self.depth.as_ref().expect("depth exists").0;
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("world pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: if separate {
                        &self.world.as_ref().expect("world target exists").view
                    } else {
                        target
                    },
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: input.clear[0],
                            g: input.clear[1],
                            b: input.clear[2],
                            a: input.clear[3],
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: stamps(!shadow_pass, false),
                occlusion_query_set: None,
                multiview_mask: None,
            });

            let draw_sprites = |pass: &mut wgpu::RenderPass<'_>,
                                pipeline: &wgpu::RenderPipeline,
                                buffer: &DynBuffer,
                                count: usize|
             -> u32 {
                if count == 0 {
                    return 0;
                }
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, &self.sprite_view_group, &[]);
                pass.set_bind_group(1, &self.atlas, &[]);
                pass.set_vertex_buffer(0, buffer.buffer.slice(..));
                pass.draw(0..6, 0..count as u32);
                count as u32
            };
            if lit.sky.is_some() {
                pass.set_pipeline(&self.sky_pipeline);
                pass.set_bind_group(0, &self.globals_group, &[]);
                pass.draw(0..3, 0..1);
                stats.draw_calls += 1;
            }
            let back = draw_sprites(
                &mut pass,
                &self.sprite_pipeline,
                &self.sprites_back,
                input.sprites_back.len(),
            );
            stats.draw_calls += u32::from(back > 0);
            stats.sprites += back;

            for translucent in [false, true] {
                if world_models.is_empty() {
                    break;
                }
                pass.set_pipeline(if translucent {
                    &self.mesh_blend_pipeline
                } else {
                    &self.mesh_pipeline
                });
                pass.set_bind_group(0, &self.globals_group, &[]);
                pass.set_bind_group(2, &self.shadow_group, &[]);
                let mut skinned_now = false;
                let stride = std::mem::size_of::<ModelInstance>() as u64;
                let mut start = 0usize;
                while start < world_models.len() {
                    let mesh_id = world_models[start].mesh;
                    let mut end = start;
                    while end < world_models.len() && world_models[end].mesh == mesh_id {
                        end += 1;
                    }
                    let Some(mesh) = self.mesh(mesh_id) else {
                        start = end;
                        continue;
                    };
                    // (skinned meshes are always solid)
                    if mesh.translucent != translucent {
                        start = end;
                        continue;
                    }
                    if mesh.skin.is_some() != skinned_now {
                        skinned_now = mesh.skin.is_some();
                        pass.set_pipeline(if skinned_now {
                            &self.skinned_pipeline
                        } else if translucent {
                            &self.mesh_blend_pipeline
                        } else {
                            &self.mesh_pipeline
                        });
                        pass.set_bind_group(0, &self.globals_group, &[]);
                        pass.set_bind_group(2, &self.shadow_group, &[]);
                        if skinned_now {
                            pass.set_bind_group(3, &self.joint_group, &[]);
                        }
                    }
                    if let Some(skin) = &mesh.skin {
                        pass.set_vertex_buffer(2, skin.slice(..));
                    }
                    pass.set_bind_group(1, &mesh.texture, &[]);
                    pass.set_vertex_buffer(0, mesh.vertices.slice(..));
                    pass.set_vertex_buffer(
                        1,
                        self.view_instances
                            .buffer
                            .slice(start as u64 * stride..end as u64 * stride),
                    );
                    pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..mesh.index_count, 0, 0..(end - start) as u32);
                    stats.draw_calls += 1;
                    stats.triangles += mesh.index_count / 3 * (end - start) as u32;
                    start = end;
                }
            }
        }
        {
            // UI pass: always at native resolution, after the (possibly upscaled) world.
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ui pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if separate {
                            wgpu::LoadOp::Clear(wgpu::Color::BLACK)
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: stamps(false, true),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            if separate {
                pass.set_pipeline(&self.blit_pipeline);
                pass.set_bind_group(0, &self.blit_group, &[]);
                pass.set_bind_group(
                    1,
                    &self.world.as_ref().expect("world target exists").group,
                    &[],
                );
                pass.draw(0..3, 0..1);
                stats.draw_calls += 1;
            }
            if !input.sprites_front.is_empty() {
                pass.set_pipeline(&self.sprite_ui_pipeline);
                pass.set_bind_group(0, &self.sprite_view_group, &[]);
                pass.set_bind_group(1, &self.atlas, &[]);
                pass.set_vertex_buffer(0, self.sprites_front.buffer.slice(..));
                pass.draw(0..6, 0..input.sprites_front.len() as u32);
                stats.draw_calls += 1;
                stats.sprites += input.sprites_front.len() as u32;
            }
            if !input.ui_models.is_empty() {
                let stride = std::mem::size_of::<ModelInstance>() as u64;
                let mut start = 0usize;
                while start < input.ui_models.len() {
                    let mesh_id = input.ui_models[start].mesh;
                    let mut end = start;
                    while end < input.ui_models.len() && input.ui_models[end].mesh == mesh_id {
                        end += 1;
                    }
                    if let Some(mesh) = self.mesh(mesh_id).filter(|m| m.skin.is_none()) {
                        pass.set_pipeline(&self.ui_mesh_pipeline);
                        pass.set_bind_group(0, &self.ui_globals_group, &[]);
                        pass.set_bind_group(1, &mesh.texture, &[]);
                        pass.set_bind_group(2, &self.shadow_group, &[]);
                        pass.set_vertex_buffer(0, mesh.vertices.slice(..));
                        pass.set_vertex_buffer(
                            1,
                            self.ui_instances
                                .buffer
                                .slice(start as u64 * stride..end as u64 * stride),
                        );
                        pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                        pass.draw_indexed(0..mesh.index_count, 0, 0..(end - start) as u32);
                        stats.draw_calls += 1;
                        stats.triangles += mesh.index_count / 3 * (end - start) as u32;
                    }
                    start = end;
                }
            }
            if !input.text.is_empty() {
                pass.set_pipeline(&self.text_pipeline);
                pass.set_bind_group(0, &self.sprite_view_group, &[]);
                pass.set_bind_group(1, &self.glyph_group, &[]);
                pass.set_vertex_buffer(0, self.sprites_text.buffer.slice(..));
                pass.draw(0..6, 0..input.text.len() as u32);
                stats.draw_calls += 1;
                stats.sprites += input.text.len() as u32;
            }
        }
        if let (true, Some(t)) = (timing, &self.gpu_timer) {
            encoder.resolve_query_set(&t.queries, 0..2, &t.resolve, 0);
            encoder.copy_buffer_to_buffer(&t.resolve, 0, &t.readback, 0, 16);
        }
        self.queue.submit([encoder.finish()]);
        if let (true, Some(t)) = (timing, &self.gpu_timer) {
            t.request();
        }
        stats
    }

    /// Renders one frame offscreen and returns tightly packed RGBA8 pixels.
    pub fn capture(&mut self, size: (u32, u32), input: &FrameInput) -> Vec<u8> {
        self.capture_with_stats(size, input).0
    }

    /// [`Gfx::capture`], and what the frame drew (draw calls, triangles, how many draws were culled).
    pub fn capture_with_stats(
        &mut self,
        size: (u32, u32),
        input: &FrameInput,
    ) -> (Vec<u8>, FrameStats) {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("capture"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let stats = self.render(&view, size, input);
        let row_bytes = size.0 * 4;
        let padded = row_bytes.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: (padded * size.1) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("capture copy"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(size.1),
                },
            },
            wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([encoder.finish()]);
        let slice = readback.slice(..);
        slice.map_async(wgpu::MapMode::Read, |result| result.expect("map readback"));
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .expect("poll");
        let mapped = slice.get_mapped_range().expect("mapped range");
        let mut pixels = Vec::with_capacity((row_bytes * size.1) as usize);
        for row in mapped.chunks(padded as usize).take(size.1 as usize) {
            pixels.extend_from_slice(&row[..row_bytes as usize]);
        }
        (pixels, stats)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn things_outside_the_view_are_culled_and_big_or_scaled_ones_that_reach_in_are_not() {
        use super::{frustum_planes, instance_visible};
        // a camera at z = 5 looking down -z, 60 degrees tall, square
        let view_proj =
            glam::camera::rh::proj::directx::perspective(60f32.to_radians(), 1.0, 0.1, 400.0)
                * glam::camera::rh::view::look_at_mat4(
                    Vec3::new(0.0, 0.0, 5.0),
                    Vec3::ZERO,
                    Vec3::Y,
                );
        let planes = frustum_planes(&view_proj);
        let at = |x: f32, y: f32, z: f32, scale: f32| {
            glam::Mat4::from_scale_rotation_translation(
                Vec3::splat(scale),
                glam::Quat::IDENTITY,
                Vec3::new(x, y, z),
            )
            .to_cols_array_2d()
        };
        let unit = ([0.0, 0.0, 0.0], 1.0);
        assert!(
            instance_visible(&planes, unit, false, &at(0.0, 0.0, 0.0, 1.0)),
            "straight ahead"
        );
        assert!(
            !instance_visible(&planes, unit, false, &at(0.0, 0.0, 50.0, 1.0)),
            "behind the camera"
        );
        assert!(
            !instance_visible(&planes, unit, false, &at(0.0, 0.0, -500.0, 1.0)),
            "past the far plane"
        );
        assert!(
            !instance_visible(&planes, unit, false, &at(100.0, 0.0, 0.0, 1.0)),
            "far to the side"
        );
        assert!(
            !instance_visible(&planes, unit, false, &at(0.0, 100.0, 0.0, 1.0)),
            "far above"
        );
        assert!(
            instance_visible(&planes, unit, false, &at(100.0, 0.0, 0.0, 120.0)),
            "scaled up so that it reaches into the view"
        );
        // just outside the edge, but its radius reaches over it
        let edge = 5.0 * (30f32.to_radians()).tan(); // half the view's width at the origin's distance
        assert!(instance_visible(
            &planes,
            unit,
            false,
            &at(edge + 0.5, 0.0, 0.0, 1.0)
        ));
        assert!(!instance_visible(
            &planes,
            unit,
            false,
            &at(edge + 1.5, 0.0, 0.0, 1.0)
        ));
        // a skinned mesh is allowed half as much again for limbs that swing out
        assert!(!instance_visible(
            &planes,
            unit,
            false,
            &at(edge + 1.3, 0.0, 0.0, 1.0)
        ));
        assert!(instance_visible(
            &planes,
            unit,
            true,
            &at(edge + 1.3, 0.0, 0.0, 1.0)
        ));
    }

    use super::*;

    #[test]
    fn mip_levels_halve_and_keep_atlas_tiles_apart_down_to_the_last() {
        // a 32 x 32 atlas of two 16-pixel tiles: red and opaque on the left, see-through on the right
        let mut rgba = vec![0u8; 32 * 32 * 4];
        for y in 0..32 {
            for x in 0..16 {
                rgba[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4].copy_from_slice(&[255, 0, 0, 255]);
            }
        }
        let image = Image {
            width: 32,
            height: 32,
            rgba,
        };
        let chain = mip_chain(&image, 5);
        assert_eq!(chain.len(), (32 * 32 + 16 * 16 + 8 * 8 + 4 * 4 + 2 * 2) * 4);
        let last = &chain[(32 * 32 + 16 * 16 + 8 * 8 + 4 * 4) * 4..];
        assert_eq!(
            &last[..4],
            &[255, 0, 0, 255],
            "the left tile is still pure red"
        );
        assert_eq!(last[7], 0, "the right tile is still see-through");
    }
}

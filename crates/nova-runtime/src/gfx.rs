//! wgpu renderer: batched 2D sprites and instanced low-poly meshes in one pass.
//!
//! The renderer draws into any `TextureView`, so the same code serves the window
//! surface, headless captures and (later) editor viewports.

use bytemuck::{Pod, Zeroable};
use glam::Vec3;
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

/// Most point lights drawn at once (a frame's extra ones are ignored).
pub const MAX_POINT_LIGHTS: usize = 8;

/// A light that fades to nothing at `radius` world units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointLight {
    pub position: [f32; 3],
    pub radius: f32,
    /// Linear multipliers, 1.0 = full.
    pub color: [f32; 3],
}

/// How 3D models are lit: one directional light, an ambient floor and a few point lights.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lighting {
    /// Direction the light travels (normalised).
    pub direction: [f32; 3],
    pub color: [f32; 3],
    pub ambient: [f32; 3],
    pub points: [PointLight; MAX_POINT_LIGHTS],
    pub point_count: usize,
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
    pub mesh: usize,
    pub instance: ModelInstance,
}

#[derive(Clone, Copy)]
pub struct Camera {
    pub eye: Vec3,
    pub target: Vec3,
    pub fov_y_degrees: f32,
}

/// New vertices for a mesh made to be rewritten (a posed skinned part), written before the frame draws.
pub struct MeshWrite {
    pub mesh: usize,
    pub vertices: Vec<MeshVertex>,
}

pub struct FrameInput<'a> {
    pub clear: [f64; 4],
    pub camera: Camera,
    pub sprites_back: &'a [SpriteInstance],
    /// Draws using the same mesh must be contiguous; each run becomes one instanced draw.
    pub models: &'a [ModelDraw],
    /// Vertices to put into meshes before drawing (their ids are used by `models`).
    pub mesh_writes: &'a [MeshWrite],
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
}

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
    globals: wgpu::Buffer,
    globals_group: wgpu::BindGroup,
    meshes: Vec<GpuMesh>,
    model_instances: DynBuffer,
    depth: Option<(wgpu::TextureView, (u32, u32))>,
}

fn texture_group(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    label: &str,
    image: &Image,
) -> wgpu::BindGroup {
    let texture = device.create_texture_with_data(
        queue,
        &wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: image.width,
                height: image.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        },
        wgpu::util::TextureDataOrder::LayerMajor,
        &image.rgba,
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
            required_features: wgpu::Features::empty(),
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

        let mesh_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("mesh pipeline layout"),
            bind_group_layouts: &[Some(&globals_layout), Some(&texture_layout)],
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
        let mesh_pipeline = make_mesh_pipeline("meshes", None, true);
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
            globals,
            globals_group,
            meshes: Vec::new(),
            model_instances,
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
            Some(image) => texture_group(
                &self.device,
                &self.queue,
                &self.texture_layout,
                &self.sampler_nearest,
                "mesh texture",
                image,
            ),
            None => self.white_group(),
        };
        self.meshes.push(GpuMesh {
            vertices,
            indices,
            index_count: mesh.indices.len() as u32,
            texture,
            translucent: mesh.vertices.iter().any(|v| v.color[3] < 255),
        });
        self.meshes.len() - 1
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

        // wgpu clip space is 0..1 in depth with y up, which is glam's "directx" projection.
        let view_proj = glam::camera::rh::proj::directx::perspective(
            input.camera.fov_y_degrees.to_radians(),
            aspect,
            0.1,
            400.0,
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
        };
        self.queue
            .write_buffer(&self.globals, 0, bytemuck::bytes_of(&globals));

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
        for w in input.mesh_writes {
            // A write for a mesh that is not there, or with a different size, is ignored.
            if let Some(m) = self.meshes.get(w.mesh) {
                let bytes: &[u8] = bytemuck::cast_slice(&w.vertices);
                if bytes.len() as u64 == m.vertices.size() {
                    self.queue.write_buffer(&m.vertices, 0, bytes);
                }
            }
        }
        let instances: Vec<ModelInstance> = input.models.iter().map(|m| m.instance).collect();
        self.model_instances
            .write(&self.device, &self.queue, bytemuck::cast_slice(&instances));

        let mut stats = FrameStats {
            world_size,
            ..Default::default()
        };
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame"),
            });
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
                timestamp_writes: None,
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
            let back = draw_sprites(
                &mut pass,
                &self.sprite_pipeline,
                &self.sprites_back,
                input.sprites_back.len(),
            );
            stats.draw_calls += u32::from(back > 0);
            stats.sprites += back;

            for translucent in [false, true] {
                if input.models.is_empty() {
                    break;
                }
                pass.set_pipeline(if translucent {
                    &self.mesh_blend_pipeline
                } else {
                    &self.mesh_pipeline
                });
                pass.set_bind_group(0, &self.globals_group, &[]);
                let stride = std::mem::size_of::<ModelInstance>() as u64;
                let mut start = 0usize;
                while start < input.models.len() {
                    let mesh_id = input.models[start].mesh;
                    let mut end = start;
                    while end < input.models.len() && input.models[end].mesh == mesh_id {
                        end += 1;
                    }
                    let mesh = &self.meshes[mesh_id];
                    if mesh.translucent != translucent {
                        start = end;
                        continue;
                    }
                    pass.set_bind_group(1, &mesh.texture, &[]);
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
                timestamp_writes: None,
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
        self.queue.submit([encoder.finish()]);
        stats
    }

    /// Renders one frame offscreen and returns tightly packed RGBA8 pixels.
    pub fn capture(&mut self, size: (u32, u32), input: &FrameInput) -> Vec<u8> {
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
        self.render(&view, size, input);
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
        pixels
    }
}

//! 2D effects, all opt-in (`nova.ambient2d`, `nova.light2d`, a sprite's `blend`, `nova.circle`, an entity's `shadow`,
//! `nova.reflections`, `nova.weather { rain }`; docs/project-format.md "2D light and weather"). A frame that asks for none of them
//! carries no [`Fx2dFrame`] and is drawn exactly as before, by the same pipelines.
//!
//! What each costs, in GPU work (the shaders are in `shaders/fx2d.wgsl`):
//! - lights: one small float picture a quarter of the world picture's size (an eighth with `nova.effects("low")`), cleared to the
//!   ambient colour, each light one quad added into it; every world sprite then reads it once where it stands. No loop over lights
//!   anywhere: a light costs the pixels of its own quad in the small picture.
//! - added light (`blend = "add"` or `"screen"`) and the round shapes: the sprite's own pixels, through another pipeline; a run of
//!   sprites with the same style is one draw.
//! - drop shadows: one soft ellipse each, all drawn in one batch under the first entity that casts one.
//! - reflections: the things standing above puddles, flipped, drawn into a picture of their own (only those whose flipped copy lands
//!   on a reflective tile), then the reflective tiles drawn again over themselves showing it: the pixels of the puddles and of the
//!   reflected sprites, not a copy of the screen.
//! - rain: streaks and splash rings made in the vertex shader from the instance number (no buffer, nothing per drop in Lua).

use super::*;
use std::sync::Arc;

/// Most 2D lights in a frame; more are dropped (the nearest to the middle of the view are kept), and `play` says so.
pub const MAX_LIGHTS_2D: usize = 128;
/// Most sprites mirrored in puddles in a frame.
pub const MAX_MIRRORED: usize = 1024;

/// How a 2D sprite or shape is combined with what is under it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Blend2d {
    /// Covers by its alpha (the default).
    #[default]
    Alpha,
    /// Adds its colour: light. It can only brighten.
    Add,
    /// Brightens like light on film: 1 - (1 - under)(1 - colour); softer than add on bright things, never past white.
    Screen,
}

/// What a 2D quad shows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Shape2d {
    /// Its picture from the atlas.
    #[default]
    Picture,
    /// A filled disc (an ellipse when the quad is not square) of its colour.
    Disc,
    /// The same, soft: full in the middle, nothing at the edge.
    Soft,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Style2d {
    pub blend: Blend2d,
    pub shape: Shape2d,
    /// Multiplied by the light map when 2D lighting is on (added light never is: it is light).
    pub lit: bool,
}

impl Style2d {
    /// The style a plain sprite has (no mark needed).
    pub const PLAIN: Style2d = Style2d {
        blend: Blend2d::Alpha,
        shape: Shape2d::Picture,
        lit: true,
    };

    fn lit_when(self, lighting: bool) -> Self {
        Self {
            lit: self.lit && lighting && self.blend == Blend2d::Alpha,
            ..self
        }
    }
}

/// One 2D light, in the sprites' units (screen units, the view 540 high): its middle, its half sizes across and down (an ellipse
/// on the ground), and its colour in linear light times its intensity.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct Light2d {
    pub center: [f32; 2],
    pub radius: [f32; 2],
    pub color: [f32; 4],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rain2d {
    /// 0 to 1.
    pub amount: f32,
    /// Sideways units per unit of fall.
    pub wind: f32,
    /// Linear colour and alpha.
    pub color: [f32; 4],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reflect2d {
    /// 0 to 1: how much of the mirrored picture shows.
    pub strength: f32,
    /// How far it wobbles, in units.
    pub ripple: f32,
    /// Linear multiplier.
    pub tint: [f32; 3],
}

/// What the 2D effects need for one frame (built by the game at the end of a frame; see `game/fx2d_api.rs`).
#[derive(Clone, Debug, Default)]
pub struct Fx2dFrame {
    /// Linear colour a white thing shows where no light reaches; Some turns the light map on.
    pub ambient: Option<[f32; 3]>,
    pub lights: Vec<Light2d>,
    /// World pixels per light-map pixel (4; 8 is cheaper).
    pub light_scale: u32,
    /// Sprites of `sprites_back` that are not plain, by index, in order.
    pub styles: Vec<(usize, Style2d)>,
    /// Drop shadows (soft ellipses), drawn together before the sprite at `shadows_at`.
    pub shadows: Vec<SpriteInstance>,
    pub shadows_at: usize,
    pub reflect: Option<Reflect2d>,
    /// The reflective tiles (their own quads), drawn again before the sprite at `reflect_at` to show the mirror.
    pub mask: Vec<SpriteInstance>,
    pub reflect_at: usize,
    /// The mirrored copies, and the styles of those that are not plain (by index into `mirrored`).
    pub mirrored: Vec<SpriteInstance>,
    pub mirrored_styles: Vec<(usize, Style2d)>,
    pub rain: Option<Rain2d>,
    /// The world position of the view's top-left corner.
    pub origin: [f32; 2],
    pub time: f32,
}

impl Fx2dFrame {
    fn reflecting(&self) -> bool {
        self.reflect.is_some() && !self.mask.is_empty()
    }
}

/// The frame's 2D effects as [`Lighting`] carries them (compared by identity: a frame's are never edited after they are made).
#[derive(Clone, Debug)]
pub struct Fx2d(pub Arc<Fx2dFrame>);

impl PartialEq for Fx2d {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct FxUniform {
    target: [f32; 2],
    origin: [f32; 2],
    time: f32,
    rain: f32,
    wind: f32,
    drops: f32,
    splashes: f32,
    ripple: f32,
    strength: f32,
    rings: f32,
    rain_color: [f32; 4],
    tint: [f32; 4],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Key {
    /// A sprite style in the world pass, or (false) in the pass that draws the mirror.
    Styled(Style2d, bool),
    Reflect,
    Rain,
}

/// Raindrops and splashes for an amount of rain from 0 to 1.
fn rain_counts(amount: f32) -> (u32, u32) {
    let a = amount.clamp(0.0, 1.0);
    ((a * 520.0).round() as u32, (a * 90.0).round() as u32)
}

pub(super) struct Fx2dGpu {
    module: wgpu::ShaderModule,
    world_format: wgpu::TextureFormat,
    samples: u32,
    texture_layout: wgpu::BindGroupLayout,
    fx_layout: wgpu::BindGroupLayout,
    style_layout: wgpu::PipelineLayout,
    reflect_layout: wgpu::PipelineLayout,
    light_pipeline: wgpu::RenderPipeline,
    pipelines: HashMap<Key, wgpu::RenderPipeline>,
    uniform: wgpu::Buffer,
    sampler: wgpu::Sampler,
    /// A 1 x 1 white light map, for styled draws while lighting is off.
    blank: wgpu::TextureView,
    light: Option<(wgpu::TextureView, (u32, u32))>,
    group: wgpu::BindGroup,
    mirror: Option<(wgpu::TextureView, (u32, u32), wgpu::BindGroup)>,
    lights: DynBuffer,
    shadows: DynBuffer,
    mask: DynBuffer,
    mirrored: DynBuffer,
    /// What `prepare` found for this frame.
    lighting: bool,
    rain_instances: u32,
}

const LIGHT_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

fn fx_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    light: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
    uniform: &wgpu::Buffer,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("2d fx"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(light),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: uniform.as_entire_binding(),
            },
        ],
    })
}

fn float_target(
    device: &wgpu::Device,
    label: &str,
    size: (u32, u32),
    format: wgpu::TextureFormat,
) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: size.0.max(1),
                height: size.1.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
        .create_view(&wgpu::TextureViewDescriptor::default())
}

const PREMULTIPLIED: wgpu::BlendState = wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING;

fn blend_state(blend: Blend2d) -> wgpu::BlendState {
    let keep_alpha = wgpu::BlendComponent {
        src_factor: wgpu::BlendFactor::Zero,
        dst_factor: wgpu::BlendFactor::One,
        operation: wgpu::BlendOperation::Add,
    };
    match blend {
        Blend2d::Alpha => PREMULTIPLIED,
        Blend2d::Add => wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: keep_alpha,
        },
        Blend2d::Screen => wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::OneMinusDst,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: keep_alpha,
        },
    }
}

impl Fx2dGpu {
    pub fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        world_format: wgpu::TextureFormat,
        samples: u32,
        view_layout: &wgpu::BindGroupLayout,
        texture_layout: &wgpu::BindGroupLayout,
    ) -> Self {
        let module = device.create_shader_module(wgpu::include_wgsl!("../shaders/fx2d.wgsl"));
        let fx_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("2d fx layout"),
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
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let style_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("2d fx sprites"),
            bind_group_layouts: &[Some(view_layout), Some(texture_layout), Some(&fx_layout)],
            immediate_size: 0,
        });
        let reflect_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("2d fx reflections"),
            bind_group_layouts: &[
                Some(view_layout),
                Some(texture_layout),
                Some(&fx_layout),
                Some(texture_layout),
            ],
            immediate_size: 0,
        });
        let light_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("2d lights"),
            bind_group_layouts: &[Some(view_layout)],
            immediate_size: 0,
        });
        let light_attributes =
            wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2, 2 => Float32x4];
        let light_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("2d lights"),
            layout: Some(&light_layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs_light"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Light2d>() as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &light_attributes,
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_light"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: LIGHT_FORMAT,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::One,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent::REPLACE,
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("2d fx uniform"),
            size: std::mem::size_of::<FxUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("2d fx"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let blank_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("2d no light map"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &blank_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &[255; 4],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        let blank = blank_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let group = fx_group(device, &fx_layout, &blank, &sampler, &uniform);
        let buffer = |label| DynBuffer::new(device, label, wgpu::BufferUsages::VERTEX, 1 << 10);
        Self {
            module,
            world_format,
            samples,
            texture_layout: texture_layout.clone(),
            fx_layout,
            style_layout,
            reflect_layout,
            light_pipeline,
            pipelines: HashMap::new(),
            uniform,
            sampler,
            blank,
            light: None,
            group,
            mirror: None,
            lights: buffer("2d lights"),
            shadows: buffer("2d shadows"),
            mask: buffer("2d reflective tiles"),
            mirrored: buffer("2d mirrored sprites"),
            lighting: false,
            rain_instances: 0,
        }
    }

    fn make(&self, device: &wgpu::Device, key: Key) -> wgpu::RenderPipeline {
        let sprite_attributes = wgpu::vertex_attr_array![
            0 => Float32x2, 1 => Float32x2, 2 => Float32x4, 3 => Unorm8x4, 4 => Float32
        ];
        let sprite_buffer = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<SpriteInstance>() as u64,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &sprite_attributes,
        };
        let (vertex, fragment, blend, world, layout, buffers) = match key {
            Key::Styled(style, world) => {
                let fragment = match (style.shape, style.lit) {
                    (Shape2d::Picture, false) => "fs_picture",
                    (Shape2d::Picture, true) => "fs_picture_lit",
                    (Shape2d::Disc, false) => "fs_disc",
                    (Shape2d::Disc, true) => "fs_disc_lit",
                    (Shape2d::Soft, false) => "fs_soft",
                    (Shape2d::Soft, true) => "fs_soft_lit",
                };
                (
                    "vs_sprite",
                    fragment,
                    blend_state(style.blend),
                    world,
                    &self.style_layout,
                    vec![Some(sprite_buffer)],
                )
            }
            Key::Reflect => (
                "vs_sprite",
                "fs_reflect",
                PREMULTIPLIED,
                true,
                &self.reflect_layout,
                vec![Some(sprite_buffer)],
            ),
            Key::Rain => (
                "vs_rain",
                "fs_rain",
                PREMULTIPLIED,
                true,
                &self.style_layout,
                vec![],
            ),
        };
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("2d fx"),
            layout: Some(layout),
            vertex: wgpu::VertexState {
                module: &self.module,
                entry_point: Some(vertex),
                compilation_options: Default::default(),
                buffers: &buffers,
            },
            fragment: Some(wgpu::FragmentState {
                module: &self.module,
                entry_point: Some(fragment),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: self.world_format,
                    blend: Some(blend),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            // the world pass has a depth buffer (for the models); 2D draws neither test nor write it
            depth_stencil: world.then_some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: if world { self.samples } else { 1 },
                ..Default::default()
            },
            multiview_mask: None,
            cache: None,
        })
    }

    fn ensure(&mut self, device: &wgpu::Device, key: Key) {
        if !self.pipelines.contains_key(&key) {
            let p = self.make(device, key);
            self.pipelines.insert(key, p);
        }
    }

    /// Puts the frame's lights, shapes and mirror on the GPU and makes what is missing; call before the passes.
    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        frame: &Fx2dFrame,
        world_size: (u32, u32),
    ) {
        self.lighting = frame.ambient.is_some();
        // the light map: a fraction of the world picture's size
        if self.lighting {
            let scale = frame.light_scale.clamp(1, 16);
            let size = (world_size.0.div_ceil(scale), world_size.1.div_ceil(scale));
            if !matches!(&self.light, Some((_, s)) if *s == size) {
                let view = float_target(device, "2d light map", size, LIGHT_FORMAT);
                self.group = fx_group(device, &self.fx_layout, &view, &self.sampler, &self.uniform);
                self.light = Some((view, size));
            }
            self.lights
                .write(device, queue, bytemuck::cast_slice(&frame.lights));
        } else if self.light.take().is_some() {
            self.group = fx_group(
                device,
                &self.fx_layout,
                &self.blank,
                &self.sampler,
                &self.uniform,
            );
        }
        let reflecting = frame.reflecting();
        if reflecting {
            if !matches!(&self.mirror, Some((_, s, _)) if *s == world_size) {
                let view = float_target(device, "2d mirror", world_size, self.world_format);
                let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("2d mirror"),
                    layout: &self.texture_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                });
                self.mirror = Some((view, world_size, group));
            }
            self.mask
                .write(device, queue, bytemuck::cast_slice(&frame.mask));
            self.mirrored
                .write(device, queue, bytemuck::cast_slice(&frame.mirrored));
            self.ensure(device, Key::Reflect);
            self.ensure(device, Key::Styled(Style2d::PLAIN.lit_when(false), false));
            for &(_, style) in &frame.mirrored_styles {
                self.ensure(device, Key::Styled(style.lit_when(false), false));
            }
        } else {
            self.mirror = None;
        }
        if !frame.shadows.is_empty() {
            self.shadows
                .write(device, queue, bytemuck::cast_slice(&frame.shadows));
            self.ensure(device, Key::Styled(SHADOW_STYLE, true));
        }
        if self.lighting {
            self.ensure(device, Key::Styled(Style2d::PLAIN.lit_when(true), true));
        }
        for &(_, style) in &frame.styles {
            self.ensure(device, Key::Styled(style.lit_when(self.lighting), true));
        }
        let (drops, splashes) = frame.rain.map_or((0, 0), |r| rain_counts(r.amount));
        self.rain_instances = drops + splashes;
        if self.rain_instances > 0 {
            self.ensure(device, Key::Rain);
        }
        let rain = frame.rain.unwrap_or(Rain2d {
            amount: 0.0,
            wind: 0.0,
            color: [0.0; 4],
        });
        let reflect = frame.reflect.unwrap_or(Reflect2d {
            strength: 0.0,
            ripple: 0.0,
            tint: [1.0; 3],
        });
        let uniform = FxUniform {
            target: [world_size.0 as f32, world_size.1 as f32],
            origin: frame.origin,
            time: frame.time,
            rain: rain.amount,
            wind: rain.wind,
            drops: drops as f32,
            splashes: splashes as f32,
            ripple: reflect.ripple,
            strength: reflect.strength,
            rings: if frame.rain.is_some() { 1.6 } else { 0.0 },
            rain_color: rain.color,
            tint: [
                reflect.tint[0],
                reflect.tint[1],
                reflect.tint[2],
                if self.lighting { 1.0 } else { 0.0 },
            ],
        };
        queue.write_buffer(&self.uniform, 0, bytemuck::bytes_of(&uniform));
    }

    /// The passes before the world's: the light map and the mirror.
    pub fn encode_before(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        frame: &Fx2dFrame,
        view_group: &wgpu::BindGroup,
        atlas: &wgpu::BindGroup,
    ) -> u32 {
        let mut calls = 0;
        if let (Some(ambient), Some((light, _))) = (frame.ambient, &self.light) {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("2d light map"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: light,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: f64::from(ambient[0]),
                            g: f64::from(ambient[1]),
                            b: f64::from(ambient[2]),
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            if !frame.lights.is_empty() {
                pass.set_pipeline(&self.light_pipeline);
                pass.set_bind_group(0, view_group, &[]);
                pass.set_vertex_buffer(0, self.lights.buffer.slice(..));
                pass.draw(0..6, 0..frame.lights.len() as u32);
                calls += 1;
            }
        }
        if let (true, Some((mirror, _, _))) = (frame.reflecting(), &self.mirror) {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("2d mirror"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: mirror,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            calls += self.draw_runs(
                &mut pass,
                &self.mirrored,
                frame.mirrored.len(),
                &frame.mirrored_styles,
                false,
                false,
                view_group,
                atlas,
            );
        }
        calls
    }

    fn pipeline(
        &self,
        style: Style2d,
        world: bool,
        lighting: bool,
    ) -> Option<&wgpu::RenderPipeline> {
        self.pipelines
            .get(&Key::Styled(style.lit_when(lighting), world))
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_one(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        style: Style2d,
        world: bool,
        lighting: bool,
        plain: Option<&wgpu::RenderPipeline>,
        buffer: &DynBuffer,
        range: std::ops::Range<usize>,
        view_group: &wgpu::BindGroup,
        atlas: &wgpu::BindGroup,
    ) -> u32 {
        if range.is_empty() {
            return 0;
        }
        let stride = std::mem::size_of::<SpriteInstance>() as u64;
        match plain.filter(|_| style == Style2d::PLAIN) {
            // a plain sprite while the light map is off: the engine's own sprite pipeline, so that it is drawn exactly as without effects
            Some(p) => {
                pass.set_pipeline(p);
                pass.set_bind_group(0, view_group, &[]);
                pass.set_bind_group(1, atlas, &[]);
            }
            None => {
                let Some(pipeline) = self.pipeline(style, world, lighting) else {
                    return 0;
                };
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, view_group, &[]);
                pass.set_bind_group(1, atlas, &[]);
                pass.set_bind_group(2, &self.group, &[]);
            }
        }
        pass.set_vertex_buffer(
            0,
            buffer
                .buffer
                .slice(range.start as u64 * stride..range.end as u64 * stride),
        );
        pass.draw(0..6, 0..range.len() as u32);
        1
    }

    /// A list of sprites with sparse styles: each run of one style is one draw.
    #[allow(clippy::too_many_arguments)]
    fn draw_runs(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        buffer: &DynBuffer,
        count: usize,
        styles: &[(usize, Style2d)],
        world: bool,
        lighting: bool,
        view_group: &wgpu::BindGroup,
        atlas: &wgpu::BindGroup,
    ) -> u32 {
        let mut calls = 0;
        let mut at = 0;
        let mut marks = styles.iter().peekable();
        while at < count {
            let next = marks.peek().map_or(count, |m| m.0.min(count));
            if next > at {
                calls += self.draw_one(
                    pass,
                    Style2d::PLAIN,
                    world,
                    lighting,
                    None,
                    buffer,
                    at..next,
                    view_group,
                    atlas,
                );
                at = next;
                continue;
            }
            let (index, style) = *marks.next().expect("a mark at `at`");
            if index < at {
                continue;
            }
            let mut end = index + 1;
            while let Some(&&(i, s)) = marks.peek() {
                if i == end && s == style {
                    end += 1;
                    marks.next();
                } else {
                    break;
                }
            }
            let end = end.min(count);
            calls += self.draw_one(
                pass,
                style,
                world,
                lighting,
                None,
                buffer,
                index..end,
                view_group,
                atlas,
            );
            at = end;
        }
        calls
    }

    /// The world's sprites with their styles, the custom-shaded ones (`shaded`, by index), the drop shadows and the reflections
    /// each in its place. Returns the draw calls.
    #[allow(clippy::too_many_arguments)]
    pub fn draw_world(
        &self,
        gfx: &Gfx,
        pass: &mut wgpu::RenderPass<'_>,
        frame: &Fx2dFrame,
        count: usize,
        shaded: &[(usize, &ShadedSprite, &custom::Slot)],
    ) -> u32 {
        let view_group = &gfx.sprite_view_group;
        let atlas = &gfx.atlas;
        let stride = std::mem::size_of::<SpriteInstance>() as u64;
        let lighting = self.lighting;
        let mut calls = 0;
        // the points where something else is drawn before the sprite of that index: the reflections, then the drop shadows
        let mut due = [
            (frame.reflecting() && self.mirror.is_some()).then_some(frame.reflect_at),
            (!frame.shadows.is_empty()).then_some(frame.shadows_at),
        ];
        let draw_point = |pass: &mut wgpu::RenderPass<'_>, which: usize| -> u32 {
            if which == 0 {
                let (Some(pipeline), Some((_, _, mirror))) =
                    (self.pipelines.get(&Key::Reflect), &self.mirror)
                else {
                    return 0;
                };
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, view_group, &[]);
                pass.set_bind_group(1, atlas, &[]);
                pass.set_bind_group(2, &self.group, &[]);
                pass.set_bind_group(3, mirror, &[]);
                pass.set_vertex_buffer(0, self.mask.buffer.slice(..));
                pass.draw(0..6, 0..frame.mask.len() as u32);
                1
            } else {
                self.draw_one(
                    pass,
                    SHADOW_STYLE,
                    true,
                    lighting,
                    None,
                    &self.shadows,
                    0..frame.shadows.len(),
                    view_group,
                    atlas,
                )
            }
        };
        let plain = (!lighting).then_some(&gfx.sprite_pipeline);
        let mut at = 0usize;
        let mut marks = frame.styles.iter().peekable();
        let mut custom = shaded.iter().peekable();
        loop {
            for (which, point) in due.iter_mut().enumerate() {
                if point.is_some_and(|p| p <= at || at >= count) {
                    *point = None;
                    calls += draw_point(pass, which);
                }
            }
            if at >= count {
                break;
            }
            let next_mark = marks.peek().map_or(count, |m| m.0);
            let next_custom = custom.peek().map_or(count, |c| c.0);
            let next_point = due.iter().flatten().copied().min().unwrap_or(count);
            let next = next_mark.min(next_custom).min(next_point).min(count);
            if next > at {
                calls += self.draw_one(
                    pass,
                    Style2d::PLAIN,
                    true,
                    lighting,
                    plain,
                    &gfx.sprites_back,
                    at..next,
                    view_group,
                    atlas,
                );
                at = next;
                continue;
            }
            if next_custom == at {
                let &(index, sprite, slot) = custom.next().expect("a custom sprite at `at`");
                while marks.peek().is_some_and(|m| m.0 <= index) {
                    marks.next();
                }
                if let (Some(pipeline), Some(group)) = (
                    gfx.extras
                        .pipeline(sprite.shading.shader, custom::Variant::SpriteWorld),
                    gfx.extras.group(false, sprite.shading.textures),
                ) {
                    pass.set_pipeline(pipeline);
                    pass.set_bind_group(0, view_group, &[]);
                    pass.set_bind_group(1, atlas, &[]);
                    pass.set_bind_group(2, group, &[slot.offset]);
                    pass.set_vertex_buffer(
                        0,
                        gfx.sprites_back
                            .buffer
                            .slice(index as u64 * stride..(index as u64 + 1) * stride),
                    );
                    pass.draw(0..6, 0..1);
                    calls += 1;
                }
                at = index + 1;
                continue;
            }
            // a run of sprites of one style (stopping before the next custom one and the next point)
            let (index, style) = *marks.next().expect("a mark at `at`");
            if index < at {
                continue;
            }
            let limit = custom.peek().map_or(count, |c| c.0).min(count).min(
                due.iter()
                    .flatten()
                    .copied()
                    .filter(|&p| p > index)
                    .min()
                    .unwrap_or(count),
            );
            let mut end = index + 1;
            while let Some(&&(i, s)) = marks.peek() {
                if i == end && s == style && end < limit {
                    end += 1;
                    marks.next();
                } else {
                    break;
                }
            }
            calls += self.draw_one(
                pass,
                style,
                true,
                lighting,
                plain,
                &gfx.sprites_back,
                index..end,
                view_group,
                atlas,
            );
            at = end;
        }
        calls
    }

    /// Rain over the whole world picture (after every world sprite and model, under the HUD).
    pub fn draw_rain(&self, gfx: &Gfx, pass: &mut wgpu::RenderPass<'_>) -> u32 {
        if self.rain_instances == 0 {
            return 0;
        }
        let Some(pipeline) = self.pipelines.get(&Key::Rain) else {
            return 0;
        };
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &gfx.sprite_view_group, &[]);
        pass.set_bind_group(1, &gfx.atlas, &[]);
        pass.set_bind_group(2, &self.group, &[]);
        pass.draw(0..6, 0..self.rain_instances);
        1
    }
}

/// Drop shadows: soft ellipses, not lit (black under light is still black).
pub const SHADOW_STYLE: Style2d = Style2d {
    blend: Blend2d::Alpha,
    shape: Shape2d::Soft,
    lit: false,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_effects_shader_parses_and_validates() {
        let source = include_str!("../shaders/fx2d.wgsl");
        let module = naga::front::wgsl::parse_str(source)
            .unwrap_or_else(|e| panic!("{}", e.emit_to_string(source)));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .expect("fx2d.wgsl validates");
    }

    #[test]
    fn the_uniform_and_the_light_match_the_shader() {
        // canvas, origin, eight numbers, two colours: 80 bytes, as the WGSL struct lays them out
        assert_eq!(std::mem::size_of::<FxUniform>(), 80);
        assert_eq!(std::mem::size_of::<Light2d>(), 32);
    }

    #[test]
    fn rain_grows_with_the_amount() {
        assert_eq!(rain_counts(0.0), (0, 0));
        let (d1, s1) = rain_counts(0.5);
        let (d2, s2) = rain_counts(1.0);
        assert!(d1 > 0 && d2 > d1 && s2 > s1);
    }
}

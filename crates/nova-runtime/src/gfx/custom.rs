//! Richer surfaces: models lit by their glTF material (normal maps, metallic and roughness, emission; `fs_material` in
//! mesh.wgsl) and custom shaders a person writes (`shaders/<name>.wgsl`, checked by [`crate::shader`]) on models, on sprites and
//! as a full-screen post effect. Both are opt-in: a game that uses neither draws exactly what it drew before.

use super::*;
use crate::shader::Kind;

/// Custom-shaded draws in a frame (models and sprites together; the post effect has its own slot). Beyond this they are skipped.
pub const MAX_SHADED_DRAWS: usize = 255;
/// Each draw's numbers sit 256 bytes apart in one uniform buffer (the alignment every backend accepts for dynamic offsets).
const UNIFORM_STRIDE: u64 = 256;

/// Per vertex of a mesh drawn with its material (see [`crate::model::Material`]): a second vertex buffer beside the mesh's own.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct MaterialVertex {
    pub tangent: [f32; 4],
    pub surface: [f32; 4],
    pub emission: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct CustomUniform {
    param: [f32; 4],
    param2: [f32; 4],
    /// time, the picture's width and height, unused
    info: [f32; 4],
    /// a sprite's atlas rectangle
    rect: [f32; 4],
}

/// Which pipeline of a custom shader.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum Variant {
    Model { skinned: bool, blend: bool },
    SpriteWorld,
    SpriteUi,
    Post,
}

pub(super) struct GpuMaterial {
    pub buffer: wgpu::Buffer,
    pub group: wgpu::BindGroup,
}

/// The GPU objects behind materials and custom shaders.
pub(super) struct Extras {
    material_layout: wgpu::BindGroupLayout,
    pub material_pipeline: wgpu::RenderPipeline,
    pub material_blend_pipeline: wgpu::RenderPipeline,
    pub skinned_material_pipeline: wgpu::RenderPipeline,
    /// A flat normal map, a white surface map (the factors alone) and a white emission map, for meshes without their own.
    map_defaults: [wgpu::TextureView; 3],
    map_samplers: HashMap<[Wrap; 2], wgpu::Sampler>,
    custom_layout: wgpu::BindGroupLayout,
    custom_model_layout: wgpu::BindGroupLayout,
    model_pipeline_layout: wgpu::PipelineLayout,
    sprite_pipeline_layout: wgpu::PipelineLayout,
    post_pipeline_layout: wgpu::PipelineLayout,
    uniforms: wgpu::Buffer,
    /// Each shader's modules by where it is used (None: the GPU refused it, already logged).
    shaders: Vec<Option<HashMap<Kind, wgpu::ShaderModule>>>,
    pipelines: HashMap<(usize, Variant), Option<wgpu::RenderPipeline>>,
    textures: HashMap<usize, wgpu::TextureView>,
    white: wgpu::TextureView,
    sampler: wgpu::Sampler,
    /// Bind groups of a custom shader's resources, by (for a model, picture a, picture b).
    groups: HashMap<(bool, Option<usize>, Option<usize>), wgpu::BindGroup>,
    pub shaded_instances: DynBuffer,
    /// What the post effect draws into (the world picture's size); the finishing pass reads it instead of the world target.
    pub post_target: Option<WorldTarget>,
    format: wgpu::TextureFormat,
}

/// Layouts made in `Gfx::new` that the extras' pipelines share.
pub(super) struct Shared<'a> {
    pub globals: &'a wgpu::BindGroupLayout,
    pub texture: &'a wgpu::BindGroupLayout,
    pub shadow: &'a wgpu::BindGroupLayout,
    pub sprite_view: &'a wgpu::BindGroupLayout,
    pub mesh_shader: &'a wgpu::ShaderModule,
}

const VERTEX_ATTRIBUTES: [wgpu::VertexAttribute; 5] = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Unorm8x4, 3 => Float32x2, 9 => Float32];
const INSTANCE_ATTRIBUTES: [wgpu::VertexAttribute; 5] = wgpu::vertex_attr_array![
    4 => Float32x4, 5 => Float32x4, 6 => Float32x4, 7 => Float32x4, 8 => Float32x4
];
const SKIN_ATTRIBUTES: [wgpu::VertexAttribute; 2] =
    wgpu::vertex_attr_array![10 => Uint16x4, 11 => Float32x4];
const MATERIAL_ATTRIBUTES: [wgpu::VertexAttribute; 3] =
    wgpu::vertex_attr_array![12 => Float32x4, 13 => Float32x4, 14 => Float32x4];
const SPRITE_ATTRIBUTES: [wgpu::VertexAttribute; 5] = wgpu::vertex_attr_array![
    0 => Float32x2, 1 => Float32x2, 2 => Float32x4, 3 => Unorm8x4, 4 => Float32
];

fn layout_of(
    stride: usize,
    step: wgpu::VertexStepMode,
    attributes: &[wgpu::VertexAttribute],
) -> wgpu::VertexBufferLayout<'_> {
    wgpu::VertexBufferLayout {
        array_stride: stride as u64,
        step_mode: step,
        attributes,
    }
}

/// The vertex buffers of a model pipeline: the mesh, its instances, then (skinned) the joints, then (material) the material.
fn model_buffers(skinned: bool, material: bool) -> Vec<Option<wgpu::VertexBufferLayout<'static>>> {
    let mut out = vec![
        Some(layout_of(
            std::mem::size_of::<MeshVertex>(),
            wgpu::VertexStepMode::Vertex,
            &VERTEX_ATTRIBUTES,
        )),
        Some(layout_of(
            std::mem::size_of::<ModelInstance>(),
            wgpu::VertexStepMode::Instance,
            &INSTANCE_ATTRIBUTES,
        )),
    ];
    if skinned {
        out.push(Some(layout_of(
            std::mem::size_of::<SkinVertex>(),
            wgpu::VertexStepMode::Vertex,
            &SKIN_ATTRIBUTES,
        )));
    }
    if material {
        out.push(Some(layout_of(
            std::mem::size_of::<MaterialVertex>(),
            wgpu::VertexStepMode::Vertex,
            &MATERIAL_ATTRIBUTES,
        )));
    }
    out
}

fn texture_entry(
    binding: u32,
    visibility: wgpu::ShaderStages,
    filterable: bool,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

fn sampler_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    }
}

/// A picture as a texture view with its smaller copies (when its sides are powers of two), in sRGB (colours) or linear (values).
fn map_view(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    image: &Image,
    srgb: bool,
    label: &str,
) -> wgpu::TextureView {
    let pow2 = image.width.is_power_of_two() && image.height.is_power_of_two();
    let levels = if pow2 {
        32 - image.width.min(image.height).leading_zeros()
    } else {
        1
    };
    let data = if levels > 1 {
        mip_chain(image, levels)
    } else {
        image.rgba.clone()
    };
    device
        .create_texture_with_data(
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
                format: if srgb {
                    wgpu::TextureFormat::Rgba8UnormSrgb
                } else {
                    wgpu::TextureFormat::Rgba8Unorm
                },
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            &data,
        )
        .create_view(&wgpu::TextureViewDescriptor::default())
}

fn pixel(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    rgba: [u8; 4],
    srgb: bool,
    label: &str,
) -> wgpu::TextureView {
    map_view(
        device,
        queue,
        &Image {
            width: 1,
            height: 1,
            rgba: rgba.to_vec(),
        },
        srgb,
        label,
    )
}

fn address(w: Wrap) -> wgpu::AddressMode {
    match w {
        Wrap::Repeat => wgpu::AddressMode::Repeat,
        Wrap::MirroredRepeat => wgpu::AddressMode::MirrorRepeat,
        Wrap::ClampToEdge => wgpu::AddressMode::ClampToEdge,
    }
}

impl Extras {
    pub fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        format: wgpu::TextureFormat,
        shared: &Shared,
    ) -> Self {
        let both = wgpu::ShaderStages::VERTEX_FRAGMENT;
        let fragment = wgpu::ShaderStages::FRAGMENT;
        let material_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("material layout"),
            entries: &[
                texture_entry(0, wgpu::ShaderStages::VERTEX, false),
                texture_entry(1, fragment, true),
                texture_entry(2, fragment, true),
                texture_entry(3, fragment, true),
                sampler_entry(4),
            ],
        });
        let uniform_entry = wgpu::BindGroupLayoutEntry {
            binding: 5,
            visibility: both,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: true,
                min_binding_size: wgpu::BufferSize::new(std::mem::size_of::<CustomUniform>() as u64),
            },
            count: None,
        };
        let custom_entries = [
            uniform_entry,
            texture_entry(6, fragment, true),
            texture_entry(7, fragment, true),
            sampler_entry(8),
        ];
        let custom_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("custom shader layout"),
            entries: &custom_entries,
        });
        let mut model_entries = vec![texture_entry(0, wgpu::ShaderStages::VERTEX, false)];
        model_entries.extend(custom_entries);
        let custom_model_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("custom model shader layout"),
                entries: &model_entries,
            });
        let pipeline_layout = |label: &str, groups: &[&wgpu::BindGroupLayout]| {
            let groups: Vec<Option<&wgpu::BindGroupLayout>> =
                groups.iter().map(|g| Some(*g)).collect();
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(label),
                bind_group_layouts: &groups,
                immediate_size: 0,
            })
        };
        let material_pipeline_layout = pipeline_layout(
            "material pipeline layout",
            &[
                shared.globals,
                shared.texture,
                shared.shadow,
                &material_layout,
            ],
        );
        let model_pipeline_layout = pipeline_layout(
            "custom model pipeline layout",
            &[
                shared.globals,
                shared.texture,
                shared.shadow,
                &custom_model_layout,
            ],
        );
        let sprite_pipeline_layout = pipeline_layout(
            "custom sprite pipeline layout",
            &[shared.sprite_view, shared.texture, &custom_layout],
        );
        let post_pipeline_layout = pipeline_layout(
            "custom post pipeline layout",
            &[shared.texture, &custom_layout],
        );
        let make_material = |label: &str, skinned: bool, blend: bool| {
            let buffers = model_buffers(skinned, true);
            model_pipeline(
                device,
                label,
                &material_pipeline_layout,
                shared.mesh_shader,
                if skinned {
                    "vs_skinned_material"
                } else {
                    "vs_material"
                },
                "fs_material",
                &buffers,
                format,
                blend,
            )
        };
        let material_pipeline = make_material("material meshes", false, false);
        let material_blend_pipeline = make_material("translucent material meshes", false, true);
        let skinned_material_pipeline = make_material("skinned material meshes", true, false);
        let map_defaults = [
            pixel(
                device,
                queue,
                [128, 128, 255, 255],
                false,
                "flat normal map",
            ),
            pixel(device, queue, [255; 4], false, "plain surface map"),
            pixel(device, queue, [255; 4], true, "plain emission map"),
        ];
        let uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("custom shader numbers"),
            size: UNIFORM_STRIDE * (MAX_SHADED_DRAWS as u64 + 1),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("custom shader pictures"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            material_layout,
            material_pipeline,
            material_blend_pipeline,
            skinned_material_pipeline,
            map_defaults,
            map_samplers: HashMap::new(),
            custom_layout,
            custom_model_layout,
            model_pipeline_layout,
            sprite_pipeline_layout,
            post_pipeline_layout,
            uniforms,
            shaders: Vec::new(),
            pipelines: HashMap::new(),
            textures: HashMap::new(),
            white: pixel(device, queue, [255; 4], true, "white"),
            sampler,
            groups: HashMap::new(),
            shaded_instances: DynBuffer::new(
                device,
                "custom-shaded model instances",
                wgpu::BufferUsages::VERTEX,
                1 << 12,
            ),
            post_target: None,
            format,
        }
    }

    /// The pipeline of a shader for a use, when it exists (made by [`Gfx::prepare_custom`]).
    pub fn pipeline(&self, shader: usize, variant: Variant) -> Option<&wgpu::RenderPipeline> {
        self.pipelines.get(&(shader, variant))?.as_ref()
    }

    pub fn group(&self, model: bool, textures: [Option<usize>; 2]) -> Option<&wgpu::BindGroup> {
        self.groups.get(&(model, textures[0], textures[1]))
    }
}

#[allow(clippy::too_many_arguments)]
fn model_pipeline(
    device: &wgpu::Device,
    label: &str,
    layout: &wgpu::PipelineLayout,
    module: &wgpu::ShaderModule,
    vertex: &str,
    fragment: &str,
    buffers: &[Option<wgpu::VertexBufferLayout>],
    format: wgpu::TextureFormat,
    blend: bool,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module,
            entry_point: Some(vertex),
            compilation_options: Default::default(),
            buffers,
        },
        fragment: Some(wgpu::FragmentState {
            module,
            entry_point: Some(fragment),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: blend.then_some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: wgpu::PrimitiveState {
            cull_mode: Some(wgpu::Face::Back),
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: DEPTH_FORMAT,
            depth_write_enabled: Some(!blend),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    })
}

/// What one custom-shaded draw needs: (shading, pipeline, for a model, the picture's size, a sprite's atlas rectangle).
type Wanted = (Shading, Variant, bool, (u32, u32), [f32; 4]);

/// One custom-shaded draw this frame: which slot of the uniform buffer holds its numbers.
pub(super) struct Slot {
    pub offset: u32,
}

impl Gfx {
    /// The material buffer and maps of a mesh drawn with its material (None for a plain mesh).
    pub(super) fn upload_material(&mut self, mesh: &MeshData) -> Option<GpuMaterial> {
        let material = mesh.material.as_ref()?;
        let n = mesh.vertices.len();
        let vertices: Vec<MaterialVertex> = (0..n)
            .map(|i| MaterialVertex {
                tangent: material.tangents.get(i).copied().unwrap_or([0.0; 4]),
                surface: material
                    .surface
                    .get(i)
                    .copied()
                    .unwrap_or([0.0, 1.0, 0.0, 0.0]),
                emission: material
                    .emission
                    .get(i)
                    .copied()
                    .unwrap_or([0.0, 0.0, 0.0, -1.0]),
            })
            .collect();
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("mesh material"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
        let device = &self.device;
        let queue = &self.queue;
        let view = |image: &Option<Image>, default: &wgpu::TextureView, srgb: bool, label: &str| {
            image.as_ref().map_or_else(
                || default.clone(),
                |i| map_view(device, queue, i, srgb, label),
            )
        };
        let d = &self.extras.map_defaults;
        let normal = view(&material.normal_map, &d[0], false, "normal map");
        let surface = view(
            &material.surface_map,
            &d[1],
            false,
            "metallic-roughness map",
        );
        let emissive = view(&material.emissive_map, &d[2], true, "emission map");
        let sampler = self
            .extras
            .map_samplers
            .entry(mesh.wrap)
            .or_insert_with(|| {
                device.create_sampler(&wgpu::SamplerDescriptor {
                    label: Some("material maps"),
                    address_mode_u: address(mesh.wrap[0]),
                    address_mode_v: address(mesh.wrap[1]),
                    mag_filter: wgpu::FilterMode::Linear,
                    min_filter: wgpu::FilterMode::Linear,
                    mipmap_filter: wgpu::MipmapFilterMode::Linear,
                    ..Default::default()
                })
            })
            .clone();
        let joints = self
            .joint_texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("mesh material"),
            layout: &self.extras.material_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&joints),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&normal),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&surface),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(&emissive),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });
        Some(GpuMaterial { buffer, group })
    }

    /// Adds a custom shader (the text of a `shaders/<name>.wgsl` file) for models, sprites and post effects; its id is the number of
    /// shaders added before it. It is checked first ([`crate::shader::validate`]); a shader the GPU still refuses keeps its id and is
    /// not drawn. Either way the error says what is wrong.
    pub fn add_shader(&mut self, source: &str) -> Result<usize, String> {
        self.backup.shaders.push(source.to_string());
        let id = self.extras.shaders.len();
        if let Err(e) = crate::shader::validate(source) {
            self.extras.shaders.push(None);
            return Err(e.describe("shader"));
        }
        let mut modules = HashMap::new();
        for kind in Kind::ALL {
            let (code, _) = crate::shader::compose(kind, source);
            let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
            let module = self
                .device
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("custom shader"),
                    source: wgpu::ShaderSource::Wgsl(code.into()),
                });
            if let Some(error) = pollster::block_on(scope.pop()) {
                log::error!(
                    "the GPU refused custom shader {id} for {}: {error}",
                    kind.name()
                );
                self.extras.shaders.push(None);
                return Err(format!(
                    "the GPU refused the shader for {}: {error}",
                    kind.name()
                ));
            }
            modules.insert(kind, module);
        }
        self.extras.shaders.push(Some(modules));
        Ok(id)
    }

    /// A picture for custom shaders (`textures = { ... }` in a draw), by an id the game chooses; replaces one with the same id.
    pub fn set_shader_texture(&mut self, id: usize, image: &Image) {
        self.backup.shader_textures.insert(id, image.clone());
        let view = map_view(
            &self.device,
            &self.queue,
            image,
            true,
            "custom shader picture",
        );
        self.extras.textures.insert(id, view);
        // groups that held the old picture are made again when next needed
        self.extras
            .groups
            .retain(|k, _| k.1 != Some(id) && k.2 != Some(id));
    }

    fn ensure_pipeline(&mut self, shader: usize, variant: Variant) {
        if self.extras.pipelines.contains_key(&(shader, variant)) {
            return;
        }
        let kind = match variant {
            Variant::Model { .. } => Kind::Model,
            Variant::SpriteWorld | Variant::SpriteUi => Kind::Sprite,
            Variant::Post => Kind::Post,
        };
        let Some(Some(modules)) = self.extras.shaders.get(shader) else {
            self.extras.pipelines.insert((shader, variant), None);
            return;
        };
        let module = &modules[&kind];
        let device = &self.device;
        let x = &self.extras;
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let pipeline = match variant {
            Variant::Model { skinned, blend } => model_pipeline(
                device,
                "custom shader on models",
                &x.model_pipeline_layout,
                module,
                if skinned { "vs_skinned" } else { "vs_main" },
                crate::shader::FRAGMENT,
                &model_buffers(skinned, false),
                x.format,
                blend,
            ),
            Variant::SpriteWorld | Variant::SpriteUi => {
                let buffers = [Some(layout_of(
                    std::mem::size_of::<SpriteInstance>(),
                    wgpu::VertexStepMode::Instance,
                    &SPRITE_ATTRIBUTES,
                ))];
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("custom shader on sprites"),
                    layout: Some(&x.sprite_pipeline_layout),
                    vertex: wgpu::VertexState {
                        module,
                        entry_point: Some("vs_main"),
                        compilation_options: Default::default(),
                        buffers: &buffers,
                    },
                    fragment: Some(wgpu::FragmentState {
                        module,
                        entry_point: Some(crate::shader::FRAGMENT),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format: x.format,
                            blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    primitive: wgpu::PrimitiveState::default(),
                    depth_stencil: (variant == Variant::SpriteWorld).then_some(
                        wgpu::DepthStencilState {
                            format: DEPTH_FORMAT,
                            depth_write_enabled: Some(false),
                            depth_compare: Some(wgpu::CompareFunction::Always),
                            stencil: Default::default(),
                            bias: Default::default(),
                        },
                    ),
                    multisample: wgpu::MultisampleState::default(),
                    multiview_mask: None,
                    cache: None,
                })
            }
            Variant::Post => device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("custom post effect"),
                layout: Some(&x.post_pipeline_layout),
                vertex: wgpu::VertexState {
                    module,
                    entry_point: Some("vs_post"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module,
                    entry_point: Some(crate::shader::FRAGMENT),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: x.format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            }),
        };
        let pipeline = match pollster::block_on(scope.pop()) {
            Some(error) => {
                log::error!("the GPU refused custom shader {shader} ({variant:?}): {error}");
                None
            }
            None => Some(pipeline),
        };
        self.extras.pipelines.insert((shader, variant), pipeline);
    }

    fn ensure_group(&mut self, model: bool, textures: [Option<usize>; 2]) {
        let key = (model, textures[0], textures[1]);
        if self.extras.groups.contains_key(&key) {
            return;
        }
        let x = &self.extras;
        let picture = |t: Option<usize>| t.and_then(|id| x.textures.get(&id)).unwrap_or(&x.white);
        let joints = self
            .joint_texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut entries = vec![
            wgpu::BindGroupEntry {
                binding: 5,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &x.uniforms,
                    offset: 0,
                    size: wgpu::BufferSize::new(std::mem::size_of::<CustomUniform>() as u64),
                }),
            },
            wgpu::BindGroupEntry {
                binding: 6,
                resource: wgpu::BindingResource::TextureView(picture(textures[0])),
            },
            wgpu::BindGroupEntry {
                binding: 7,
                resource: wgpu::BindingResource::TextureView(picture(textures[1])),
            },
            wgpu::BindGroupEntry {
                binding: 8,
                resource: wgpu::BindingResource::Sampler(&x.sampler),
            },
        ];
        if model {
            entries.push(wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&joints),
            });
        }
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("custom shader resources"),
            layout: if model {
                &x.custom_model_layout
            } else {
                &x.custom_layout
            },
            entries: &entries,
        });
        self.extras.groups.insert(key, group);
    }

    /// Makes what this frame's custom-shaded draws need (pipelines, bind groups, the post effect's target) and writes their numbers:
    /// the shaded models in `models` first, then the shaded sprites of `input` (world, then UI), then the post effect. Returns
    /// each draw's slot in that order (None for one beyond [`MAX_SHADED_DRAWS`] or with an unknown shader).
    pub(super) fn prepare_custom(
        &mut self,
        input: &FrameInput,
        models: &[ShadedModel],
        world_size: (u32, u32),
        size: (u32, u32),
    ) -> Vec<Option<Slot>> {
        let mut numbers: Vec<CustomUniform> = Vec::new();
        let mut slots = Vec::new();
        let uniform = |s: &Shading, picture: (u32, u32), rect: [f32; 4]| CustomUniform {
            param: [s.params[0], s.params[1], s.params[2], s.params[3]],
            param2: [s.params[4], s.params[5], s.params[6], s.params[7]],
            info: [input.time, picture.0 as f32, picture.1 as f32, 0.0],
            rect,
        };
        // (shading, pipeline, for a model, the picture's size, a sprite's atlas rectangle)
        let mut wanted: Vec<Wanted> = Vec::new();
        for m in models {
            let skinned = self.mesh(m.draw.mesh).is_some_and(|g| g.skin.is_some());
            wanted.push((
                m.shading,
                Variant::Model {
                    skinned,
                    blend: m.blend,
                },
                true,
                world_size,
                [0.0; 4],
            ));
        }
        for s in input.shaded_sprites {
            let list = if s.ui {
                input.sprites_front
            } else {
                input.sprites_back
            };
            let rect = list.get(s.index).map_or([0.0; 4], |i| i.uv);
            let variant = if s.ui {
                Variant::SpriteUi
            } else {
                Variant::SpriteWorld
            };
            wanted.push((
                s.shading,
                variant,
                false,
                if s.ui { size } else { world_size },
                rect,
            ));
        }
        if let Some(post) = &input.post {
            wanted.push((*post, Variant::Post, false, world_size, [0.0; 4]));
        }
        let post_index = input.post.map(|_| wanted.len() - 1);
        for (i, (shading, variant, model, picture, rect)) in wanted.iter().enumerate() {
            let is_post = Some(i) == post_index;
            if (!is_post && numbers.len() >= MAX_SHADED_DRAWS)
                || !matches!(self.extras.shaders.get(shading.shader), Some(Some(_)))
            {
                slots.push(None);
                continue;
            }
            self.ensure_pipeline(shading.shader, *variant);
            self.ensure_group(*model, shading.textures);
            if self.extras.pipeline(shading.shader, *variant).is_none() {
                slots.push(None);
                continue;
            }
            slots.push(Some(Slot {
                offset: (numbers.len() as u64 * UNIFORM_STRIDE) as u32,
            }));
            numbers.push(uniform(shading, *picture, *rect));
        }
        if !numbers.is_empty() {
            let mut bytes = vec![0u8; numbers.len() * UNIFORM_STRIDE as usize];
            for (i, n) in numbers.iter().enumerate() {
                let at = i * UNIFORM_STRIDE as usize;
                bytes[at..at + std::mem::size_of::<CustomUniform>()]
                    .copy_from_slice(bytemuck::bytes_of(n));
            }
            self.queue.write_buffer(&self.extras.uniforms, 0, &bytes);
        }
        if input.post.is_some() {
            self.ensure_post_target(world_size);
        }
        slots
    }

    fn ensure_post_target(&mut self, size: (u32, u32)) {
        if matches!(&self.extras.post_target, Some(w) if w.size == size) {
            return;
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("post effect target"),
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
            label: Some("post effect target"),
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
        self.extras.post_target = Some(WorldTarget { view, size, group });
    }

    /// Draws custom-shaded models whose `blend` is `blend` (their instances are in `extras.shaded_instances`, one each, in the order
    /// of `models`). Returns (draw calls, triangles).
    pub(super) fn draw_shaded_models(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        models: &[ShadedModel],
        slots: &[Option<Slot>],
        blend: bool,
    ) -> (u32, u32) {
        let stride = std::mem::size_of::<ModelInstance>() as u64;
        let (mut calls, mut triangles) = (0, 0);
        for (i, m) in models.iter().enumerate() {
            if m.blend != blend {
                continue;
            }
            let (Some(Some(slot)), Some(mesh)) = (slots.get(i), self.mesh(m.draw.mesh)) else {
                continue;
            };
            let skinned = mesh.skin.is_some();
            let (Some(pipeline), Some(group)) = (
                self.extras
                    .pipeline(m.shading.shader, Variant::Model { skinned, blend }),
                self.extras.group(true, m.shading.textures),
            ) else {
                continue;
            };
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, &self.globals_group, &[]);
            pass.set_bind_group(1, &mesh.texture, &[]);
            pass.set_bind_group(2, &self.shadow_group, &[]);
            pass.set_bind_group(3, group, &[slot.offset]);
            pass.set_vertex_buffer(0, mesh.vertices.slice(..));
            pass.set_vertex_buffer(
                1,
                self.extras
                    .shaded_instances
                    .buffer
                    .slice(i as u64 * stride..(i as u64 + 1) * stride),
            );
            if let Some(skin) = &mesh.skin {
                pass.set_vertex_buffer(2, skin.slice(..));
            }
            pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..mesh.index_count, 0, 0..1);
            calls += 1;
            triangles += mesh.index_count / 3;
        }
        (calls, triangles)
    }

    /// Draws a layer's sprites from `buffer` (`count` of them), in order, the custom-shaded ones (`shaded`: their index in the layer
    /// and slot, sorted by index) with their shader and the runs between them as one instanced draw each. Returns the draw calls.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn draw_sprite_runs(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        plain: &wgpu::RenderPipeline,
        buffer: &DynBuffer,
        count: usize,
        shaded: &[(usize, &ShadedSprite, &Slot)],
        variant: Variant,
    ) -> u32 {
        let stride = std::mem::size_of::<SpriteInstance>() as u64;
        let mut calls = 0;
        let mut at = 0usize;
        let mut run = |pass: &mut wgpu::RenderPass<'_>, from: usize, to: usize| {
            if to > from {
                pass.set_pipeline(plain);
                pass.set_bind_group(0, &self.sprite_view_group, &[]);
                pass.set_bind_group(1, &self.atlas, &[]);
                pass.set_vertex_buffer(
                    0,
                    buffer
                        .buffer
                        .slice(from as u64 * stride..to as u64 * stride),
                );
                pass.draw(0..6, 0..(to - from) as u32);
                calls += 1;
            }
        };
        let mut custom_calls = 0;
        for &(index, sprite, slot) in shaded {
            if index >= count || index < at {
                continue;
            }
            run(pass, at, index);
            if let (Some(pipeline), Some(group)) = (
                self.extras.pipeline(sprite.shading.shader, variant),
                self.extras.group(false, sprite.shading.textures),
            ) {
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, &self.sprite_view_group, &[]);
                pass.set_bind_group(1, &self.atlas, &[]);
                pass.set_bind_group(2, group, &[slot.offset]);
                pass.set_vertex_buffer(
                    0,
                    buffer
                        .buffer
                        .slice(index as u64 * stride..(index as u64 + 1) * stride),
                );
                pass.draw(0..6, 0..1);
                custom_calls += 1;
            }
            at = index + 1;
        }
        run(pass, at, count);
        calls + custom_calls
    }

    /// The post effect: the world picture through the shader into the post target.
    pub(super) fn draw_post(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        post: &Shading,
        slot: &Slot,
    ) -> bool {
        let (Some(target), Some(world), Some(pipeline), Some(group)) = (
            self.extras.post_target.as_ref(),
            self.world.as_ref(),
            self.extras.pipeline(post.shader, Variant::Post),
            self.extras.group(false, post.textures),
        ) else {
            return false;
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("post effect"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &target.view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &world.group, &[]);
        pass.set_bind_group(1, group, &[slot.offset]);
        pass.draw(0..3, 0..1);
        true
    }
}

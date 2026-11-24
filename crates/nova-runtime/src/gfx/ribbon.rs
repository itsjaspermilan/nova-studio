//! Ribbons: soft strokes in the air, drawn blended in their own pass after the see-through models (`nova.ambient`'s wind curls).
//!
//! A see-through model's pixel under 0.3 of alpha is dropped (`plain_light` in mesh.wgsl: cut-out pictures of leaves and glass need
//! it), so a soft, faint stroke cannot be drawn as a model: its edges would be cut hard and its fade would have to be a screen-door.
//! A ribbon is a strip of points instead (each with its half-width and its alpha), turned across the line of sight on the CPU
//! and drawn as one blended triangle list: the alpha falls smoothly from its middle line to nothing at its edges (no cut), along
//! its length as the points say, and a stroke thinner than a pixel is drawn a pixel wide and fainter, so it never breaks up.
//! `shaders/ribbon.wgsl` is appended to mesh.wgsl (its globals and haze are used). Nothing is drawn when there are no ribbons.

use bytemuck::{Pod, Zeroable};
use glam::Vec3;

/// A soft stroke in the air.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Ribbon {
    /// Points along it, on the flat ground the game draws on (y is the height above the ground: the whole ribbon is lifted by
    /// the ground under its first point): x, y, z, half its width (metres) and its alpha (0 to 1).
    pub points: Vec<[f32; 5]>,
    /// Its colour (linear).
    pub color: [f32; 3],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Vertex {
    position: [f32; 3],
    /// x: across the ribbon, -1 to 1; y: the alpha there.
    across: [f32; 2],
    color: [f32; 3],
}

pub struct RibbonGpu {
    pipeline: wgpu::RenderPipeline,
    buffer: wgpu::Buffer,
    capacity: u64,
    count: u32,
}

impl RibbonGpu {
    pub fn new(
        device: &wgpu::Device,
        world_format: wgpu::TextureFormat,
        samples: u32,
        globals: &wgpu::BindGroupLayout,
        depth_format: wgpu::TextureFormat,
    ) -> Self {
        let source = concat!(
            include_str!("../shaders/mesh.wgsl"),
            "\n",
            include_str!("../shaders/ribbon.wgsl")
        );
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ribbon"),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("ribbon pipeline layout"),
            bind_group_layouts: &[Some(globals)],
            immediate_size: 0,
        });
        let attributes = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x2, 2 => Float32x3];
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ribbons"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs_ribbon"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &attributes,
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_ribbon"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: world_format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::COLOR,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: depth_format,
                depth_write_enabled: Some(false),
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
        let capacity = 4096;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ribbons"),
            size: capacity,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Self {
            pipeline,
            buffer,
            capacity,
            count: 0,
        }
    }

    /// Makes the frame's triangles: each point's two edges turned across the line of sight from `eye`, the ribbon lifted by the
    /// ground (`ground(x, z)`) under its first point. `pixel` is the metres a pixel spans one metre from the eye: a ribbon is drawn
    /// at least a pixel wide, fainter by as much as it was widened.
    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        ribbons: &[Ribbon],
        eye: Vec3,
        pixel: f32,
        ground: impl Fn(f32, f32) -> f32,
    ) {
        let mut vertices: Vec<Vertex> = Vec::new();
        for r in ribbons {
            let n = r.points.len();
            if n < 2 {
                continue;
            }
            let lift = ground(r.points[0][0], r.points[0][2]);
            let at = |i: usize| {
                let p = r.points[i];
                Vec3::new(p[0], p[1] + lift, p[2])
            };
            let mut edges = Vec::with_capacity(n);
            for i in 0..n {
                let p = at(i);
                let along =
                    (at((i + 1).min(n - 1)) - at(i.saturating_sub(1))).normalize_or(Vec3::X);
                let side = along.cross(eye - p).normalize_or(Vec3::Y);
                let least = (eye - p).length() * pixel;
                let (half, alpha) = (r.points[i][3], r.points[i][4]);
                let (half, alpha) = if half < least {
                    (least, alpha * half / least)
                } else {
                    (half, alpha)
                };
                edges.push((p - side * half, p + side * half, alpha));
            }
            for w in edges.windows(2) {
                let (a0, a1, aa) = w[0];
                let (b0, b1, ba) = w[1];
                let v = |position: Vec3, x: f32, alpha: f32| Vertex {
                    position: position.to_array(),
                    across: [x, alpha],
                    color: r.color,
                };
                vertices.extend_from_slice(&[
                    v(a0, -1.0, aa),
                    v(a1, 1.0, aa),
                    v(b0, -1.0, ba),
                    v(a1, 1.0, aa),
                    v(b1, 1.0, ba),
                    v(b0, -1.0, ba),
                ]);
            }
        }
        self.count = vertices.len() as u32;
        if vertices.is_empty() {
            return;
        }
        let bytes: &[u8] = bytemuck::cast_slice(&vertices);
        if bytes.len() as u64 > self.capacity {
            self.capacity = (bytes.len() as u64).next_power_of_two();
            self.buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("ribbons"),
                size: self.capacity,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
        }
        queue.write_buffer(&self.buffer, 0, bytes);
    }

    /// Draws the frame's ribbons (after the see-through models). Returns the draw calls made and the triangles.
    pub fn draw(&self, pass: &mut wgpu::RenderPass<'_>, globals: &wgpu::BindGroup) -> (u32, u32) {
        if self.count == 0 {
            return (0, 0);
        }
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, globals, &[]);
        pass.set_vertex_buffer(0, self.buffer.slice(..));
        pass.draw(0..self.count, 0..1);
        (1, self.count / 3)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_ribbon_shader_parses_and_validates() {
        let source = concat!(
            include_str!("../shaders/mesh.wgsl"),
            "\n",
            include_str!("../shaders/ribbon.wgsl")
        );
        let module = naga::front::wgsl::parse_str(source).expect("ribbon.wgsl parses");
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        )
        .validate(&module)
        .expect("ribbon.wgsl validates");
    }
}

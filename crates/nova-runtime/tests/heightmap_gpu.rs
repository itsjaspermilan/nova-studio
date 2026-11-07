//! The heightmap on the real GPU path: the vertex shaders (`mesh.wgsl`) lift a thin strip by the map, and the CPU's `Terrain::height` (what
//! `nova.terrain_height` returns) must say the same: seen side on through a nearly orthographic camera, the strip's top edge sits at the CPU
//! height plus the strip's own thickness. Skips (passes with a note) when the machine has no usable adapter.

use nova_runtime::gfx::{Camera, FrameInput, Gfx, Lighting, ModelDraw, ModelInstance, Terrain};
use nova_runtime::heightmap::HeightMap;
use nova_runtime::model::{MeshData, MeshVertex};
use std::sync::Arc;

fn png16(w: u32, h: u32, values: &[u16]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(&mut out, w, h);
    enc.set_color(png::ColorType::Grayscale);
    enc.set_depth(png::BitDepth::Sixteen);
    let mut wr = enc.write_header().unwrap();
    wr.write_image_data(
        &values
            .iter()
            .flat_map(|v| v.to_be_bytes())
            .collect::<Vec<u8>>(),
    )
    .unwrap();
    drop(wr);
    out
}

/// A strip along x at z = 0, `thick` metres tall, both faces, a column every half metre.
fn strip(from: f32, to: f32, thick: f32) -> MeshData {
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let columns = ((to - from) / 0.5) as u32;
    for k in 0..=columns {
        let x = from + k as f32 * 0.5;
        for y in [0.0, thick] {
            vertices.push(MeshVertex {
                position: [x, y, 0.0],
                normal: [0.0, 0.0, 1.0],
                color: [255; 4],
                uv: [0.0, 0.0],
                emissive: 1.0,
            });
        }
    }
    for k in 0..columns {
        let (a, b, c, d) = (2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 3);
        indices.extend_from_slice(&[a, c, b, b, c, d, a, b, c, b, d, c]);
    }
    MeshData {
        vertices,
        indices,
        ..Default::default()
    }
}

#[test]
fn the_shader_lifts_vertices_by_the_same_heights_the_cpu_reports() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let mut gfx = match Gfx::new(&instance, None) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("skipping GPU test: {e}");
            return;
        }
    };
    // a 16 x 16 map of scattered heights (up to 25 m), 4 m between samples, covering -30..30
    let values: Vec<u16> = (0..256u32)
        .map(|i| ((i.wrapping_mul(2654435761) >> 7) % 40000 + (i % 16) * 1500) as u16)
        .collect();
    let map =
        Arc::new(HeightMap::from_png(&png16(16, 16, &values), -30.0, -30.0, 60.0, 25.0).unwrap());
    let lighting = Lighting {
        terrain: Terrain {
            map: Some(map),
            ..Default::default()
        },
        ..Default::default()
    };
    let thick = 0.3;
    let mesh = gfx.upload_mesh(&strip(-20.0, 20.0, thick));
    let draws = [ModelDraw {
        casts: false,
        mesh,
        instance: ModelInstance {
            matrix: glam::Mat4::IDENTITY.to_cols_array_2d(),
            tint: [1.0; 4],
        },
    }];
    // a long lens: vertices all at z = 0 are the same distance away, so the picture is a plain scale of x and y
    let (w, h) = (800u32, 600u32);
    let (distance, half_height) = (400.0f32, 20.0f32);
    let (cx, cy) = (0.0f32, 12.5f32);
    let input = FrameInput {
        clear: [0.0, 0.0, 0.0, 1.0],
        camera: Camera {
            eye: glam::Vec3::new(cx, cy, distance),
            target: glam::Vec3::new(cx, cy, 0.0),
            fov_y_degrees: 2.0 * (half_height / distance).atan().to_degrees(),
        },
        sprites_back: &[],
        models: &draws,
        joints: &[],
        mesh_ops: &[],
        ui_models: &[],
        lighting: lighting.clone(),
        sprites_front: &[],
        text: &[],
        world_height: 0,
    };
    let pixels = gfx.capture((w, h), &input);
    let metres_per_px = 2.0 * half_height / h as f32;
    let mut worst = 0.0f32;
    let mut checked = 0;
    for px in (40..w - 40).step_by(7) {
        let x = cx + (px as f32 + 0.5 - w as f32 / 2.0) * metres_per_px;
        if x.abs() > 19.5 {
            continue;
        }
        // the top of the lit strip in this column
        let Some(top) = (0..h).find(|&py| {
            let i = ((py * w + px) * 4) as usize;
            u32::from(pixels[i]) + u32::from(pixels[i + 1]) + u32::from(pixels[i + 2]) > 300
        }) else {
            panic!("no strip in column {px} (x = {x})");
        };
        let seen = cy + (h as f32 / 2.0 - top as f32) * metres_per_px;
        let expected = lighting.terrain.height(x, 0.0) + thick;
        worst = worst.max((seen - expected).abs());
        checked += 1;
    }
    assert!(checked > 50, "only {checked} columns checked");
    // a pixel is 6.7 cm: allow a few for the edge's anti-aliasing and the strip's half-metre columns
    assert!(
        worst < 0.25,
        "the strip's top is up to {worst} m from the CPU's height"
    );
}

//! Trees on a slope, on the real GPU path (`mesh.wgsl`): a model lifted vertex by vertex is sheared by the hills (its crown's downhill
//! side drops with the ground, so on a hillside every tree leans the way the slope does: the Fernhollow play notes of 2026-11-22),
//! while one drawn `upright` (`ModelInstance::upright`, `lift = "upright"`) keeps its crown level at the height of the ground under
//! its origin and only its foot follows the ground. Seen side on through a nearly orthographic camera on a 45 degree ramp: a
//! 6 m wide bar 5 m up stays level when upright and slopes one for one when not. Skips (passes with a note) without a usable adapter.

use nova_runtime::gfx::{
    Camera, FrameInput, Gfx, Lift, Lighting, ModelDraw, ModelInstance, Terrain, UPRIGHT_FOOT,
};
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

/// A bar along x at z = 0 from `y0` to `y1`, both faces, a column every quarter metre (so a shear shows in its top edge).
fn bar(from: f32, to: f32, y0: f32, y1: f32) -> MeshData {
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let columns = ((to - from) / 0.25) as u32;
    for k in 0..=columns {
        let x = from + k as f32 * 0.25;
        for y in [y0, y1] {
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
fn the_slot_keeps_the_sway_and_the_way_it_rides_the_hills() {
    let plain = ModelInstance {
        matrix: glam::Mat4::IDENTITY.to_cols_array_2d(),
        tint: [1.0; 4],
    };
    assert_eq!(plain.lift(), Lift::Vertex);
    assert_eq!(plain.swaying(0.02).lift(), Lift::Vertex);
    let tree = plain.swaying(0.016).upright();
    assert_eq!(tree.lift(), Lift::Upright);
    assert!((tree.sway() - 0.016).abs() < 1e-4); // (f32 next to 1000 keeps about 6e-5)
    let tree = plain.upright().swaying(0.3);
    assert_eq!(tree.lift(), Lift::Upright);
    assert!((tree.sway() - 0.3).abs() < 1e-4); // (f32 next to 1000 keeps about 6e-5)
    let car = plain.rigid();
    assert_eq!(car.lift(), Lift::Rigid);
    assert_eq!(car.sway(), 0.0);
    let flag = plain.swaying(0.5).rigid();
    assert_eq!(flag.lift(), Lift::Rigid);
    assert!((flag.sway() - 0.5).abs() < 1e-4); // (f32 next to 1000 keeps about 6e-5)
}

#[test]
fn an_upright_crown_stays_level_on_a_slope_and_a_plain_one_leans_with_it() {
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
    // a steady ramp up along x: 0 m at x = -30 to 60 m at x = 30 (a slope of 1, 45 degrees)
    let values: Vec<u16> = (0..256u32)
        .map(|i| ((i % 16) as f32 / 15.0 * 65535.0) as u16)
        .collect();
    let map =
        Arc::new(HeightMap::from_png(&png16(16, 16, &values), -30.0, -30.0, 60.0, 60.0).unwrap());
    let lighting = Lighting {
        terrain: Terrain {
            map: Some(map),
            ..Default::default()
        },
        ..Default::default()
    };
    let ground = |x: f32| lighting.terrain.height(x, 0.0);
    assert!(
        (ground(3.0) - ground(-3.0) - 6.0).abs() < 0.05,
        "the ramp climbs a metre a metre"
    );
    // a crown: a bar 6 m wide, 5 to 5.4 m above the model's origin (well above its foot)
    let (y0, y1) = (5.0, 5.4);
    assert!(y0 > UPRIGHT_FOOT);
    let mesh = gfx.upload_mesh(&bar(-3.0, 3.0, y0, y1));
    let top_edge = |gfx: &mut Gfx, instance: ModelInstance| -> Vec<(f32, f32)> {
        let draws = [ModelDraw {
            casts: false,
            mesh,
            instance,
        }];
        let (w, h) = (800u32, 600u32);
        let (distance, half_height) = (400.0f32, 8.0f32);
        let (cx, cy) = (0.0f32, ground(0.0) + 5.0);
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
            shaded_models: &[],
            shaded_sprites: &[],
            post: None,
            texture_ops: &[],
            time: 0.0,
            ui_models: &[],
            lighting: lighting.clone(),
            sprites_front: &[],
            text: &[],
            world_height: 0,
        };
        let pixels = gfx.capture((w, h), &input);
        let metres_per_px = 2.0 * half_height / h as f32;
        let mut edge = Vec::new();
        for px in (20..w - 20).step_by(4) {
            let x = cx + (px as f32 + 0.5 - w as f32 / 2.0) * metres_per_px;
            if x.abs() > 2.8 {
                continue;
            }
            let top = (0..h).find(|&py| {
                let i = ((py * w + px) * 4) as usize;
                u32::from(pixels[i]) + u32::from(pixels[i + 1]) + u32::from(pixels[i + 2]) > 300
            });
            if let Some(top) = top {
                edge.push((x, cy + (h as f32 / 2.0 - top as f32) * metres_per_px));
            }
        }
        edge
    };
    let plain = ModelInstance {
        matrix: glam::Mat4::IDENTITY.to_cols_array_2d(),
        tint: [1.0; 4],
    };
    // upright: the top edge is level, at the ground under the origin plus the bar's height
    let upright = top_edge(&mut gfx, plain.swaying(0.0).upright());
    assert!(upright.len() > 40, "only {} columns seen", upright.len());
    for &(x, y) in &upright {
        assert!(
            (y - (ground(0.0) + y1)).abs() < 0.1,
            "upright: the crown at x = {x} is at {y}, not level at {}",
            ground(0.0) + y1
        );
    }
    // vertex by vertex (the old way, and still the default): it climbs with the ramp, a metre a metre
    let leaning = top_edge(&mut gfx, plain);
    assert!(leaning.len() > 40);
    for &(x, y) in &leaning {
        assert!(
            (y - (ground(x) + y1)).abs() < 0.1,
            "plain: the bar at x = {x} is at {y}, not on the ramp at {}",
            ground(x) + y1
        );
    }
}

//! The far shadow map (`nova.shadows { far = ... }`, gfx.rs `far_plans`) on the real GPU path: a tree-sized caster 70 m along the
//! view shadows the ground with `far` and does not without it (it is past the `radius` map); a small caster there casts no far
//! shadow (only casters over FAR_CASTER go into that map); and a near shadow is as sharp with `far` as without. Skips (passes with
//! a note) without a usable adapter.

use nova_runtime::gfx::{Camera, FrameInput, Gfx, Lighting, ModelDraw, ModelInstance, Shadows};
use nova_runtime::model::{MeshData, MeshVertex};

const W: u32 = 480;
const H: u32 = 320;

fn gfx() -> Option<Gfx> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    match Gfx::new(&instance, None) {
        Ok(g) => Some(g),
        Err(e) => {
            eprintln!("skipping GPU test: {e}");
            None
        }
    }
}

/// A box from `lo` to `hi`, flat-shaded, in one colour.
fn boxed(lo: [f32; 3], hi: [f32; 3], color: [u8; 4]) -> MeshData {
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let faces: [([f32; 3], [[f32; 3]; 4]); 6] = [
        (
            [0.0, 1.0, 0.0],
            [
                [lo[0], hi[1], lo[2]],
                [lo[0], hi[1], hi[2]],
                [hi[0], hi[1], hi[2]],
                [hi[0], hi[1], lo[2]],
            ],
        ),
        (
            [0.0, -1.0, 0.0],
            [
                [lo[0], lo[1], lo[2]],
                [hi[0], lo[1], lo[2]],
                [hi[0], lo[1], hi[2]],
                [lo[0], lo[1], hi[2]],
            ],
        ),
        (
            [1.0, 0.0, 0.0],
            [
                [hi[0], lo[1], lo[2]],
                [hi[0], hi[1], lo[2]],
                [hi[0], hi[1], hi[2]],
                [hi[0], lo[1], hi[2]],
            ],
        ),
        (
            [-1.0, 0.0, 0.0],
            [
                [lo[0], lo[1], lo[2]],
                [lo[0], lo[1], hi[2]],
                [lo[0], hi[1], hi[2]],
                [lo[0], hi[1], lo[2]],
            ],
        ),
        (
            [0.0, 0.0, 1.0],
            [
                [lo[0], lo[1], hi[2]],
                [hi[0], lo[1], hi[2]],
                [hi[0], hi[1], hi[2]],
                [lo[0], hi[1], hi[2]],
            ],
        ),
        (
            [0.0, 0.0, -1.0],
            [
                [lo[0], lo[1], lo[2]],
                [lo[0], hi[1], lo[2]],
                [hi[0], hi[1], lo[2]],
                [hi[0], lo[1], lo[2]],
            ],
        ),
    ];
    for (n, quad) in faces {
        let base = vertices.len() as u32;
        for p in quad {
            vertices.push(MeshVertex {
                position: p,
                normal: n,
                color,
                uv: [0.0, 0.0],
                emissive: 0.0,
            });
        }
        indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    MeshData {
        vertices,
        indices,
        ..Default::default()
    }
}

/// A flat ground 600 m across in squares of 10 m (so the near and far parts are lit per pixel alike).
fn ground() -> MeshData {
    let (n, size) = (60u32, 600.0f32);
    let step = size / n as f32;
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    for j in 0..=n {
        for i in 0..=n {
            vertices.push(MeshVertex {
                position: [
                    -size / 2.0 + i as f32 * step,
                    0.0,
                    -size / 2.0 + j as f32 * step,
                ],
                normal: [0.0, 1.0, 0.0],
                color: [200, 200, 200, 255],
                uv: [0.0, 0.0],
                emissive: 0.0,
            });
        }
    }
    for j in 0..n {
        for i in 0..n {
            let a = j * (n + 1) + i;
            indices.extend_from_slice(&[a, a + n + 2, a + 1, a, a + n + 1, a + n + 2]);
        }
    }
    MeshData {
        vertices,
        indices,
        ..Default::default()
    }
}

fn shoot(gfx: &mut Gfx, draws: &[ModelDraw], far: f32, eye: [f32; 3], target: [f32; 3]) -> Vec<u8> {
    let input = FrameInput {
        clear: [0.0, 0.0, 0.0, 1.0],
        camera: Camera {
            eye: glam::Vec3::from(eye),
            target: glam::Vec3::from(target),
            fov_y_degrees: 55.0,
        },
        sprites_back: &[],
        models: draws,
        joints: &[],
        mesh_ops: &[],
        shaded_models: &[],
        shaded_sprites: &[],
        post: None,
        texture_ops: &[],
        time: 0.0,
        ui_models: &[],
        lighting: Lighting {
            // the sun high, ahead and to the side: a shadow falls towards the camera and to +x
            direction: [0.3, -0.75, 0.59],
            color: [1.0, 1.0, 1.0],
            ambient: [0.35, 0.35, 0.35],
            shadows: Some(Shadows {
                radius: 40.0,
                strength: 0.8,
                near: 6.0,
                softness: 1.4,
                far,
            }),
            ..Default::default()
        },
        sprites_front: &[],
        text: &[],
        world_height: 0,
    };
    gfx.capture((W, H), &input)
}

fn draw(mesh: usize, casts: bool) -> ModelDraw {
    ModelDraw {
        casts,
        mesh,
        instance: ModelInstance {
            matrix: glam::Mat4::IDENTITY.to_cols_array_2d(),
            tint: [1.0; 4],
        },
    }
}

/// The summed darkness (255 minus green) over the picture: more where more of the ground is in shadow.
fn darkness(px: &[u8]) -> f64 {
    px.as_chunks::<4>()
        .0
        .iter()
        .map(|p| 255.0 - p[1] as f64)
        .sum()
}

#[test]
fn a_tree_far_along_the_view_keeps_its_shadow_with_far() {
    let Some(mut gfx) = gfx() else { return };
    let ground = gfx.upload_mesh(&ground());
    // a pillar the size of a tree (1.6 m across, 9 m tall), 70 m ahead
    let tree = gfx.upload_mesh(&boxed(
        [-0.8, 0.0, -70.8],
        [0.8, 9.0, -69.2],
        [120, 90, 60, 255],
    ));
    // (from 10 m up, looking at a point near the camera as a game's camera does: the ground 70 m off is seen at a slant)
    let eye = [0.0, 10.0, 6.0];
    let target = [0.0, 4.0, -4.0];
    let scene = [draw(ground, false), draw(tree, true)];
    let only_ground = [draw(ground, false)];
    let base = darkness(&shoot(&mut gfx, &only_ground, 110.0, eye, target));
    let a = shoot(&mut gfx, &scene, 0.0, eye, target);
    let b = shoot(&mut gfx, &scene, 110.0, eye, target);
    let without = darkness(&a) - base;
    let with = darkness(&b) - base;
    // (the pillar itself is the same in both: what differs is its shadow on the ground beside it)
    assert!(
        with > without + 2_000.0,
        "with far = 110 the pillar 70 m away shadows the ground ({with:.0} against {without:.0} without)"
    );
}

#[test]
fn small_casters_stay_out_of_the_far_map() {
    let Some(mut gfx) = gfx() else { return };
    let ground = gfx.upload_mesh(&ground());
    // a stone 0.8 m across (its bounding radius well under FAR_CASTER), 70 m ahead: no shadow from the far map
    let stone = gfx.upload_mesh(&boxed(
        [-0.4, 0.0, -70.4],
        [0.4, 0.8, -69.6],
        [120, 90, 60, 255],
    ));
    let eye = [0.0, 10.0, 6.0];
    let target = [0.0, 4.0, -4.0];
    let scene = [draw(ground, false), draw(stone, true)];
    let a = shoot(&mut gfx, &scene, 0.0, eye, target);
    let b = shoot(&mut gfx, &scene, 110.0, eye, target);
    let diff: f64 = a
        .iter()
        .zip(&b)
        .map(|(x, y)| (*x as f64 - *y as f64).abs())
        .sum();
    assert!(
        diff < 200.0,
        "a small caster far off casts nothing either way ({diff:.0})"
    );
}

#[test]
fn near_shadows_stay_as_sharp_with_far() {
    let Some(mut gfx) = gfx() else { return };
    let ground = gfx.upload_mesh(&ground());
    // a post 4 m ahead: its shadow is in the fine near map, with far or without
    let post = gfx.upload_mesh(&boxed(
        [-0.1, 0.0, -4.1],
        [0.1, 1.5, -3.9],
        [120, 90, 60, 255],
    ));
    let eye = [0.0, 1.8, 0.0];
    let target = [0.0, 0.0, -4.0];
    let scene = [draw(ground, false), draw(post, true)];
    let a = shoot(&mut gfx, &scene, 0.0, eye, target);
    let b = shoot(&mut gfx, &scene, 110.0, eye, target);
    let diff = a
        .iter()
        .zip(&b)
        .map(|(x, y)| (*x as f64 - *y as f64).abs())
        .sum::<f64>()
        / (W * H) as f64;
    assert!(
        diff < 0.05,
        "the near view is the same with far ({diff:.3} levels a pixel)"
    );
}

//! `nova.model`'s `outline` on the real GPU path (`outline.wgsl`): a red cube with a white outline is ringed in white pixels a few wide, the
//! same ring a cube twice as far away (constant on the screen), and nothing without the outline. Skips (passes with a note) without a
//! usable adapter.

use nova_runtime::gfx::{
    Camera, FrameInput, Gfx, Lighting, ModelDraw, ModelInstance, OutlineDraw, SeeThrough,
};
use nova_runtime::model::{MeshData, MeshVertex};

/// A cube of half-size 1 with flat faces (each face its own four vertices and outward normal), emissive so it draws its own colour.
fn cube() -> MeshData {
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    // (normal, u, v) with u x v = normal: counter-clockwise from outside
    let faces: [([f32; 3], [f32; 3], [f32; 3]); 6] = [
        ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
        ([0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]),
        ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
        ([-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
        ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]),
        ([0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
    ];
    for (n, u, v) in faces {
        let base = vertices.len() as u32;
        for (su, sv) in [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            vertices.push(MeshVertex {
                position: [
                    n[0] + u[0] * su + v[0] * sv,
                    n[1] + u[1] * su + v[1] * sv,
                    n[2] + u[2] * su + v[2] * sv,
                ],
                normal: n,
                color: [255; 4],
                uv: [0.0, 0.0],
                emissive: 1.0,
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

fn at(x: f32, y: f32, z: f32) -> glam::Mat4 {
    glam::Mat4::from_translation(glam::Vec3::new(x, y, z))
}

#[test]
fn an_outlined_model_is_ringed_by_a_few_pixels_that_stay_the_same_size_at_any_distance() {
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
    let mesh = gfx.upload_mesh(&cube());
    let (w, h) = (400u32, 300u32);
    // a red cube at (x, 0, z) seen from 10 m along -z, with `outlines` and `see` on
    let shot = |gfx: &mut Gfx, z: f32, outline: Option<f32>, see: Option<SeeThrough>| -> Vec<u8> {
        let matrix = at(0.0, 0.0, z);
        let draws = [ModelDraw {
            casts: false,
            mesh,
            instance: ModelInstance {
                matrix: matrix.to_cols_array_2d(),
                tint: [1.0, 0.0, 0.0, 1.0],
            },
        }];
        let outlines: Vec<OutlineDraw> = outline
            .map(|width| OutlineDraw {
                mesh,
                matrix: matrix.to_cols_array_2d(),
                color: [1.0, 1.0, 1.0],
                width,
            })
            .into_iter()
            .collect();
        let input = FrameInput {
            clear: [0.0, 0.0, 0.0, 1.0],
            camera: Camera {
                eye: glam::Vec3::new(0.0, 0.0, 10.0),
                target: glam::Vec3::new(0.0, 0.0, 0.0),
                fov_y_degrees: 20.0,
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
            lighting: Lighting {
                outlines,
                see_through: see,
                ..Default::default()
            },
            sprites_front: &[],
            text: &[],
            world_height: 0,
        };
        gfx.capture((w, h), &input)
    };
    let px = |p: &[u8], x: u32, y: u32| -> [u8; 3] {
        let i = ((y * w + x) * 4) as usize;
        [p[i], p[i + 1], p[i + 2]]
    };
    let red = |c: [u8; 3]| c[0] > 100 && c[1] < 60 && c[2] < 60;
    let white = |c: [u8; 3]| c[0] > 200 && c[1] > 200 && c[2] > 200;
    // along the middle row: where the red starts on the left, and how many white pixels lie just outside it
    let ring = |p: &[u8]| -> (u32, u32) {
        let y = h / 2;
        let left = (0..w).find(|&x| red(px(p, x, y))).expect("the cube is drawn");
        let mut n = 0;
        let mut x = left;
        while x > 0 && white(px(p, x - 1, y)) {
            n += 1;
            x -= 1;
        }
        (left, n)
    };
    let plain = shot(&mut gfx, 0.0, None, None);
    assert_eq!(ring(&plain).1, 0, "no outline asked, none drawn");
    let near = shot(&mut gfx, 0.0, Some(3.0), None);
    let (left, n) = ring(&near);
    assert!((2..=4).contains(&n), "a 3 px outline is about 3 px wide: {n} (the cube's edge at x = {left})");
    let far = shot(&mut gfx, -10.0, Some(3.0), None);
    let (_, n_far) = ring(&far);
    assert!((2..=4).contains(&n_far), "and as wide on a cube twice as far: {n_far}");
    // the middle of the cube stays red and a pixel well outside the ring stays the clear colour
    assert!(red(px(&near, w / 2, h / 2)), "the cube's face is untouched");
    assert_eq!(px(&near, left - 12, h / 2), [0, 0, 0], "nothing beyond the ring");
    // the outline is not cut by nova.see_through (the cube's own pixels near the eye go; its ring stays)
    let cut = shot(
        &mut gfx,
        0.0,
        Some(3.0),
        Some(SeeThrough {
            at: [0.0, 0.0, 0.0],
            radius: 1.0,
            margin: 0.0,
            amount: 1.0,
            above: -10.0,
            near: 30.0,
            near_from: 30.0,
            near_amount: 1.0,
        }),
    );
    assert!(!red(px(&cut, w / 2, h / 2)), "the see-through cut took the cube's face");
    let y = h / 2;
    let whites = (0..w).filter(|&x| white(px(&cut, x, y))).count();
    assert!(whites >= 4, "while its outline is still drawn: {whites} white pixels on the row");
}

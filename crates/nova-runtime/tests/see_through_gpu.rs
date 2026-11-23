//! `nova.see_through` on the real GPU path (`mesh.wgsl`, `see_through_cut`): a red wall 3 m high stands between the camera and a
//! green board; with the hole kept on a point in front of the board, the wall's pixels round that point are dropped and the board shows
//! through, while the wall's foot (under `above`) and the wall away from the line of sight stay. Without it the wall hides the board.
//! Skips (passes with a note) without a usable adapter.

use nova_runtime::gfx::{Camera, FrameInput, Gfx, Lighting, ModelDraw, ModelInstance, SeeThrough};
use nova_runtime::model::{MeshData, MeshVertex};

/// A flat board facing +z (both faces), `x0..x1` across and `y0..y1` up, at z = 0 in its own space.
fn board(x0: f32, x1: f32, y0: f32, y1: f32) -> MeshData {
    let v = |x: f32, y: f32| MeshVertex {
        position: [x, y, 0.0],
        normal: [0.0, 0.0, 1.0],
        color: [255; 4],
        uv: [0.0, 0.0],
        emissive: 1.0,
    };
    // (rows a quarter metre apart, so the cut's edge falls inside triangles rather than on one big one)
    let mut vertices = Vec::new();
    let rows = ((y1 - y0) / 0.25).ceil() as u32;
    for k in 0..=rows {
        let y = (y0 + k as f32 * 0.25).min(y1);
        vertices.push(v(x0, y));
        vertices.push(v(x1, y));
    }
    let mut indices = Vec::new();
    for k in 0..rows {
        let (a, b, c, d) = (2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 3);
        indices.extend_from_slice(&[a, b, c, b, d, c, a, c, b, b, c, d]);
    }
    MeshData {
        vertices,
        indices,
        ..Default::default()
    }
}

fn at(x: f32, y: f32, z: f32, tint: [f32; 4]) -> ModelInstance {
    ModelInstance {
        matrix: glam::Mat4::from_translation(glam::Vec3::new(x, y, z)).to_cols_array_2d(),
        tint,
    }
}

#[test]
fn the_hole_shows_what_is_behind_the_wall_and_keeps_its_foot() {
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
    let wall = gfx.upload_mesh(&board(-4.0, 4.0, 0.0, 3.0));
    let back = gfx.upload_mesh(&board(-6.0, 6.0, 0.0, 3.0));
    let draws = [
        ModelDraw {
            casts: false,
            mesh: wall,
            instance: at(0.0, 0.0, 5.0, [1.0, 0.0, 0.0, 1.0]),
        },
        ModelDraw {
            casts: false,
            mesh: back,
            instance: at(0.0, 0.0, 0.0, [0.0, 1.0, 0.0, 1.0]),
        },
    ];
    let (w, h) = (400u32, 300u32);
    // looking straight along -z at the board's middle, from 20 m: the wall covers the middle of the picture
    let shot = |gfx: &mut Gfx, see: Option<SeeThrough>| -> Vec<u8> {
        let input = FrameInput {
            clear: [0.0, 0.0, 0.0, 1.0],
            camera: Camera {
                eye: glam::Vec3::new(0.0, 1.5, 20.0),
                target: glam::Vec3::new(0.0, 1.5, 0.0),
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
                see_through: see,
                ..Default::default()
            },
            sprites_front: &[],
            text: &[],
            world_height: 0,
        };
        gfx.capture((w, h), &input)
    };
    // (which of the two a pixel shows, at a point on the wall's plane: x and y in metres)
    let what = |pixels: &[u8], x: f32, y: f32| -> char {
        // the wall is 15 m from the eye; the picture is 2 * 15 * tan(10 degrees) metres high there
        let span = 2.0 * 15.0 * (10.0f32).to_radians().tan();
        let px = (w as f32 / 2.0 + x / span * h as f32) as u32;
        let py = (h as f32 / 2.0 - (y - 1.5) / span * h as f32) as u32;
        let i = ((py * w + px) * 4) as usize;
        let (r, g) = (pixels[i], pixels[i + 1]);
        if r > 100 && g < 60 {
            'r'
        } else if g > 100 && r < 60 {
            'g'
        } else {
            '?'
        }
    };
    let plain = shot(&mut gfx, None);
    assert_eq!(
        what(&plain, 0.0, 1.5),
        'r',
        "without the hole the wall hides the board"
    );
    let cut = shot(
        &mut gfx,
        Some(SeeThrough {
            at: [0.0, 1.5, 0.0],
            radius: 1.6,
            margin: 1.0,
            amount: 1.0,
            above: 0.3,
            near: 0.0,
        }),
    );
    // the middle of the hole (inside 70% of its radius, 1.2 m at the wall's distance: no dither there) shows the board
    for (x, y) in [(0.0, 1.5), (0.5, 1.5), (-0.5, 1.9), (0.0, 0.8)] {
        assert_eq!(
            what(&cut, x, y),
            'g',
            "the hole shows the board at {x}, {y}"
        );
    }
    // the wall's foot (under 0.3 m over its base) and the wall away from the line of sight stay
    assert_eq!(
        what(&cut, 0.0, 0.15),
        'r',
        "the foot of the wall is never cut"
    );
    assert_eq!(what(&cut, 2.8, 1.5), 'r', "the wall outside the hole stays");
    // half the amount drops about half the pixels in the hole
    let half = shot(
        &mut gfx,
        Some(SeeThrough {
            at: [0.0, 1.5, 0.0],
            radius: 1.6,
            margin: 1.0,
            amount: 0.5,
            above: 0.3,
            near: 0.0,
        }),
    );
    // `near`: the wall stands 15 m from the eye, so with 20 (its dithered edge from 16) all of it goes, out to its edges (not its foot)
    let near = shot(
        &mut gfx,
        Some(SeeThrough {
            at: [0.0, 1.5, 0.0],
            radius: 1.6,
            margin: 1.0,
            amount: 1.0,
            above: 0.3,
            near: 20.0,
        }),
    );
    assert_eq!(
        what(&near, 2.8, 1.5),
        'g',
        "everything within `near` of the eye goes"
    );
    assert_eq!(what(&near, 0.0, 0.15), 'r', "but not under `above`");
    let (mut green, mut all) = (0, 0);
    for dy in -10..10 {
        for dx in -10..10 {
            let (px, py) = ((w / 2) as i32 + dx, (h / 2) as i32 + dy);
            let i = ((py as u32 * w + px as u32) * 4) as usize;
            all += 1;
            if half[i + 1] > 100 && half[i] < 60 {
                green += 1;
            }
        }
    }
    let share = green as f32 / all as f32;
    assert!(
        (0.3..0.7).contains(&share),
        "amount 0.5 drops about half: {share}"
    );
}

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
            near_from: -1.0,
            near_amount: -1.0,
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
            near_from: -1.0,
            near_amount: -1.0,
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
            near_from: -1.0,
            near_amount: -1.0,
        }),
    );
    assert_eq!(
        what(&near, 2.8, 1.5),
        'g',
        "everything within `near` of the eye goes"
    );
    assert_eq!(what(&near, 0.0, 0.15), 'r', "but not under `above`");
    // the near fade is its own: with the hole off (amount 0) and near_amount 1 everything within `near_from` of the eye (here 16 m,
    // the wall is 15 m off) is wholly gone; with near_amount 0 and the hole on, the wall's edge stays, so the two are independent
    let mut fade = |amount: f32, near_amount: f32, near_from: f32| {
        shot(
            &mut gfx,
            Some(SeeThrough {
                at: [0.0, 1.5, 0.0],
                radius: 1.6,
                margin: 1.0,
                amount,
                above: 0.3,
                near: 20.0,
                near_from,
                near_amount,
            }),
        )
    };
    let only_fade = fade(0.0, 1.0, 16.0);
    assert_eq!(what(&only_fade, 2.8, 1.5), 'g', "the near fade alone clears the wall inside near_from");
    assert_eq!(what(&only_fade, 0.0, 0.15), 'r', "but not under `above`");
    let only_hole = fade(1.0, 0.0, 16.0);
    assert_eq!(what(&only_hole, 2.8, 1.5), 'r', "no near fade: the wall outside the hole stays");
    assert_eq!(what(&only_hole, 0.0, 1.5), 'g', "and the hole still shows the board");
    let far_from = fade(0.0, 1.0, 5.0);
    let green = [(2.8f32, 1.5f32), (2.0, 2.0), (-2.5, 1.0), (1.0, 1.2), (-1.0, 2.2), (2.5, 0.8)]
        .iter()
        .filter(|(x, y)| what(&far_from, *x, *y) == 'g')
        .count();
    assert!((1..=5).contains(&green), "at 15 m between near_from 5 and near 20 the wall is part faded: {green} of 6 spots");
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

/// One frame of `draws` from 20 m along -z, looking at (0, 1.5, 0), with `see` (as the test above).
fn frame(
    gfx: &mut Gfx,
    draws: &[ModelDraw],
    see: Option<SeeThrough>,
    (w, h): (u32, u32),
) -> Vec<u8> {
    let input = FrameInput {
        clear: [0.0, 0.0, 0.0, 1.0],
        camera: Camera {
            eye: glam::Vec3::new(0.0, 1.5, 20.0),
            target: glam::Vec3::new(0.0, 1.5, 0.0),
            fov_y_degrees: 20.0,
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
            see_through: see,
            ..Default::default()
        },
        sprites_front: &[],
        text: &[],
        world_height: 0,
    };
    gfx.capture((w, h), &input)
}

fn gpu() -> Option<Gfx> {
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

/// `see_through = false` (`ModelInstance::kept_whole`): the same wall in the same hole is not cut; its dirt slot keeps its meaning.
#[test]
fn a_draw_kept_whole_is_never_cut() {
    let Some(mut gfx) = gpu() else { return };
    let wall = gfx.upload_mesh(&board(-4.0, 4.0, 0.0, 3.0));
    let back = gfx.upload_mesh(&board(-6.0, 6.0, 0.0, 3.0));
    let see = Some(SeeThrough {
        at: [0.0, 1.5, 0.0],
        radius: 1.6,
        margin: 1.0,
        amount: 1.0,
        above: 0.3,
        near: 0.0,
        near_from: -1.0,
        near_amount: -1.0,
    });
    let (w, h) = (400u32, 300u32);
    let middle = |p: &[u8]| {
        let i = (((h / 2) * w + w / 2) * 4) as usize;
        (p[i], p[i + 1])
    };
    for (kept, want) in [(false, "the board"), (true, "the wall")] {
        let wall_at = at(0.0, 0.0, 5.0, [1.0, 0.0, 0.0, 1.0]);
        let draws = [
            ModelDraw {
                casts: false,
                mesh: wall,
                instance: if kept { wall_at.kept_whole() } else { wall_at },
            },
            ModelDraw {
                casts: false,
                mesh: back,
                instance: at(0.0, 0.0, 0.0, [0.0, 1.0, 0.0, 1.0]),
            },
        ];
        let (r, g) = middle(&frame(&mut gfx, &draws, see, (w, h)));
        let shows = if r > 100 && g < 60 {
            "the wall"
        } else if g > 100 && r < 60 {
            "the board"
        } else {
            "?"
        };
        assert_eq!(shows, want, "kept whole: {kept}");
    }
    let dirty = at(0.0, 0.0, 0.0, [1.0; 4]).dirty(0.5, [0.0; 3], false);
    let kept = dirty.kept_whole();
    assert!(kept.is_kept_whole() && !dirty.is_kept_whole());
    assert_eq!(kept.matrix[3][3], -dirty.matrix[3][3]);
}

/// One see-through pane in a mesh no longer makes the whole mesh see-through: its solid triangles are drawn solid (writing depth, so
/// a part of the same mesh behind them stays hidden whatever order the triangles come in), and only the pane is blended.
#[test]
fn a_pane_of_glass_leaves_the_rest_of_its_mesh_solid() {
    let Some(mut gfx) = gpu() else { return };
    let quad = |x0: f32, x1: f32, y0: f32, y1: f32, z: f32, color: [u8; 4], base: u32| {
        let v = |x: f32, y: f32| MeshVertex {
            position: [x, y, z],
            normal: [0.0, 0.0, 1.0],
            color,
            uv: [0.0, 0.0],
            emissive: 1.0,
        };
        (
            vec![v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)],
            vec![base, base + 1, base + 2, base, base + 2, base + 3],
        )
    };
    // a red panel in front, a blue one 1 m behind it listed AFTER it (so without depth it would paint over the red), and a pane of
    // half-clear white glass off to the side, all one mesh
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    for (x0, x1, z, color) in [
        (-1.0, 1.0, 0.0, [255, 0, 0, 255]),
        (-1.5, 1.5, -1.0, [0, 0, 255, 255]),
        (2.0, 3.0, 0.0, [255, 255, 255, 100]),
    ] {
        let (v, i) = quad(x0, x1, 0.5, 2.5, z, color, vertices.len() as u32);
        vertices.extend(v);
        indices.extend(i);
    }
    let mesh = gfx.upload_mesh(&MeshData {
        vertices,
        indices,
        ..Default::default()
    });
    let back = gfx.upload_mesh(&board(-6.0, 6.0, 0.0, 3.0));
    let draws = [
        ModelDraw {
            casts: false,
            mesh,
            instance: at(0.0, 0.0, 2.0, [1.0; 4]),
        },
        ModelDraw {
            casts: false,
            mesh: back,
            instance: at(0.0, 0.0, -2.0, [0.0, 1.0, 0.0, 1.0]),
        },
    ];
    let (w, h) = (400u32, 300u32);
    let p = frame(&mut gfx, &draws, None, (w, h));
    let px = |x: f32| {
        // (the panels are 18 m from the eye)
        let span = 2.0 * 18.0 * (10.0f32).to_radians().tan();
        let i = (((h / 2) * w + (w as f32 / 2.0 + x / span * h as f32) as u32) * 4) as usize;
        [p[i], p[i + 1], p[i + 2]]
    };
    let red = px(0.0);
    assert!(
        red[0] > 100 && red[1] < 60 && red[2] < 60,
        "the solid front panel is drawn over the one behind it: {red:?}"
    );
    // the pane: the green board behind shows through, lightened by the white
    let pane = px(2.5);
    assert!(
        pane[1] > 100 && pane[0] > 40 && pane[0] < 230,
        "the pane is blended over what is behind it: {pane:?}"
    );
}

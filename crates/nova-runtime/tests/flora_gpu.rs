//! Flowers among the grass (`nova.grass { flowers = ... }`, gfx/grass.rs `Flora`, shaders/grass.wgsl `vs_flora`), the grass's and
//! the flowers' fade with the distance, and the soft blended ribbons of the wind curls (gfx/ribbon.rs), on the real GPU path: the
//! pictures stand on the ground near the camera in their own colours; none grow where the map is black; they thin and fade out over
//! the last part of their distance (a ring part way is neither whole nor empty) and are gone past it; the same for the blades; the
//! CPU's copy of where plants stand agrees with what is drawn; a ribbon is drawn with soft, faint edges (no cut at 0.3 of alpha)
//! and see-through. Each with and without multisampling. Skips (passes with a note) without a usable adapter.

use std::sync::Arc;

use nova_runtime::gfx::{
    Camera, Flora, FloraPicture, FrameInput, Gfx, Grass, GroundPicture, Lighting, ModelDraw,
    ModelInstance, Quality, Ribbon,
};
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

/// A flat square of grey ground `size` metres across.
fn ground(size: f32) -> MeshData {
    let n = 20u32;
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
                color: [70, 70, 70, 255],
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

/// A picture of two kinds: a red disc and a blue one, each in its 32-texel cell, see-through round them.
fn picture() -> Arc<FloraPicture> {
    let (w, h) = (64u32, 32u32);
    let mut rgba = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let (cx, k) = if x < 32 { (16.0, 0) } else { (48.0, 1) };
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - 16.0).powi(2)).sqrt();
            if d < 13.0 {
                let i = ((y * w + x) * 4) as usize;
                let c = if k == 0 { [230, 20, 20] } else { [20, 40, 230] };
                rgba[i..i + 4].copy_from_slice(&[c[0], c[1], c[2], 255]);
            }
        }
    }
    Arc::new(FloraPicture::new(w, h, rgba, 2))
}

fn flora(distance: f32) -> Flora {
    Flora {
        picture: picture(),
        kinds: 2,
        density: 6.0,
        size: 0.5,
        distance,
        patch: 1.0,
        cover: 1.0,
        spots: Vec::new(),
    }
}

/// Grass that is hardly there (tiny dark blades) carrying `flora`.
fn low_grass(flora: Option<Flora>, distance: f32) -> Grass {
    Grass {
        color: [0.02, 0.02, 0.02],
        height: 0.05,
        width: 0.01,
        density: 0.5,
        distance,
        flora,
        ..Default::default()
    }
}

fn shoot(
    gfx: &mut Gfx,
    mesh: usize,
    grass: Option<Grass>,
    ribbons: Vec<Ribbon>,
    eye: [f32; 3],
    target: [f32; 3],
    msaa: u32,
) -> Vec<u8> {
    let draws = [ModelDraw {
        casts: false,
        mesh,
        instance: ModelInstance {
            matrix: glam::Mat4::IDENTITY.to_cols_array_2d(),
            tint: [1.0; 4],
        },
    }];
    let input = FrameInput {
        clear: [0.0, 0.0, 0.0, 1.0],
        camera: Camera {
            eye: glam::Vec3::from(eye),
            target: glam::Vec3::from(target),
            fov_y_degrees: 50.0,
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
            direction: [0.2, -1.0, 0.1],
            color: [1.0, 1.0, 1.0],
            ambient: [0.6, 0.6, 0.6],
            grass,
            ribbons,
            quality: Quality {
                msaa,
                ..Default::default()
            },
            ..Default::default()
        },
        sprites_front: &[],
        text: &[],
        world_height: 0,
    };
    gfx.capture_with_stats((W, H), &input).0
}

fn px(p: &[u8], x: u32, y: u32) -> [f64; 3] {
    let i = ((y * W + x) * 4) as usize;
    [p[i] as f64, p[i + 1] as f64, p[i + 2] as f64]
}

fn is_red(c: [f64; 3]) -> bool {
    c[0] > c[1] + 60.0 && c[0] > c[2] + 60.0
}
fn is_blue(c: [f64; 3]) -> bool {
    c[2] > c[0] + 60.0 && c[2] > c[1] + 40.0
}
fn is_green(c: [f64; 3]) -> bool {
    c[1] > c[0] + 10.0 && c[1] > c[2]
}

/// Looking straight down from `height` over (0, 0): the share of pixels that `test` likes whose ground spot is between `r0` and
/// `r1` metres from the point under the eye.
fn ring(shot: &[u8], height: f32, r0: f32, r1: f32, test: fn([f64; 3]) -> bool) -> f64 {
    let t = (25f32).to_radians().tan() * height; // metres from the middle to the top edge, on the ground
    let (mut n, mut k) = (0, 0);
    for y in 0..H {
        for x in 0..W {
            let gx = (x as f32 + 0.5 - W as f32 / 2.0) / (H as f32 / 2.0) * t;
            let gz = (y as f32 + 0.5 - H as f32 / 2.0) / (H as f32 / 2.0) * t;
            let r = gx.hypot(gz);
            if r >= r0 && r < r1 {
                n += 1;
                if test(px(shot, x, y)) {
                    k += 1;
                }
            }
        }
    }
    k as f64 / n.max(1) as f64
}

#[test]
fn flowers_stand_in_their_own_colours_and_not_where_the_map_is_black() {
    let Some(mut gfx) = gfx() else { return };
    let mesh = gfx.upload_mesh(&ground(200.0));
    for msaa in [1, 4] {
        // low over the meadow: the pictures stand up in red and blue, both kinds
        let shot = shoot(
            &mut gfx,
            mesh,
            Some(low_grass(Some(flora(20.0)), 24.0)),
            Vec::new(),
            [0.0, 1.2, 0.0],
            [0.0, 0.3, -6.0],
            msaa,
        );
        let (mut red, mut blue) = (0, 0);
        for y in H / 2..H {
            for x in 0..W {
                red += usize::from(is_red(px(&shot, x, y)));
                blue += usize::from(is_blue(px(&shot, x, y)));
            }
        }
        let all = (W * H / 2) as f64;
        assert!(
            red as f64 / all > 0.02 && blue as f64 / all > 0.02,
            "msaa {msaa}: both kinds stand near the camera ({:.3} red, {:.3} blue)",
            red as f64 / all,
            blue as f64 / all
        );
        let none = shoot(
            &mut gfx,
            mesh,
            Some(low_grass(None, 24.0)),
            Vec::new(),
            [0.0, 1.2, 0.0],
            [0.0, 0.3, -6.0],
            msaa,
        );
        let red_none = (0..W * H)
            .filter(|i| is_red(px(&none, i % W, i / W)))
            .count();
        assert_eq!(red_none, 0, "msaa {msaa}: no flora, no flowers");
    }
    // a map 40 m across: grass on the left half (x < 0), none on the right; from above, flowers only on the left
    let side = 81u32;
    let mut texels = vec![0u8; (side * side) as usize];
    for j in 0..side {
        for i in 0..side / 2 {
            texels[(j * side + i) as usize] = 255;
        }
    }
    let map = Arc::new(GroundPicture {
        width: side,
        rows: side,
        x0: -20.0,
        z0: -20.0,
        cell: 0.5,
        texels,
    });
    let grass = Grass {
        map: Some(map),
        ..low_grass(Some(flora(20.0)), 24.0)
    };
    // (the CPU's copy of the places says the same: every plant of the squares round the middle stands where the map is full)
    for (i, j) in [(-1, -1), (0, -1), (-1, 0), (0, 0)] {
        let places = grass.flora_places(i, j);
        if i < 0 {
            assert!(
                places.len() > 100,
                "plants on the full half: {}",
                places.len()
            );
        }
        for (x, _, _) in places {
            assert!(
                x < -0.4,
                "no plant where the map thins or is black (x = {x:.2})"
            );
        }
    }
    let shot = shoot(
        &mut gfx,
        mesh,
        Some(grass),
        Vec::new(),
        [0.0, 10.0, 0.01],
        [0.0, 0.0, 0.0],
        4,
    );
    let count = |x0: u32, x1: u32| {
        let mut k = 0;
        for y in H / 4..3 * H / 4 {
            for x in x0..x1 {
                let c = px(&shot, x, y);
                k += usize::from(is_red(c) || is_blue(c));
            }
        }
        k
    };
    let (left, right) = (
        count(W / 2 - 150, W / 2 - 20),
        count(W / 2 + 20, W / 2 + 150),
    );
    assert!(left > 300, "flowers where the map is full: {left} pixels");
    assert_eq!(right, 0, "none where it is black");
}

#[test]
fn flowers_and_blades_fade_out_over_the_end_of_their_distance_with_no_ring() {
    let Some(mut gfx) = gfx() else { return };
    let mesh = gfx.upload_mesh(&ground(200.0));
    let height = 30.0;
    let colourful = |c: [f64; 3]| is_red(c) || is_blue(c);
    for msaa in [1, 4] {
        // flowers to 10 m, seen from straight above
        let shot = shoot(
            &mut gfx,
            mesh,
            Some(low_grass(Some(flora(10.0)), 12.0)),
            Vec::new(),
            [0.0, height, 0.01],
            [0.0, 0.0, 0.0],
            msaa,
        );
        let near = ring(&shot, height, 1.0, 3.0, colourful);
        let mid = ring(&shot, height, 6.0, 7.0, colourful);
        let late = ring(&shot, height, 8.3, 9.3, colourful);
        let past = ring(&shot, height, 11.5, 13.0, colourful);
        assert!(near > 0.2, "msaa {msaa}: flowers near: {near:.3}");
        assert!(
            late > near * 0.01 && late < mid,
            "msaa {msaa}: towards the end they are thinning and fading, not cut ({near:.3} near, {mid:.3} at 6 m, {late:.3} at 9 m)"
        );
        assert!(
            past < 0.001,
            "msaa {msaa}: none past the distance: {past:.4}"
        );
        // blades to 12 m: the same
        let blades = Grass {
            color: [0.3, 0.7, 0.2],
            height: 0.6,
            distance: 12.0,
            ..Default::default()
        };
        let shot = shoot(
            &mut gfx,
            mesh,
            Some(blades),
            Vec::new(),
            [0.0, height, 0.01],
            [0.0, 0.0, 0.0],
            msaa,
        );
        let near = ring(&shot, height, 1.0, 3.0, is_green);
        let mid = ring(&shot, height, 5.0, 6.5, is_green);
        let late = ring(&shot, height, 9.8, 10.8, is_green);
        let past = ring(&shot, height, 13.5, 15.0, is_green);
        assert!(near > 0.15, "msaa {msaa}: blades near: {near:.3}");
        assert!(
            late > near * 0.01 && late < mid * 0.8,
            "msaa {msaa}: the last blades fade, not cut ({near:.3} near, {mid:.3} at 6 m, {late:.3} at 10 m)"
        );
        assert!(
            past < 0.002,
            "msaa {msaa}: no blades past the distance: {past:.4}"
        );
    }
}

#[test]
fn a_ribbon_is_soft_and_see_through_with_faint_edges_kept() {
    let Some(mut gfx) = gfx() else { return };
    let mesh = gfx.upload_mesh(&ground(200.0));
    // a white ribbon across the view, 0.4 m wide, at half alpha, 6 m ahead and 2 m up, over the dark ground
    let points = (0..=20)
        .map(|i| [-3.0 + i as f32 * 0.3, 2.0, -6.0, 0.2, 0.5])
        .collect();
    let ribbon = Ribbon {
        points,
        color: [1.0, 1.0, 1.0],
    };
    for msaa in [1, 4] {
        let bare = shoot(
            &mut gfx,
            mesh,
            None,
            Vec::new(),
            [0.0, 1.6, 0.0],
            [0.0, 1.6, -6.0],
            msaa,
        );
        let shot = shoot(
            &mut gfx,
            mesh,
            None,
            vec![ribbon.clone()],
            [0.0, 1.6, 0.0],
            [0.0, 1.6, -6.0],
            msaa,
        );
        // down the middle column: how much brighter each pixel is than without the ribbon
        let lift: Vec<f64> = (0..H)
            .map(|y| px(&shot, W / 2, y)[0] - px(&bare, W / 2, y)[0])
            .collect();
        let peak = lift.iter().copied().fold(0.0, f64::max);
        let faint = lift.iter().filter(|&&v| v > 4.0 && v < peak * 0.45).count();
        let lit = lift.iter().filter(|&&v| v > 4.0).count();
        assert!(peak > 60.0, "msaa {msaa}: the ribbon shows: {peak:.0}");
        assert!(
            peak < 215.0,
            "msaa {msaa}: at half alpha it is see-through, not solid white: {peak:.0}"
        );
        assert!(
            lit >= 8 && faint >= 4,
            "msaa {msaa}: its edges fall off softly ({lit} pixels lit, {faint} of them faint): {lift:?}"
        );
    }
}

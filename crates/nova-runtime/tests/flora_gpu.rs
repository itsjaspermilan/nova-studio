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
    ground_coloured(size, [70, 70, 70, 255])
}

/// The same in a colour.
fn ground_coloured(size: f32, color: [u8; 4]) -> MeshData {
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
                color,
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

// ---- flicker: the owner on the device, "The flowers flicker for some reason." ------------------------------------------------------

/// The game's own flower picture (examples/mountain-post/textures/flora.png, five kinds) in a meadow like its valley's, flowers in
/// patches everywhere, low green blades among them.
fn meadow() -> Grass {
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/mountain-post/textures/flora.png"),
    )
    .expect("the game's flora picture");
    let img = nova_runtime::assets::decode_png(&bytes).unwrap();
    let picture = Arc::new(FloraPicture::new(img.width, img.height, img.rgba, 5));
    Grass {
        color: [0.05, 0.16, 0.03],
        height: 0.3,
        width: 0.07,
        density: 10.0,
        distance: 32.0,
        flora: Some(Flora {
            picture,
            kinds: 5,
            density: 1.0,
            size: 0.5,
            distance: 28.0,
            patch: 7.0,
            cover: 1.0,
            spots: Vec::new(),
        }),
        ..Default::default()
    }
}

const FW: u32 = 640;
const FH: u32 = 360;

/// Where a frame of the meadow is seen from: the eye, which way it looks (radians about y; 15 degrees down) and how far the boards
/// casting their shadows across the flowers have moved along x (metres).
#[derive(Clone, Copy)]
struct Look {
    eye: glam::Vec3,
    yaw: f32,
    boards: f32,
    /// Degrees the camera looks down (15 for the turns and walks; the game's raised boom and the rooms' camera look 45 to 52 down).
    pitch: f32,
    /// A walker the grass and the flowers bend away from (`nova.grass_bend`: x, z and its radius), if any.
    bend: Option<[f32; 3]>,
    /// The wind's time (seconds): the valley's wind blows (`nova.wind { direction = 60, strength = 1.1 }`) when it is above 0.
    time: f32,
}

impl Look {
    fn at(eye: glam::Vec3, yaw: f32, boards: f32) -> Self {
        Self {
            eye,
            yaw,
            boards,
            pitch: 15.0,
            bend: None,
            time: 0.0,
        }
    }
}

/// A frame of the meadow, with the game's lens (42 degrees) and the valley's shadows (`nova.shadows { radius = 40, near = 6,
/// softness = 1.4, far = 110 }`: a fine map for the view's first 6 metres, the wide one beyond it): boards 1.5 m wide and 3 m tall
/// stand among the flowers, their shadows falling across them towards the camera.
fn meadow_shot(
    gfx: &mut Gfx,
    (mesh, post): (usize, usize),
    grass: &Grass,
    look: Look,
    msaa: u32,
    scale: u32,
) -> Vec<u8> {
    let mut draws = vec![ModelDraw {
        casts: false,
        mesh,
        instance: ModelInstance {
            matrix: glam::Mat4::IDENTITY.to_cols_array_2d(),
            tint: [1.0; 4],
        },
    }];
    for k in 0..6 {
        draws.push(ModelDraw {
            casts: true,
            mesh: post,
            instance: ModelInstance {
                matrix: (glam::Mat4::from_translation(glam::Vec3::new(
                    -8.0 + k as f32 * 3.1 + look.boards,
                    0.0,
                    -3.0 - (k % 3) as f32 * 3.0,
                )) * glam::Mat4::from_scale(glam::Vec3::new(6.0, 1.0, 1.0)))
                .to_cols_array_2d(),
                tint: [1.0; 4],
            },
        });
    }
    let (s, c) = look.yaw.sin_cos();
    let pitch = look.pitch.to_radians();
    let mut grass = grass.clone();
    if let Some([x, z, r]) = look.bend {
        grass.bends = vec![[x, 0.0, z, r]];
    }
    let wind = if look.time > 0.0 {
        nova_runtime::gfx::Wind {
            direction: [60f32.to_radians().sin(), 60f32.to_radians().cos()],
            strength: 1.1,
            time: look.time,
        }
    } else {
        nova_runtime::gfx::Wind::default()
    };
    let fwd = glam::Vec3::new(-s * pitch.cos(), -pitch.sin(), -c * pitch.cos());
    let input = FrameInput {
        clear: [0.5, 0.6, 0.8, 1.0],
        camera: Camera {
            eye: look.eye,
            target: look.eye + fwd * 10.0,
            fov_y_degrees: 42.0,
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
            direction: [0.45, -0.75, 0.35],
            color: [1.0, 0.95, 0.85],
            ambient: [0.45, 0.48, 0.55],
            grass: Some(grass),
            wind,
            shadows: Some(nova_runtime::gfx::Shadows {
                radius: 40.0,
                strength: 0.72,
                near: 6.0,
                softness: 1.4,
                far: 110.0,
            }),
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
    shrink(&gfx.capture((FW * scale, FH * scale), &input), scale)
}

/// A post 0.25 m square and 3 m tall (a shadow to fall across the flowers).
fn post_mesh() -> MeshData {
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let (a, h) = (0.125f32, 3.0f32);
    let faces: [([f32; 3], [[f32; 3]; 4]); 5] = [
        (
            [1.0, 0.0, 0.0],
            [[a, 0.0, -a], [a, h, -a], [a, h, a], [a, 0.0, a]],
        ),
        (
            [-1.0, 0.0, 0.0],
            [[-a, 0.0, a], [-a, h, a], [-a, h, -a], [-a, 0.0, -a]],
        ),
        (
            [0.0, 0.0, 1.0],
            [[a, 0.0, a], [a, h, a], [-a, h, a], [-a, 0.0, a]],
        ),
        (
            [0.0, 0.0, -1.0],
            [[-a, 0.0, -a], [-a, h, -a], [a, h, -a], [a, 0.0, -a]],
        ),
        (
            [0.0, 1.0, 0.0],
            [[-a, h, -a], [-a, h, a], [a, h, a], [a, h, -a]],
        ),
    ];
    for (n, q) in faces {
        let b = vertices.len() as u32;
        for p in q {
            vertices.push(MeshVertex {
                position: p,
                normal: n,
                color: [90, 70, 50, 255],
                uv: [0.0, 0.0],
                emissive: 0.0,
            });
        }
        // (both windings: whichever way the mesh pipeline culls, the post is solid)
        indices.extend_from_slice(&[
            b,
            b + 1,
            b + 2,
            b,
            b + 2,
            b + 3,
            b,
            b + 2,
            b + 1,
            b,
            b + 3,
            b + 2,
        ]);
    }
    MeshData {
        vertices,
        indices,
        ..Default::default()
    }
}

/// How much the flowers flicker over a run of frames (`with`: the meadow with flowers, `without`: the same frames without them):
/// the mean second difference in time, |I(t) - (I(t-1) + I(t+1)) / 2| (0 to 255, the three channels' mean), over the pixels the
/// flowers change in any of the three frames. A flower that slides smoothly by less than a pixel a frame changes a pixel almost
/// linearly (little); a pixel that comes and goes for one frame, or a whole flower's light that jumps, counts in full. Also the
/// share of those pixels that flash (come or go for a single frame by more than 60), and the flower pixels a frame.
fn flicker(measured: &[Vec<u8>], with: &[Vec<u8>], without: &[Vec<u8>]) -> (f64, f64, usize) {
    let (mut sum, mut n, mut flashes) = (0.0, 0usize, 0usize);
    for t in 1..with.len() - 1 {
        let (a, b, c) = (&measured[t - 1], &measured[t], &measured[t + 1]);
        for i in (0..a.len()).step_by(4) {
            let mut flower = false;
            for s in t - 1..=t + 1 {
                let (f, g) = (&with[s], &without[s]);
                let d: i32 = (0..3)
                    .map(|k| (f[i + k] as i32 - g[i + k] as i32).abs())
                    .sum();
                flower |= d > 45;
            }
            if !flower {
                continue;
            }
            let (mut d, mut up, mut down) = (0.0, true, true);
            for k in 0..3 {
                let (x, y, z) = (a[i + k] as f64, b[i + k] as f64, c[i + k] as f64);
                d += (y - (x + z) / 2.0).abs();
                up &= y - x > 60.0 && y - z > 60.0;
                down &= x - y > 60.0 && z - y > 60.0;
            }
            sum += d / 3.0;
            n += 1;
            flashes += usize::from(up || down);
        }
    }
    (
        sum / n.max(1) as f64,
        flashes as f64 / n.max(1) as f64,
        n / (with.len() - 2),
    )
}

/// With NOVA_FLICKER_DIR set, the frames are written there to look at (`name_000.png` ...).
fn save_frames(name: &str, frames: &[Vec<u8>]) {
    let Ok(dir) = std::env::var("NOVA_FLICKER_DIR") else {
        return;
    };
    let dir = std::path::PathBuf::from(dir);
    std::fs::create_dir_all(&dir).unwrap();
    for (k, f) in frames.iter().enumerate() {
        let file = std::fs::File::create(dir.join(format!("{name}_{k:03}.png"))).unwrap();
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), FW, FH);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().unwrap().write_image_data(f).unwrap();
    }
}

/// Renders `frames` frames of `at(t)`, with and without the flowers, and measures their flicker.
fn flicker_run(
    gfx: &mut Gfx,
    name: &str,
    msaa: u32,
    frames: usize,
    at: impl Fn(usize) -> Look,
) -> Flicker {
    let meshes = (
        gfx.upload_mesh(&ground_coloured(200.0, [45, 95, 30, 255])),
        gfx.upload_mesh(&post_mesh()),
    );
    let grass = meadow();
    let bare = Grass {
        flora: None,
        ..grass.clone()
    };
    let (mut with, mut without, mut truth) = (Vec::new(), Vec::new(), Vec::new());
    for t in 0..frames {
        let look = at(t);
        with.push(meadow_shot(gfx, meshes, &grass, look, msaa, 1));
        without.push(meadow_shot(gfx, meshes, &bare, look, msaa, 1));
        // (the same frame drawn four times as wide and high, and averaged down: what the frame would be with no aliasing at all)
        truth.push(meadow_shot(gfx, meshes, &grass, look, 4, 4));
    }
    save_frames(&format!("{name}_msaa{msaa}"), &with);
    let (pixels, ideal) = (
        flicker(&with, &with, &without),
        flicker(&truth, &with, &without),
    );
    let f = Flicker {
        pixels: pixels.0 - ideal.0,
        flashing: pixels.1,
        cover: pixels.2,
    };
    eprintln!(
        "{name} msaa {msaa}: flicker over the ideal {:.2} ({:.2}, ideal {:.2}), flashing {:.4}, {} flower pixels a frame",
        f.pixels, pixels.0, ideal.0, f.flashing, f.cover
    );
    f
}

/// A frame `scale` times as wide and high averaged down to [`FW`] x [`FH`].
fn shrink(big: &[u8], scale: u32) -> Vec<u8> {
    if scale == 1 {
        return big.to_vec();
    }
    let mut out = vec![0u8; (FW * FH * 4) as usize];
    for y in 0..FH {
        for x in 0..FW {
            for k in 0..4 {
                let mut sum = 0u32;
                for dy in 0..scale {
                    for dx in 0..scale {
                        sum += big
                            [(((y * scale + dy) * FW * scale + x * scale + dx) * 4 + k) as usize]
                            as u32;
                    }
                }
                out[((y * FW + x) * 4 + k) as usize] = (sum / (scale * scale)) as u8;
            }
        }
    }
    out
}

/// What a run measured: how much more the flowers flicker than the same frames drawn without aliasing (the second difference in
/// time, 0 to 255), the share of flower pixels that flash for one frame, and the flower pixels a frame.
struct Flicker {
    pixels: f64,
    flashing: f64,
    cover: usize,
}

/// The owner on the device: "The flowers flicker for some reason." A camera turning where it stands (a fiftieth of a degree a frame)
/// and walking (0.3 m/s, and at a walk, 1.4 m/s, at 60 frames a second) through a meadow of the game's own flowers, and the shadows
/// of boards sliding across them (a crown swaying, the van passing): the frames change hardly more than the same frames drawn four
/// times as wide and high and averaged down (no aliasing) do, and hardly a pixel of the flowers flashes on or off for one frame (no
/// plant chosen again, no stem or petal that comes and goes, no plant lit or darkened all at once). Before 2026-11-24 the flowers'
/// edges and fades were drawn by coverage and their shadow was one look in one map: over the ideal by 3.0 (turn), 1.9 and 1.6
/// (walks) with multisampling, 6.4, 4.1 and 8.4 without; now 1.3, 0.7, 0.4 and 2.8, 1.5, 3.1 (most of what is left is the blades').
#[test]
fn flowers_hold_steady_as_the_camera_turns_and_walks() {
    let Some(mut gfx) = gfx() else { return };
    let eye = glam::Vec3::new(0.0, 3.4, 6.0);
    // (what, degrees a frame the camera turns, metres a second it walks, metres a second the boards move, and the most it may
    // flicker over the ideal with multisampling and without)
    let runs = [
        ("slow turn", 0.02f32, 0.0f32, 0.0f32, 2.0, 4.5),
        ("slow walk", 0.0, 0.3, 0.0, 1.2, 2.8),
        ("walk", 0.0, 1.4, 0.0, 1.0, 5.5),
        ("shadows", 0.0, 0.0, 0.6, 0.3, 0.5),
    ];
    for msaa in [4, 1] {
        for (what, degrees, speed, boards, most4, most1) in runs {
            let f = flicker_run(&mut gfx, &what.replace(' ', "_"), msaa, 10, |t| {
                let t = t as f32;
                Look::at(
                    eye + glam::Vec3::new(0.0, 0.0, -speed / 60.0 * t),
                    0.15 + t * degrees.to_radians(),
                    boards / 60.0 * t,
                )
            });
            assert!(
                f.cover > 2000,
                "msaa {msaa}, {what}: flowers in view: {} pixels",
                f.cover
            );
            let most = if msaa > 1 { most4 } else { most1 };
            assert!(
                f.pixels < most,
                "msaa {msaa}, {what}: the flowers flicker {:.2} over the same frames without aliasing (at most {most})",
                f.pixels
            );
            assert!(
                f.flashing < if msaa > 1 { 0.0005 } else { 0.004 },
                "msaa {msaa}, {what}: {:.4} of the flowers' pixels flash for a frame",
                f.flashing
            );
        }
    }
}

// ---- walking through them: the owner on the device, "The flowers still flicker ... When the player walks through them" ------------

/// The same from the raised camera ("When the camera is way up": the boom tilted up to 52 degrees, the rooms' top-down camera, and
/// the walking camera made like it): 6.5 m up looking 48 degrees down, walking at 1.4 m/s, alone and with the walker 6 m ahead
/// bending the flowers and the valley's wind blowing.
#[test]
fn flowers_hold_steady_seen_from_the_raised_camera() {
    let Some(mut gfx) = gfx() else { return };
    for msaa in [4, 1] {
        for (what, walker) in [("raised walk", false), ("raised walk with walker", true)] {
            let f = flicker_run(&mut gfx, &what.replace(' ', "_"), msaa, 10, |t| {
                let z = 8.0 - 1.4 / 60.0 * t as f32;
                let mut l = Look::at(glam::Vec3::new(0.0, 6.5, z), 0.15, 0.0);
                l.pitch = 48.0;
                if walker {
                    l.bend = Some([-0.9, z - 5.85, 0.75]);
                    l.time = 100.0 + t as f32 / 60.0;
                }
                l
            });
            assert!(f.cover > 2000, "msaa {msaa}, {what}: flowers in view");
            let most = if msaa > 1 { 1.0 } else { 3.5 };
            assert!(
                f.pixels < most,
                "msaa {msaa}, {what}: the flowers flicker {:.2} over the same frames without aliasing (at most {most})",
                f.pixels
            );
            assert!(
                f.flashing < if msaa > 1 { 0.001 } else { 0.004 },
                "msaa {msaa}, {what}: {:.4} of the flowers' pixels flash for a frame",
                f.flashing
            );
        }
    }
}

/// The owner after the blended edges: "The flowers still flicker. It's at random times. When the camera is way up. When the player
/// walks through them etc." A walker (`nova.grass_bend`, the game's 0.75 m) steps over one of the game's flowers half a centimetre
/// at a time, seen from the raised camera (5 m up, looking 48 degrees down): every step changes the picture about as much as the
/// next, with no step where the flower jumps. Before 2026-11-24 a plant leaned away from the walker at full lean as soon as it was
/// within half the radius, so the moment the walker passed over it, it flipped from leaning one way to leaning the other in one frame
/// (its top jumped the length of the plant), and a plant leaned that far was squashed into a streak.
#[test]
fn a_flower_walked_over_bends_away_without_a_jump() {
    let Some(mut gfx) = gfx() else { return };
    let meshes = (
        gfx.upload_mesh(&ground_coloured(200.0, [45, 95, 30, 255])),
        gfx.upload_mesh(&post_mesh()),
    );
    // (the game's flowers on bare ground: no blades in the way)
    let grass = Grass {
        density: 0.01,
        height: 0.01,
        ..meadow()
    };
    // a plant near (2, 4), on the walker's way (the boards stand further off)
    let (px, pz, _) = grass
        .flora_places(0, 0)
        .into_iter()
        .min_by(|a, b| {
            let d = |p: &(f32, f32, u32)| (p.0 - 2.0).hypot(p.1 - 4.0);
            d(a).total_cmp(&d(b))
        })
        .expect("a plant in the square");
    for msaa in [4, 1] {
        let steps = 25;
        let mut shots = Vec::new();
        for s in 0..steps {
            let mut l = Look::at(glam::Vec3::new(px, 5.0, pz + 4.5), 0.0, 0.0);
            l.pitch = 48.0;
            // (the walker comes towards the camera, a millimetre to the side of the plant's foot)
            l.bend = Some([px + 0.001, pz - 0.06 + 0.005 * s as f32, 0.75]);
            shots.push(meadow_shot(&mut gfx, meshes, &grass, l, msaa, 1));
        }
        save_frames(&format!("walked_over_msaa{msaa}"), &shots);
        let change: Vec<f64> = shots
            .windows(2)
            .map(|w| {
                w[0].iter()
                    .zip(&w[1])
                    .map(|(a, b)| (*a as f64 - *b as f64).abs())
                    .sum::<f64>()
                    / 255.0
            })
            .collect();
        let mut sorted = change.clone();
        sorted.sort_by(f64::total_cmp);
        let median = sorted[sorted.len() / 2];
        let most = sorted[sorted.len() - 1];
        eprintln!(
            "msaa {msaa}: plant at ({px:.2}, {pz:.2}); a step changes {median:.1} (median), {most:.1} at the most: {change:.0?}"
        );
        assert!(
            median > 0.5,
            "msaa {msaa}: the flowers near the walker move as it walks: {change:.1?}"
        );
        assert!(
            most < median * 4.0 + 20.0,
            "msaa {msaa}: no step where a flower jumps: the most a 5 mm step changes is {most:.1}, the median {median:.1}: {change:.1?}"
        );
    }
}

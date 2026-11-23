//! Painted surfaces on the real GPU path (`mesh.wgsl`, "Painted surfaces"; gfx/paint.rs): a vertex whose `emissive` carries a
//! painted kind (model.rs PAINT_STEP) is drawn with that kind's look, not as a glow. Ground gets soft patches and brush strokes near
//! the camera that are gone (calm, no pixel-to-pixel noise) seen from far off; a crown gets more light-and-dark variation than the
//! plain look and stays about as bright; water lays foam where it is shallow and its ripples move with time. Skips (passes with a
//! note) without a usable adapter.

use nova_runtime::gfx::{Camera, FrameInput, Gfx, Lighting, ModelDraw, ModelInstance, Wind};
use nova_runtime::model::{MeshData, MeshVertex, PAINT_STEP};

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

fn lighting(time: f32) -> Lighting {
    Lighting {
        direction: [0.35, -0.8, 0.3],
        color: [1.0, 0.97, 0.92],
        ambient: [0.45, 0.47, 0.52],
        wind: Wind {
            time,
            ..Default::default()
        },
        ..Default::default()
    }
}

fn vertex(p: [f32; 3], n: [f32; 3], color: [u8; 4], uv: [f32; 2], emissive: f32) -> MeshVertex {
    MeshVertex {
        position: p,
        normal: n,
        color,
        uv,
        emissive,
    }
}

/// A flat square of ground `size` metres across, in squares of `step`, in one green, painted as `kind` (0: plain).
fn ground(size: f32, step: f32, kind: f32) -> MeshData {
    let n = (size / step) as u32;
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    for j in 0..=n {
        for i in 0..=n {
            let (x, z) = (-size / 2.0 + i as f32 * step, -size / 2.0 + j as f32 * step);
            vertices.push(vertex(
                [x, 0.0, z],
                [0.0, 1.0, 0.0],
                [70, 120, 40, 255],
                [0.0, 0.0],
                kind * PAINT_STEP,
            ));
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

/// A ball of radius `r` at `c`, shaded smooth, in one leaf green, painted as `kind`.
fn ball(c: [f32; 3], r: f32, kind: f32) -> MeshData {
    let (seg, rows) = (32u32, 16u32);
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    for j in 0..=rows {
        let t = std::f32::consts::PI * j as f32 / rows as f32;
        for i in 0..=seg {
            let a = std::f32::consts::TAU * i as f32 / seg as f32;
            let n = [t.sin() * a.cos(), t.cos(), t.sin() * a.sin()];
            vertices.push(vertex(
                [c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r],
                n,
                [60, 110, 45, 255],
                [0.0, 0.0],
                kind * PAINT_STEP,
            ));
        }
    }
    for j in 0..rows {
        for i in 0..seg {
            let a = j * (seg + 1) + i;
            let b = a + seg + 1;
            indices.extend_from_slice(&[a, a + 1, b, a + 1, b + 1, b]);
        }
    }
    MeshData {
        vertices,
        indices,
        ..Default::default()
    }
}

/// A stream 6 m wide and 40 m long along +z, its UVs (metres across, metres downstream), deep in its middle and shallow (alpha 0)
/// in its outer metre each side.
fn stream() -> MeshData {
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let across = [-3.0f32, -2.5, -2.0, 0.0, 2.0, 2.5, 3.0];
    let rows = 80u32;
    for j in 0..=rows {
        let z = -20.0 + 40.0 * j as f32 / rows as f32;
        for &x in &across {
            let depth = if x.abs() > 2.2 { 0 } else { 255 };
            vertices.push(vertex(
                [x, 0.0, z],
                [0.0, 1.0, 0.0],
                [50, 110, 130, depth],
                [x, z + 20.0],
                4.0 * PAINT_STEP,
            ));
        }
    }
    let k = across.len() as u32;
    for j in 0..rows {
        for i in 0..k - 1 {
            let a = j * k + i;
            indices.extend_from_slice(&[a, a + k + 1, a + 1, a, a + k, a + k + 1]);
        }
    }
    MeshData {
        vertices,
        indices,
        ..Default::default()
    }
}

fn shoot(
    gfx: &mut Gfx,
    mesh: usize,
    eye: [f32; 3],
    target: [f32; 3],
    fov: f32,
    time: f32,
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
            fov_y_degrees: fov,
        },
        sprites_back: &[],
        models: &draws,
        joints: &[],
        mesh_ops: &[],
        shaded_models: &[],
        shaded_sprites: &[],
        post: None,
        texture_ops: &[],
        time,
        ui_models: &[],
        lighting: lighting(time),
        sprites_front: &[],
        text: &[],
        world_height: 0,
    };
    gfx.capture((W, H), &input)
}

fn luma(px: &[u8], x: u32, y: u32) -> f64 {
    let i = ((y * W + x) * 4) as usize;
    0.2126 * px[i] as f64 + 0.7152 * px[i + 1] as f64 + 0.0722 * px[i + 2] as f64
}

/// Mean and standard deviation of the brightness over the pixels that are drawn (not the black clear colour) in a rectangle.
fn stats(px: &[u8], x0: u32, y0: u32, x1: u32, y1: u32) -> (f64, f64, usize) {
    let mut v = Vec::new();
    for y in y0..y1 {
        for x in x0..x1 {
            let l = luma(px, x, y);
            if l > 3.0 {
                v.push(l);
            }
        }
    }
    let n = v.len().max(1) as f64;
    let mean = v.iter().sum::<f64>() / n;
    let sd = (v.iter().map(|l| (l - mean).powi(2)).sum::<f64>() / n).sqrt();
    (mean, sd, v.len())
}

/// The mean step in brightness from a pixel to its right-hand neighbour (how grainy or shimmery a picture is).
fn grain(px: &[u8], y0: u32, y1: u32) -> f64 {
    let mut sum = 0.0;
    let mut n = 0;
    for y in y0..y1 {
        for x in 0..W - 1 {
            sum += (luma(px, x, y) - luma(px, x + 1, y)).abs();
            n += 1;
        }
    }
    sum / n as f64
}

#[test]
fn painted_ground_has_strokes_near_and_is_calm_far_off() {
    let Some(mut gfx) = gfx() else { return };
    let plain = gfx.upload_mesh(&ground(400.0, 4.0, 0.0));
    let painted = gfx.upload_mesh(&ground(400.0, 4.0, 3.0));
    // standing on it: the lower half of the picture is ground within about 6 m
    let near = |gfx: &mut Gfx, m| shoot(gfx, m, [0.0, 1.7, 0.0], [0.0, 0.0, -6.0], 50.0, 0.0);
    let (pm, ps, pn) = stats(&near(&mut gfx, plain), 0, H / 2, W, H);
    let (gm, gs, gn) = stats(&near(&mut gfx, painted), 0, H / 2, W, H);
    assert!(pn > 1000 && gn > 1000);
    assert!(
        gs > ps + 2.0,
        "painted ground varies (sd {gs:.2}) more than plain ground (sd {ps:.2})"
    );
    assert!(
        (gm - pm).abs() < pm * 0.15,
        "painted ground ({gm:.1}) stays about as bright as plain ({pm:.1})"
    );
    // from 300 m up (a pixel spans more than half a metre): no strokes, so neighbouring pixels are nearly alike
    let far = shoot(
        &mut gfx,
        painted,
        [0.0, 300.0, 0.1],
        [0.0, 0.0, 0.0],
        40.0,
        0.0,
    );
    let g = grain(&far, 0, H);
    assert!(g < 1.5, "far ground is calm: {g:.2} levels a pixel");
}

#[test]
fn a_painted_crown_is_varied_and_never_glows() {
    let Some(mut gfx) = gfx() else { return };
    let plain = gfx.upload_mesh(&ball([0.0, 3.0, 0.0], 2.0, 0.0));
    let crown = gfx.upload_mesh(&ball([0.0, 3.0, 0.0], 2.0, 1.0));
    let canopy = gfx.upload_mesh(&ball([0.0, 3.0, 0.0], 2.0, 2.0));
    let look = |gfx: &mut Gfx, m| shoot(gfx, m, [0.0, 3.5, 9.0], [0.0, 3.0, 0.0], 35.0, 0.0);
    let (pm, ps, pn) = stats(&look(&mut gfx, plain), 0, 0, W, H);
    for (name, m) in [("crown", crown), ("canopy", canopy)] {
        let (cm, cs, cn) = stats(&look(&mut gfx, m), 0, 0, W, H);
        assert!(
            cn > 5000 && (cn as f64 - pn as f64).abs() < pn as f64 * 0.02,
            "{name}: the same shape is drawn"
        );
        // (a kind read as a glow of 1000 would be white: the mean would be far above the plain ball's)
        assert!(
            cm < pm * 1.3 && cm > pm * 0.65,
            "{name}: about as bright as plain ({cm:.1} against {pm:.1})"
        );
        assert!(
            cs > ps * 1.1,
            "{name}: more light and dark (sd {cs:.2}) than the plain ball (sd {ps:.2})"
        );
    }
}

#[test]
fn painted_water_froths_where_shallow_and_runs_downstream() {
    let Some(mut gfx) = gfx() else { return };
    let water = gfx.upload_mesh(&stream());
    // from above, the stream along the picture's vertical: the shallow outer metre each side against the deep middle
    let shot =
        |gfx: &mut Gfx, t: f32| shoot(gfx, water, [0.0, 14.0, 0.01], [0.0, 0.0, 0.0], 30.0, t);
    let a = shot(&mut gfx, 0.0);
    let metres_per_px = 2.0 * 14.0 * (15f32.to_radians()).tan() / H as f32;
    let col = |m: f32| (W as f32 / 2.0 + m / metres_per_px) as u32;
    let (deep, _, dn) = stats(&a, col(-1.0), H / 4, col(1.0), 3 * H / 4);
    let (edge, _, en) = stats(&a, col(2.6), H / 4, col(2.95), 3 * H / 4);
    assert!(dn > 100 && en > 20);
    assert!(
        edge > deep + 25.0,
        "foam along the shallow edge ({edge:.1}) is much lighter than the deep middle ({deep:.1})"
    );
    // a second later the ripples have moved on
    let b = shot(&mut gfx, 1.0);
    let mut moved = 0.0;
    let mut n = 0.0;
    for y in H / 4..3 * H / 4 {
        for x in col(-1.5)..col(1.5) {
            moved += (luma(&a, x, y) - luma(&b, x, y)).abs();
            n += 1.0;
        }
    }
    assert!(
        moved / n > 0.5,
        "the water moves: {:.2} levels a pixel",
        moved / n
    );
}

/// A flat quad between four corners (counter-clockwise seen from the front, whose normal is `n`), in one colour, painted as `kind`.
fn quad(c: [[f32; 3]; 4], n: [f32; 3], color: [u8; 4], kind: f32) -> MeshData {
    let uv = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
    MeshData {
        vertices: (0..4)
            .map(|i| vertex(c[i], n, color, uv[i], kind * PAINT_STEP))
            .collect(),
        indices: vec![0, 1, 2, 0, 2, 3],
        ..Default::default()
    }
}

/// The three building kinds (wood 5, roof 6, stone 7; "Painted surfaces"): near a wall they add light-and-dark of boards, tiles and
/// stones to the plain surface without changing how bright it is, and seen from far off, where a board is under a pixel, they are as
/// calm as plain paint.
#[test]
fn painted_walls_roofs_and_stone_vary_near_and_are_calm_far_off() {
    let Some(mut gfx) = gfx() else { return };
    // a wall facing +z, 8 m wide and 3 m high; a roof slope (0.6 rise a metre, facing up and to +z) of the same width; and a big wall
    let wall = |kind: f32, color: [u8; 4]| {
        quad(
            [
                [-4.0, 0.0, 0.0],
                [4.0, 0.0, 0.0],
                [4.0, 3.0, 0.0],
                [-4.0, 3.0, 0.0],
            ],
            [0.0, 0.0, 1.0],
            color,
            kind,
        )
    };
    let slope = |kind: f32, color: [u8; 4]| {
        let n = [0.0, 1.0, 0.6f32];
        let l = (n[1] * n[1] + n[2] * n[2]).sqrt();
        quad(
            [
                [-4.0, 0.0, 0.0],
                [4.0, 0.0, 0.0],
                [4.0, 3.0, -1.8],
                [-4.0, 3.0, -1.8],
            ],
            [0.0, n[1] / l, n[2] / l],
            color,
            kind,
        )
    };
    let cases: [(&str, f32, [u8; 4], bool); 3] = [
        ("wood", 5.0, [176, 130, 84, 255], false),
        ("roof", 6.0, [120, 62, 52, 255], true),
        ("stone", 7.0, [138, 134, 126, 255], false),
    ];
    for (name, kind, color, roof) in cases {
        let make = |k: f32| {
            if roof {
                slope(k, color)
            } else {
                wall(k, color)
            }
        };
        let plain = gfx.upload_mesh(&make(0.0));
        let painted = gfx.upload_mesh(&make(kind));
        let near = |gfx: &mut Gfx, m| shoot(gfx, m, [0.0, 3.2, 5.0], [0.0, 1.5, 0.0], 45.0, 0.0);
        let (pm, ps, pn) = stats(&near(&mut gfx, plain), 0, 0, W, H);
        let (gm, gs, gn) = stats(&near(&mut gfx, painted), 0, 0, W, H);
        assert!(
            pn > 5000 && (gn as f64 - pn as f64).abs() < pn as f64 * 0.02,
            "{name}: the same shape is drawn"
        );
        assert!(
            gs > ps + 2.0,
            "{name}: painted varies (sd {gs:.2}) more than plain (sd {ps:.2})"
        );
        assert!(
            (gm - pm).abs() < pm * 0.15,
            "{name}: about as bright as plain ({gm:.1} against {pm:.1})"
        );
    }
    // far off: a wall 400 m wide seen from 400 m back, a pixel spans over half a metre: no boards, tiles or stones to see
    for (name, kind, color, roof) in cases {
        let big = if roof {
            quad(
                [
                    [-200.0, 0.0, 0.0],
                    [200.0, 0.0, 0.0],
                    [200.0, 150.0, -90.0],
                    [-200.0, 150.0, -90.0],
                ],
                [0.0, 0.857, 0.514],
                color,
                kind,
            )
        } else {
            quad(
                [
                    [-200.0, 0.0, 0.0],
                    [200.0, 0.0, 0.0],
                    [200.0, 150.0, 0.0],
                    [-200.0, 150.0, 0.0],
                ],
                [0.0, 0.0, 1.0],
                color,
                kind,
            )
        };
        let m = gfx.upload_mesh(&big);
        let far = shoot(&mut gfx, m, [0.0, 60.0, 400.0], [0.0, 60.0, 0.0], 40.0, 0.0);
        let g = grain(&far, 0, H);
        assert!(g < 1.5, "{name}: far off it is calm: {g:.2} levels a pixel");
    }
}

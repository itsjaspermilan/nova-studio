//! Grass on the real GPU path (`nova.grass`, gfx/grass.rs, shaders/grass.wgsl): blades stand over the ground near the camera and
//! are gone past `distance`; none grow where the map is black; they take the colour grid's colour; they sway with the wind and bend
//! away from a bending point; they cost triangles only for the squares in view. Skips (passes with a note) without a usable adapter.

use std::sync::Arc;

use nova_runtime::gfx::{
    Camera, FrameInput, FrameStats, Gfx, Grass, GroundPicture, Lighting, ModelDraw, ModelInstance,
    Wind,
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

/// A flat square of plain ground `size` metres across, in one dark brown (so green blades stand out on it).
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
                color: [90, 60, 40, 255],
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

fn shoot(
    gfx: &mut Gfx,
    mesh: usize,
    grass: Option<Grass>,
    eye: [f32; 3],
    target: [f32; 3],
    wind: f32,
    time: f32,
) -> (Vec<u8>, FrameStats) {
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
        time,
        ui_models: &[],
        lighting: Lighting {
            direction: [0.35, -0.8, 0.3],
            color: [1.0, 0.97, 0.92],
            ambient: [0.45, 0.47, 0.52],
            wind: Wind {
                direction: [1.0, 0.0],
                strength: wind,
                time,
            },
            grass,
            ..Default::default()
        },
        sprites_front: &[],
        text: &[],
        world_height: 0,
    };
    gfx.capture_with_stats((W, H), &input)
}

fn px(p: &[u8], x: u32, y: u32) -> [f64; 3] {
    let i = ((y * W + x) * 4) as usize;
    [p[i] as f64, p[i + 1] as f64, p[i + 2] as f64]
}

/// The share of pixels in a rectangle that are green (the blades) rather than the brown ground.
fn green_share(p: &[u8], x0: u32, y0: u32, x1: u32, y1: u32) -> f64 {
    let mut n = 0;
    let mut g = 0;
    for y in y0..y1 {
        for x in x0..x1 {
            let [r, gg, b] = px(p, x, y);
            n += 1;
            if gg > r + 10.0 && gg > b {
                g += 1;
            }
        }
    }
    g as f64 / n as f64
}

fn green_grass() -> Grass {
    Grass {
        color: [0.35, 0.62, 0.2],
        ..Default::default()
    }
}

#[test]
fn grass_grows_near_the_camera_and_not_past_its_distance() {
    let Some(mut gfx) = gfx() else { return };
    let mesh = gfx.upload_mesh(&ground(200.0));
    let eye = [0.0, 1.6, 0.0];
    let look = [0.0, 0.6, -6.0];
    let (bare, bare_stats) = shoot(&mut gfx, mesh, None, eye, look, 0.0, 0.0);
    let (grassy, stats) = shoot(&mut gfx, mesh, Some(green_grass()), eye, look, 0.0, 0.0);
    // the lower half (ground within a few metres): brown without grass, mostly green blades with it
    assert!(green_share(&bare, 0, H / 2, W, H) < 0.01);
    let near = green_share(&grassy, 0, H / 2, W, H);
    assert!(near > 0.6, "blades cover the near ground: {near:.2}");
    assert!(
        stats.triangles > bare_stats.triangles + 10_000,
        "the grass is drawn ({} triangles against {})",
        stats.triangles,
        bare_stats.triangles
    );
    // grass that ends at 12 m: looking down at the ground 20 m away there is none
    let short = Grass {
        distance: 12.0,
        ..green_grass()
    };
    let (far, _) = shoot(
        &mut gfx,
        mesh,
        Some(short),
        [0.0, 6.0, 0.0],
        [0.0, 0.0, -20.0],
        0.0,
        0.0,
    );
    let centre = green_share(&far, W / 2 - 40, H / 2 - 30, W / 2 + 40, H / 2 + 30);
    assert!(centre < 0.02, "no grass past its distance: {centre:.3}");
}

#[test]
fn the_map_keeps_grass_off_and_the_colour_grid_colours_it() {
    let Some(mut gfx) = gfx() else { return };
    let mesh = gfx.upload_mesh(&ground(200.0));
    // a map 40 m across: grass on the left half (x < 0), none on the right
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
    // colours: a red grid (blades on it come out red, not the plain green)
    let colors = Arc::new(GroundPicture {
        width: 3,
        rows: 3,
        x0: -40.0,
        z0: -40.0,
        cell: 40.0,
        texels: [200u8, 40, 30, 255].repeat(9),
    });
    let grass = Grass {
        map: Some(map),
        colors: Some(colors),
        ..green_grass()
    };
    // from above, the middle of the picture straddles x = 0
    let (shot, _) = shoot(
        &mut gfx,
        mesh,
        Some(grass),
        [0.0, 12.0, 0.01],
        [0.0, 0.0, 0.0],
        0.0,
        0.0,
    );
    let red = |x0: u32, x1: u32| {
        let mut n = 0;
        let mut k = 0;
        for y in H / 4..3 * H / 4 {
            for x in x0..x1 {
                let [r, g, b] = px(&shot, x, y);
                n += 1;
                if r > g + 40.0 && r > b + 40.0 {
                    k += 1;
                }
            }
        }
        k as f64 / n as f64
    };
    let left = red(W / 2 - 120, W / 2 - 30);
    let right = red(W / 2 + 30, W / 2 + 120);
    assert!(
        left > 0.1,
        "blades grow where the map is white, in the grid's red: {left:.2}"
    );
    assert!(right < 0.01, "none where it is black: {right:.3}");
    assert!(
        green_share(&shot, 0, 0, W, H) < 0.01,
        "no blade keeps the plain colour"
    );
}

#[test]
fn grass_sways_in_the_wind_and_bends_away_from_a_point() {
    let Some(mut gfx) = gfx() else { return };
    let mesh = gfx.upload_mesh(&ground(200.0));
    let eye = [0.0, 1.2, 4.0];
    let look = [0.0, 0.3, 0.0];
    let diff = |a: &[u8], b: &[u8]| {
        let mut sum = 0.0;
        for y in 0..H {
            for x in 0..W {
                let (p, q) = (px(a, x, y), px(b, x, y));
                sum += (p[1] - q[1]).abs();
            }
        }
        sum / (W * H) as f64
    };
    let calm0 = shoot(&mut gfx, mesh, Some(green_grass()), eye, look, 0.0, 0.0).0;
    let calm1 = shoot(&mut gfx, mesh, Some(green_grass()), eye, look, 0.0, 1.3).0;
    assert!(
        diff(&calm0, &calm1) < 0.01,
        "no wind: the grass stands still"
    );
    let windy0 = shoot(&mut gfx, mesh, Some(green_grass()), eye, look, 1.2, 0.0).0;
    let windy1 = shoot(&mut gfx, mesh, Some(green_grass()), eye, look, 1.2, 1.3).0;
    let moved = diff(&windy0, &windy1);
    assert!(moved > 1.0, "in the wind it sways: {moved:.2}");
    // a bending point in the middle of the picture: the blades there lean away, the ground shows through
    let bent = Grass {
        bends: vec![[0.0, 0.0, 0.0, 1.5]],
        ..green_grass()
    };
    let (straight, _) = shoot(
        &mut gfx,
        mesh,
        Some(green_grass()),
        [0.0, 3.0, 2.5],
        look,
        0.0,
        0.0,
    );
    let (pressed, _) = shoot(&mut gfx, mesh, Some(bent), [0.0, 3.0, 2.5], look, 0.0, 0.0);
    let (cx, cy) = (W / 2, H / 2);
    let a = green_share(&straight, cx - 25, cy - 25, cx + 25, cy + 25);
    let b = green_share(&pressed, cx - 25, cy - 25, cx + 25, cy + 25);
    assert!(
        b < a - 0.15,
        "pressed grass leaves the ground showing ({b:.2} green against {a:.2})"
    );
}

#[test]
fn grass_behind_the_camera_costs_nothing() {
    let Some(mut gfx) = gfx() else { return };
    let mesh = gfx.upload_mesh(&ground(200.0));
    let (_, ahead) = shoot(
        &mut gfx,
        mesh,
        Some(green_grass()),
        [0.0, 1.6, 0.0],
        [0.0, 0.6, -6.0],
        0.0,
        0.0,
    );
    // looking up at the sky: only the squares round the camera's own foot are kept (their bounds reach the eye), not the
    // meadow ahead
    let (_, up) = shoot(
        &mut gfx,
        mesh,
        Some(green_grass()),
        [0.0, 1.6, 0.0],
        [0.0, 30.0, -1.0],
        0.0,
        0.0,
    );
    let (_, none) = shoot(
        &mut gfx,
        mesh,
        None,
        [0.0, 1.6, 0.0],
        [0.0, 30.0, -1.0],
        0.0,
        0.0,
    );
    let grass_up = up.triangles - none.triangles;
    let grass_ahead = ahead.triangles - none.triangles;
    assert!(
        grass_up * 3 < grass_ahead,
        "out of view, most grass is not drawn: {grass_up} triangles looking up against {grass_ahead} looking ahead"
    );
}

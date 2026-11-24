//! The sky and the haze on the real GPU path (`sky.wgsl`, `mesh.wgsl` `fog_over`): the sun drawn in the sky stands exactly where the
//! light comes from (so it agrees with the shadows), in the plain and the painted sky; the haze grows with distance, is complete
//! at the fog's far end, and leaves the near scene alone; and a plain fog (no haze options) draws as it always did. Skips (passes
//! with a note) without a usable adapter.

use glam::{Mat4, Vec3, Vec4};
use nova_runtime::gfx::{
    Camera, Fog, FrameInput, Gfx, Haze, Lighting, ModelDraw, ModelInstance, Sky,
};
use nova_runtime::model::{MeshData, MeshVertex};

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

const W: u32 = 320;
const H: u32 = 240;
const FOV: f32 = 50.0;

fn shot(gfx: &mut Gfx, camera: Camera, lighting: Lighting, models: &[ModelDraw]) -> Vec<u8> {
    let input = FrameInput {
        clear: [0.0, 0.0, 0.0, 1.0],
        camera,
        sprites_back: &[],
        models,
        joints: &[],
        mesh_ops: &[],
        shaded_models: &[],
        shaded_sprites: &[],
        post: None,
        texture_ops: &[],
        time: 0.0,
        ui_models: &[],
        lighting,
        sprites_front: &[],
        text: &[],
        world_height: 0,
    };
    gfx.capture((W, H), &input)
}

/// Where a direction from the eye lands on the picture (pixels from the top left), as the renderer projects it.
fn project(camera: &Camera, dir: Vec3, far: f32) -> (f32, f32) {
    let vp = glam::camera::rh::proj::directx::perspective(
        FOV.to_radians(),
        W as f32 / H as f32,
        0.1,
        far,
    ) * glam::camera::rh::view::look_at_mat4(camera.eye, camera.target, Vec3::Y);
    let c: Vec4 = vp * (camera.eye + dir * 50.0).extend(1.0);
    let (x, y) = (c.x / c.w, c.y / c.w);
    ((x * 0.5 + 0.5) * W as f32, (0.5 - y * 0.5) * H as f32)
}

/// The middle of the brightest pixels of the picture.
fn brightest(pixels: &[u8]) -> (f32, f32) {
    let lum = |i: usize| pixels[i] as u32 + pixels[i + 1] as u32 + pixels[i + 2] as u32;
    let top = (0..(W * H) as usize).map(|p| lum(p * 4)).max().unwrap();
    let (mut sx, mut sy, mut n) = (0.0, 0.0, 0.0);
    for p in 0..(W * H) as usize {
        if lum(p * 4) + 6 >= top {
            sx += (p as u32 % W) as f32 + 0.5;
            sy += (p as u32 / W) as f32 + 0.5;
            n += 1.0;
        }
    }
    (sx / n, sy / n)
}

#[test]
fn the_sun_in_the_sky_stands_where_the_light_comes_from() {
    let Some(mut gfx) = gpu() else { return };
    let light = Vec3::new(-0.5, -0.42, -0.62).normalize();
    let to_sun = -light;
    // looking a little to the side of the sun and below it, so it is not in the middle of the picture
    let side = to_sun.cross(Vec3::Y).normalize();
    let eye = Vec3::new(0.0, 1.5, 0.0);
    let camera = Camera {
        eye,
        target: eye + (to_sun + side * 0.12 - Vec3::Y * 0.08).normalize() * 10.0,
        fov_y_degrees: FOV,
    };
    let expected = project(&camera, to_sun, 400.0);
    for painted in [false, true] {
        let lighting = Lighting {
            direction: light.to_array(),
            sky: Some(Sky {
                top: [0.1, 0.3, 0.7],
                horizon: [0.6, 0.7, 0.8],
                // a sun given by hand is ignored when it follows the light
                sun: Some([1.0, 0.2, 0.0]),
                sun_from_light: true,
                painted,
                ..Default::default()
            }),
            ..Default::default()
        };
        let pixels = shot(&mut gfx, camera, lighting, &[]);
        let (x, y) = brightest(&pixels);
        let off = (x - expected.0).hypot(y - expected.1);
        assert!(
            off < 2.5,
            "the {} sky's sun is at {x:.1}, {y:.1}; the light comes from {:.1}, {:.1} ({off:.1} px off)",
            if painted { "painted" } else { "plain" },
            expected.0,
            expected.1
        );
        assert!(
            (expected.0 - W as f32 / 2.0).abs() > 10.0,
            "the sun is off the middle, so the check means something"
        );
    }
}

/// A flat board facing +z, `s` metres square, at the origin of its own space.
fn board(s: f32) -> MeshData {
    let v = |x: f32, y: f32| MeshVertex {
        position: [x * s, y * s, 0.0],
        normal: [0.0, 0.0, 1.0],
        color: [255; 4],
        uv: [0.0, 0.0],
        emissive: 1.0,
    };
    MeshData {
        vertices: vec![v(-0.5, -0.5), v(0.5, -0.5), v(0.5, 0.5), v(-0.5, 0.5)],
        indices: vec![0, 1, 2, 0, 2, 3],
        ..Default::default()
    }
}

#[test]
fn the_haze_grows_with_distance_and_leaves_the_near_scene_alone() {
    let Some(mut gfx) = gpu() else { return };
    let mesh = gfx.upload_mesh(&board(1.0));
    // red boards at growing distances straight ahead, each as wide on the picture as the others (its size grows with distance),
    // side by side
    let distances = [20.0f32, 70.0, 140.0, 220.0, 300.0, 390.0];
    let eye = Vec3::new(0.0, 2.0, 0.0);
    let camera = Camera {
        eye,
        target: eye + Vec3::new(0.0, 0.0, -1.0),
        fov_y_degrees: FOV,
    };
    let tan = (FOV.to_radians() * 0.5).tan();
    let aspect = W as f32 / H as f32;
    let place = |i: usize, d: f32| -> Vec3 {
        // across the picture, from -0.75 to 0.75 of its half width
        let u = -0.75 + 1.5 * i as f32 / (distances.len() - 1) as f32;
        Vec3::new(u * d * tan * aspect, eye.y, -d)
    };
    let draws: Vec<ModelDraw> = distances
        .iter()
        .enumerate()
        .map(|(i, &d)| ModelDraw {
            casts: false,
            mesh,
            instance: ModelInstance {
                matrix: (Mat4::from_translation(place(i, d))
                    * Mat4::from_scale(Vec3::splat(d * 0.12)))
                .to_cols_array_2d(),
                tint: [1.0, 0.0, 0.0, 1.0],
            },
        })
        .collect();
    let fog_colour = [0.6f32, 0.7, 0.8];
    let fog = |haze: Option<Haze>| Fog {
        color: fog_colour,
        near: 50.0,
        far: 380.0,
        haze,
    };
    let haze = Haze {
        height: 20.0,
        floor: 0.0,
        desaturate: 0.3,
        sun: 0.4,
    };
    let away = |pixels: &[u8]| -> Vec<f32> {
        (0..distances.len())
            .map(|i| {
                let c = project(&camera, (place(i, distances[i]) - eye).normalize(), 400.0);
                let p = ((c.1 as u32) * W + c.0 as u32) as usize * 4;
                let rgb: Vec<f32> = (0..3)
                    .map(|k| (pixels[p + k] as f32 / 255.0).powf(2.2))
                    .collect();
                (0..3)
                    .map(|k| (rgb[k] - fog_colour[k]).powi(2))
                    .sum::<f32>()
                    .sqrt()
            })
            .collect()
    };
    for f in [fog(None), fog(Some(haze))] {
        let lighting = Lighting {
            direction: Vec3::new(0.3, -0.6, 0.7).normalize().to_array(),
            fog: Some(f),
            ..Default::default()
        };
        let pixels = shot(&mut gfx, camera, lighting, &draws);
        let gap = away(&pixels);
        // nearer than the start: the board's own red, untouched; then ever nearer the haze; past the end, the haze itself
        assert!(gap[0] > 0.6, "the near board keeps its colour: {gap:?}");
        for w in gap.windows(2) {
            assert!(
                w[1] < w[0] - 0.02,
                "farther is hazier: {gap:?} ({:?})",
                f.haze
            );
        }
        assert!(
            gap[5] < 0.05,
            "at the end of the view only the haze is left: {gap:?}"
        );
        // and the CPU's sum says the same, rising from 0 at the start to 1 at the end
        let amounts: Vec<f32> = [40.0, 60.0, 120.0, 200.0, 300.0, 380.0]
            .iter()
            .map(|&d| f.amount(d, 2.0, 2.0))
            .collect();
        assert_eq!(amounts[0], 0.0);
        assert!((amounts[5] - 1.0).abs() < 1e-4, "{amounts:?}");
        for w in amounts.windows(2) {
            assert!(w[1] > w[0], "{amounts:?}");
        }
    }
    // the haze is thicker low in the valley than high above it, at the same distance
    let f = fog(Some(haze));
    assert!(f.amount(150.0, 2.0, 2.0) > f.amount(150.0, 60.0, 60.0) + 0.05);
    // and it starts gently: at 100 m it is less than a quarter there, by 300 m most of the way
    assert!(
        f.amount(100.0, 10.0, 10.0) < 0.25,
        "{}",
        f.amount(100.0, 10.0, 10.0)
    );
    assert!(
        f.amount(300.0, 10.0, 10.0) > 0.7,
        "{}",
        f.amount(300.0, 10.0, 10.0)
    );
}

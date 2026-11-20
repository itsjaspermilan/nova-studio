//! The opt-in graphics settings on the real GPU path: each setting draws a picture (nothing panics, no validation error), MSAA and cascaded
//! shadows leave a lit, shadowed scene looking like the plain one, and HDR keeps it in the same family (the tone curve changes the tones, not
//! the picture). Skips (passes with a note) when the machine has no usable adapter or a setting is unavailable on it.

use nova_runtime::gfx::{
    Camera, FrameInput, Gfx, Lighting, ModelDraw, ModelInstance, Quality, Shadows, Sky,
};
use nova_runtime::model::{MeshData, MeshVertex};

/// A box on a ground plane: something to light and to cast a shadow.
fn scene_meshes() -> (MeshData, MeshData) {
    let quad = |y: f32, half: f32| {
        let corner = |x: f32, z: f32| MeshVertex {
            position: [x, y, z],
            normal: [0.0, 1.0, 0.0],
            color: [200, 190, 160, 255],
            uv: [0.0, 0.0],
            emissive: 0.0,
        };
        MeshData {
            vertices: vec![
                corner(-half, half),
                corner(half, half),
                corner(half, -half),
                corner(-half, -half),
            ],
            indices: vec![0, 1, 2, 0, 2, 3],
            ..Default::default()
        }
    };
    let ground = quad(0.0, 30.0);
    // a pillar: four tall sides
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    for (nx, nz) in [(1.0f32, 0.0f32), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
        let base = vertices.len() as u32;
        let (tx, tz) = (-nz, nx);
        for (h, s) in [(0.0, -1.0), (0.0, 1.0), (4.0, 1.0), (4.0, -1.0)] {
            vertices.push(MeshVertex {
                position: [nx + tx * s, h, nz + tz * s],
                normal: [nx, 0.0, nz],
                color: [160, 60, 50, 255],
                uv: [0.0, 0.0],
                emissive: 0.0,
            });
        }
        indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    (
        ground,
        MeshData {
            vertices,
            indices,
            ..Default::default()
        },
    )
}

fn render(gfx: &mut Gfx, quality: Quality) -> Vec<u8> {
    let (ground, pillar) = scene_meshes();
    let (g, p) = (gfx.upload_mesh(&ground), gfx.upload_mesh(&pillar));
    let at = |x: f32, z: f32| ModelInstance {
        matrix: glam::Mat4::from_translation(glam::Vec3::new(x, 0.0, z)).to_cols_array_2d(),
        tint: [1.0; 4],
    };
    let mut draws = vec![ModelDraw {
        casts: false,
        mesh: g,
        instance: at(0.0, 0.0),
    }];
    for (x, z) in [(0.0, 0.0), (6.0, -8.0), (-7.0, -20.0)] {
        draws.push(ModelDraw {
            casts: true,
            mesh: p,
            instance: at(x, z),
        });
    }
    let lighting = Lighting {
        direction: glam::Vec3::new(-0.6, -0.7, -0.3).normalize().to_array(),
        sky: Some(Sky {
            top: [0.2, 0.4, 0.8],
            horizon: [0.7, 0.8, 0.9],
            sun: Some([0.6, 0.7, 0.3]),
            stars: 0.0,
            clouds: 0.0,
            time: 0.0,
            ground: None,
        }),
        shadows: Some(Shadows {
            radius: 20.0,
            strength: 0.6,
        }),
        quality,
        ..Default::default()
    };
    let input = FrameInput {
        clear: [0.0, 0.0, 0.0, 1.0],
        camera: Camera {
            eye: glam::Vec3::new(0.0, 6.0, 14.0),
            target: glam::Vec3::new(0.0, 1.5, -6.0),
            fov_y_degrees: 60.0,
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
        lighting,
        sprites_front: &[],
        text: &[],
        world_height: 270,
    };
    gfx.capture((480, 270), &input)
}

fn mean_difference(a: &[u8], b: &[u8]) -> f64 {
    let total: u64 = a
        .iter()
        .zip(b)
        .map(|(x, y)| (i32::from(*x) - i32::from(*y)).unsigned_abs() as u64)
        .sum();
    total as f64 / a.len() as f64
}

#[test]
fn every_setting_draws_and_the_picture_stays_the_picture() {
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
    let plain = render(&mut gfx, Quality::default());
    assert!(plain.iter().any(|v| *v > 40), "the plain picture is dark");
    let settings = [
        (
            "hdr",
            Quality {
                hdr: true,
                ..Quality::default()
            },
            40.0,
        ),
        (
            "msaa 4",
            Quality {
                msaa: 4,
                ..Quality::default()
            },
            4.0,
        ),
        (
            "2 cascades",
            Quality {
                cascades: 2,
                ..Quality::default()
            },
            8.0,
        ),
        (
            "3 cascades",
            Quality {
                cascades: 3,
                ..Quality::default()
            },
            8.0,
        ),
        (
            "ibl",
            Quality {
                ibl: true,
                ..Quality::default()
            },
            2.0,
        ),
        (
            "anisotropy",
            Quality {
                aniso: 16,
                ..Quality::default()
            },
            2.0,
        ),
        (
            "everything",
            Quality {
                hdr: true,
                msaa: 4,
                cascades: 3,
                ibl: true,
                aniso: 16,
            },
            40.0,
        ),
    ];
    for (name, quality, limit) in settings {
        let picture = render(&mut gfx, quality);
        let d = mean_difference(&plain, &picture);
        eprintln!(
            "{name}: mean difference from plain {d:.2}, in force {:?}",
            gfx.quality
        );
        assert!(picture.iter().any(|v| *v > 40), "{name}: dark picture");
        assert!(
            d < limit,
            "{name}: differs from the plain picture by {d:.2} (limit {limit})"
        );
    }
    // going back to plain gives the first picture again
    let again = render(&mut gfx, Quality::default());
    assert!(
        mean_difference(&plain, &again) < 0.5,
        "plain after the others is not plain"
    );
}

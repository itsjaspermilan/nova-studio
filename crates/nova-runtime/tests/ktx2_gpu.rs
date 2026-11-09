//! A compressed (ETC2, from KTX2) base colour picture on the real GPU path: a quad textured with it must look like the same quad
//! textured with the RGBA8 picture it was made from, within what a 4-bits-a-pixel encoding loses; and a GPU without ETC2 falls back to
//! the plain picture (the test then only checks that nothing breaks). Skips when the machine has no usable adapter.

use nova_runtime::gfx::{Camera, FrameInput, Gfx, Lighting, ModelDraw, ModelInstance};
use nova_runtime::ktx2;
use nova_runtime::model::{Image, MeshData, MeshVertex};

fn picture() -> Image {
    let (w, h) = (64u32, 64u32);
    let mut rgba = Vec::new();
    for y in 0..h {
        for x in 0..w {
            // a smooth colour field with a hard edge and some fine detail: what a texture is
            let checker = if (x / 8 + y / 8) % 2 == 0 { 30 } else { 0 };
            rgba.extend_from_slice(&[
                (x * 255 / (w - 1)) as u8,
                (y * 255 / (h - 1)) as u8,
                (110 + checker + ((x * 7 + y * 3) % 17) as i32).min(255) as u8,
                255,
            ]);
        }
    }
    Image {
        width: w,
        height: h,
        rgba,
    }
}

fn quad() -> MeshData {
    let corner = |x: f32, y: f32| MeshVertex {
        position: [x, y, 0.0],
        normal: [0.0, 0.0, 1.0],
        color: [255; 4],
        uv: [(x + 1.0) / 2.0, 1.0 - (y + 1.0) / 2.0],
        emissive: 1.0,
    };
    MeshData {
        vertices: vec![
            corner(-1.0, -1.0),
            corner(1.0, -1.0),
            corner(1.0, 1.0),
            corner(-1.0, 1.0),
        ],
        indices: vec![0, 1, 2, 0, 2, 3],
        smooth: true,
        ..Default::default()
    }
}

fn render(gfx: &mut Gfx, mesh: &MeshData) -> Vec<u8> {
    let id = gfx.upload_mesh(mesh);
    let draws = [ModelDraw {
        casts: false,
        mesh: id,
        instance: ModelInstance {
            matrix: glam::Mat4::IDENTITY.to_cols_array_2d(),
            tint: [1.0; 4],
        },
    }];
    let input = FrameInput {
        clear: [0.0, 0.0, 0.0, 1.0],
        camera: Camera {
            eye: glam::Vec3::new(0.0, 0.0, 2.0),
            target: glam::Vec3::ZERO,
            fov_y_degrees: 53.13, // the quad (2 high) at 2 m away fills the picture
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
        lighting: Lighting::default(),
        sprites_front: &[],
        text: &[],
        world_height: 0,
    };
    gfx.capture((128, 128), &input)
}

#[test]
fn an_etc2_picture_looks_like_the_rgba_one_it_came_from() {
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
    let image = picture();
    let file = ktx2::encode_etc2(&image, true).unwrap();
    let compressed = std::sync::Arc::new(ktx2::parse(&file).unwrap());
    // the compressed file is an eighth of the RGBA8 picture's size, plus its smaller copies
    assert!(
        file.len() * 6 < image.rgba.len() * 2,
        "{} bytes",
        file.len()
    );

    let mut plain = quad();
    plain.texture = Some(image.clone());
    let a = render(&mut gfx, &plain);

    let mut squeezed = quad();
    squeezed.compressed = Some(compressed);
    // (a stand-in picture for a GPU that cannot read ETC2: it must not be what is drawn where ETC2 works)
    squeezed.texture = Some(Image {
        width: 4,
        height: 4,
        rgba: [255, 0, 255, 255].repeat(16),
    });
    let b = render(&mut gfx, &squeezed);

    let has_etc2 = gfx
        .device
        .features()
        .contains(wgpu::Features::TEXTURE_COMPRESSION_ETC2);
    let total: u64 = a
        .as_chunks::<4>()
        .0
        .iter()
        .zip(b.as_chunks::<4>().0.iter())
        .map(|(p, q)| {
            (0..3)
                .map(|c| (i32::from(p[c]) - i32::from(q[c])).unsigned_abs() as u64)
                .sum::<u64>()
        })
        .sum();
    let mean = total as f64 / (a.len() / 4) as f64 / 3.0;
    eprintln!("etc2 supported: {has_etc2}; mean difference per channel: {mean:.2} of 255");
    if has_etc2 {
        assert!(
            mean < 6.0,
            "the compressed picture differs by {mean:.2} on average"
        );
    } else {
        assert!(
            mean > 20.0,
            "the stand-in was expected on a GPU without ETC2"
        );
    }
}

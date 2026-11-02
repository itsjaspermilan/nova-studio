//! Renders the spike offscreen through the real GPU path. Skips (passes with a note)
//! when the machine has no usable adapter, so it is safe on headless CI later.

use nova_runtime::gfx::Gfx;
use nova_runtime::script::{ScriptHost, ScriptState};
use nova_runtime::spike::{self, Perf, Spike};

fn render(size: (u32, u32), world_height: u32) -> Option<(Vec<u8>, (u32, u32))> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let mut gfx = match Gfx::new(&instance, None) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("skipping GPU test: {e}");
            return None;
        }
    };
    let mut spike = Spike::new(&mut gfx).expect("spike");
    let script = ScriptHost::new(spike::MAIN_LUA.to_string(), "main.lua".into(), None);
    let state: ScriptState = script.state();
    let hud = spike::hud_text(&spike, &Perf::default(), &state, None, "test");
    spike.build(1.0 / 60.0, size, &state, &hud);
    let pixels = gfx.capture(size, &spike.frame_input(&state, world_height));
    // Capture again to learn the world size the renderer actually used.
    let stats = {
        let texture = gfx.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("probe"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: gfx.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        gfx.render(&view, size, &spike.frame_input(&state, world_height))
    };
    Some((pixels, stats.world_size))
}

fn distinct_colors(pixels: &[u8]) -> usize {
    let mut seen = std::collections::HashSet::new();
    for px in pixels.as_chunks::<4>().0.iter().step_by(7) {
        seen.insert([px[0], px[1], px[2]]);
    }
    seen.len()
}

#[test]
fn world_renders_at_reduced_height_and_upscales_to_the_screen() {
    let size = (640, 360);
    let Some((reduced, world)) = render(size, 180) else {
        return;
    };
    assert_eq!(
        world,
        (320, 180),
        "world target is half the screen height at the same aspect"
    );
    assert_eq!(
        reduced.len(),
        (size.0 * size.1 * 4) as usize,
        "output is full screen size"
    );
    assert!(distinct_colors(&reduced) > 20, "scene is not blank");
    assert!(
        reduced.as_chunks::<4>().0.iter().all(|p| p[3] == 255),
        "output is fully opaque"
    );
}

#[test]
fn zero_or_oversized_world_height_means_native() {
    let size = (640, 360);
    for height in [0, 360, 1080] {
        let Some((pixels, world)) = render(size, height) else {
            return;
        };
        assert_eq!(world, size, "world_height {height} renders at native size");
        assert!(distinct_colors(&pixels) > 20);
    }
}

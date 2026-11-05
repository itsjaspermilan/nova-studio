//! Nova's native runtime. At this stage it is the M1 device spike: a wgpu renderer
//! (2D sprites + low-poly 3D), a Lua gameplay host, an input action layer and audio.

pub mod actions;
pub mod app;
pub mod assets;
pub mod audio;
pub mod bake;
pub mod content;
pub mod diagnostics;
pub mod export;
pub mod font;
pub mod game;
pub mod gfx;
pub mod input;
pub mod inputscript;
pub mod lights;
pub mod mixer;
pub mod model;
pub mod pak;
pub mod project;
pub mod save;
pub mod scene;
pub mod script;
pub mod spike;
pub mod sprite;
pub mod stream;
pub mod terrain;
pub mod text;
pub mod tilemap;
pub mod vfs;
pub mod voxel;
pub mod walls;

#[cfg(target_os = "android")]
pub mod android_ui;

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
fn android_main(android: android_activity::AndroidApp) {
    android_logger::init_once(
        android_logger::Config::default()
            .with_max_level(log::LevelFilter::Info)
            .with_tag("nova"),
    );
    std::panic::set_hook(Box::new(|info| log::error!("panic: {info}")));
    // Hide the status bar; the theme alone leaves it reserved on some devices/profiles.
    android.set_window_flags(
        android_activity::WindowManagerFlags::FULLSCREEN,
        android_activity::WindowManagerFlags::empty(),
    );
    android_ui::init(&android);
    android_ui::hide_system_bars();
    // An APK built for a game carries it as assets/project.npk; without one it runs the benchmark.
    let pak = {
        use std::io::Read;
        android
            .asset_manager()
            .open(c"project.npk")
            .and_then(|mut asset| {
                let mut bytes = Vec::new();
                asset.read_to_end(&mut bytes).ok()?;
                log::info!("project.npk: {} bytes", bytes.len());
                Some(app::PakBytes(std::sync::Arc::new(bytes)))
            })
    };
    let options = app::Options {
        save_dir: android.internal_data_path(),
        pak,
        ..app::Options::default()
    };
    if let Err(e) = app::run_windowed(options, android) {
        log::error!("nova exited with an error: {e}");
    }
}

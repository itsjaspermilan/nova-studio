//! Nova's native runtime. At this stage it is the M1 device spike: a wgpu renderer
//! (2D sprites + low-poly 3D), a Lua gameplay host, an input action layer and audio.

pub mod app;
pub mod assets;
pub mod audio;
pub mod content;
pub mod font;
pub mod game;
pub mod gfx;
pub mod input;
pub mod model;
pub mod project;
pub mod script;
pub mod spike;
pub mod vfs;

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
    if let Err(e) = app::run_windowed(app::Options::default(), android) {
        log::error!("nova exited with an error: {e}");
    }
}

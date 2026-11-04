//! Window/event-loop host (desktop and Android) and the headless benchmark runner.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Instant;

use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{
    DeviceEvent, DeviceId, ElementState, MouseButton, MouseScrollDelta, WindowEvent,
};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{CursorGrabMode, Window, WindowId};

use crate::actions::InputFrame;
use crate::audio::{self, AudioOut};
use crate::content::Content;
use crate::gfx::Gfx;
use crate::input::Input;
use crate::spike::Perf;

/// A packed project held in memory (read from an `.npk` file or from the APK's assets).
#[derive(Clone)]
pub struct PakBytes(pub Arc<Vec<u8>>);

impl std::fmt::Debug for PakBytes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PakBytes({} bytes)", self.0.len())
    }
}

#[derive(Clone, Debug)]
pub struct Options {
    pub frames: Option<u32>,
    pub capture: Option<PathBuf>,
    /// A Lua script to run instead of the built-in spike script (spike mode only).
    pub script: Option<PathBuf>,
    /// A Nova project folder to run (`nova run <folder>`).
    pub project: Option<PathBuf>,
    /// A packed project to play instead of a folder (`--pak`, or the Android APK's own).
    pub pak: Option<PakBytes>,
    /// Where save data goes (default: the platform's data folder; in memory when headless).
    pub save_dir: Option<PathBuf>,
    /// Show the stats overlay in project mode (F3 toggles it).
    pub hud: bool,
    pub size: (u32, u32),
    pub uncapped: bool,
    pub no_audio: bool,
    pub headless: bool,
    /// Actions held down for the whole headless run, e.g. `throttle`, `steer=1` (testing).
    pub hold: Vec<String>,
    /// Taps for headless runs: a source held for two frames from the frame given.
    pub press: Vec<(String, u32)>,
    /// Height of the world render target in pixels (UI is always native); 0 = native.
    /// `None` uses the project's `world_height` (540 for the spike).
    pub world_height: Option<u32>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            frames: None,
            capture: None,
            script: None,
            project: None,
            pak: None,
            save_dir: None,
            hud: false,
            size: (1280, 720),
            uncapped: false,
            world_height: None,
            no_audio: false,
            headless: false,
            hold: Vec::new(),
            press: Vec::new(),
        }
    }
}

fn new_instance(backends: wgpu::Backends) -> wgpu::Instance {
    wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    })
}

/// Backends to try in order. Vulkan first on Android (all current handhelds have it) with
/// OpenGL ES as the fallback; native APIs on desktop. `NOVA_BACKEND=vulkan|gl|metal|dx12`
/// forces one on desktop.
fn backend_candidates() -> Vec<wgpu::Backends> {
    if let Ok(name) = std::env::var("NOVA_BACKEND") {
        match name.to_ascii_lowercase().as_str() {
            "vulkan" => return vec![wgpu::Backends::VULKAN],
            "gl" => return vec![wgpu::Backends::GL],
            "metal" => return vec![wgpu::Backends::METAL],
            "dx12" => return vec![wgpu::Backends::DX12],
            other => log::warn!("ignoring unknown NOVA_BACKEND '{other}'"),
        }
    }
    if cfg!(target_os = "android") {
        vec![wgpu::Backends::VULKAN, wgpu::Backends::GL]
    } else {
        vec![wgpu::Backends::PRIMARY]
    }
}

/// Turns `--hold` entries into values forced on actions every frame: `a`, `move_x=-1`,
/// or any action name a project defines.
fn held_actions(hold: &[String]) -> Result<Vec<(String, f32)>, String> {
    hold.iter()
        .filter(|e| !e.is_empty())
        .map(|entry| match entry.split_once('=') {
            Some((name, v)) => v
                .parse::<f32>()
                .map(|v| (name.to_string(), v))
                .map_err(|_| format!("--hold {entry}: '{v}' is not a number")),
            None => Ok((entry.clone(), 1.0)),
        })
        .collect()
}

fn print_summary(label: &str, perf: &Perf) {
    if let Some(s) = perf.summary() {
        println!(
            "{label}: frames={} mean={:.2}ms p95={:.2}ms max={:.2}ms ({:.0} fps mean)",
            s.frames,
            s.mean_ms,
            s.p95_ms,
            s.max_ms,
            1000.0 / s.mean_ms
        );
    }
}

pub fn save_png(path: &std::path::Path, size: (u32, u32), rgba: &[u8]) -> Result<(), String> {
    let file = std::fs::File::create(path)
        .map_err(|e| format!("cannot create {}: {e}", path.display()))?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), size.0, size.1);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(rgba).map_err(|e| e.to_string())
}

/// Renders a fixed number of frames offscreen (no window, no vsync) and reports timings
/// including GPU completion. Deterministic time step, so captures are repeatable.
/// "1.23 / 2.50": the mean and the 95th percentile of some timings.
fn mean_p95(times: &mut [f32]) -> String {
    if times.is_empty() {
        return "-".into();
    }
    let mean = times.iter().sum::<f32>() / times.len() as f32;
    times.sort_by(|a, b| a.total_cmp(b));
    let p95 = times[((times.len() as f32 * 0.95) as usize).min(times.len() - 1)];
    format!("{mean:.2} / {p95:.2}")
}

pub fn run_headless(opts: Options) -> Result<(), String> {
    let instance = new_instance(backend_candidates()[0]);
    let mut gfx = Gfx::new(&instance, None)?;
    let mut content = Content::load(&opts, &mut gfx)?;
    let frames = opts.frames.unwrap_or(120);
    let size = opts.size;
    let target = gfx.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("headless target"),
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
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut perf = Perf::default();
    let dt = 1.0 / 60.0;
    let held = held_actions(&opts.hold)?;
    println!(
        "adapter: {} ({:?})",
        gfx.adapter_info.name, gfx.adapter_info.backend
    );
    println!("content: {}", content.title());
    // where each frame's time went, to show what part of a game is slow (Lua, the rest of the update, or drawing)
    let (mut lua_times, mut build_times, mut render_times) = (Vec::new(), Vec::new(), Vec::new());
    for frame in 0..frames {
        let started = Instant::now();
        let (build_ms, lua_ms) = content.update(
            &mut gfx,
            dt,
            frame as f64 * dt as f64,
            size,
            &InputFrame {
                overrides: held.clone(),
                sources: opts
                    .press
                    .iter()
                    .filter(|(_, at)| frame >= *at && frame < at + 2)
                    .map(|(source, _)| (source.clone(), 1.0))
                    .collect(),
                ..Default::default()
            },
            &perf,
            "off (headless)",
        );
        content.take_audio(); // no audio device here; keep the queue from growing
        content.take_rumble(); // nor a gamepad
        let render_started = Instant::now();
        perf.stats = gfx.render(&view, size, &content.frame_input(opts.world_height));
        content.frame_done();
        gfx.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|e| e.to_string())?;
        perf.times.update_ms = build_ms;
        perf.times.lua_ms = lua_ms;
        perf.times.render_ms = render_started.elapsed().as_secs_f32() * 1000.0;
        lua_times.push(lua_ms);
        build_times.push(build_ms);
        render_times.push(perf.times.render_ms);
        perf.record(started.elapsed().as_secs_f32() * 1000.0);
    }
    print_summary("headless", &perf);
    println!(
        "where the time went (mean / p95 ms): lua {} | update {} | render {}",
        mean_p95(&mut lua_times),
        mean_p95(&mut build_times),
        mean_p95(&mut render_times)
    );
    println!(
        "last frame: draws={} sprites={} triangles={} world={}x{}",
        perf.stats.draw_calls,
        perf.stats.sprites,
        perf.stats.triangles,
        perf.stats.world_size.0,
        perf.stats.world_size.1
    );
    if let Some(error) = content.error() {
        return Err(format!("script error: {error}"));
    }
    if let Some(path) = &opts.capture {
        let pixels = gfx.capture(size, &content.frame_input(opts.world_height));
        save_png(path, size, &pixels)?;
        println!("captured {}", path.display());
    }
    Ok(())
}

struct App {
    opts: Options,
    instance: wgpu::Instance,
    window: Option<Arc<Window>>,
    surface: Option<wgpu::Surface<'static>>,
    config: Option<wgpu::SurfaceConfiguration>,
    gfx: Option<Gfx>,
    content: Option<Content>,
    input: Input,
    perf: Perf,
    last_frame: Instant,
    started: Instant,
    audio: Option<AudioOut>,
    audio_error: Option<String>,
    audio_started: bool,
    frames_done: u32,
    held: Vec<(String, f32)>,
    last_audio_log: Instant,
    finished: bool,
    failed: Option<String>,
}

impl App {
    fn configure(&mut self, width: u32, height: u32) {
        let (Some(surface), Some(gfx)) = (&self.surface, &self.gfx) else {
            return;
        };
        let caps = surface.get_capabilities(&gfx.adapter);
        let present_mode = if self.opts.uncapped {
            [wgpu::PresentMode::Immediate, wgpu::PresentMode::Mailbox]
                .into_iter()
                .find(|m| caps.present_modes.contains(m))
                .unwrap_or(wgpu::PresentMode::Fifo)
        } else {
            wgpu::PresentMode::Fifo
        };
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: gfx.format,
            width: width.max(1),
            height: height.max(1),
            present_mode,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            color_space: wgpu::SurfaceColorSpace::Auto,
        };
        surface.configure(&gfx.device, &config);
        self.input.set_surface_width(config.width as f32);
        log::info!(
            "surface {}x{} {:?} {:?}",
            config.width,
            config.height,
            config.format,
            config.present_mode
        );
        self.config = Some(config);
    }

    /// Locks the cursor to the window and hides it (or frees it), so that the mouse can turn a camera without end. Not every
    /// platform can: macOS and Windows lock, Linux confines; a handheld has no mouse.
    fn set_mouse_grab(window: &Option<Arc<Window>>, input: &mut Input, on: bool) {
        let Some(window) = window else { return };
        let granted = if on {
            window
                .set_cursor_grab(CursorGrabMode::Locked)
                .or_else(|_| window.set_cursor_grab(CursorGrabMode::Confined))
                .is_ok()
        } else {
            let _ = window.set_cursor_grab(CursorGrabMode::None);
            false
        };
        window.set_cursor_visible(!granted);
        input.mouse_locked = granted;
    }

    fn audio_text(&self) -> String {
        if let Some(audio) = &self.audio {
            let s = &audio.stats;
            return format!(
                "{} cb {} max {:.2}ms flt {} err {} voices {} underruns {}",
                audio.description,
                s.callbacks.load(Ordering::Relaxed),
                s.max_callback_micros.load(Ordering::Relaxed) as f32 / 1000.0,
                s.faults.load(Ordering::Relaxed),
                s.stream_errors.load(Ordering::Relaxed),
                s.voices.load(Ordering::Relaxed),
                s.stream_underruns.load(Ordering::Relaxed)
            );
        }
        match &self.audio_error {
            Some(e) => format!("off ({e})"),
            None => "off".into(),
        }
    }

    fn frame(&mut self, event_loop: &ActiveEventLoop) {
        if self.finished {
            return;
        }
        let (Some(config), Some(_)) = (self.config.clone(), self.surface.as_ref()) else {
            return;
        };
        let now = Instant::now();
        let dt = (now - self.last_frame).as_secs_f32().min(0.1);
        self.last_frame = now;
        let size = (config.width, config.height);

        let frame = InputFrame {
            sources: self.input.sources(),
            overrides: self.held.clone(),
            last_source: self.input.last_new_source.take(),
            pointer: self.input.pointer(Gfx::ui_scale(size)),
        };
        let audio = self.audio_text();
        if self.last_audio_log.elapsed().as_secs() >= 2 && self.audio.is_some() {
            self.last_audio_log = Instant::now();
            log::info!("audio: {audio}");
        }
        let music_position = self.audio.as_ref().and_then(|a| {
            (a.stats.music_playing.load(Ordering::Relaxed) == 1)
                .then(|| a.stats.music_position_ms.load(Ordering::Relaxed) as f64 / 1000.0)
        });
        let (Some(gfx), Some(content)) = (self.gfx.as_mut(), self.content.as_mut()) else {
            return;
        };
        content.set_music_position(music_position);
        if self.input.take_toggle_hud() {
            content.toggle_hud();
        }
        let (build_ms, lua_ms) = content.update(
            gfx,
            dt,
            self.started.elapsed().as_secs_f64(),
            size,
            &frame,
            &self.perf,
            &audio,
        );
        for command in content.take_audio() {
            if let Some(out) = &self.audio {
                out.send(command);
            }
        }
        for rumble in content.take_rumble() {
            self.input.rumble(&rumble);
        }
        if let Some(on) = content.take_grab_request() {
            Self::set_mouse_grab(&self.window, &mut self.input, on);
        }

        let surface = self.surface.as_ref().expect("surface checked above");
        let texture = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.configure(config.width, config.height);
                return;
            }
            _ => return,
        };
        let view = texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let render_started = Instant::now();
        self.perf.stats = gfx.render(&view, size, &content.frame_input(self.opts.world_height));
        content.frame_done();
        self.perf.times.render_ms = render_started.elapsed().as_secs_f32() * 1000.0;
        gfx.queue.present(texture);
        self.perf.times.update_ms = build_ms;
        self.perf.times.lua_ms = lua_ms;
        self.perf.record(dt * 1000.0);

        self.frames_done += 1;
        if self.opts.frames.is_some_and(|n| self.frames_done >= n) {
            self.finished = true;
            print_summary("windowed", &self.perf);
            event_loop.exit();
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attributes = Window::default_attributes()
            .with_title("Nova")
            .with_inner_size(LogicalSize::new(self.opts.size.0, self.opts.size.1));
        let window = match event_loop.create_window(attributes) {
            Ok(w) => Arc::new(w),
            Err(e) => {
                self.failed = Some(format!("cannot create window: {e}"));
                event_loop.exit();
                return;
            }
        };
        let mut surface = None;
        if self.gfx.is_none() {
            let mut last_error = String::from("no graphics backend available");
            for backends in backend_candidates() {
                let instance = new_instance(backends);
                let candidate = match instance.create_surface(window.clone()) {
                    Ok(s) => s,
                    Err(e) => {
                        last_error = format!("cannot create surface ({backends:?}): {e}");
                        log::warn!("{last_error}");
                        continue;
                    }
                };
                match Gfx::new(&instance, Some(&candidate)) {
                    Ok(gfx) => {
                        self.instance = instance;
                        self.gfx = Some(gfx);
                        surface = Some(candidate);
                        break;
                    }
                    Err(e) => {
                        last_error = format!("{backends:?}: {e}");
                        log::warn!("graphics backend failed, trying the next: {last_error}");
                    }
                }
            }
            if surface.is_none() {
                self.failed = Some(last_error);
                event_loop.exit();
                return;
            }
        }
        let surface = match surface {
            Some(s) => s,
            None => match self.instance.create_surface(window.clone()) {
                Ok(s) => s,
                Err(e) => {
                    self.failed = Some(format!("cannot create surface: {e}"));
                    event_loop.exit();
                    return;
                }
            },
        };
        if self.content.is_none() {
            let gfx = self.gfx.as_mut().expect("graphics were created above");
            match Content::load(&self.opts, gfx) {
                Ok(content) => self.content = Some(content),
                Err(e) => {
                    self.failed = Some(e);
                    event_loop.exit();
                    return;
                }
            }
        }
        let size = window.inner_size();
        self.window = Some(window);
        self.surface = Some(surface);
        self.configure(size.width, size.height);
        if !self.audio_started && !self.opts.no_audio {
            self.audio_started = true;
            let mixer = self
                .content
                .as_ref()
                .is_some_and(|c| c.plays_sound_effects());
            match audio::start(mixer) {
                Ok(out) => self.audio = Some(out),
                Err(e) => {
                    log::warn!("audio disabled: {e}");
                    self.audio_error = Some(e);
                }
            }
        }
        self.last_frame = Instant::now();
    }

    fn suspended(&mut self, _event_loop: &ActiveEventLoop) {
        // Android destroys the native window while the app is in the background.
        self.surface = None;
        self.config = None;
        self.window = None;
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => self.configure(size.width, size.height),
            WindowEvent::KeyboardInput { event, .. } => {
                // Escape closes the window unless the game uses it (to pause, say)
                let used = self
                    .content
                    .as_ref()
                    .is_some_and(|c| c.uses_source("key:Escape"));
                if event.state == ElementState::Pressed
                    && event.physical_key == PhysicalKey::Code(KeyCode::Escape)
                    && !used
                {
                    event_loop.exit();
                }
                self.input.key(&event);
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.input
                    .cursor_moved(position.x as f32, position.y as f32);
            }
            WindowEvent::CursorLeft { .. } => self.input.cursor_left(),
            WindowEvent::MouseInput { state, button, .. } => {
                let index = match button {
                    MouseButton::Left => 0,
                    MouseButton::Right => 1,
                    MouseButton::Middle => 2,
                    _ => 3,
                };
                self.input
                    .mouse_button(index, state == ElementState::Pressed);
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let lines = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 40.0,
                };
                self.input.mouse_wheel(lines);
            }
            WindowEvent::Touch(touch) => {
                self.input.touch(
                    touch.id,
                    touch.phase,
                    touch.location.x as f32,
                    touch.location.y as f32,
                );
            }
            // Android game controllers: sticks, triggers and the d-pad hat (see vendor/winit/NOVA-PATCH.md).
            #[cfg(target_os = "android")]
            WindowEvent::AxisMotion { axis, value, .. } => {
                self.input.native_axis(axis, value as f32)
            }
            WindowEvent::RedrawRequested => self.frame(event_loop),
            _ => {}
        }
    }

    fn device_event(&mut self, _event_loop: &ActiveEventLoop, _id: DeviceId, event: DeviceEvent) {
        if let DeviceEvent::MouseMotion { delta } = event {
            self.input.mouse_motion(delta.0 as f32, delta.1 as f32);
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }
}

pub fn run_windowed(
    opts: Options,
    #[cfg(target_os = "android")] android: android_activity::AndroidApp,
) -> Result<(), String> {
    let mut builder = EventLoop::builder();
    #[cfg(target_os = "android")]
    {
        use winit::platform::android::EventLoopBuilderExtAndroid;
        builder.with_android_app(android);
    }
    let event_loop = builder
        .build()
        .map_err(|e| format!("cannot create event loop: {e}"))?;
    event_loop.set_control_flow(ControlFlow::Poll);
    let held = held_actions(&opts.hold)?;
    let mut app = App {
        opts,
        instance: new_instance(wgpu::Backends::PRIMARY),
        window: None,
        surface: None,
        config: None,
        gfx: None,
        content: None,
        input: Input::new(),
        perf: Perf::default(),
        last_frame: Instant::now(),
        started: Instant::now(),
        audio: None,
        audio_error: None,
        audio_started: false,
        frames_done: 0,
        held,
        last_audio_log: Instant::now(),
        finished: false,
        failed: None,
    };
    event_loop
        .run_app(&mut app)
        .map_err(|e| format!("event loop: {e}"))?;
    match app.failed {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

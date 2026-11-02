//! Loads the shipped example project from disk the way `nova run` does, and renders it.

use std::path::PathBuf;
use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::gfx::Gfx;
use nova_runtime::input::Actions;
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{DirVfs, Vfs};

fn example() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/rally-demo")
}

/// Stands in for the GPU so the project logic can be tested anywhere.
struct FakeGpu(usize);

impl Uploader for FakeGpu {
    fn set_atlas(&mut self, _atlas: &Image) {}
    fn add_mesh(&mut self, _mesh: &MeshData) -> usize {
        self.0 += 1;
        self.0 - 1
    }
}

fn load() -> Game {
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&example()).expect("example folder"));
    Game::load(vfs).expect("example project loads")
}

#[test]
fn rally_demo_loads_cleanly_and_draws_every_layer() {
    let mut game = load();
    game.upload(&mut FakeGpu(0));
    assert_eq!(game.project.manifest.name, "Rally Demo");
    assert!(game.warnings.is_empty(), "{:?}", game.warnings);
    assert!(game.error.is_none(), "{:?}", game.error);
    for frame in 0..90 {
        game.update(
            1.0 / 60.0,
            frame as f64 / 60.0,
            [960.0, 540.0],
            Actions::default(),
            false,
        );
    }
    assert!(game.error.is_none(), "{:?}", game.error);
    let input = game.frame_input(540);
    assert!(input.sprites_back.len() >= 14, "clouds in the world layer");
    assert!(input.models.len() >= 42, "ground, crates and the car");
    assert!(
        !input.sprites_front.is_empty(),
        "the gauge is in the UI layer"
    );
    assert!(input.text.len() >= 8, "HUD text is drawn as letters");
}

#[test]
fn rally_demo_renders_something_real_through_the_gpu() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let Ok(mut gfx) = Gfx::new(&instance, None) else {
        eprintln!("skipping GPU test: no adapter");
        return;
    };
    let mut game = load();
    game.upload(&mut gfx);
    for frame in 0..60 {
        game.update(
            1.0 / 60.0,
            frame as f64 / 60.0,
            [960.0, 540.0],
            Actions::default(),
            false,
        );
    }
    let size = (960, 540);
    let pixels = gfx.capture(size, &game.frame_input(0));
    let at = |x: u32, y: u32| {
        let i = ((y * size.0 + x) * 4) as usize;
        [pixels[i], pixels[i + 1], pixels[i + 2]]
    };
    let sky = at(480, 20);
    let grass = at(480, 500);
    assert!(sky[2] > sky[0] && sky[2] > 150, "sky is blue-ish: {sky:?}");
    assert!(
        grass[1] > grass[0] && grass[1] > grass[2],
        "ground is green-ish: {grass:?}"
    );
}

#[test]
fn editing_a_script_on_disk_is_noticed_and_a_broken_one_shows_an_error() {
    let dir = std::env::temp_dir().join(format!("nova-hot-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("nova.json"), r#"{"format":1,"name":"Hot"}"#).unwrap();
    std::fs::write(
        dir.join("main.lua"),
        "function update(dt) nova.rect(1,1,1,1) end",
    )
    .unwrap();
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&dir).unwrap());
    let mut game = Game::load(vfs).unwrap();
    assert!(!game.changed_on_disk(), "nothing changed yet");

    std::thread::sleep(std::time::Duration::from_millis(450));
    std::fs::write(
        dir.join("main.lua"),
        "function update(dt) nova.rect(2,2,2,2) end",
    )
    .unwrap();
    let later = std::time::SystemTime::now() + std::time::Duration::from_secs(30);
    std::fs::File::options()
        .write(true)
        .open(dir.join("main.lua"))
        .unwrap()
        .set_modified(later)
        .unwrap();
    assert!(game.changed_on_disk(), "the edit is detected");
    let mut game = Game::load(game.vfs()).unwrap();
    game.update(0.016, 0.0, [960.0, 540.0], Actions::default(), false);
    assert_eq!(game.frame_input(540).sprites_back[0].size, [2.0, 2.0]);

    std::thread::sleep(std::time::Duration::from_millis(450));
    std::fs::write(dir.join("main.lua"), "function update(dt) +++").unwrap();
    let later = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
    std::fs::File::options()
        .write(true)
        .open(dir.join("main.lua"))
        .unwrap()
        .set_modified(later)
        .unwrap();
    assert!(game.changed_on_disk());
    let broken = Game::load(game.vfs()).unwrap();
    assert!(
        broken.error.is_some(),
        "a syntax error is shown, not a crash"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

fn crate_dash() -> Game {
    let vfs: Rc<dyn Vfs> =
        Rc::new(DirVfs::new(&example().join("../crate-dash")).expect("crate-dash folder"));
    let mut game = Game::load(vfs).expect("crate-dash loads");
    game.upload(&mut FakeGpu(0));
    game
}

#[test]
fn crate_dash_plays_through_every_scene_without_errors() {
    let mut game = crate_dash();
    assert!(game.warnings.is_empty(), "{:?}", game.warnings);
    let idle = Actions::default();
    let jump = Actions {
        throttle: 1.0,
        steer: 0.4,
        ..Default::default()
    };

    // The title waits for a button: nothing moves on until the player jumps.
    for frame in 0..60 {
        game.update(1.0 / 60.0, frame as f64 / 60.0, [960.0, 540.0], idle, false);
    }
    assert!(game.error.is_none(), "{:?}", game.error);
    let title_letters = game.frame_input(540).text.len();
    assert!(title_letters > 30, "the title text is on screen");

    // Hold jump for a long play session. Crates fall on the player until the game ends and returns
    // to the title; holding jump starts it again, so this runs title -> play -> over -> title repeatedly.
    let mut time = 1.0;
    for _ in 0..(60 * 60 * 3) {
        game.update(1.0 / 60.0, time, [960.0, 540.0], jump, false);
        time += 1.0 / 60.0;
        assert!(
            game.error.is_none(),
            "error at t={time:.1}s: {:?}",
            game.error
        );
    }
    let input = game.frame_input(540);
    assert!(!input.sprites_back.is_empty() || !input.sprites_front.is_empty());
}

#[test]
fn font_gallery_draws_every_builtin_font() {
    let vfs: Rc<dyn Vfs> =
        Rc::new(DirVfs::new(&example().join("../font-gallery")).expect("folder"));
    let mut game = Game::load(vfs).expect("loads");
    game.upload(&mut FakeGpu(0));
    assert!(game.warnings.is_empty(), "{:?}", game.warnings);
    game.set_pixel_scale(2.0);
    game.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    assert!(game.error.is_none(), "{:?}", game.error);
    assert!(
        game.frame_input(540).text.len() > 400,
        "paragraphs of letters on screen"
    );
    assert!(game.take_glyph_atlas().is_some());
}

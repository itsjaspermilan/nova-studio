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
        input.sprites_front.len() > 50,
        "HUD text and gauge in the UI layer"
    );
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

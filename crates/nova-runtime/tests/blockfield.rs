//! Probe 2, Blockfield (examples/blockfield, see docs/probes.md): a block-building survival game. This plays it without a
//! window: the world makes itself, the player lands on the ground and stands still, can break and place blocks, and a long
//! walk stays inside the frame budget. What it looks like is checked by eye with `nova run --headless --capture`.

use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;

use nova_runtime::actions::InputFrame;
use nova_runtime::game::{Game, Uploader};
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{DirVfs, Vfs};

#[derive(Default)]
struct CountingGpu(Cell<usize>);
impl Uploader for CountingGpu {
    fn set_atlas(&mut self, _: &Image) {}
    fn add_mesh(&mut self, _: &MeshData) -> usize {
        let n = self.0.get();
        self.0.set(n + 1);
        n
    }
}

const DT: f32 = 1.0 / 60.0;

fn frame(g: &mut Game, held: &[&str]) {
    let input = InputFrame {
        sources: held.iter().map(|k| (k.to_string(), 1.0)).collect(),
        ..Default::default()
    };
    g.update_input(DT, 0.0, [960.0, 540.0], &input);
    assert!(g.error.is_none(), "the game raised an error: {:?}", g.error);
}

fn tap(g: &mut Game, key: &str) {
    frame(g, &[key]);
    frame(g, &[]);
}

/// The game with no worker threads, so that a test does the same thing every time.
fn game() -> Game {
    let mut g = game_with_threads();
    g.set_deterministic(true);
    g
}

fn game_with_threads() -> Game {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/blockfield");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.upload(&mut CountingGpu::default());
    g
}

/// The numbers of the newest `blockfield:` log line (F3 writes one).
fn status(g: &mut Game) -> std::collections::HashMap<String, String> {
    try_status(g).expect("a status line")
}

/// The same, or nothing while the world is still being made (the game answers F3 only once it is).
fn try_status(g: &mut Game) -> Option<std::collections::HashMap<String, String>> {
    let line = g
        .take_log()
        .into_iter()
        .rev()
        .find(|l| l.starts_with("blockfield:"))?;
    Some(
        line["blockfield:".len()..]
            .split_whitespace()
            .filter_map(|kv| kv.split_once('='))
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    )
}

#[test]
fn the_world_makes_itself_and_the_player_stands_on_it() {
    let mut g = game();
    for _ in 0..400 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:F3");
    let s = status(&mut g);
    let chunks: usize = s["chunks"].parse().unwrap();
    assert!(chunks >= 90, "a ring of chunks was made: {chunks}");
    assert_eq!(s["ground"], "true", "standing on the ground: {s:?}");
    let y: f64 = s["y"].parse().unwrap();
    assert!(
        (20.0..110.0).contains(&y),
        "on the surface, not in the sky or the stone: {y}"
    );
}

#[test]
fn blocks_can_be_broken_and_placed_and_the_change_is_remembered() {
    let mut g = game();
    for _ in 0..400 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:KeyF"); // creative: instant breaking, blocks to place
    // look straight down and dig
    for _ in 0..30 {
        let input = InputFrame {
            sources: [("key:KeyX".to_string(), 1.0)].into_iter().collect(),
            pointer: nova_runtime::actions::PointerFrame {
                present: true,
                dy: 40.0,
                ..Default::default()
            },
            ..Default::default()
        };
        g.update_input(DT, 0.0, [960.0, 540.0], &input);
        assert!(g.error.is_none(), "{:?}", g.error);
    }
    tap(&mut g, "key:F3");
    let s = status(&mut g);
    let edited: usize = s["edited"].parse().unwrap();
    assert!(edited >= 1, "digging changed a chunk: {s:?}");
    // the player now falls into the hole it dug and lands lower
    for _ in 0..120 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:F3");
    let s2 = status(&mut g);
    assert_eq!(s2["ground"], "true", "{s2:?}");
}

#[test]
fn a_long_walk_streams_chunks_without_errors_and_within_the_budget() {
    let mut g = game();
    for _ in 0..400 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:KeyF"); // creative, so that mobs and hunger leave the walk alone
    let started = std::time::Instant::now();
    let mut worst = 0.0f64;
    let mut total = 0.0f64;
    let frames = 900;
    for _ in 0..frames {
        let t = std::time::Instant::now();
        frame(&mut g, &["key:KeyW", "key:ControlLeft"]);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        worst = worst.max(ms);
        total += ms;
    }
    let _ = started;
    tap(&mut g, "key:F3");
    let s = status(&mut g);
    let chunks: usize = s["chunks"].parse().unwrap();
    // walking about 80 m forward over 15 s drops far chunks and makes new ones: the count stays in a band
    assert!(
        (90..=200).contains(&chunks),
        "chunks while walking: {chunks}"
    );
    // (debug builds are slow, so this only catches a runaway; the release numbers are in docs/probes.md)
    assert!(
        total / frames as f64 > 0.0 && worst < 3000.0,
        "mean {:.1} ms, worst {:.1} ms",
        total / frames as f64,
        worst
    );
}

#[test]
fn the_world_also_makes_itself_on_worker_threads() {
    // real threads and real time: the frames run until the engine has made the ring of chunks
    let mut g = game_with_threads();
    let started = std::time::Instant::now();
    let mut chunks = 0usize;
    let mut threads = 0usize;
    let (mut worst, mut total, mut count) = (0.0f64, 0.0f64, 0u32);
    while started.elapsed().as_secs() < 20 {
        for _ in 0..20 {
            let t = std::time::Instant::now();
            frame(&mut g, &[]);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            (worst, total, count) = (worst.max(ms), total + ms, count + 1);
        }
        tap(&mut g, "key:F3");
        if let Some(s) = try_status(&mut g) {
            chunks = s["chunks"].parse().unwrap();
            threads = s["threads"].parse().unwrap();
            if chunks >= 90 && s["ground"] == "true" {
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    eprintln!(
        "threaded load: {chunks} chunks, {threads} workers, {count} frames in {:?}, mean {:.2} ms, worst {:.2} ms",
        started.elapsed(),
        total / count.max(1) as f64,
        worst
    );
    assert!(chunks >= 90, "the ring was made: {chunks} chunks");
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    if cores > 2 {
        assert!(
            threads >= 1,
            "with {cores} cores there are workers: {threads}"
        );
    }
}

#[test]
fn a_saved_game_with_things_in_hand_starts_without_errors() {
    // the bug this guards: with items saved in the hotbar, the first frames drew the held item before the eye had a place
    let dir = std::env::temp_dir().join(format!("blockfield-save-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    {
        let mut g = game();
        g.open_save(&dir).expect("a save folder");
        for _ in 0..400 {
            frame(&mut g, &[]);
        }
        tap(&mut g, "key:KeyF"); // creative: the hotbar fills
        tap(&mut g, "key:Escape"); // pausing saves
        g.flush_save();
    }
    let mut g = game_with_threads();
    g.open_save(&dir).expect("the same folder");
    let started = std::time::Instant::now();
    let mut chunks = 0usize;
    while started.elapsed().as_secs() < 20 && chunks < 90 {
        for _ in 0..10 {
            frame(&mut g, &[]); // (frame() fails the test on any script error)
        }
        tap(&mut g, "key:F3");
        if let Some(s) = try_status(&mut g) {
            chunks = s["chunks"].parse().unwrap();
        }
        std::thread::sleep(std::time::Duration::from_millis(3));
    }
    assert!(chunks >= 90, "the world came up: {chunks}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_recorded_session_plays_back_and_digs() {
    // the same kind of file `nova run --headless --input` plays and `--record` writes
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/data/blockfield-dig.json");
    let script =
        nova_runtime::inputscript::InputScript::from_file(&path).expect("the script reads");
    let mut g = game();
    for n in 0..script.length() + 5 {
        let mut input = script.frame(n);
        if n == 0 {
            input.sources.clear();
        }
        g.update_input(DT, 0.0, [960.0, 540.0], &input);
        assert!(g.error.is_none(), "frame {n}: {:?}", g.error);
    }
    let s = status(&mut g);
    let pitch: f64 = s["pitch"].parse().unwrap();
    assert!(pitch < -1.0, "the mouse pushed the view down: {pitch}");
    assert!(s["creative"] == "true", "{s:?}");
    let edited: usize = s["edited"].parse().unwrap();
    assert!(
        edited >= 1,
        "holding the mine button dug (and the place button put a block back): {s:?}"
    );
}

#[test]
fn blocks_are_drawn_as_cubes_into_the_ui() {
    // creative mode fills the hotbar; every cube-shaped block in it (and the make menu's rows and the carried grid) is
    // a mesh in the UI layer, which the renderer draws under the text
    let mut g = game();
    for _ in 0..400 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:KeyF");
    frame(&mut g, &[]);
    let in_hotbar = g.frame_input(540).ui_models.len();
    assert!(in_hotbar >= 6, "the hotbar's cubes: {in_hotbar}");
    tap(&mut g, "key:KeyE"); // the make menu opens: rows and the carried grid add more
    frame(&mut g, &[]);
    let with_menu = g.frame_input(540).ui_models.len();
    assert!(with_menu > in_hotbar + 6, "{with_menu} against {in_hotbar}");
}

#[test]
fn the_world_can_be_named_from_the_pause_screen() {
    // pause, press E to name it, type on a keyboard (a letter that is not allowed is dropped), press enter: the name is saved
    let dir = std::env::temp_dir().join(format!("blockfield-name-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut g = game();
    g.open_save(&dir).expect("a save folder");
    for _ in 0..400 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:Escape");
    tap(&mut g, "key:KeyE");
    for text in ["Pine", " Ridge", "\u{8}\u{8}", "ge!", "\n"] {
        let input = InputFrame {
            typed: text.to_string(),
            ..Default::default()
        };
        g.update_input(DT, 0.0, [960.0, 540.0], &input);
        assert!(g.error.is_none(), "{:?}", g.error);
        frame(&mut g, &[]);
    }
    g.flush_save();
    let saved = std::fs::read_to_string(dir.join("save.json")).expect("the save file");
    assert!(saved.contains("\"world_name\": \"Pine Ridge\""), "{saved}");
    let _ = std::fs::remove_dir_all(&dir);
}

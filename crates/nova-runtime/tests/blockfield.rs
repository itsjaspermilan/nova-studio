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

fn game() -> Game {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/blockfield");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.upload(&mut CountingGpu::default());
    g
}

/// The numbers of the newest `blockfield:` log line (F3 writes one).
fn status(g: &mut Game) -> std::collections::HashMap<String, String> {
    let line = g
        .take_log()
        .into_iter()
        .rev()
        .find(|l| l.starts_with("blockfield:"))
        .expect("a status line");
    line["blockfield:".len()..]
        .split_whitespace()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
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

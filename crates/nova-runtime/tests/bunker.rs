//! Probe 3, Bunker Run (examples/bunker-run, see docs/probes.md): a first-person shooter in rooms. The game ships with a bot (F9)
//! that plays it, and this lets the bot play: it has to find its way through doors (paths round walls), shoot what it can see
//! (rays that stop at walls), fetch the key for the red door and win, with nothing going wrong in the scripts on the way.

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
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/bunker-run");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.upload(&mut CountingGpu::default());
    g.reseed(7); // (the bot aims with math.random: a fixed seed makes the run repeatable)
    g
}

/// The numbers of the newest `bunker:` log line (F3 writes one).
fn status(g: &mut Game) -> std::collections::HashMap<String, String> {
    let line = g
        .take_log()
        .into_iter()
        .rev()
        .find(|l| l.starts_with("bunker:"))
        .expect("a status line");
    line["bunker:".len()..]
        .split_whitespace()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

#[test]
fn the_level_builds_with_walls_and_creatures() {
    let mut g = game();
    for _ in 0..10 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:F3");
    let s = status(&mut g);
    assert_eq!(
        s["enemies"], "6",
        "two drones, two guards, a brute and the boss: {s:?}"
    );
    assert_eq!(s["hp"], "100");
    assert_eq!((s["dead"].as_str(), s["won"].as_str()), ("false", "false"));
}

#[test]
fn a_bot_can_play_the_level_to_the_end() {
    let mut g = game();
    tap(&mut g, "key:F6"); // god mode: the question is whether the level can be played, not whether the bot survives
    tap(&mut g, "key:F9"); // the bot
    let mut last = None;
    for second in 0..230 {
        for _ in 0..60 {
            frame(&mut g, &[]);
        }
        if second % 10 == 9 {
            tap(&mut g, "key:F3");
            let s = status(&mut g);
            if s["won"] == "true" {
                last = Some(s);
                break;
            }
        }
    }
    let s = last.expect("the bot won within four minutes of play");
    assert_eq!(
        s["kills"], "10",
        "the six, and the four drones the boss calls: {s:?}"
    );
    assert_eq!(s["key"], "true", "the red door needed the key");
    assert_eq!(s["exit"], "true");
}

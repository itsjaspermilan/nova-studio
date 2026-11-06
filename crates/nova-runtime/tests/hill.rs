//! Probe 5, Hill Run (examples/hill-run, see docs/probes.md): a third-person character on a field made of triangles
//! (`nova.solid`): rolling hills, a staircase of 0.3 m steps, a cliff it cannot climb, and a path up. The game ships with a bot
//! (F9) that walks the route to the flag.

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
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/hill-run");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.set_deterministic(true);
    g.upload(&mut CountingGpu::default());
    g
}

/// The numbers of the newest `hill:` status line (F3 writes one).
fn status(g: &mut Game) -> std::collections::HashMap<String, String> {
    tap(g, "key:F3");
    let line = g
        .take_log()
        .into_iter()
        .rev()
        .find(|l| l.starts_with("hill: x="))
        .expect("a status line");
    line["hill:".len()..]
        .split_whitespace()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn number(s: &std::collections::HashMap<String, String>, key: &str) -> f32 {
    s[key].trim_end_matches(',').parse().unwrap_or_else(|_| panic!("{key} = {}", s[key]))
}

#[test]
fn the_character_stands_on_the_hills_and_a_bot_climbs_the_stairs_and_the_path_to_the_flag() {
    let mut g = game();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    let at_rest = status(&mut g);
    let (x, y) = (number(&at_rest, "x"), number(&at_rest, "y"));
    assert!(x.abs() < 0.1 && y > -0.5 && y < 3.0, "it settled on the meadow where it started: {at_rest:?}");
    tap(&mut g, "key:F9"); // the bot
    let mut log = Vec::new();
    let mut won = false;
    for _ in 0..60 * 150 {
        frame(&mut g, &[]);
        log.extend(g.take_log());
        if log.iter().any(|l| l.starts_with("hill: flag reached")) {
            won = true;
            break;
        }
    }
    let s = status(&mut g);
    assert!(won, "the bot reached the flag within 150 s of game time: {s:?} {log:?}");
    assert!(number(&s, "max_height") > 25.0, "up the hill: {s:?}");
    assert!(number(&s, "hops") >= 15.0, "it hopped up the staircase: {s:?}");
    assert_eq!(number(&s, "falls"), 0.0, "and never fell off the world: {s:?}");
}

#[test]
fn the_cliff_cannot_be_climbed_by_walking_straight_at_it() {
    let mut g = game();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:F8"); // put the player on the hill below the cliff, bot walking at the peak
    let start = status(&mut g);
    let base = number(&start, "y");
    for _ in 0..60 * 40 {
        frame(&mut g, &[]);
    }
    let s = status(&mut g);
    assert_eq!(number(&s, "falls"), 0.0, "{s:?}");
    assert!(number(&s, "max_height") > base + 3.0, "it climbed the 37 degree hill up to the cliff: {s:?} (from {base})");
    // the hill reaches about 15.6 m at the foot of the cliff and the cliff is 7 m more
    assert!(number(&s, "max_height") < 19.0, "and no further: it did not walk up a 74 degree cliff: {s:?}");
    assert!(number(&s, "slide") > 20.0, "it was pushed back by the cliff, sliding: {s:?}");
}

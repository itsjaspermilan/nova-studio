//! Moving Day (examples/moving-day): the self-test of its levels and rules (every level's solver solution replayed through the game's own rules),
//! and the game played through its menus: the title, the first flat played by its solution, the results and on to the next flat, undo and restart,
//! the pause menu and the level select.

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

fn load() -> Game {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/moving-day");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.upload(&mut CountingGpu::default());
    g
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
    for _ in 0..16 {
        frame(g, &[]);
    }
}

fn wait(g: &mut Game, frames: usize) {
    for _ in 0..frames {
        frame(g, &[]);
    }
}

fn run_until(
    g: &mut Game,
    log: &mut Vec<String>,
    what: &str,
    limit: usize,
    done: impl Fn(&[String]) -> bool,
) {
    for _ in 0..limit {
        frame(g, &[]);
        log.extend(g.take_log());
        if done(log) {
            return;
        }
    }
    panic!(
        "{what}: not reached after {limit} frames; the log says {:?}",
        &log[log.len().saturating_sub(12)..]
    );
}

fn count(log: &[String], needle: &str) -> usize {
    log.iter().filter(|l| l.contains(needle)).count()
}

#[test]
fn the_levels_and_rules_pass_their_own_checks() {
    let mut g = load();
    wait(&mut g, 20);
    let mut log = vec![];
    frame(&mut g, &["key:F10"]);
    run_until(&mut g, &mut log, "the self-test", 300, |l| {
        count(l, "selftest: ok") + count(l, "selftest: FAIL") > 0
    });
    assert!(
        count(&log, "selftest: ok") == 1 && count(&log, "selftest: FAIL") == 0,
        "the self-test failed: {log:?}"
    );
}

#[test]
fn the_first_flat_is_solved_and_the_next_one_follows() {
    let mut g = load();
    wait(&mut g, 20);
    let mut log = vec![];
    tap(&mut g, "key:Enter"); // Play: the first flat, with its tips
    run_until(&mut g, &mut log, "the first flat", 60 * 3, |l| {
        count(l, "play: level 1 ") > 0
    });
    wait(&mut g, 70); // (the wipe opens)
    frame(&mut g, &["key:F9"]); // the solver's solution, pressed in turn
    run_until(&mut g, &mut log, "the flat finished", 60 * 10, |l| {
        count(l, "play: solved level 1 ") > 0
    });
    assert!(
        log.iter()
            .any(|l| l.contains("play: solved level 1 ") && l.contains("3 stars")),
        "the solver's solution earns three stars: {log:?}"
    );
    wait(&mut g, 60 * 3); // the stars and the results
    tap(&mut g, "key:Enter"); // Next flat
    run_until(&mut g, &mut log, "the second flat", 60 * 3, |l| {
        count(l, "play: level 2 ") > 0
    });
}

#[test]
fn undo_and_restart_take_moves_back() {
    let mut g = load();
    wait(&mut g, 20);
    let mut log = vec![];
    tap(&mut g, "pad:south"); // A: Play
    run_until(&mut g, &mut log, "the first flat", 60 * 3, |l| {
        count(l, "play: level 1 ") > 0
    });
    wait(&mut g, 70); // (the wipe opens)
    tap(&mut g, "pad:dpad_right");
    tap(&mut g, "pad:dpad_right");
    tap(&mut g, "pad:east"); // B: undo one
    log.extend(g.take_log());
    assert!(count(&log, "play: undo, 1 moves") == 1, "{log:?}");
    // X held starts again
    for _ in 0..60 {
        frame(&mut g, &["pad:west"]);
    }
    wait(&mut g, 10);
    log.extend(g.take_log());
    assert!(count(&log, "play: start again") == 1, "{log:?}");
    tap(&mut g, "pad:east"); // and a restart can be undone too
    log.extend(g.take_log());
    assert!(count(&log, "play: undo, 1 moves") == 2, "{log:?}");
}

#[test]
fn the_pause_menu_and_the_level_select() {
    let mut g = load();
    wait(&mut g, 20);
    let mut log = vec![];
    tap(&mut g, "key:ArrowDown"); // Choose a flat
    tap(&mut g, "key:Enter");
    wait(&mut g, 20);
    log.extend(g.take_log());
    tap(&mut g, "key:ArrowRight"); // flat 2 is locked: nothing happens
    tap(&mut g, "key:Enter");
    wait(&mut g, 60);
    log.extend(g.take_log());
    assert_eq!(
        count(&log, "play: level"),
        0,
        "a locked flat opened: {log:?}"
    );
    tap(&mut g, "key:ArrowLeft");
    tap(&mut g, "key:Enter"); // flat 1
    run_until(&mut g, &mut log, "the first flat", 60 * 3, |l| {
        count(l, "play: level 1 ") > 0
    });
    wait(&mut g, 70);
    tap(&mut g, "key:Escape"); // pause
    tap(&mut g, "key:ArrowDown");
    tap(&mut g, "key:ArrowDown"); // Choose a flat
    tap(&mut g, "key:Enter");
    run_until(&mut g, &mut log, "the level select", 60 * 3, |l| {
        count(l, "title: streets") > 0
    });
    tap(&mut g, "key:Backspace"); // B: back to the title
    wait(&mut g, 20);
}

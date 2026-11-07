//! Nebula Swap (examples/nebula-swap): the rules' own self-test (every puzzle won by its recorded solution, clears, chains, garbage, game over, the rival), and
//! the game played through its menus in each mode with the computer at the controls (F9), with nothing raising an error.

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
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/nebula-swap");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.upload(&mut CountingGpu::default());
    g
}

const DT: f32 = 1.0 / 60.0;

fn frame(g: &mut Game, held: &[&str]) {
    let input = InputFrame { sources: held.iter().map(|k| (k.to_string(), 1.0)).collect(), ..Default::default() };
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

fn run_until(g: &mut Game, log: &mut Vec<String>, what: &str, limit: usize, done: impl Fn(&[String]) -> bool) {
    for _ in 0..limit {
        frame(g, &[]);
        log.extend(g.take_log());
        if done(log) {
            return;
        }
    }
    panic!("{what}: not reached after {limit} frames; the log says {log:?}");
}

fn has(log: &[String], needle: &str) -> bool {
    log.iter().any(|l| l.contains(needle))
}

/// The title card, the main menu, then `downs` steps down the menu and Accept (and Accept again for a pace).
fn start(g: &mut Game, downs: usize, pace: bool) {
    wait(g, 20);
    tap(g, "key:Enter"); // title -> menu
    for _ in 0..downs {
        tap(g, "key:ArrowDown");
    }
    tap(g, "key:Enter");
    if pace {
        tap(g, "key:Enter"); // the first pace
    }
}

#[test]
fn the_rules_pass_their_own_checks() {
    let mut g = load();
    wait(&mut g, 20);
    let mut log = vec![];
    frame(&mut g, &["key:F10"]);
    run_until(&mut g, &mut log, "the self-test", 200, |l| has(l, "selftest: ok") || has(l, "selftest: FAIL"));
    assert!(has(&log, "selftest: ok"), "the self-test failed: {log:?}");
}

#[test]
fn endless_starts_after_the_countdown_and_plays_on_its_own() {
    let mut g = load();
    start(&mut g, 0, true);
    let mut log = vec![];
    run_until(&mut g, &mut log, "the countdown", 60 * 8, |l| has(l, "nebula: go"));
    frame(&mut g, &["key:F9"]);
    wait(&mut g, 60 * 20);
    log.extend(g.take_log());
    assert!(has(&log, "nebula: autoplay true"), "{log:?}");
    assert!(!has(&log, "over mode=endless won=false score=0"), "the computer should have scored in 20 seconds: {log:?}");
}

#[test]
fn a_puzzle_starts_from_the_list_and_the_pause_menu_leads_back_to_the_title() {
    let mut g = load();
    start(&mut g, 1, false); // Puzzle -> the list
    tap(&mut g, "key:Enter"); // puzzle 1
    let mut log = vec![];
    run_until(&mut g, &mut log, "the puzzle intro", 60 * 8, |l| has(l, "nebula: go"));
    tap(&mut g, "key:Escape"); // pause
    tap(&mut g, "key:ArrowDown");
    tap(&mut g, "key:ArrowDown"); // Quit to menu
    tap(&mut g, "key:Enter");
    wait(&mut g, 120);
    tap(&mut g, "key:Enter"); // from the title's menu (the quit comes back to it) -> Endless -> pace
    wait(&mut g, 10);
}

#[test]
fn a_garbage_battle_runs_with_both_boards_playing() {
    let mut g = load();
    start(&mut g, 2, true);
    let mut log = vec![];
    run_until(&mut g, &mut log, "the countdown", 60 * 8, |l| has(l, "nebula: go"));
    frame(&mut g, &["key:F9"]);
    wait(&mut g, 60 * 40);
}

#[test]
fn doing_nothing_in_endless_ends_the_game_and_the_results_lead_on() {
    let mut g = load();
    start(&mut g, 0, true);
    let mut log = vec![];
    run_until(&mut g, &mut log, "game over", 60 * 140, |l| has(l, "nebula: over mode=endless"));
    wait(&mut g, 120);
    tap(&mut g, "key:Enter"); // Play again
    run_until(&mut g, &mut log, "the new game", 60 * 8, |l| l.iter().filter(|x| x.contains("nebula: go")).count() >= 2);
}

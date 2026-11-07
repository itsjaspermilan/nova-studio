//! Potion Panic (examples/potion-panic): the self-test of its levels and rules, the computer apprentice playing all twelve levels, and the game played through its menus:
//! the story campaign (the story cards, a level, the results, the next level), the pause menu, and Free Brew with rules of its own.

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
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/potion-panic");
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
fn the_computer_apprentice_earns_a_star_on_every_level() {
    let mut g = load();
    wait(&mut g, 20);
    let mut log = vec![];
    frame(&mut g, &["key:F9"]);
    run_until(&mut g, &mut log, "the simulation", 3000, |l| {
        count(l, "botsim: done") > 0
    });
    assert_eq!(count(&log, "botsim: m1 "), 1, "{log:?}");
    assert!(
        log.iter()
            .any(|l| l.contains("botsim: done, 0 levels under one star")),
        "some level could not earn a star: {log:?}"
    );
}

#[test]
fn the_campaign_goes_from_the_story_to_a_level_and_on_to_the_next() {
    let mut g = load();
    wait(&mut g, 20);
    let mut log = vec![];
    tap(&mut g, "key:Enter"); // title -> menu
    tap(&mut g, "key:Enter"); // Story campaign -> the opening story
    tap(&mut g, "key:Escape"); // skip it: the map
    tap(&mut g, "key:Enter"); // level 1: the meadow's story card
    tap(&mut g, "key:Escape"); // skip it: the level starts
    run_until(
        &mut g,
        &mut log,
        "the first level's countdown",
        60 * 10,
        |l| count(l, "potion: go") >= 1,
    );
    frame(&mut g, &["key:F9"]); // the computer plays
    run_until(&mut g, &mut log, "the end of the level", 60 * 200, |l| {
        count(l, "potion: over level=m1") > 0
    });
    assert!(
        log.iter()
            .any(|l| l.contains("potion: over level=m1") && !l.contains("stars=0")),
        "the apprentice should earn a star: {log:?}"
    );
    wait(&mut g, 60 * 3);
    tap(&mut g, "key:Enter"); // Next level
    run_until(&mut g, &mut log, "the second level", 60 * 10, |l| {
        count(l, "potion: go") >= 2
    });
}

#[test]
fn the_pause_menu_leads_back_to_the_map_and_b_goes_back() {
    let mut g = load();
    wait(&mut g, 20);
    let mut log = vec![];
    tap(&mut g, "pad:south"); // A: title -> menu
    tap(&mut g, "pad:east"); // B: back to the title
    tap(&mut g, "pad:south"); // A: the menu again
    tap(&mut g, "pad:south"); // A: the story
    tap(&mut g, "pad:east"); // B: skip it
    tap(&mut g, "pad:south"); // A: level 1's story
    tap(&mut g, "pad:east"); // B: skip it
    run_until(&mut g, &mut log, "the countdown", 60 * 10, |l| {
        count(l, "potion: go") >= 1
    });
    tap(&mut g, "key:Escape"); // pause
    tap(&mut g, "key:ArrowDown");
    tap(&mut g, "key:ArrowDown"); // Leave
    tap(&mut g, "key:Enter");
    wait(&mut g, 120);
    tap(&mut g, "key:Escape"); // the map: back to the menu
    wait(&mut g, 30);
}

#[test]
fn free_brew_needs_a_beaten_level_and_takes_rules_of_its_own() {
    let mut g = load();
    wait(&mut g, 20);
    let mut log = vec![];
    // clear level 1 with the computer first
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:Escape");
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:Escape");
    run_until(&mut g, &mut log, "the countdown", 60 * 10, |l| {
        count(l, "potion: go") >= 1
    });
    frame(&mut g, &["key:F9"]);
    run_until(&mut g, &mut log, "the end of the level", 60 * 200, |l| {
        count(l, "potion: over level=m1") > 0
    });
    wait(&mut g, 60 * 3);
    tap(&mut g, "key:ArrowDown");
    tap(&mut g, "key:ArrowDown"); // Map (Next level, Brew again, Map)
    tap(&mut g, "key:Enter");
    wait(&mut g, 120);
    tap(&mut g, "key:Escape"); // the map -> the menu
    tap(&mut g, "key:ArrowDown"); // Free brew
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:Enter"); // level 1 -> the rules
    tap(&mut g, "key:ArrowRight"); // Time: 2 minutes
    tap(&mut g, "key:ArrowDown");
    tap(&mut g, "key:ArrowRight"); // Orders: Rush
    for _ in 0..6 {
        tap(&mut g, "key:ArrowDown"); // to Start brewing
    }
    tap(&mut g, "key:Enter");
    run_until(
        &mut g,
        &mut log,
        "the free level's countdown",
        60 * 10,
        |l| count(l, "potion: go") >= 2,
    );
    frame(&mut g, &["key:F9"]);
    run_until(
        &mut g,
        &mut log,
        "the end of the free level",
        60 * 140,
        |l| count(l, "potion: over level=m1") >= 2,
    );
}

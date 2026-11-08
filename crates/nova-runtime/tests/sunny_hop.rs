//! Sunny Hop (examples/sunny-hop): its self-test (every level's file, the map, the hero's jumps, save data), the menus, a level started from the map,
//! finished by the computer player and saved, the next level, the pause menu, a time trial, and (ignored by default: it takes minutes) the
//! computer player finishing every level with every gem.

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
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/sunny-hop");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.upload(&mut CountingGpu::default());
    g
}

const DT: f32 = 1.0 / 60.0;

fn frame(g: &mut Game, held: &[&str], log: &mut Vec<String>) {
    let input = InputFrame {
        sources: held.iter().map(|k| (k.to_string(), 1.0)).collect(),
        ..Default::default()
    };
    g.update_input(DT, 0.0, [960.0, 540.0], &input);
    assert!(g.error.is_none(), "the game raised an error: {:?}", g.error);
    log.extend(g.take_log());
}

fn tap(g: &mut Game, key: &str, log: &mut Vec<String>) {
    frame(g, &[key], log);
    for _ in 0..20 {
        frame(g, &[], log);
    }
}

fn wait(g: &mut Game, frames: usize, log: &mut Vec<String>) {
    for _ in 0..frames {
        frame(g, &[], log);
    }
}

fn count(log: &[String], needle: &str) -> usize {
    log.iter().filter(|l| l.contains(needle)).count()
}

fn run_until(g: &mut Game, log: &mut Vec<String>, what: &str, limit: usize, needle: &str) {
    for _ in 0..limit {
        frame(g, &[], log);
        if count(log, needle) > 0 {
            return;
        }
    }
    panic!(
        "{what}: '{needle}' not seen after {limit} frames; the log ends {:?}",
        &log[log.len().saturating_sub(12)..]
    );
}

#[test]
fn the_levels_map_jumps_and_saves_pass_the_self_test() {
    let mut g = load();
    let mut log = vec![];
    wait(&mut g, 20, &mut log);
    frame(&mut g, &["key:F10"], &mut log);
    run_until(&mut g, &mut log, "the self-test", 120, "sunny: selftest");
    assert!(
        count(&log, "sunny: selftest passed") == 1 && count(&log, "selftest FAIL") == 0,
        "the self-test failed: {:?}",
        log.iter()
            .filter(|l| l.contains("selftest"))
            .collect::<Vec<_>>()
    );
}

#[test]
fn the_title_menu_leads_to_the_map_and_options_and_back() {
    let mut g = load();
    let mut log = vec![];
    wait(&mut g, 20, &mut log);
    assert_eq!(count(&log, "sunny: title"), 1);
    tap(&mut g, "pad:south", &mut log); // press A: the menu
    tap(&mut g, "key:ArrowDown", &mut log); // Options
    tap(&mut g, "pad:south", &mut log);
    assert_eq!(count(&log, "sunny: menu Options"), 1, "{log:?}");
    tap(&mut g, "key:ArrowRight", &mut log); // music up a step
    tap(&mut g, "pad:east", &mut log); // B: back to the menu
    tap(&mut g, "key:ArrowUp", &mut log); // Play
    tap(&mut g, "pad:south", &mut log);
    run_until(
        &mut g,
        &mut log,
        "the map",
        120,
        "sunny: map at grass-0 stars=0/75",
    );
    wait(&mut g, 60, &mut log);
    // only the first level is open: walking right does nothing
    tap(&mut g, "key:ArrowRight", &mut log);
    wait(&mut g, 90, &mut log);
    assert_eq!(count(&log, "sunny: map at grass-1"), 0, "{log:?}");
    tap(&mut g, "pad:east", &mut log); // B: the title
    run_until(&mut g, &mut log, "back to the title", 120, "sunny: title");
}

#[test]
fn a_level_is_played_finished_saved_and_the_next_one_opens() {
    let mut g = load();
    let mut log = vec![];
    wait(&mut g, 20, &mut log);
    tap(&mut g, "pad:south", &mut log); // the menu
    tap(&mut g, "pad:south", &mut log); // Play: the map
    run_until(&mut g, &mut log, "the map", 120, "sunny: map at grass-0");
    wait(&mut g, 60, &mut log); // (the wipe clears)
    tap(&mut g, "pad:south", &mut log); // play First Hops
    run_until(
        &mut g,
        &mut log,
        "the first level",
        120,
        "sunny: play grass-0 normal",
    );
    wait(&mut g, 90, &mut log);
    // the pause menu: Resume
    tap(&mut g, "key:Escape", &mut log);
    tap(&mut g, "pad:south", &mut log);
    // the computer finishes it, with every gem
    frame(&mut g, &["key:F9"], &mut log);
    run_until(
        &mut g,
        &mut log,
        "the end of the level",
        60 * 240,
        "sunny: finished grass-0",
    );
    let line = log
        .iter()
        .find(|l| l.contains("sunny: finished grass-0"))
        .unwrap()
        .clone();
    assert!(
        line.contains("gems=3/3") && line.contains("saved=true") && !line.contains("stars=0"),
        "{line}"
    );
    // the results: Next level
    wait(&mut g, 120, &mut log);
    tap(&mut g, "pad:south", &mut log);
    run_until(
        &mut g,
        &mut log,
        "the next level",
        120,
        "sunny: play grass-1 normal",
    );
    wait(&mut g, 90, &mut log);
    // pause, World map: the map stands on the new level, with the stars earned so far
    tap(&mut g, "key:Escape", &mut log);
    tap(&mut g, "key:ArrowDown", &mut log);
    tap(&mut g, "key:ArrowDown", &mut log);
    tap(&mut g, "pad:south", &mut log);
    run_until(
        &mut g,
        &mut log,
        "the map again",
        120,
        "sunny: map at grass-1 stars=",
    );
    wait(&mut g, 60, &mut log);
    let stars = log
        .iter()
        .rev()
        .find(|l| l.contains("sunny: map at grass-1 stars="))
        .unwrap();
    assert!(
        !stars.contains("stars=0/"),
        "the cleared level's stars count: {stars}"
    );
    // the first level can now be walked back to and played as a time trial (Y)
    tap(&mut g, "key:ArrowLeft", &mut log);
    wait(&mut g, 40, &mut log);
    run_until(
        &mut g,
        &mut log,
        "walking back",
        60,
        "sunny: map at grass-0",
    );
    wait(&mut g, 20, &mut log);
    tap(&mut g, "pad:north", &mut log);
    run_until(
        &mut g,
        &mut log,
        "the time trial",
        120,
        "sunny: play grass-0 trial",
    );
}

/// Every level, finished by the computer player with all three gems (the proof that each can be done). Minutes long:
/// `cargo test --release -p nova-runtime --test sunny_hop -- --ignored`.
#[test]
#[ignore]
fn the_computer_player_finishes_every_level_with_every_gem() {
    let mut g = load();
    let mut log = vec![];
    wait(&mut g, 20, &mut log);
    frame(&mut g, &["key:F9"], &mut log);
    run_until(
        &mut g,
        &mut log,
        "every level",
        60 * 60 * 60,
        "sunny: bot finished all",
    );
    let done: Vec<_> = log.iter().filter(|l| l.contains(" done time=")).collect();
    assert_eq!(done.len(), 25, "{done:?}");
    for l in &done {
        assert!(
            l.contains("gems=3/3"),
            "a level's gems were not all found: {l}"
        );
    }
    assert_eq!(count(&log, "bot gave up"), 0, "{log:?}");
}

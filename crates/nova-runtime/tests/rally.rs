//! Pine Ridge Rally (examples/pine-ridge-rally) played through its menus and a whole race, driven by the game's own
//! "let the computer drive" key, on both circuits. What it checks is what a player would see: the menus lead to a race,
//! the race has a countdown, laps are counted, the race ends on the results screen, and nothing raises an error.

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
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/pine-ridge-rally");
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

/// Holds a key for one frame, then lets go for a few so the game sees a fresh press.
fn tap(g: &mut Game, key: &str) {
    frame(g, &[key]);
    for _ in 0..4 {
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
    panic!("{what}: not reached after {limit} frames; the log says {log:?}");
}

/// Title, main menu, then the circuit chooser with `circuit_steps` steps of "Circuit" to the right.
fn start_race(g: &mut Game, circuit_steps: usize, trial: bool) {
    for _ in 0..30 {
        frame(g, &[]);
    }
    tap(g, "key:Enter"); // title -> main menu
    tap(g, "key:Enter"); // Race -> circuit chooser
    for _ in 0..circuit_steps {
        tap(g, "key:ArrowRight");
    }
    if trial {
        tap(g, "key:ArrowDown"); // to Mode
        tap(g, "key:ArrowRight"); // Race -> Time trial
        tap(g, "key:ArrowUp");
    }
    for _ in 0..4 {
        tap(g, "key:ArrowDown"); // Circuit -> Mode -> Car -> Laps -> START
    }
    frame(g, &["key:Enter"]); // START
}

fn play(circuit_steps: usize, trial: bool) -> Vec<String> {
    let mut g = load();
    start_race(&mut g, circuit_steps, trial);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    tap(&mut g, "key:F9"); // let the computer drive
    run_until(&mut g, &mut log, "the results", 60 * 60 * 6, |l| {
        l.iter().any(|x| x.starts_with("results:"))
    });
    // the results screen is up and survives a few seconds
    for _ in 0..180 {
        frame(&mut g, &[]);
    }
    log.extend(g.take_log());
    log
}

#[test]
fn a_whole_race_on_pine_ridge_ends_on_the_results_screen() {
    let log = play(0, false);
    let laps = log.iter().filter(|l| l.starts_with("lap ")).count();
    assert_eq!(laps, 3, "a lap line for each of the three laps: {log:?}");
    assert!(
        !log.iter().any(|l| l.contains("put back on the road")),
        "nobody got stuck: {log:?}"
    );
    let results = log.iter().find(|l| l.starts_with("results:")).unwrap();
    assert!(results.contains("of 4"), "{results}");
    // the tyres wore (a little just by driving three laps) and the computer driver did not wreck the car
    let wear = log
        .iter()
        .find(|l| l.starts_with("wear:"))
        .expect("the wear is logged");
    let number = |after: &str| -> f32 {
        wear.split(after)
            .nth(1)
            .unwrap()
            .split([',', ' '])
            .next()
            .unwrap()
            .parse()
            .unwrap()
    };
    let (tyres, body) = (number("tyres "), number("body "));
    assert!((0.2..0.995).contains(&tyres), "tyres wore: {wear}");
    assert!(body > 0.5, "the car is not wrecked: {wear}");
}

#[test]
fn a_whole_race_on_dust_valley_ends_on_the_results_screen() {
    let log = play(1, false);
    assert!(log.iter().any(|l| l.starts_with("results:")), "{log:?}");
    assert_eq!(
        log.iter().filter(|l| l.starts_with("lap ")).count(),
        3,
        "{log:?}"
    );
    assert!(
        !log.iter().any(|l| l.contains("put back on the road")),
        "nobody got stuck: {log:?}"
    );
}

#[test]
fn a_time_trial_has_no_rivals_and_keeps_the_ghost_of_the_best_lap() {
    let log = play(0, true);
    let results = log
        .iter()
        .find(|l| l.starts_with("results:"))
        .expect("the trial ends");
    assert!(
        results.contains("place 1 of 1"),
        "alone on the circuit: {results}"
    );
    assert_eq!(
        log.iter().filter(|l| l.starts_with("lap ")).count(),
        3,
        "{log:?}"
    );
    let saved: Vec<_> = log
        .iter()
        .filter(|l| l.starts_with("ghost saved"))
        .collect();
    assert!(!saved.is_empty(), "the first lap leaves a ghost: {log:?}");
    let points: usize = saved[0]
        .split(['(', ' '])
        .find_map(|w| w.parse().ok())
        .unwrap_or(0);
    assert!(
        points > 300,
        "about ten points a second of a lap of half a minute or more: {saved:?}"
    );
}

#[test]
fn a_whole_race_on_frost_pass_ends_on_the_results_screen() {
    let log = play(2, false);
    assert!(log.iter().any(|l| l.starts_with("results:")), "{log:?}");
    assert_eq!(
        log.iter().filter(|l| l.starts_with("lap ")).count(),
        3,
        "{log:?}"
    );
    assert!(
        !log.iter().any(|l| l.contains("put back on the road")),
        "nobody got stuck: {log:?}"
    );
}

#[test]
fn a_whole_race_on_harbour_lights_ends_on_the_results_screen() {
    let log = play(3, false);
    assert!(log.iter().any(|l| l.starts_with("results:")), "{log:?}");
    assert_eq!(
        log.iter().filter(|l| l.starts_with("lap ")).count(),
        3,
        "{log:?}"
    );
    assert!(
        !log.iter().any(|l| l.contains("put back on the road")),
        "nobody got stuck: {log:?}"
    );
}

/// The controls screen: pick a row, press the new key, and the action uses it (and not the old key) from then on; the
/// gamepad entries stay; "back to the defaults" undoes it.
#[test]
fn the_controls_screen_remaps_a_key_and_can_put_the_defaults_back() {
    let mut g = load();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:Enter"); // the title screen
    tap(&mut g, "key:ArrowDown");
    tap(&mut g, "key:ArrowDown");
    tap(&mut g, "key:Enter"); // Options
    for _ in 0..4 {
        tap(&mut g, "key:ArrowDown");
    }
    tap(&mut g, "key:Enter"); // Controls...
    g.take_log();
    tap(&mut g, "key:Enter"); // the first row, Accelerate: now listening
    // a press while listening: the key I, which also reaches the script as the newest source
    let input = InputFrame {
        sources: [("key:KeyI".to_string(), 1.0)].into_iter().collect(),
        last_source: Some("key:KeyI".into()),
        ..Default::default()
    };
    g.update_input(DT, 0.0, [960.0, 540.0], &input);
    for _ in 0..4 {
        frame(&mut g, &[]);
    }
    let log = g.take_log();
    let line = log
        .iter()
        .find(|l| l.contains("controls: throttle"))
        .unwrap_or_else(|| panic!("the new key was taken: {log:?}"));
    assert!(line.contains('I'), "{line}");
    assert!(!line.contains("Up, W"), "the old keys are replaced: {line}");
    assert!(
        line.contains("R2") || line.contains('A'),
        "the gamepad entries stay: {line}"
    );
    // down to "Back to the defaults" (after the eight rows) and choose it
    for _ in 0..8 {
        tap(&mut g, "key:ArrowDown");
    }
    tap(&mut g, "key:Enter");
    let log = g.take_log();
    assert!(
        log.iter().any(|l| l.contains("back to the defaults")),
        "{log:?}"
    );
}

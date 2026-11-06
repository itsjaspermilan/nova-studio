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
    for _ in 0..6 {
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

/// A frame with analogue values (a trigger part way down) as well as held keys.
fn frame_with(g: &mut Game, held: &[(&str, f32)]) {
    let input = InputFrame {
        sources: held.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ..Default::default()
    };
    g.update_input(DT, 0.0, [960.0, 540.0], &input);
    assert!(g.error.is_none(), "the game raised an error: {:?}", g.error);
}

/// Drives to speed on the throttle, then brakes the way `ramp` says (trigger values, one a frame): did the wheels lock?
fn braking_locks_the_wheels(ramp: &[f32], key_instead: bool) -> bool {
    let mut g = load();
    start_race(&mut g, 0, false);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    // the computer drives to speed (on the road: straight on at full throttle runs into the roadside props), then lets go
    tap(&mut g, "key:F9");
    for _ in 0..60 * 10 {
        frame_with(&mut g, &[]);
    }
    tap(&mut g, "key:F9");
    for _ in 0..30 {
        frame_with(&mut g, &[("key:ArrowUp", 1.0)]);
    }
    log.clear();
    for v in ramp {
        if key_instead {
            frame_with(&mut g, &[("key:ArrowDown", 1.0)]);
        } else {
            frame_with(&mut g, &[("axis:l2", *v)]);
        }
        log.extend(g.take_log());
    }
    log.iter().any(|l| l == "brake: the wheels locked")
}

#[test]
fn a_trigger_pulled_right_through_at_speed_locks_the_wheels_and_a_gentle_one_or_a_key_does_not() {
    let hard: Vec<f32> = [0.3, 0.6, 0.9, 1.0]
        .iter()
        .copied()
        .chain(std::iter::repeat_n(1.0, 40))
        .collect();
    let gentle: Vec<f32> = [0.2, 0.4, 0.6]
        .iter()
        .copied()
        .chain(std::iter::repeat_n(0.6, 40))
        .collect();
    assert!(
        braking_locks_the_wheels(&hard, false),
        "a trigger pulled right through locks the wheels"
    );
    assert!(
        !braking_locks_the_wheels(&gentle, false),
        "a trigger half way does not"
    );
    assert!(
        !braking_locks_the_wheels(&hard, true),
        "a key is all or nothing and never locks the wheels (it would otherwise on every stop)"
    );
}

#[test]
fn every_circuit_has_stands_banners_billboards_and_pylons_beside_the_road() {
    for circuit in 0..4 {
        let mut g = load();
        start_race(&mut g, circuit, false);
        let mut log = Vec::new();
        run_until(&mut g, &mut log, "the roadside is built", 120, |l| {
            l.iter().any(|x| x.starts_with("rally: roadside "))
        });
        let line = log
            .iter()
            .find_map(|l| l.strip_prefix("rally: roadside "))
            .unwrap_or_else(|| panic!("circuit {circuit} built no roadside: {log:?}"));
        let n: usize = line.split_whitespace().next().unwrap().parse().unwrap();
        assert!(n >= 20, "circuit {circuit}: only {n} roadside props");
    }
}

/// The player's car after `frames` of holding the throttle and steering to the left, from speed on the road: (slip, speed, how far it turned).
fn cornering(car_steps: usize, frames: usize, drive_seconds: usize, steer: f32) -> (f32, f32, f32) {
    cornering_with(car_steps, frames, drive_seconds, steer, true)
}

fn cornering_with(
    car_steps: usize,
    frames: usize,
    drive_seconds: usize,
    steer: f32,
    throttle: bool,
) -> (f32, f32, f32) {
    let mut g = load();
    // the car chooser is the first row after Circuit and Mode: step to the car, then to START
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:ArrowDown"); // to Mode
    tap(&mut g, "key:ArrowDown"); // to Car
    for _ in 0..car_steps {
        tap(&mut g, "key:ArrowRight");
    }
    for _ in 0..2 {
        tap(&mut g, "key:ArrowDown"); // Laps, START
    }
    frame(&mut g, &["key:Enter"]);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    tap(&mut g, "key:F9");
    for _ in 0..60 * drive_seconds {
        frame_with(&mut g, &[]);
    }
    tap(&mut g, "key:F9");
    g.take_log();
    tap(&mut g, "key:F3");
    let before = stat(&mut g);
    for _ in 0..frames {
        if throttle {
            frame_with(&mut g, &[("key:ArrowUp", 1.0), ("key:ArrowLeft", steer)]);
        } else {
            frame_with(&mut g, &[("key:ArrowLeft", steer)]);
        }
    }
    let after = stat(&mut g);
    (
        after["slip"],
        after["speed"],
        (after["heading"] - before["heading"]).abs(),
    )
}

fn stat(g: &mut Game) -> std::collections::HashMap<String, f32> {
    tap(g, "key:F3");
    let line = g
        .take_log()
        .into_iter()
        .rev()
        .find(|l| l.starts_with("rally: speed="))
        .expect("a status line");
    line["rally: ".len()..]
        .split_whitespace()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.parse().unwrap()))
        .collect()
}

#[test]
fn the_sedan_and_hatchback_drift_under_power_in_a_bend_and_the_formula_car_grips() {
    // Redline (0), Blue Streak (1), Green Machine (2)
    let (formula_slip, _, _) = cornering(0, 90, 4, 0.7);
    let (blue_slip, blue_speed, _) = cornering(1, 90, 4, 0.7);
    let (green_slip, _, _) = cornering(2, 90, 4, 0.7);
    let (gentle_slip, _, _) = cornering(1, 90, 4, 0.4);
    assert!(
        blue_slip > 0.6 && green_slip > 0.6,
        "the road cars slide: {blue_slip} {green_slip}"
    );
    assert!(formula_slip < 0.6, "the formula car grips: {formula_slip}");
    assert!(
        gentle_slip < 0.4,
        "a gentle bend does not make the road car slide: {gentle_slip}"
    );
    assert!(
        blue_speed > 12.0,
        "and a drift keeps its speed: {blue_speed}"
    );
}

#[test]
fn the_right_stick_picks_a_view_and_the_camera_goes_back_behind_the_car_when_it_is_let_go() {
    let mut g = load();
    start_race(&mut g, 0, false);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    for _ in 0..60 {
        frame_with(&mut g, &[("key:ArrowUp", 1.0)]);
    }
    assert!(
        stat(&mut g)["orbit"].abs() < 0.05,
        "behind the car to start with"
    );
    let half_turn = std::f32::consts::FRAC_PI_2;
    // each view is a place, not a speed: holding the stick longer does not go further
    for frames in [90, 240] {
        for _ in 0..frames {
            frame_with(&mut g, &[("axis:right_x", 1.0)]);
        }
        let right = stat(&mut g)["orbit"];
        assert!(
            (right - half_turn).abs() < 0.1,
            "right looks out of the right ({frames} frames): {right}"
        );
        for _ in 0..120 {
            frame_with(&mut g, &[]);
        }
        assert!(stat(&mut g)["orbit"].abs() < 0.1, "and it comes back");
    }
    // any angle between the four: up and to the right is an eighth of a turn, and a stick pointing 30 degrees from the right is that
    for _ in 0..90 {
        frame_with(&mut g, &[("axis:right_x", 0.7), ("axis:right_y", -0.7)]);
    }
    let diagonal = stat(&mut g)["orbit"];
    assert!(
        (diagonal - std::f32::consts::FRAC_PI_4).abs() < 0.1,
        "up and right: {diagonal}"
    );
    for _ in 0..90 {
        frame_with(&mut g, &[("axis:right_x", 0.8), ("axis:right_y", 0.46)]); // to the right and a little down
    }
    let low = stat(&mut g)["orbit"];
    assert!(
        (low - 2.09).abs() < 0.2,
        "right and down by 30 degrees is 120 degrees round: {low}"
    );
    for _ in 0..120 {
        frame_with(&mut g, &[]);
    }
    for _ in 0..90 {
        frame_with(&mut g, &[("axis:right_x", -1.0)]);
    }
    let left = stat(&mut g)["orbit"];
    assert!(
        (left + half_turn).abs() < 0.1,
        "left looks out of the left: {left}"
    );
    for _ in 0..120 {
        frame_with(&mut g, &[("axis:right_y", 1.0)]);
    }
    let behind = stat(&mut g);
    assert!(behind["orbit"].abs() > 3.0, "down looks behind: {behind:?}");
    assert!(behind["lift"] > 0.1, "from a little higher: {behind:?}");
    for _ in 0..120 {
        frame_with(&mut g, &[]);
    }
    assert!(stat(&mut g)["orbit"].abs() < 0.1, "and back again");
    for _ in 0..60 {
        frame_with(&mut g, &[("pad:thumb_r", 1.0)]);
    }
    assert!(
        stat(&mut g)["orbit"].abs() > 3.0,
        "a press of the stick looks back too"
    );
}

#[test]
fn lifting_off_the_accelerator_in_a_bend_turns_the_car_in_sharper() {
    // the same speed and steering for a second, with and without the throttle: the heading changes more without it
    let (_, _, on) = cornering_with(0, 60, 4, 0.5, true);
    let (_, _, off) = cornering_with(0, 60, 4, 0.5, false);
    assert!(
        off > on * 1.08,
        "lifting turns in sharper: {off} against {on} on the throttle"
    );
    assert!(off < on * 1.6, "but only slightly: {off} against {on}");
}

#[test]
fn a_player_who_has_stopped_on_the_road_is_left_alone() {
    let mut g = load();
    start_race(&mut g, 0, false);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    log.clear();
    // twenty seconds of doing nothing: the player stays where they are (no "Back on the road"), and nobody else is wedged yet
    for _ in 0..60 * 20 {
        frame(&mut g, &[]);
        log.extend(g.take_log());
    }
    assert!(
        !log.iter().any(|l| l.starts_with("You put back")),
        "the player was moved though they were only waiting: {log:?}"
    );
}

#[test]
fn the_car_takes_a_few_seconds_to_reach_100_kmh() {
    let mut g = load();
    start_race(&mut g, 0, false);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    // the computer drives (straight on at full throttle runs into the roadside props)
    tap(&mut g, "key:F9");
    let at = |g: &mut Game, frames: usize| {
        for _ in 0..frames {
            frame_with(g, &[]);
        }
        stat(g)["speed"]
    };
    let two = at(&mut g, 90);
    assert!(
        two < 27.8,
        "100 km/h (27.8 m/s) is not reached in two seconds: {two}"
    );
    let ten = at(&mut g, 8 * 60);
    assert!(ten > 27.8, "but is by ten: {ten}");
}

#[test]
fn the_engine_is_heard_while_racing_and_louder_as_the_throttle_goes_down() {
    use nova_runtime::mixer::Command;
    let mut g = load();
    start_race(&mut g, 0, false);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    g.take_audio();
    let loudest = |g: &mut Game, frames: usize, held: &[(&str, f32)]| -> f32 {
        let mut best = 0.0f32;
        for _ in 0..frames {
            frame_with(g, held);
            for c in g.take_audio() {
                if let Command::Set { volume: Some(v), .. } = c {
                    best = best.max(v);
                }
            }
        }
        best
    };
    let idle = loudest(&mut g, 60, &[]);
    let full = loudest(&mut g, 120, &[("key:ArrowUp", 1.0)]);
    assert!(full > 0.25, "at full throttle one engine loop is set to {full}");
    assert!(full > idle, "and louder than at idle ({idle})");
}

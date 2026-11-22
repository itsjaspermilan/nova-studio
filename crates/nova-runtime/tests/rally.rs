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

thread_local! {
    /// Set by a test that plays as a new player (no cars, the starting coins, only the first course of each list open). Otherwise `load`
    /// gives the game a save in which every car is owned, every course is open, and `CAR` is the car last driven.
    static FRESH: Cell<bool> = const { Cell::new(false) };
    /// The car the save says was driven last, as a number into `state.cars` (lib/state.lua; 1 is the Apex GT, 2 the Outback).
    static CAR: Cell<usize> = const { Cell::new(1) };
}

/// The cars of `state.cars`, in its order (lib/state.lua): the save of an ordinary test owns them all.
const CARS: [&str; 2] = ["car_gt", "car_offroad"];
/// The car of each class (sport: the Apex GT; everyday: the Outback 4x4), as numbers into `state.cars`.
const CLASS_CARS: [usize; 2] = [1, 2];

/// The course ids in the order of the game's lists (lib/state.lua): circuits, then stages.
const CIRCUITS: [&str; 10] = [
    "pine_ridge",
    "dust_valley",
    "frost_pass",
    "harbour_lights",
    "autumn_glen",
    "ridge_gp",
    "copper_canyon",
    "glacier_ring",
    "neon_docks",
    "autumn_summit",
];
const STAGES: [&str; 11] = [
    "stage_pine_ridge",
    "stage_dust_valley",
    "stage_frost_pass",
    "stage_harbour_lights",
    "stage_autumn_glen",
    "stage_mesa_run",
    "stage_canyon",
    "stage_glacier_night",
    "stage_harbour_sprint",
    "stage_marathon",
    "stage_random_1",
];

fn load() -> Game {
    load_with(serde_json::Map::new())
}

/// `load`, with more entries in the save (an ordinary test's save; ignored for a new player's).
fn load_with(extra: serde_json::Map<String, serde_json::Value>) -> Game {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/pine-ridge-rally");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = if FRESH.with(|f| f.get()) {
        Game::load(vfs).expect("the game loads")
    } else {
        let dir = std::env::temp_dir().join(format!(
            "nova-rally-save-{:?}-{}",
            std::thread::current().id(),
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut save = serde_json::Map::new();
        let circuits: serde_json::Map<String, serde_json::Value> = CIRCUITS
            .iter()
            .map(|id| (id.to_string(), serde_json::json!(1)))
            .collect();
        let stages: serde_json::Map<String, serde_json::Value> = STAGES
            .iter()
            .map(|id| (id.to_string(), serde_json::json!(3)))
            .collect();
        save.insert("career_circuit".into(), serde_json::Value::Object(circuits));
        save.insert("career_rally".into(), serde_json::Value::Object(stages));
        save.insert("owned".into(), serde_json::json!(CARS));
        save.insert("coins".into(), serde_json::json!(1_000_000));
        save.insert("last_car".into(), serde_json::json!(CAR.with(|c| c.get())));
        save.extend(extra);
        // (the save file's own shape: see crates/nova-runtime/src/save.rs)
        let file = serde_json::json!({ "format": 1, "data": serde_json::Value::Object(save) });
        std::fs::write(dir.join("save.json"), file.to_string()).unwrap();
        Game::load_with(vfs, &|_| Some(dir.clone())).expect("the game loads")
    };
    g.upload(&mut CountingGpu::default());
    g
}

/// A game whose save says `car` (a number into `state.cars`) was driven last.
fn load_car(car: usize) -> Game {
    CAR.with(|c| c.set(car));
    load()
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

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Rally,
    Circuit,
    Trial,
}

/// Through the menus to a race: the title, the mode on the main menu (Rally, Circuit, Time trial), the track `course_steps` down the
/// list, the car the save last drove (A in the garage), for a circuit the laps (`laps` steps left or right of the track's own), and
/// RACE. The last press is held for one frame only, so the countdown begins at once.
fn setup(g: &mut Game, mode: Mode, course_steps: usize, laps: i32) {
    for _ in 0..30 {
        frame(g, &[]);
    }
    let downs = match mode {
        Mode::Rally => 0,
        Mode::Circuit => 1,
        Mode::Trial => 2,
    };
    for _ in 0..downs {
        tap(g, "key:ArrowDown");
    }
    tap(g, "key:Enter"); // the mode -> its tracks
    for _ in 0..course_steps {
        tap(g, "key:ArrowDown");
    }
    tap(g, "key:Enter"); // the track -> the garage
    tap(g, "key:Enter"); // the car -> the laps, or the page with everything on it
    if mode == Mode::Circuit {
        for _ in 0..laps.abs() {
            tap(
                g,
                if laps > 0 {
                    "key:ArrowRight"
                } else {
                    "key:ArrowLeft"
                },
            );
        }
        tap(g, "key:Enter"); // the laps -> the page with everything on it
    }
    frame(g, &["key:Enter"]); // RACE
}

/// A circuit race (or a time trial) on the circuit `circuit_steps` down the list.
fn start_race(g: &mut Game, circuit_steps: usize, trial: bool) {
    setup(
        g,
        if trial { Mode::Trial } else { Mode::Circuit },
        circuit_steps,
        0,
    );
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
    assert_eq!(laps, 2, "a lap line for each of the two laps: {log:?}");
    assert!(
        !log.iter().any(|l| l.contains("put back on the road")),
        "nobody got stuck: {log:?}"
    );
    let results = log
        .iter()
        .find(|l| l.starts_with("results: place"))
        .unwrap();
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
    rivals_keep_to_the_road(&log);
}

/// Every rival spends under 3% of the race with its wheels off the road (they cut every bend across the grass until 2026-11-08).
fn rivals_keep_to_the_road(log: &[String]) {
    let line = log
        .iter()
        .find(|l| l.starts_with("results: off the road"))
        .expect("the time off the road is logged");
    for entry in line.trim_start_matches("results: off the road ").split(' ') {
        let share: f32 = entry
            .split_once('=')
            .unwrap()
            .1
            .trim_end_matches('%')
            .parse()
            .unwrap();
        assert!(share < 3.0, "a rival kept to the road: {line}");
    }
}

#[test]
fn a_whole_race_on_dust_valley_ends_on_the_results_screen() {
    let log = play(1, false);
    assert!(log.iter().any(|l| l.starts_with("results:")), "{log:?}");
    assert_eq!(
        log.iter().filter(|l| l.starts_with("lap ")).count(),
        2,
        "{log:?}"
    );
    assert!(
        !log.iter().any(|l| l.contains("put back on the road")),
        "nobody got stuck: {log:?}"
    );
    // every car has a time when the player finishes (the ones still racing get an estimate, not "did not finish"), and the
    // rivals drive the player's car in its other paints
    let line = log
        .iter()
        .find(|l| l.contains("a time for"))
        .expect("a results line");
    assert!(line.contains("a time for 4 of 4 cars"), "{line}");
    rivals_keep_to_the_road(&log);
    assert!(
        log.iter().any(|l| l.contains("rally: slipstream")),
        "the player drafted behind a rival at some point: {log:?}"
    );
    let rivals: Vec<&str> = line.rsplit("rivals: ").next().unwrap().split(' ').collect();
    assert_eq!(rivals.len(), 3, "{line}");
    for r in rivals {
        assert!(
            ["car_gt_red", "car_gt_white", "car_gt_grey"].contains(&r),
            "{line}"
        );
    }
}

#[test]
fn a_time_trial_has_no_rivals_and_keeps_the_ghost_of_the_best_lap() {
    let log = play(0, true);
    let results = log
        .iter()
        .find(|l| l.starts_with("results: place"))
        .expect("the trial ends");
    assert!(
        results.contains("place 1 of 1"),
        "alone on the circuit: {results}"
    );
    assert_eq!(
        log.iter().filter(|l| l.starts_with("lap ")).count(),
        2,
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
        2,
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
        2,
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
    tap(&mut g, "key:ArrowUp"); // (up from Rally wraps round to Quit, the last of the main menu)
    tap(&mut g, "key:ArrowUp"); // Options, the one above it
    tap(&mut g, "key:Enter"); // Options
    for _ in 0..9 {
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

/// The objects of a course's scene file, by kind.
fn scene_kinds(course: &str) -> std::collections::HashMap<String, usize> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../examples/pine-ridge-rally/scenes/{course}.scene.json"
    ));
    let scene: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("the scene file")).unwrap();
    let mut out = std::collections::HashMap::new();
    for o in scene["objects"].as_array().unwrap() {
        *out.entry(o["kind"].as_str().unwrap().to_string())
            .or_insert(0) += 1;
    }
    out
}

const COURSES: [&str; 8] = [
    "pine_ridge",
    "dust_valley",
    "frost_pass",
    "harbour_lights",
    "stage_pine_ridge",
    "stage_dust_valley",
    "stage_frost_pass",
    "stage_harbour_lights",
];

#[test]
fn every_course_has_stands_banners_billboards_pylons_and_a_crowd_beside_the_road() {
    for course in COURSES {
        let kinds = scene_kinds(course);
        let count = |prefix: &str| -> usize {
            kinds
                .iter()
                .filter(|(k, _)| k.starts_with(prefix))
                .map(|(_, n)| n)
                .sum()
        };
        assert_eq!(
            count("grandstand"),
            2,
            "{course}: a stand each side of the start"
        );
        assert!(count("banner_") >= 2, "{course}: banners");
        let props = count("grandstand")
            + count("tent")
            + count("banner_")
            + count("flag_")
            + count("billboard")
            + count("pylon");
        assert!(props >= 20, "{course}: only {props} roadside props");
        assert!(count("pylon") >= 3, "{course}: pylons");
        assert!(count("crowd_") >= 150, "{course}: a crowd");
        assert_eq!(
            kinds.get("foliage"),
            Some(&1),
            "{course}: the grass's settings"
        );
    }
    // and the game draws them: the crowd is counted as the race is built
    let mut g = load();
    start_race(&mut g, 0, false);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the crowd is in place", 120, |l| {
        l.iter().any(|x| x.starts_with("rally: crowd "))
    });
    let people = scene_kinds("pine_ridge")
        .iter()
        .filter(|(k, _)| k.starts_with("crowd_"))
        .map(|(_, n)| n)
        .sum::<usize>();
    assert!(
        log.iter()
            .any(|l| *l == format!("rally: crowd {people} people")),
        "{log:?}"
    );
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
    // 0 is the Apex GT, 1 the Outback 4x4; a time trial: no rivals to bump the car
    let mut g = load_car(1 + car_steps);
    setup(&mut g, Mode::Trial, 0, 0);
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
fn the_coupe_slides_under_power_in_a_bend_and_the_4x4_does_not() {
    // the Apex GT (0), the Outback (1)
    let (gt_slip, _, _) = cornering(0, 90, 4, 0.7);
    let (_, gt_speed, _) = cornering(0, 50, 4, 0.7);
    let (offroad_slip, _, _) = cornering(1, 90, 4, 0.7);
    let (gentle_slip, _, _) = cornering(0, 90, 4, 0.4);
    assert!(gt_slip > 0.6, "the coupe slides: {gt_slip}");
    assert!(
        offroad_slip < gt_slip - 0.15,
        "the 4x4 holds its line better: {offroad_slip} against {gt_slip}"
    );
    assert!(
        gentle_slip < 0.4,
        "a gentle bend does not make the coupe slide: {gentle_slip}"
    );
    assert!(
        gt_speed > 12.0,
        "and it keeps its speed through the slide: {gt_speed}"
    );
}

/// Each car is its own machine: the coupe has eight gears, pulls harder and runs faster; the 4x4 has five, and on the grass it keeps
/// most of its speed where the coupe bogs down.
#[test]
fn the_two_cars_have_their_own_gearboxes_speeds_and_ways_with_the_rough() {
    let flat_out = |car: usize| {
        let mut g = load_car(car);
        setup(&mut g, Mode::Trial, 0, 0);
        let mut log = Vec::new();
        run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
            l.iter().any(|x| x == "go")
        });
        tap(&mut g, "key:F9");
        let mut top_gear = 0.0f32;
        let mut top_speed = 0.0f32;
        let mut at_three = 0.0f32;
        for f in 0..60 * 40 {
            frame_with(&mut g, &[]);
            if f % 30 == 29 {
                let s = stat(&mut g);
                top_gear = top_gear.max(s["gear"]);
                top_speed = top_speed.max(s["speed"]);
                if f == 179 {
                    at_three = s["speed"];
                }
            }
        }
        (top_gear, top_speed, at_three)
    };
    let (gt_gear, gt_top, gt_three) = flat_out(1);
    let (off_gear, off_top, off_three) = flat_out(2);
    assert!(
        (6.0..=8.0).contains(&gt_gear),
        "the coupe gets well up its eight gears on a lap: {gt_gear}"
    );
    assert!(
        (4.0..=5.0).contains(&off_gear),
        "the 4x4 has five: {off_gear}"
    );
    assert!(
        gt_top > off_top + 6.0,
        "the coupe is much the faster: {gt_top} against {off_top}"
    );
    assert!(
        gt_three > off_three + 2.0,
        "and quicker off the line: {gt_three} against {off_three}"
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
            (right + half_turn).abs() < 0.1,
            "right looks out of the right (a car's left is +x, so the turn is negative) ({frames} frames): {right}"
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
        (diagonal + std::f32::consts::FRAC_PI_4).abs() < 0.1,
        "up and right: {diagonal}"
    );
    for _ in 0..90 {
        frame_with(&mut g, &[("axis:right_x", 0.8), ("axis:right_y", 0.46)]); // to the right and a little down
    }
    let low = stat(&mut g)["orbit"];
    assert!(
        (low + 2.09).abs() < 0.2,
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
        (left - half_turn).abs() < 0.1,
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

/// Off the road: a car stopped on the grass backs out of it with the brake (reverse once pulled less than the grass held, so it could
/// not move at all), and a player who drives on, far from the road, is put back on it behind a fade to black.
#[test]
fn a_car_on_the_grass_reverses_and_one_far_from_the_road_is_put_back() {
    let mut g = load();
    start_race(&mut g, 0, false);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    // full throttle and hard right until the car is on the grass, then stop on it
    let mut on_grass = false;
    for _ in 0..60 * 8 {
        for _ in 0..10 {
            frame_with(&mut g, &[("key:ArrowUp", 1.0), ("key:ArrowRight", 1.0)]);
        }
        if stat(&mut g)["rough"] > 0.5 {
            on_grass = true;
            break;
        }
    }
    assert!(on_grass, "the car reached the grass");
    for _ in 0..90 {
        frame_with(&mut g, &[("key:ArrowDown", 1.0)]); // brake to a stop
    }
    for _ in 0..90 {
        frame_with(&mut g, &[("key:ArrowDown", 1.0)]); // and on into reverse
    }
    let s = stat(&mut g);
    assert!(s["speed"] < -2.0, "the car reverses on the grass: {s:?}");
    // now drive away from the road until the game puts the car back
    g.take_log();
    let mut log = Vec::new();
    for _ in 0..60 * 30 {
        frame_with(&mut g, &[("key:ArrowUp", 1.0), ("key:ArrowRight", 0.3)]);
        log.extend(g.take_log());
        if log
            .iter()
            .any(|l| l.starts_with("You put back on the road (too far"))
        {
            break;
        }
    }
    assert!(
        log.iter()
            .any(|l| l.starts_with("You put back on the road (too far")),
        "{log:?}"
    );
    let s = stat(&mut g);
    assert!(s["off"] < 10.0, "back on the road: {s:?}");
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
                if let Command::Set {
                    volume: Some(v), ..
                } = c
                {
                    best = best.max(v);
                }
            }
        }
        best
    };
    let idle = loudest(&mut g, 60, &[]);
    let full = loudest(&mut g, 120, &[("key:ArrowUp", 1.0)]);
    assert!(
        full > 0.25,
        "at full throttle one engine loop is set to {full}"
    );
    assert!(full > idle, "and louder than at idle ({idle})");
}

#[test]
fn the_engine_moves_through_its_loops_as_the_revs_climb_and_no_loop_is_bent_far() {
    use nova_runtime::mixer::Command;
    let mut g = load();
    start_race(&mut g, 0, false);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    tap(&mut g, "key:F9"); // the computer drives
    g.take_audio();
    let mut loudest_ids = std::collections::BTreeSet::new();
    let (mut lowest, mut highest) = (f32::MAX, 0.0f32);
    for _ in 0..60 * 12 {
        frame_with(&mut g, &[]);
        let mut loudest = (0.0f32, 0u64, 1.0f32);
        for c in g.take_audio() {
            if let Command::Set {
                id,
                volume: Some(v),
                pitch: Some(p),
                ..
            } = c
                && v > loudest.0
            {
                loudest = (v, id, p);
            }
        }
        if loudest.0 > 0.0 {
            loudest_ids.insert(loudest.1);
            lowest = lowest.min(loudest.2);
            highest = highest.max(loudest.2);
        }
    }
    assert!(
        loudest_ids.len() >= 3,
        "the loudest loop changes as the car speeds up: {loudest_ids:?}"
    );
    assert!(
        lowest > 0.55 && highest < 1.8,
        "a loop is bent by under a half either way: {lowest} to {highest}"
    );
}

/// How the cars and the difficulties come out: one lap each, the player's car driven by the computer (F9) against three rivals of its own
/// class. Prints the finishing times. Run on purpose: `cargo test --release -p nova-runtime --test rally ai_balance -- --ignored --nocapture`.
fn one_lap(car: usize, circuit_steps: usize) -> String {
    let mut g = load_car(car);
    setup(&mut g, Mode::Circuit, circuit_steps, -2);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    tap(&mut g, "key:F9");
    run_until(&mut g, &mut log, "the results", 60 * 60 * 6, |l| {
        l.iter().any(|x| x.starts_with("results: times"))
    });
    let stuck = log
        .iter()
        .filter(|l| l.contains("put back on the road"))
        .count();
    let log_copy = log.clone();
    let times = log
        .into_iter()
        .find(|l| l.starts_with("results: times"))
        .unwrap();
    if stuck > 0 {
        format!(
            "{times} (STUCK {stuck} times: {:?})",
            log_copy
                .iter()
                .filter(|l| l.contains("put back on the road"))
                .collect::<Vec<_>>()
        )
    } else {
        times
    }
}

#[test]
#[ignore]
fn ai_balance() {
    let cars = [("Apex GT", 1), ("Outback", 2)];
    // AI_CARS=Redline,Cab limits the sweep to some cars
    let only = std::env::var("AI_CARS").unwrap_or_default();
    // (the difficulty is the course's: Pine Ridge is Easy, Frost Pass Medium, Copper Canyon Hard)
    for (name, car) in cars {
        if !only.is_empty() && !only.split(',').any(|o| o == name) {
            continue;
        }
        for (label, course) in [("easy", 0), ("medium", 2), ("hard", 6)] {
            println!("{name:14} {label:6} {}", one_lap(car, course));
        }
    }
}

/// The difficulty is the course's level: the rivals of an Easy circuit drive as the easy setting says, of a Medium one the medium, and so on.
#[test]
fn a_course_sets_how_hard_the_rivals_drive() {
    for (steps, want) in [(0, "easy"), (2, "medium"), (6, "hard"), (8, "expert")] {
        let mut g = load();
        setup(&mut g, Mode::Circuit, steps, 0);
        let mut log = Vec::new();
        run_until(&mut g, &mut log, "the race is built", 60 * 8, |l| {
            l.iter().any(|x| x.starts_with("rivals: difficulty"))
        });
        assert!(
            log.iter()
                .any(|l| *l == format!("rivals: difficulty {want}")),
            "circuit {steps}: {log:?}"
        );
    }
}

/// A rally stage driven by the computer (F9): from the title screen choose Rally, a stage (0 to 9) and the car `car` (a number into
/// `state.cars`), start, and run to the results. Returns the log.
fn stage_run(stage: usize, car: usize) -> Vec<String> {
    let mut g = load_car(car);
    setup(&mut g, Mode::Rally, stage, 0);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    tap(&mut g, "key:F9");
    run_until(&mut g, &mut log, "the stage's results", 60 * 60 * 8, |l| {
        l.iter().any(|x| x.starts_with("results: rally score"))
    });
    log
}

#[test]
fn a_rally_stage_is_driven_in_sections_and_scored() {
    let log = stage_run(0, 1);
    let sections = log.iter().filter(|l| l.starts_with("section ")).count();
    assert_eq!(sections, 5, "five sections: {log:?}");
    let notes = log
        .iter()
        .find(|l| l.contains("pace notes"))
        .expect("the stage is built");
    assert!(notes.contains("5 sections"), "{notes}");
    let score = log
        .iter()
        .find(|l| l.starts_with("results: rally score"))
        .unwrap();
    assert!(score.contains("of 5000"), "{score}");
    assert!(
        !log.iter().any(|l| l.contains("put back on the road")),
        "the computer driver stayed on the road: {log:?}"
    );
}

/// The classes of car in the order of their tabs on the car page (lib/state.lua).
const CLASSES: [&str; 2] = ["sport", "everyday"];

/// The section times of a good run by the first car of each class on each stage (for lib/pars.lua). Run on purpose:
/// `cargo test --release -p nova-runtime --test rally rally_pars -- --ignored --nocapture` (COURSES=stage_canyon,... for some).
#[test]
#[ignore]
fn rally_pars() {
    let only = std::env::var("COURSES").unwrap_or_default();
    for (stage, id) in STAGES.iter().enumerate() {
        if !only.is_empty() && !only.split(',').any(|o| o == *id) {
            continue;
        }
        for (class_tab, class) in CLASSES.iter().enumerate() {
            let log = stage_run(stage, CLASS_CARS[class_tab]);
            let times: Vec<String> = log
                .iter()
                .filter(|l| l.starts_with("section "))
                .map(|l| l.rsplit("t=").next().unwrap().to_string())
                .collect();
            let total: f32 = times.iter().map(|t| t.parse::<f32>().unwrap()).sum();
            println!(
                "PAR stage {id} {class} {} total {total:.1}",
                times.join(" ")
            );
        }
    }
}

/// The best lap of a time trial driven by the computer, in the first car of each class on each circuit (the par laps in lib/pars.lua).
/// Run on purpose: `cargo test --release -p nova-runtime --test rally lap_pars -- --ignored --nocapture`.
#[test]
#[ignore]
fn lap_pars() {
    let only = std::env::var("COURSES").unwrap_or_default();
    for (circuit, id) in CIRCUITS.iter().enumerate() {
        if !only.is_empty() && !only.split(',').any(|o| o == *id) {
            continue;
        }
        for (class_tab, class) in CLASSES.iter().enumerate() {
            let mut g = load_car(CLASS_CARS[class_tab]);
            setup(&mut g, Mode::Trial, circuit, 0);
            let mut log = Vec::new();
            run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
                l.iter().any(|x| x == "go")
            });
            tap(&mut g, "key:F9");
            run_until(&mut g, &mut log, "the results", 60 * 60 * 10, |l| {
                l.iter().any(|x| x.starts_with("results:"))
            });
            assert!(
                log.iter().any(|l| *l == format!("rally: course {id}")),
                "{id}"
            );
            let best = log
                .iter()
                .filter_map(|l| {
                    l.strip_prefix("lap ")
                        .and_then(|r| r.split(" done in ").nth(1))
                })
                .map(|t| {
                    let (m, s) = t.split_once(':').unwrap();
                    m.parse::<f32>().unwrap() * 60.0 + s.parse::<f32>().unwrap()
                })
                .fold(f32::MAX, f32::min);
            println!("LAPPAR {id} {class} {best:.2}");
        }
    }
}

/// What the crowd costs in a race: `cargo test --release -p nova-runtime --test rally -- --ignored --nocapture crowd_cost`
/// prints, over 40 seconds of the computer driving a lap, the mean script time of a frame, the joint matrices uploaded, the model
/// instances and the draw runs (equal meshes side by side are one instanced draw) of the frames.
#[test]
#[ignore]
fn crowd_cost() {
    let mut g = load();
    start_race(&mut g, 0, false);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    tap(&mut g, "key:F9");
    let (mut ms, mut joints, mut instances, mut runs, mut peak) =
        (0.0, 0usize, 0usize, 0usize, 0usize);
    let frames = 60 * 40;
    for _ in 0..frames {
        frame(&mut g, &[]);
        ms += g.last_update.as_secs_f64() * 1000.0;
        let input = g.frame_input(0);
        joints += input.joints.len();
        peak = peak.max(input.joints.len());
        instances += input.models.len();
        let mut last = usize::MAX;
        for m in input.models {
            if m.mesh != last {
                runs += 1;
                last = m.mesh;
            }
        }
    }
    let n = frames as f64;
    println!(
        "crowd_cost: update {:.3} ms, joint matrices {:.0} a frame (peak {peak}), instances {:.0}, draw runs {:.1}",
        ms / n,
        joints as f64 / n,
        instances as f64 / n,
        runs as f64 / n
    );
}

/// Every course driven by the computer (F9): the results line of a race on each circuit and of a rally stage on each stage, to compare
/// before and after a change to the courses. Run on purpose:
/// `cargo test --release -p nova-runtime --test rally course_times -- --ignored --nocapture`.
#[test]
#[ignore]
fn course_times() {
    // COURSES=autumn_glen,stage_canyon limits it to some courses
    let only = std::env::var("COURSES").unwrap_or_default();
    let wanted = |id: &str| only.is_empty() || only.split(',').any(|o| o == id);
    for (circuit, id) in CIRCUITS.iter().enumerate() {
        if !wanted(id) {
            continue;
        }
        let log = play(circuit, false);
        assert!(
            log.iter().any(|l| *l == format!("rally: course {id}")),
            "{id}: {log:?}"
        );
        let laps: Vec<&String> = log.iter().filter(|l| l.starts_with("lap ")).collect();
        let times = log
            .iter()
            .find(|l| l.starts_with("results: times"))
            .unwrap();
        let stuck = log
            .iter()
            .filter(|l| l.contains("put back on the road"))
            .count();
        let off = log
            .iter()
            .find(|l| l.starts_with("results: off the road"))
            .cloned()
            .unwrap_or_default();
        println!("COURSE circuit {circuit} {id}: {times} | {off} | {laps:?} | put back {stuck}");
    }
    for (stage, id) in STAGES.iter().enumerate() {
        if !wanted(id) {
            continue;
        }
        let log = stage_run(stage, 1);
        assert!(
            log.iter().any(|l| *l == format!("rally: course {id}")),
            "{id}: {log:?}"
        );
        let sections: Vec<&String> = log.iter().filter(|l| l.starts_with("section ")).collect();
        let score = log
            .iter()
            .find(|l| l.starts_with("results: rally score"))
            .unwrap();
        let stuck = log
            .iter()
            .filter(|l| l.contains("put back on the road"))
            .count();
        println!("COURSE stage {stage} {id}: {score} | {sections:?} | put back {stuck}");
    }
}

/// A new player: 1,000 coins and no car. In the garage they buy a starter (Oobi, a kart: A asks, a second A buys), race the first circuit
/// against three karts, are paid for it, and finishing in the top three opens the second circuit, which they can then race.
#[test]
#[ignore = "every vehicle is unlocked for testing (state.UNLOCK_ALL_VEHICLES in lib/state.lua); run with --ignored once progression is back"]
fn a_new_player_buys_a_starter_car_and_finishing_a_circuit_opens_the_next() {
    FRESH.with(|f| f.set(true));
    let mut g = load();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:ArrowDown"); // Circuit
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:Enter"); // Pine Ridge, the first circuit -> the garage, on the first starter (Commuter)
    tap(&mut g, "key:ArrowRight");
    tap(&mut g, "key:ArrowRight"); // Commuter -> Green Machine -> Oobi
    tap(&mut g, "key:Enter"); // "buy it?"
    tap(&mut g, "key:Enter"); // bought
    let log = g.take_log();
    assert!(
        log.iter()
            .any(|l| l == "garage: bought kart_oobi for 1000 coins, 0 left"),
        "{log:?}"
    );
    tap(&mut g, "key:Enter"); // race in it -> the laps
    tap(&mut g, "key:Enter"); // the laps -> ready to race
    frame(&mut g, &["key:Enter"]); // RACE
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    assert!(
        log.iter().any(|l| l == "rally: course pine_ridge"),
        "{log:?}"
    );
    tap(&mut g, "key:F9");
    run_until(&mut g, &mut log, "the results", 60 * 60 * 6, |l| {
        l.iter().any(|x| x.starts_with("results: place"))
    });
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    log.extend(g.take_log());
    let rivals = log.iter().find(|l| l.contains("a time for")).unwrap();
    for r in rivals.rsplit("rivals: ").next().unwrap().split(' ') {
        assert!(
            r.starts_with("kart_"),
            "a kart's rivals drive karts: {rivals}"
        );
    }
    let place: usize = log
        .iter()
        .find_map(|l| l.strip_prefix("results: place "))
        .and_then(|r| r.split(' ').next())
        .unwrap()
        .parse()
        .unwrap();
    let coins = log
        .iter()
        .find(|l| l.starts_with("results: ") && l.contains(" coins, "))
        .unwrap();
    assert!(
        !coins.starts_with("results: 0 coins"),
        "a finish pays: {coins}"
    );
    assert!(
        place > 3 || coins.contains("opened dust_valley"),
        "a top-three finish opens Dust Valley: {coins}"
    );
    if place > 3 {
        return; // (the computer driver came last: nothing opened, and that is right)
    }
    // the results: Restart is first, Return second; back on the main menu, Circuit, then one down is Dust Valley, open now
    for _ in 0..120 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:ArrowDown"); // Return
    tap(&mut g, "key:Enter");
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:ArrowDown"); // Circuit
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:ArrowDown"); // Dust Valley
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:Enter"); // Oobi, the car driven last
    tap(&mut g, "key:Enter"); // the laps
    frame(&mut g, &["key:Enter"]); // RACE
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "Dust Valley starts", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    assert!(
        log.iter().any(|l| l == "rally: course dust_valley"),
        "{log:?}"
    );
}

/// A course that has not been opened cannot be chosen: a new player who moves to the second circuit and presses A stays on the list
/// (A again on the first goes on to the garage).
#[test]
#[ignore = "every vehicle is unlocked for testing (state.UNLOCK_ALL_VEHICLES in lib/state.lua); run with --ignored once progression is back"]
fn a_locked_course_cannot_be_chosen() {
    FRESH.with(|f| f.set(true));
    let mut g = load();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:ArrowDown"); // Circuit
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:ArrowDown"); // Dust Valley, locked
    g.take_log();
    tap(&mut g, "key:Enter"); // refused: still on the list
    tap(&mut g, "key:ArrowUp"); // Pine Ridge
    tap(&mut g, "key:Enter"); // the garage: no car yet, so A asks to buy the starter under the focus
    tap(&mut g, "key:Enter"); // "buy it?"
    tap(&mut g, "key:Enter"); // bought
    let log = g.take_log();
    assert!(
        log.iter()
            .any(|l| l.starts_with("garage: bought car_sedan")),
        "the second A was in the garage (the first, on the locked course, did nothing): {log:?}"
    );
}

/// The Autumn Glen stage is gravel, then tarmac from its halfway hairpin (a zone of its track): six sections, the road changes under the
/// car once, and the computer driver gets through without being put back.
#[test]
fn a_stage_turns_from_gravel_to_tarmac() {
    let log = stage_run(4, 1);
    assert!(
        log.iter().any(|l| l == "rally: course stage_autumn_glen"),
        "{log:?}"
    );
    assert_eq!(
        log.iter().filter(|l| l.starts_with("section ")).count(),
        6,
        "{log:?}"
    );
    assert!(
        log.iter()
            .any(|l| l == "rally: the road turns to road_asphalt"),
        "{log:?}"
    );
    assert!(
        !log.iter().any(|l| l.contains("put back on the road")),
        "{log:?}"
    );
}

// ---- the car select (the garage, and choosing the car before a race): lib/garage.lua, scenes/title.lua -------------------------

/// The carousel's order: the makes in `state.makes`' order, the cheapest car first within a make.
const SHOWROOM: [&str; 13] = [
    "car_city",
    "car_hatch",
    "car_s14",
    "car_s15",
    "car_hatch_r",
    "car_rally",
    "car_gt",
    "car_gt2",
    "car_offroad",
    "car_suv",
    "car_pickup",
    "car_muscle",
    "car_truck",
];

/// Through the menus to the car select as the step before a rally stage (the mode, the stage, then the cars), on the car the save drove last.
fn open_car_select(g: &mut Game) {
    for _ in 0..30 {
        frame(g, &[]);
    }
    tap(g, "key:Enter"); // Rally -> its stages
    tap(g, "key:Enter"); // the first stage -> the cars
}

/// What the stage shows (F3 in the car select logs it): `speed` (the turn, radians a second), `angle`, `tilt`, `hand` (1 while the right
/// stick has the car), `car` and `make`.
fn garage_stat(g: &mut Game) -> std::collections::HashMap<String, String> {
    tap(g, "key:F3");
    let line = g
        .take_log()
        .into_iter()
        .rev()
        .find(|l| l.starts_with("garage: speed="))
        .expect("the car select answers F3");
    line["garage: ".len()..]
        .split_whitespace()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn shown_car(g: &mut Game) -> String {
    garage_stat(g)["car"].clone()
}

fn number(stat: &std::collections::HashMap<String, String>, key: &str) -> f32 {
    stat[key].parse().unwrap()
}

fn screen(g: &Game) -> String {
    g.lua_text("nova.scene_now().screen")
        .unwrap()
        .trim_matches('"')
        .to_string()
}

fn the_car_chosen(g: &Game) -> String {
    g.lua_text("require('lib.state').current_car().id")
        .unwrap()
        .trim_matches('"')
        .to_string()
}

#[test]
fn every_car_has_a_make_and_every_make_a_logo_file() {
    let g = load();
    g.run_lua(
        "local state = require('lib.state')
         for _, c in ipairs(state.cars) do nova.log('car ' .. c.id .. ' ' .. tostring(c.make)) end
         for _, m in ipairs(state.makes) do nova.log('make ' .. m.id .. ' ' .. m.logo .. ' ' .. #m.color) end
         for i, c in ipairs(state.showroom()) do nova.log('showroom ' .. i .. ' ' .. c.id) end",
        "makes",
    )
    .unwrap();
    let log = g.take_log();
    let makes: Vec<Vec<&str>> = log
        .iter()
        .filter_map(|l| l.strip_prefix("make "))
        .map(|l| l.split(' ').collect())
        .collect();
    assert!(
        (6..=8).contains(&makes.len()),
        "about seven makes: {makes:?}"
    );
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/pine-ridge-rally");
    for m in &makes {
        assert_eq!(m[2], "3", "{m:?}: a colour");
        let file = folder.join("sprites").join(format!("{}.png", m[1]));
        assert!(file.exists(), "the logo of {} is {file:?}", m[0]);
        assert!(
            file.metadata().unwrap().len() > 1000,
            "{file:?} is a picture"
        );
    }
    let cars: Vec<Vec<&str>> = log
        .iter()
        .filter_map(|l| l.strip_prefix("car "))
        .map(|l| l.split(' ').collect())
        .collect();
    assert_eq!(cars.len(), 13);
    for c in &cars {
        assert!(
            makes.iter().any(|m| m[0] == c[1]),
            "{} has a make that is in the table: {c:?}",
            c[0]
        );
    }
    for m in &makes {
        assert!(cars.iter().any(|c| c[1] == m[0]), "no car is a {}", m[0]);
    }
    let showroom: Vec<&str> = log
        .iter()
        .filter_map(|l| l.strip_prefix("showroom "))
        .map(|l| l.split(' ').nth(1).unwrap())
        .collect();
    assert_eq!(showroom, SHOWROOM, "the carousel's order");
}

#[test]
fn left_and_right_move_the_car_select_one_car_and_wrap_round() {
    let mut g = load();
    open_car_select(&mut g);
    assert_eq!(
        shown_car(&mut g),
        "car_gt",
        "it opens on the car last driven"
    );
    tap(&mut g, "key:ArrowRight");
    assert_eq!(shown_car(&mut g), "car_gt2", "right is the next card");
    tap(&mut g, "key:ArrowLeft");
    tap(&mut g, "key:ArrowLeft");
    assert_eq!(shown_car(&mut g), "car_rally", "left is the one before");
    tap(&mut g, "key:ArrowRight");
    // the last car, and one more
    for _ in 0..6 {
        tap(&mut g, "key:ArrowRight");
    }
    assert_eq!(shown_car(&mut g), "car_truck", "the end of the row");
    tap(&mut g, "key:ArrowRight");
    assert_eq!(shown_car(&mut g), "car_city", "wraps to the first");
    tap(&mut g, "key:ArrowLeft");
    assert_eq!(
        shown_car(&mut g),
        "car_truck",
        "and back round the other way"
    );
    // a round of all thirteen is where it began
    for _ in 0..13 {
        tap(&mut g, "key:ArrowRight");
    }
    assert_eq!(shown_car(&mut g), "car_truck");
    // the pad's d-pad does the same
    tap(&mut g, "pad:dpad_right");
    assert_eq!(shown_car(&mut g), "car_city");
}

#[test]
fn holding_right_keeps_moving_through_the_cars() {
    let mut g = load();
    open_car_select(&mut g);
    g.take_log();
    for _ in 0..90 {
        frame(&mut g, &["key:ArrowRight"]);
    }
    let log = g.take_log();
    let moves = log
        .iter()
        .filter(|l| l.starts_with("garage: shows "))
        .count();
    assert!(
        (5..=9).contains(&moves),
        "one at once, a pause, then one every sixth of a second: {moves}"
    );
}

#[test]
fn the_shoulder_buttons_jump_to_the_next_make() {
    let mut g = load();
    open_car_select(&mut g);
    assert_eq!(garage_stat(&mut g)["make"], "apex");
    tap(&mut g, "pad:r1");
    assert_eq!(garage_stat(&mut g)["make"], "kestrel");
    tap(&mut g, "pad:r1");
    let s = garage_stat(&mut g);
    assert_eq!(
        (s["make"].as_str(), s["car"].as_str()),
        ("cairn", "car_offroad"),
        "the make's first car"
    );
    // (Cairn has three cars: moving on inside it, R still goes to the next make's first)
    tap(&mut g, "key:ArrowRight");
    tap(&mut g, "pad:r1");
    let s = garage_stat(&mut g);
    assert_eq!(
        (s["make"].as_str(), s["car"].as_str()),
        ("mammut", "car_muscle")
    );
    tap(&mut g, "pad:r1");
    assert_eq!(garage_stat(&mut g)["make"], "sora", "wraps round the makes");
    tap(&mut g, "pad:l1");
    assert_eq!(garage_stat(&mut g)["make"], "mammut", "L goes back a make");
    tap(&mut g, "pad:l1");
    tap(&mut g, "pad:l1");
    assert_eq!(garage_stat(&mut g)["make"], "kestrel");
}

#[test]
fn the_right_stick_turns_the_shown_car_and_it_returns_to_the_slow_turn() {
    let mut g = load();
    open_car_select(&mut g);
    let slow_speed = 2.0 * std::f32::consts::PI / 20.0;
    // on its own it turns once in twenty seconds
    for _ in 0..60 {
        frame(&mut g, &[]);
    }
    let slow = garage_stat(&mut g);
    assert!(
        (number(&slow, "speed").abs() - slow_speed).abs() < 0.02,
        "the slow turn: {slow:?}"
    );
    assert_eq!(slow["hand"], "0");
    // the stick spins it, far faster, and the log says the hand has it
    let before = number(&slow, "angle");
    for _ in 0..30 {
        frame_with(&mut g, &[("axis:right_x", 1.0)]);
    }
    let held = garage_stat(&mut g);
    assert_eq!(held["hand"], "1");
    assert!(
        (number(&held, "angle") - before).abs() > 0.8,
        "half a second of the stick turns it a good way: {before} -> {}",
        held["angle"]
    );
    // the other way turns it back
    let mid = number(&held, "angle");
    for _ in 0..60 {
        frame_with(&mut g, &[("axis:right_x", -1.0)]);
    }
    assert!(
        number(&garage_stat(&mut g), "angle") < mid,
        "left turns it the other way"
    );
    // up and down tip the view a little, within limits
    for _ in 0..240 {
        frame_with(&mut g, &[("axis:right_y", 1.0)]);
    }
    let tipped = number(&garage_stat(&mut g), "tilt");
    assert!(
        (0.1..=0.35).contains(&tipped),
        "tipped, but only a little: {tipped}"
    );
    for _ in 0..240 {
        frame_with(&mut g, &[("axis:right_y", -1.0)]);
    }
    let up = number(&garage_stat(&mut g), "tilt");
    assert!(
        (-0.1..=0.0).contains(&up),
        "and not far the other way: {up}"
    );
    // let go: it coasts, and after about three seconds eases back into the slow turn (and the view back level)
    g.take_log();
    for _ in 0..(60 * 2) {
        frame(&mut g, &[]);
    }
    assert_eq!(
        garage_stat(&mut g)["hand"],
        "1",
        "still the hand's for a while"
    );
    for _ in 0..(60 * 12) {
        frame(&mut g, &[]);
    }
    let log = g.take_log();
    assert!(
        log.iter().any(|l| l.starts_with("garage: slow turn")),
        "{log:?}"
    );
    let back = garage_stat(&mut g);
    assert_eq!(back["hand"], "0");
    assert!(
        (number(&back, "speed").abs() - slow_speed).abs() < 0.02,
        "back in the slow turn: {back:?}"
    );
    assert!(number(&back, "tilt").abs() < 0.02, "and level: {back:?}");
}

#[test]
fn the_car_select_buys_cars_and_a_car_of_yours_goes_on_to_the_race() {
    let mut g = load();
    g.run_lua("require('lib.state').UNLOCK_ALL_VEHICLES = false", "t")
        .unwrap();
    open_car_select(&mut g);
    // the save owns the Apex GT and the Outback; the next card is the Kestrel GT2, which is not yours
    tap(&mut g, "key:ArrowRight");
    assert_eq!(shown_car(&mut g), "car_gt2");
    tap(&mut g, "key:Enter"); // "buy it?"
    assert!(
        !g.take_log().iter().any(|l| l.starts_with("garage: bought")),
        "the first A only asks"
    );
    tap(&mut g, "key:ArrowLeft"); // (moving away drops the question)
    tap(&mut g, "key:ArrowRight");
    tap(&mut g, "key:Enter");
    assert!(
        !g.take_log().iter().any(|l| l.starts_with("garage: bought")),
        "and the question starts again"
    );
    tap(&mut g, "key:Enter"); // bought
    let log = g.take_log();
    assert!(
        log.iter()
            .any(|l| l == "garage: bought car_gt2 for 9000 coins, 991000 left"),
        "{log:?}"
    );
    // now it is yours: A picks it and goes on, to the page with everything on it (a rally has no laps to choose)
    tap(&mut g, "key:Enter");
    let log = g.take_log();
    assert!(log.iter().any(|l| l == "garage: chose car_gt2"), "{log:?}");
    assert_eq!(screen(&g), "confirm");
    assert_eq!(the_car_chosen(&g), "car_gt2");
    // B goes back to the cars, and B again to the stages
    tap(&mut g, "key:Escape");
    assert_eq!(screen(&g), "garage");
    tap(&mut g, "key:Escape");
    assert_eq!(screen(&g), "track");
}

#[test]
fn a_car_you_cannot_afford_is_not_bought() {
    let mut extra = serde_json::Map::new();
    extra.insert("coins".into(), serde_json::json!(100));
    let mut g = load_with(extra);
    g.run_lua("require('lib.state').UNLOCK_ALL_VEHICLES = false", "t")
        .unwrap();
    open_car_select(&mut g);
    tap(&mut g, "key:ArrowRight");
    assert_eq!(shown_car(&mut g), "car_gt2");
    tap(&mut g, "key:Enter");
    tap(&mut g, "key:Enter");
    let log = g.take_log();
    assert!(
        !log.iter().any(|l| l.starts_with("garage: bought")),
        "{log:?}"
    );
    let note = g.lua_text("nova.scene_now().note").unwrap();
    assert!(note.contains("Not enough coins"), "{note}");
    // backing out leaves the car that was chosen before
    tap(&mut g, "key:Escape");
    assert_eq!(the_car_chosen(&g), "car_gt");
}

// ---- the rivals and the suspension (2026-11-21) -----------------------------------------------------------------------------------
// These start a race straight from the game's state (lib/state.lua) instead of through the menus, so they do not depend on the title
// screen's pages. `PROBE` (Lua, below) watches every car each frame: its lap times, its speed and line at each waypoint of its second
// lap, the frames it spent on the grass, hitting things or stuck.

/// The index of a course in its list (circuits or stages), 1-based, and whether it is a stage.
fn course_index(course: &str) -> (usize, bool) {
    if let Some(i) = CIRCUITS.iter().position(|c| *c == course) {
        return (i + 1, false);
    }
    let i = STAGES
        .iter()
        .position(|c| *c == course)
        .unwrap_or_else(|| panic!("no course {course}"));
    (i + 1, true)
}

/// A game in a race on `course` (a circuit or a stage), in car `car` (1-based into `state.cars`), `mode` "race", "trial" or "rally",
/// after `setup_lua` (run once the state is set, before the scene is built), at the green light. The probe is installed.
fn race_direct(
    course: &str,
    car: usize,
    mode: &str,
    laps: i32,
    setup_lua: &str,
) -> (Game, Vec<String>) {
    let mut g = load_car(car);
    frame(&mut g, &[]);
    let (index, stage) = course_index(course);
    let field = if stage { "stage" } else { "track" };
    g.run_lua(
        &format!(
            "local s = require('lib.state'); s.mode = '{mode}'; s.{field} = {index}; s.laps = {laps}; s.car = {car}; {setup_lua}; nova.goto_scene('{course}')"
        ),
        "test setup",
    )
    .expect("the race is set up");
    g.run_lua(PROBE, "probe").expect("the probe loads");
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the countdown ends", 60 * 10, |l| {
        l.iter().any(|x| x == "go")
    });
    (g, log)
}

const PROBE: &str = r#"
PROBE_DATA = { cars = {}, frames = 0 }
function PROBE()
  local sc = nova.scene_now()
  if not sc or not sc.cars or sc.phase ~= "racing" then return end
  PROBE_DATA.frames = PROBE_DATA.frames + 1
  for _, c in ipairs(sc.cars) do
    local p = PROBE_DATA.cars[c.name]
    if not p then
      p = { laps = {}, trace = {}, ctl = {}, lat = {}, rough = 0, hits = 0, stuck = 0, frames = 0, lap = nil, t0 = 0, dmg = c.damage }
      PROBE_DATA.cars[c.name] = p
    end
    if c.finish_time and not p.finished then
      p.finished = true
      if p.lap and p.lap >= 0 and not sc.stage then p.laps[#p.laps + 1] = c.finish_time - p.t0 end
      if sc.stage then p.laps[#p.laps + 1] = c.finish_time end
    end
    if not c.finish_time then
      local lap = math.floor(c.progress / sc.length)
      if p.lap == nil then p.lap = lap end
      if lap > p.lap then
        if p.lap >= 0 then p.laps[#p.laps + 1] = sc.clock - p.t0 end
        p.lap, p.t0 = lap, sc.clock
      end
      p.frames = p.frames + 1
      if c.surface == "rough" then p.rough = p.rough + 1 end
      if c.damage > p.dmg + 1e-6 then p.hits = p.hits + 1 end
      p.dmg = c.damage
      if (c.stuck or 0) > 0.3 then p.stuck = p.stuck + 1 end
      if lap == (sc.stage and 0 or 1) then
        local wp = c.waypoint
        p.trace[wp] = c.speed
        p.ctl[wp] = (c.ctl.throttle or 0) - (c.ctl.brake or 0)
        p.lat[wp] = c.left or 0
      end
    end
  end
end
function PROBE_REPORT()
  local track = require("lib.track")
  local pts = {}
  for i = 1, track.count() do local q = track.point(i); pts[#pts + 1] = string.format("%.2f:%.5f:%.2f", q.seg, q.k, q.w) end
  nova.log("PROBE track " .. table.concat(pts, " "))
  for name, p in pairs(PROBE_DATA.cars) do
    local laps = {}
    for _, t in ipairs(p.laps) do laps[#laps + 1] = string.format("%.2f", t) end
    nova.log(string.format("PROBE car %s laps %s rough %.1f%% hits %d stuck %.1fs", name, table.concat(laps, ","), 100 * p.rough / math.max(1, p.frames), p.hits, p.stuck / 60))
    local tr = {}
    for i = 1, track.count() do tr[#tr + 1] = string.format("%.1f:%.2f:%.1f", p.trace[i] or -1, p.ctl[i] or 0, p.lat[i] or 0) end
    nova.log("PROBE trace " .. name .. " " .. table.concat(tr, " "))
  end
end
"#;

/// Plays a race set up by `race_direct` until every car has finished (or `max_seconds`), running the probe each frame (and
/// `each_frame` before it). Returns the mean Lua time of a frame in milliseconds; the log gets the probe's report.
fn run_probed(
    g: &mut Game,
    log: &mut Vec<String>,
    max_seconds: usize,
    each_frame: Option<&str>,
) -> f64 {
    let mut ms = 0.0;
    let mut n = 0usize;
    for _ in 0..60 * max_seconds {
        frame(g, &[]);
        ms += g.last_update.as_secs_f64() * 1000.0;
        n += 1;
        if let Some(lua) = each_frame {
            g.run_lua(lua, "each frame").expect("each-frame lua");
        }
        g.run_lua("PROBE()", "probe").expect("probe");
        log.extend(g.take_log());
        if g.lua_truth(ALL_DONE).unwrap_or(false) {
            break;
        }
    }
    g.run_lua("PROBE_REPORT()", "probe").expect("probe report");
    log.extend(g.take_log());
    ms / n.max(1) as f64
}
const ALL_DONE: &str = "(function() local sc = nova.scene_now(); if not sc.cars then return true end for _, c in ipairs(sc.cars) do if not c.finish_time then return false end end return true end)()";

/// One car of the probe's report: its laps, its summary line, and its trace (speed, throttle - brake, how far left of the middle) at
/// each waypoint of its second lap.
struct ProbeCar {
    laps: Vec<f32>,
    summary: String,
    trace: Vec<(f32, f32, f32)>,
}
type Trace = Vec<(f32, f32, f32)>;
fn probe_cars(log: &[String]) -> (Trace, std::collections::BTreeMap<String, ProbeCar>) {
    let triple = |s: &str| -> (f32, f32, f32) {
        let mut it = s.split(':').map(|v| v.parse::<f32>().unwrap_or(0.0));
        (
            it.next().unwrap_or(0.0),
            it.next().unwrap_or(0.0),
            it.next().unwrap_or(0.0),
        )
    };
    let track: Trace = log
        .iter()
        .rev()
        .find_map(|l| l.strip_prefix("PROBE track "))
        .map(|r| r.split(' ').map(triple).collect())
        .unwrap_or_default();
    let mut cars = std::collections::BTreeMap::new();
    for l in log.iter() {
        if let Some(r) = l.strip_prefix("PROBE car ") {
            let name = r.split(' ').next().unwrap().to_string();
            let laps = r
                .split(" laps ")
                .nth(1)
                .unwrap()
                .split(' ')
                .next()
                .unwrap()
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| s.parse().unwrap())
                .collect();
            cars.insert(
                name,
                ProbeCar {
                    laps,
                    summary: r.to_string(),
                    trace: Vec::new(),
                },
            );
        }
    }
    for l in log.iter() {
        if let Some(r) = l.strip_prefix("PROBE trace ") {
            let (name, rest) = r.split_once(' ').unwrap();
            if let Some(c) = cars.get_mut(name) {
                c.trace = rest.split(' ').map(triple).collect();
            }
        }
    }
    (track, cars)
}

/// Where a car loses time against a reference trace, in seconds, by the kind of road: straights (the reference on the throttle on
/// straight road), braking (the reference on the brake), corners (the reference off the throttle in a bend) and the rest (exits:
/// the reference back on the throttle in a bend).
fn time_lost(
    track: &[(f32, f32, f32)],
    car: &[(f32, f32, f32)],
    reference: &[(f32, f32, f32)],
) -> [f32; 4] {
    let mut lost = [0.0f32; 4];
    let n = track.len().min(car.len()).min(reference.len());
    for i in 0..n {
        let (seg, k, _) = track[i];
        let (v, _, _) = car[i];
        let (vr, ctl_r, _) = reference[i];
        if v <= 0.5 || vr <= 0.5 {
            continue;
        }
        let dt = seg / v - seg / vr;
        let kind = if k.abs() < 0.006 && ctl_r > 0.5 {
            0
        } else if ctl_r < -0.05 {
            1
        } else if ctl_r <= 0.5 {
            2
        } else {
            3
        };
        lost[kind] += dt;
    }
    lost
}

fn best(laps: &[f32]) -> f32 {
    laps.iter().cloned().fold(f32::MAX, f32::min)
}

/// How the rivals drive, against the reference (the computer driving the player's car at its best, alone, in a time trial): each
/// one's laps, its time off the road, its hits, and where it loses time. Run on purpose:
/// `cargo test --release -p nova-runtime --test rally rival_report -- --ignored --nocapture`
/// (COURSES=pine_ridge,... for some; CARS=1,2 for the cars, as numbers into `state.cars`; RIVALS=easy|normal|hard).
#[test]
#[ignore]
fn rival_report() {
    let only =
        std::env::var("COURSES").unwrap_or("pine_ridge,ridge_gp,dust_valley,frost_pass".into());
    let cars = std::env::var("CARS").unwrap_or("1,2".into());
    let level = std::env::var("RIVALS").unwrap_or("normal".into());
    let laps: i32 = std::env::var("LAPS")
        .ok()
        .and_then(|l| l.parse().ok())
        .unwrap_or(3);
    for course in only.split(',') {
        for car in cars.split(',').map(|c| c.parse::<usize>().unwrap()) {
            let setup = format!(
                "s.rival_level = '{level}'; {}",
                std::env::var("SETUP").unwrap_or_default()
            );
            let (mut g, mut log) = race_direct(course, car, "trial", 2, &setup);
            g.run_lua("nova.scene_now().player.autopilot = true", "autopilot")
                .unwrap();
            let _ = run_probed(&mut g, &mut log, 60 * 6, None);
            let (_, refc) = probe_cars(&log);
            let reference = refc.get("You").expect("the reference");
            let best_ref = best(&reference.laps);
            let ideal = log
                .iter()
                .find(|l| l.starts_with("rivals: ideal"))
                .cloned()
                .unwrap_or_default();
            println!("REF {course} car {car}: {} {ideal}", reference.summary);
            let (mut g, mut log) = race_direct(course, car, "race", laps, &setup);
            g.run_lua("nova.scene_now().player.autopilot = true", "autopilot")
                .unwrap();
            let ms = run_probed(&mut g, &mut log, 60 * 12, None);
            let (track, cars) = probe_cars(&log);
            for (name, c) in cars.iter() {
                let b = best(&c.laps);
                let lost = time_lost(&track, &c.trace, &reference.trace);
                println!(
                    "  {course} car {car} {name:6} best {b:6.2} ({:+5.1}% of ref {best_ref:.2}) | {} | lost s: straight {:+.1} braking {:+.1} corner {:+.1} exit {:+.1}",
                    100.0 * (b / best_ref - 1.0),
                    c.summary,
                    lost[0],
                    lost[1],
                    lost[2],
                    lost[3]
                );
            }
            for l in log.iter().filter(|l| l.contains("put back on the road")) {
                println!("  {course} car {car}: {l}");
            }
            println!("  {course} car {car}: lua {ms:.3} ms a frame");
        }
    }
}

/// A Lua expression printed every few frames of a race, for looking into the driving: `COURSE` (pine_ridge), `CAR` (1), `MODE`
/// (trial), `LAPS` (2), `SETUP` (Lua run as the race is set up), `START` (Lua run at the green light: the player's car is driven by the
/// computer unless it says otherwise), `EXPR`, `EVERY` (frames, 10), `SECONDS` (120). Run on purpose:
/// `EXPR='nova.scene_now().player.speed' cargo test --release -p nova-runtime --test rally lua_trace -- --ignored --nocapture`.
#[test]
#[ignore]
fn lua_trace() {
    let var = |k: &str, d: &str| std::env::var(k).unwrap_or(d.into());
    let (course, mode, expr) = (
        var("COURSE", "pine_ridge"),
        var("MODE", "trial"),
        var("EXPR", "nova.scene_now().player.speed"),
    );
    let car: usize = var("CAR", "1").parse().unwrap();
    let laps: i32 = var("LAPS", "2").parse().unwrap();
    let every: usize = var("EVERY", "10").parse().unwrap();
    let seconds: usize = var("SECONDS", "120").parse().unwrap();
    let (mut g, mut log) = race_direct(&course, car, &mode, laps, &var("SETUP", ""));
    g.run_lua(
        &var("START", "nova.scene_now().player.autopilot = true"),
        "start",
    )
    .unwrap();
    for f in 0..60 * seconds {
        frame(&mut g, &[]);
        log.extend(g.take_log());
        if f % every == 0 {
            println!("f{f} {}", g.lua_text(&expr).unwrap_or_else(|e| e));
        }
        if g.lua_truth(ALL_DONE).unwrap_or(false) {
            break;
        }
    }
    for l in log.iter().filter(|l| !l.starts_with("PROBE")) {
        println!("LOG {l}");
    }
}

/// A Lua number (the value of `expression`).
fn lua_number(g: &Game, expression: &str) -> f64 {
    let text = g
        .lua_text(&format!("tostring({expression})"))
        .unwrap_or_else(|e| panic!("{expression}: {e}"));
    text.trim_matches('"')
        .parse()
        .unwrap_or_else(|_| panic!("{expression} is not a number: {text}"))
}

/// The best lap of each car of a race, from the probe: (name, best lap, the longest it was off the road at once, in seconds).
fn race_laps(course: &str, car: usize, laps: i32, setup: &str) -> Vec<(String, f32, f32)> {
    let (mut g, mut log) = race_direct(course, car, "race", laps, setup);
    g.run_lua("nova.scene_now().player.autopilot = true", "autopilot")
        .unwrap();
    // (the longest stretch each car spends with its wheels on the grass)
    g.run_lua(
        "ROUGH = {}; local probe = PROBE; PROBE = function() probe(); for _, c in ipairs(nova.scene_now().cars) do local r = ROUGH[c.name] or { now = 0, most = 0 }; ROUGH[c.name] = r; if c.surface == 'rough' and not c.finish_time then r.now = r.now + 1 / 60 else r.now = 0 end; if r.now > r.most then r.most = r.now end end end",
        "rough",
    )
    .unwrap();
    run_probed(&mut g, &mut log, 60 * 12, None);
    assert!(
        !log.iter().any(|l| l.contains("put back on the road")),
        "{course}: nobody is put back: {:?}",
        log.iter()
            .filter(|l| l.contains("put back"))
            .collect::<Vec<_>>()
    );
    let (_, cars) = probe_cars(&log);
    cars.iter()
        .map(|(name, c)| {
            let most = lua_number(&g, &format!("ROUGH['{name}'].most")) as f32;
            (name.clone(), best(&c.laps), most)
        })
        .collect()
}

/// The reference: the best of two laps of a time trial in the same car, driven by the computer at its best (F9).
fn reference_lap(course: &str, car: usize) -> f32 {
    let (mut g, mut log) = race_direct(course, car, "trial", 2, "");
    g.run_lua("nova.scene_now().player.autopilot = true", "autopilot")
        .unwrap();
    run_probed(&mut g, &mut log, 60 * 6, None);
    let (_, cars) = probe_cars(&log);
    best(&cars["You"].laps)
}

/// On Normal the rivals are a field, not a pack: the fastest a few per cent off the reference lap, the slowest about ten, and a spread
/// between them; nobody is put back or spends more than a moment on the grass, over a whole race, on a tarmac circuit, a gravel one and a
/// snow one. Slow (about a minute and a half): `cargo test --release -p nova-runtime --test rally rivals_are_a_field -- --ignored`.
#[test]
#[ignore]
fn rivals_are_a_field_close_to_the_reference_and_keep_to_the_road() {
    for course in ["pine_ridge", "dust_valley", "frost_pass"] {
        let reference = reference_lap(course, 1);
        let laps = race_laps(course, 1, 3, "s.rival_level = 'normal'");
        let rivals: Vec<&(String, f32, f32)> = laps.iter().filter(|(n, _, _)| n != "You").collect();
        let fastest = rivals.iter().map(|r| r.1).fold(f32::MAX, f32::min);
        let slowest = rivals.iter().map(|r| r.1).fold(0.0, f32::max);
        println!("{course}: reference {reference:.2}, rivals {rivals:?}");
        assert!(
            fastest < reference * 1.05,
            "{course}: the fastest rival is within a few per cent of the reference lap {reference:.2}: {rivals:?}"
        );
        assert!(
            slowest < reference * 1.12,
            "{course}: the slowest rival is within about 12% of the reference lap {reference:.2}: {rivals:?}"
        );
        assert!(
            slowest > fastest * 1.015,
            "{course}: the rivals are spread out, not one pace: {rivals:?}"
        );
        for (name, _, most) in rivals {
            assert!(
                *most < 1.0,
                "{course}: {name} is never on the grass for more than a moment ({most:.2} s)"
            );
        }
    }
}

/// A faster car catching a slower one on a straight moves out and passes it, with no contact and no pile-up: Mika is put 40 m behind
/// Rosa (who is held to 18 m/s), in her lane, the others far away.
#[test]
fn a_faster_rival_passes_a_slower_one_without_touching_it() {
    let (mut g, mut log) = race_direct("ridge_gp", 1, "race", 3, "s.rival_level = 'normal'");
    // the start of the circuit's long straight: the waypoint with the longest run of gentle bends after it
    g.run_lua(
        r#"
        local sc = nova.scene_now()
        local track = require('lib.track')
        local best, at = 0, 1
        for i = 1, track.count() do
          local run = 0
          while run < 40 and math.abs(track.point(i + run).k) < 0.004 do run = run + 1 end
          if run > best then best, at = run, i end
        end
        local function car(name) for _, c in ipairs(sc.cars) do if c.name == name then return c end end end
        local function put(c, s, left)
          local x, z, _, tx, tz = track.at(s)
          c:teleport(x + tz * left, z - tx * left, math.atan(tx, tz))
          sc:locate(c)
          c.progress = s + sc.length -- (as if it had started the lap)
          c.velx, c.velz, c.speed = tx * 18, tz * 18, 18
        end
        local s0 = track.point(at).s
        local rosa, mika = car('Rosa'), car('Mika')
        put(rosa, s0 + 45, 0); put(mika, s0 + 5, 0)
        rosa.cruise = 18
        put(car('Dax'), s0 - 150, 3); put(sc.player, s0 - 200, -3)
        sc.player.autopilot = true; sc.player.cruise = 5; car('Dax').cruise = 5
        CONTACT, CLOSEST = 0, 99
        PASS_A, PASS_B = rosa, mika
        "#,
        "set up the pass",
    )
    .unwrap();
    let check = r#"
        local a, b = PASS_A, PASS_B
        local closest = 99
        for ka = -1, 1, 2 do for kb = -1, 1, 2 do
          local dx = (b.x + math.sin(b.heading) * kb) - (a.x + math.sin(a.heading) * ka)
          local dz = (b.z + math.cos(b.heading) * kb) - (a.z + math.cos(a.heading) * ka)
          closest = math.min(closest, math.sqrt(dx * dx + dz * dz))
        end end
        if closest < 1.9 then CONTACT = CONTACT + 1 end
        if closest < CLOSEST then CLOSEST = closest end
    "#;
    for _ in 0..60 * 12 {
        frame(&mut g, &[]);
        g.run_lua(check, "check").unwrap();
    }
    log.extend(g.take_log());
    let ahead = lua_number(&g, "PASS_B.progress - PASS_A.progress");
    let contact = lua_number(&g, "CONTACT");
    let closest = lua_number(&g, "CLOSEST");
    let damage = lua_number(&g, "PASS_A.damage + PASS_B.damage");
    assert!(
        ahead > 10.0,
        "Mika got past Rosa ({ahead:.1} m ahead after 12 s)"
    );
    assert_eq!(
        contact, 0.0,
        "no contact (closest {closest:.2} m between their circles)"
    );
    assert!(damage < 1e-6, "neither is damaged: {damage}");
}

/// The suspension over a course of jumps (short ridges across the road at speed): every frame, every wheel is within its travel (from
/// the droop stop to the bump stop, so inside its arch) and is drawn where its station on the body says; the car leaves the ground and
/// lands again. For a GT car, a 4x4 and the six-wheeler.
#[test]
fn over_jumps_every_wheel_stays_within_its_travel_and_in_its_arch() {
    for car in [1usize, 2, 13] {
        let (mut g, _log) = race_direct("pine_ridge", car, "trial", 3, "");
        g.run_lua(
            r#"
            local p = nova.scene_now().player
            p.autopilot = true
            local deg = math.deg(math.atan(math.cos(p.heading), math.sin(p.heading)))
            nova.terrain { waves = { { wavelength = 40, direction = deg, height = 1.0, phase = 0 } } }
            p.susp.ready = false
            require('lib.racing').clear(); p.ai = nil
            BAD, AIR, LANDED, FRAMES, WORST = 0, 0, 0, 0, ''
            "#,
            "jumps",
        )
        .unwrap();
        let check = r#"
            local p = nova.scene_now().player
            local sp, r = p.susp, p.ride
            FRAMES = FRAMES + 1
            for i, s in ipairs(p.stations) do
              local travel = sp.s[i]
              local drawn = p:wheel_offset(i) - ((sp.y - sp.t[i]) + s.fwd * sp.p + s.left * sp.r)
              if travel < -r.droop - 1e-6 or travel > r.bump + 1e-6 or math.abs(drawn - travel) > 1e-6 then
                BAD = BAD + 1
                WORST = string.format('%s s=%.3f drawn=%.3f (droop %.3f, bump %.3f)', s.name, travel, drawn, r.droop, r.bump)
              end
            end
            if p.airborne then AIR = AIR + 1 elseif AIR > 0 and LANDED == 0 then LANDED = FRAMES end
        "#;
        for _ in 0..60 * 14 {
            frame(&mut g, &[]);
            g.run_lua(check, "check").unwrap();
        }
        let bad = lua_number(&g, "BAD");
        let air = lua_number(&g, "AIR");
        let landed = lua_number(&g, "LANDED");
        let worst = g.lua_text("WORST").unwrap();
        assert_eq!(
            bad, 0.0,
            "car {car}: every wheel within its travel: {worst}"
        );
        if car == 1 {
            // (the 4x4 and the six-wheeler are slower and their long travel soaks most of these up: they ride them)
            assert!(
                air > 5.0,
                "car {car}: the jumps throw it into the air ({air} frames)"
            );
            assert!(landed > 0.0, "car {car}: and it lands");
        }
    }
}

/// On flat ground, standing still, every car settles at its ride height: the body where the model has it, level, every wheel touching
/// and at rest in its travel. Dropped from 25 cm it lands, rebounds once at most, and settles again within a second and a half.
#[test]
fn a_car_at_rest_on_flat_ground_settles_at_ride_height_on_every_wheel() {
    for car in [1usize, 2, 6, 7, 13] {
        let (mut g, _log) = race_direct("pine_ridge", car, "trial", 3, "");
        g.run_lua(
            "nova.terrain(); local p = nova.scene_now().player; p.enabled = false; p.susp.ready = false",
            "flat",
        )
        .unwrap();
        for _ in 0..120 {
            frame(&mut g, &[]);
        }
        let state = "(function() local p = nova.scene_now().player; local sp = p.susp; local worst, touching = 0, 0 for i = 1, #p.stations do worst = math.max(worst, math.abs(sp.s[i]), math.abs(p:wheel_offset(i))); if sp.touch[i] then touching = touching + 1 end end return string.format('%.4f %.4f %.4f %.4f %d %d', p.lift, p.pitch, p.roll, worst, touching, #p.stations) end)()";
        let read = |g: &Game| -> Vec<f64> {
            g.lua_text(state)
                .unwrap()
                .trim_matches('"')
                .split(' ')
                .map(|v| v.parse().unwrap())
                .collect()
        };
        let v = read(&g);
        assert!(
            v[0].abs() < 0.004,
            "car {car}: the body at ride height: {v:?}"
        );
        assert!(
            v[1].abs() < 0.003 && v[2].abs() < 0.003,
            "car {car}: level: {v:?}"
        );
        assert!(
            v[3] < 0.004,
            "car {car}: each wheel at rest in its travel: {v:?}"
        );
        assert_eq!(v[4], v[5], "car {car}: every wheel touches: {v:?}");
        // dropped from 25 cm: count the times the body comes back up from more than 1.5 cm below its ride height (each a compression)
        g.run_lua(
            "local p = nova.scene_now().player; p.susp.y = p.susp.y + 0.25; LAST, REBOUNDS = p.lift, 0",
            "drop",
        )
        .unwrap();
        for _ in 0..90 {
            frame(&mut g, &[]);
            g.run_lua(
                "local p = nova.scene_now().player; if LAST < -0.015 and p.lift >= -0.015 then REBOUNDS = REBOUNDS + 1 end LAST = p.lift",
                "watch",
            )
            .unwrap();
        }
        let rebounds = lua_number(&g, "REBOUNDS");
        assert!(
            rebounds <= 1.0,
            "car {car}: one compression, one rebound, no second bounce after a drop ({rebounds})"
        );
        let v = read(&g);
        assert!(
            v[0].abs() < 0.006,
            "car {car}: settled again after the drop: {v:?}"
        );
    }
}

/// The ideal time of a course for a class (lib/racing.lua's `racing.ideal_time`, for par times) is there for every circuit and stage,
/// worked out from the scene file alone (from the title screen), at a believable average speed.
#[test]
fn every_course_has_an_ideal_time_for_each_class() {
    let mut g = load();
    for _ in 0..5 {
        frame(&mut g, &[]);
    }
    for id in CIRCUITS.iter().chain(STAGES.iter()) {
        let sport = lua_number(
            &g,
            &format!("require('lib.racing').ideal_time('{id}', 'sport')"),
        );
        let everyday = lua_number(
            &g,
            &format!("require('lib.racing').ideal_time('{id}', 'everyday')"),
        );
        let length = lua_number(
            &g,
            &format!(
                "(function() local n, d, last = 0, 0, nil; local pts = {{}}; for _, o in ipairs(nova.scene_data('{id}').objects) do if o.kind == 'waypoint' then pts[#pts + 1] = o end end table.sort(pts, function(a, b) return (a.props.i or 0) < (b.props.i or 0) end) for _, o in ipairs(pts) do if last then d = d + math.sqrt((o.x - last.x) ^ 2 + (o.z - last.z) ^ 2) end last = o end return d end)()"
            ),
        );
        let (vs, ve) = (length / sport, length / everyday);
        println!(
            "{id}: {length:.0} m, sport {sport:.1} s ({vs:.1} m/s), 4x4 {everyday:.1} s ({ve:.1} m/s)"
        );
        assert!(
            (12.0..55.0).contains(&vs),
            "{id}: a road car averages {vs:.1} m/s"
        );
        assert!(
            (10.0..50.0).contains(&ve),
            "{id}: a 4x4 averages {ve:.1} m/s"
        );
    }
}

/// What the game's Lua costs a frame in a race with a full grid (four cars, the player's driven by the computer so that the rivals are
/// close by and in view): the mean of 40 seconds, on this machine. The device is several times slower; before this change (2026-11-21:
/// the old suspension and drivers) it was 0.32 to 0.67 ms a frame here on the same courses (rival_report). Run on purpose:
/// `cargo test --release -p nova-runtime --test rally full_grid_lua_cost -- --ignored --nocapture`.
#[test]
#[ignore]
fn full_grid_lua_cost() {
    for course in ["pine_ridge", "dust_valley", "frost_pass", "ridge_gp"] {
        let (mut g, _log) = race_direct(course, 1, "race", 3, "");
        g.run_lua("nova.scene_now().player.autopilot = true", "autopilot")
            .unwrap();
        let (mut total, mut worst) = (0.0, 0.0f64);
        let frames = 60 * 40;
        for _ in 0..frames {
            frame(&mut g, &[]);
            let ms = g.last_update.as_secs_f64() * 1000.0;
            total += ms;
            worst = worst.max(ms);
        }
        let mean = total / frames as f64;
        println!("full_grid_lua_cost {course}: mean {mean:.3} ms, worst {worst:.2} ms a frame");
        assert!(
            mean < 2.0,
            "{course}: the Lua of a frame stays cheap ({mean:.3} ms)"
        );
    }
}

// ---- a rally stage's HUD: no map, notes at the top centre read aloud, a bar of sections (2026-11-21) -------------------------------

/// A boolean the HUD of the last frame recorded (`hud_drawn`: what it put on the screen).
fn hud_drawn(g: &Game, part: &str) -> bool {
    g.lua_text(&format!("tostring(nova.scene_now().hud_drawn.{part})"))
        .unwrap_or_else(|e| panic!("hud_drawn.{part}: {e}"))
        .trim_matches('"')
        == "true"
}

/// The text of a Lua expression, without its quotes.
fn lua_said(g: &Game, expr: &str) -> String {
    g.lua_text(expr)
        .unwrap_or_else(|e| panic!("{expr}: {e}"))
        .trim_matches('"')
        .to_string()
}

#[test]
fn a_rally_stage_shows_no_map_of_its_route_in_the_hud_or_on_the_stage_choice_but_circuits_keep_theirs()
 {
    // in the race
    let (mut g, _) = race_direct("stage_pine_ridge", 1, "rally", 1, "");
    g.run_lua("nova.scene_now().player.autopilot = true", "autopilot")
        .unwrap();
    for _ in 0..240 {
        frame(&mut g, &[]);
    }
    assert!(!hud_drawn(&g, "map"), "a stage's HUD has no route map");
    assert!(hud_drawn(&g, "notes"), "the pace notes are drawn");
    assert!(hud_drawn(&g, "bar"), "the bar of sections is drawn");
    let (mut g, _) = race_direct("pine_ridge", 1, "race", 2, "");
    for _ in 0..60 {
        frame(&mut g, &[]);
    }
    assert!(hud_drawn(&g, "map"), "a circuit's HUD keeps its map");
    assert!(!hud_drawn(&g, "bar"), "a circuit has no bar of sections");
    // on the choice screens: Rally (the first mode), then a circuit (the second)
    let mut g = load();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:Enter"); // Rally -> its stages
    for _ in 0..10 {
        frame(&mut g, &[]);
    }
    assert_eq!(
        lua_said(&g, "tostring(require('lib.scenic').last)"),
        "stage_pine_ridge",
        "the stage's picture is drawn"
    );
    assert_eq!(
        lua_said(&g, "tostring(require('lib.scenic').map_last)"),
        "nil",
        "no route is drawn for a stage"
    );
    let mut g = load();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:ArrowDown");
    tap(&mut g, "key:Enter"); // Circuit -> its circuits
    for _ in 0..10 {
        frame(&mut g, &[]);
    }
    assert_eq!(
        lua_said(&g, "tostring(require('lib.scenic').map_last)"),
        "pine_ridge",
        "a circuit's route is drawn"
    );
    assert_eq!(
        lua_said(&g, "tostring(require('lib.scenic').last)"),
        "nil",
        "and no stage picture"
    );
}

#[test]
fn the_co_driver_queues_the_right_clips_for_a_note_and_stays_silent_without_them() {
    let g = load();
    let words = |notes: &str, k: usize, away: &str| {
        lua_said(
            &g,
            &format!(
                "(function() local c = require('lib.codriver'); local n = {notes}; local w, count = c.words(n, {k}, {away}); return table.concat(w, ' ') .. ' #' .. count end)()"
            ),
        )
    };
    let left4 = "{ s = 300, e = 360, left = true, grade = 4, long = true, tightens = true }";
    let right2 = "{ s = 400, e = 440, left = false, grade = 2 }";
    // a bend with what goes with it, 210 m off, and the next one close behind it: one call, joined with "into"
    assert_eq!(
        words(&format!("{{ {left4}, {right2} }}"), 1, "210"),
        "two_hundred left four long tightens into right two #2"
    );
    // too near for a distance; a bend far from the next is a call of its own
    assert_eq!(
        words(
            &format!("{{ {left4}, {{ s = 900, e = 940, left = false, grade = 3 }} }}"),
            1,
            "60"
        ),
        "left four long tightens #1"
    );
    // a hairpin, a square corner, a flat kink, a crest on its own, the finish
    assert_eq!(
        words(
            "{ { s = 100, e = 150, left = false, grade = 1, hairpin = true } }",
            1,
            "120"
        ),
        "one_hundred hairpin right #1"
    );
    assert_eq!(
        words(
            "{ { s = 100, e = 130, left = true, grade = 3, square = true, caution = true } }",
            1,
            "nil"
        ),
        "square left caution #1"
    );
    assert_eq!(
        words(
            "{ { s = 100, e = 120, left = true, grade = 6, flat = true } }",
            1,
            "nil"
        ),
        "left flat #1"
    );
    assert_eq!(
        words("{ { s = 100, e = 100, kind = 'crest' } }", 1, "160"),
        "one_fifty crest #1"
    );
    assert_eq!(
        words("{ { s = 100, e = 140, kind = 'finish' } }", 1, "nil"),
        "finish #1"
    );
    // every clip the notes can need is one the voice script makes
    let script = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/rally/voice.mjs"),
    )
    .unwrap();
    for name in [
        "left",
        "right",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "hairpin",
        "square",
        "flat",
        "long",
        "short",
        "tightens",
        "opens",
        "crest",
        "jump",
        "dip",
        "caution",
        "dont_cut",
        "into",
        "and",
        "fifty",
        "one_hundred",
        "one_fifty",
        "two_hundred",
        "finish",
        "go",
    ] {
        assert!(
            script.contains(&format!("{name}:")),
            "voice.mjs makes the clip {name}"
        );
    }
    // with no clips (a folder that is not there) the game goes on and says nothing: every word is tried once, none is spoken, no error
    let g = load();
    g.run_lua(
        "local c = require('lib.codriver'); c.prefix = 'no_such_voice/'; c.reset({ { s = 150, e = 200, left = true, grade = 3, long = true }, { s = 230, e = 260, left = false, grade = 2 } })",
        "silent",
    )
    .unwrap();
    for i in 0..600 {
        g.run_lua(
            &format!("require('lib.codriver').update(1/60, true, {i} / 60 * 30, 30)"),
            "step",
        )
        .unwrap();
        assert!(g.error.is_none(), "no error without clips: {:?}", g.error);
    }
    let spoken = lua_said(
        &g,
        "(function() local n, s = 0, 0 for _, e in ipairs(require('lib.codriver').log()) do n = n + 1 if e.spoken then s = s + 1 end end return n .. ' ' .. s end)()",
    );
    let (n, s) = spoken.split_once(' ').unwrap();
    assert!(
        n.parse::<usize>().unwrap() >= 6,
        "the calls were made: {spoken}"
    );
    assert_eq!(s, "0", "and none was heard: {spoken}");
    assert_eq!(
        lua_said(&g, "tostring(require('lib.codriver').speaking())"),
        "false",
        "nothing is left waiting"
    );
}

#[test]
fn nothing_that_stays_on_screen_moves_between_the_frame_before_the_pause_and_the_paused_one() {
    let (mut g, _) = race_direct("stage_pine_ridge", 1, "rally", 1, "");
    g.run_lua("nova.scene_now().player.autopilot = true", "autopilot")
        .unwrap();
    for _ in 0..600 {
        frame(&mut g, &[]);
    }
    let snap = |g: &Game| {
        lua_said(
            g,
            "(function() local r = nova.scene_now(); local c, p = r.camera, r.player; local w, h = nova.view(); return string.format('%.5f %.5f %.5f %.5f %.5f %.5f %.4f %.5f | %.5f %.5f %.5f | view %d %d', c.x, c.y, c.z, c.tx, c.ty, c.tz, c.fov, c.heading, p.x, p.z, p.heading, w, h) end)()",
        )
    };
    let before = snap(&g);
    tap(&mut g, "key:Escape");
    assert_eq!(lua_said(&g, "tostring(nova.scene_now().paused)"), "true");
    assert_eq!(
        before,
        snap(&g),
        "the camera, the car and the screen's size stay put when the game is paused"
    );
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    assert_eq!(before, snap(&g), "and stay put while it is paused");
    assert!(
        before.ends_with("view 960 540"),
        "the screen is 960 by 540 units: {before}"
    );
}

#[test]
fn sections_fill_with_green_yellow_or_red_by_their_time_against_the_target_and_add_up_to_the_stage()
{
    let g = load();
    // a fast, a middling and a slow section against a 20 second target (green to 10 %, yellow to 25 %, red beyond: lib/sections.lua)
    for (time, colour) in [
        (18.5, "green"),
        (20.0, "green"),
        (21.9, "green"),
        (23.0, "yellow"),
        (24.9, "yellow"),
        (26.0, "red"),
        (40.0, "red"),
    ] {
        assert_eq!(
            lua_said(&g, &format!("(require('lib.sections').grade({time}, 20))")),
            colour,
            "{time} s against 20 s"
        );
    }
    // the sections of a stage with no gates of its own: 6 to 12, in order, side by side, and they end where the stage does
    for length in [1500, 2600, 4600, 6000] {
        let out = lua_said(
            &g,
            &format!(
                "(function() local s = require('lib.sections'); local plan = s.plan({length}, nil, {{ {{ s = 300, e = 380, grade = 3, left = true }}, {{ s = 900, e = 1000, grade = 2, left = false }} }}); local sum, last = 0, 0; local ok = true; for _, p in ipairs(plan) do if math.abs(p.from - last) > 1e-6 or p.to <= p.from then ok = false end sum = sum + (p.to - p.from); last = p.to end return string.format('%d %.3f %s', #plan, sum, tostring(ok)) end)()"
            ),
        );
        let parts: Vec<&str> = out.split(' ').collect();
        let count: usize = parts[0].parse().unwrap();
        assert!((6..=12).contains(&count), "{length} m: {count} sections");
        assert!(
            (parts[1].parse::<f64>().unwrap() - length as f64).abs() < 0.01,
            "{length} m: the sections add up: {out}"
        );
        assert_eq!(parts[2], "true", "{length} m: contiguous, in order");
    }
    // and in a real stage: the bar's sections cover it, each has a target, and the targets add up to the ideal time of the stage
    let (g, _) = race_direct("stage_dust_valley", 1, "rally", 1, "");
    let out = lua_said(
        &g,
        "(function() local r = nova.scene_now(); local sum, last, targets, ok = 0, 0, 0, true; for _, b in ipairs(r.bar) do if math.abs(b.from - last) > 0.01 or b.target <= 0 then ok = false end sum = sum + b.to - b.from; last = b.to; targets = targets + b.target end local ideal = r:ideal_time(r.player); return string.format('%.3f %.3f %.3f %.3f %s', sum, r.length, targets, ideal, tostring(ok)) end)()",
    );
    let n: Vec<&str> = out.split(' ').collect();
    let (sum, length, targets, ideal): (f64, f64, f64, f64) = (
        n[0].parse().unwrap(),
        n[1].parse().unwrap(),
        n[2].parse().unwrap(),
        n[3].parse().unwrap(),
    );
    // (the last section ends at the finish gate, a little before the road's end, where the line's own ideal time runs on)
    assert!(
        sum > length - 120.0 && sum <= length + 0.01,
        "the sections add up to the stage up to its finish: {out}"
    );
    assert!(
        targets < ideal && targets > 0.92 * ideal,
        "the targets add up to the stage's ideal time up to the finish: {out}"
    );
    assert_eq!(
        n[4], "true",
        "each section starts where the one before ends and has a target: {out}"
    );
}

#[test]
fn the_computer_at_its_best_fills_most_of_a_stages_bar_green_and_none_of_it_red() {
    let log = stage_run(0, 1);
    let colours: Vec<&str> = log
        .iter()
        .filter(|l| l.starts_with("rally: section ") && l.contains(" of its target "))
        .map(|l| l.split(' ').nth(3).unwrap().trim_end_matches(':'))
        .collect();
    assert_eq!(
        colours.len(),
        5,
        "a colour for each of the five sections: {log:?}"
    );
    assert!(
        !colours.contains(&"red"),
        "the computer at its best is never red: {colours:?}"
    );
    assert!(
        colours.iter().filter(|c| **c == "green").count() >= 3,
        "and mostly green: {colours:?}"
    );
}

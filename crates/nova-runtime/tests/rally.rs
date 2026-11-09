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
    /// The car the save says was driven last, as a number into `state.cars` (lib/state.lua; 1 is Redline).
    static CAR: Cell<usize> = const { Cell::new(1) };
}

/// The cars of `state.cars`, in its order (lib/state.lua): the save of an ordinary test owns them all.
const CARS: [&str; 25] = [
    "car",
    "car_blue",
    "car_green",
    "car_yellow",
    "car_sedan",
    "car_suv",
    "car_suvl",
    "car_taxi",
    "car_police",
    "car_van",
    "car_pickup",
    "racecar_green",
    "racecar_orange",
    "racecar_red",
    "racecar_white",
    "kart_oobi",
    "kart_oodi",
    "kart_ooli",
    "kart_oopi",
    "kart_oozi",
    "ambulance",
    "firetruck",
    "garbage_truck",
    "delivery",
    "tractor",
];
/// The first car of each class (formula, sport, everyday, kart, fun), as numbers into `state.cars`.
const CLASS_CARS: [usize; 5] = [1, 2, 5, 16, 21];

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
const STAGES: [&str; 10] = [
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
];

fn load() -> Game {
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
    // every car has a time when the player finishes (the ones still racing get an estimate, not "did not finish"), and a Formula
    // car's rivals drive other Formula cars
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
            [
                "car_yellow",
                "racecar_green",
                "racecar_orange",
                "racecar_red",
                "racecar_white"
            ]
            .contains(&r),
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
    tap(&mut g, "key:ArrowUp"); // (up from Race wraps round to Options, the last of the main menu)
    tap(&mut g, "key:Enter"); // Options
    for _ in 0..7 {
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
    // down to "Back to the defaults" (after the nine rows) and choose it
    for _ in 0..9 {
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
    // 0 is Redline (the Formula class); 1 and 2 are the first two of the Sport class (Blue Streak, Green Machine); a time trial: no rivals
    // to bump the car
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
fn the_sedan_and_hatchback_drift_under_power_in_a_bend_and_the_formula_car_grips() {
    // Redline (0), Blue Streak (1), Green Machine (2)
    let (formula_slip, _, _) = cornering(0, 90, 4, 0.7);
    let (blue_slip, _, _) = cornering(1, 90, 4, 0.7);
    let (_, blue_speed, _) = cornering(1, 50, 4, 0.7);
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
    let cars = [
        ("Redline", 1),
        ("Sunburst", 4),
        ("Blue Streak", 2),
        ("Green Machine", 3),
        ("Grand Tourer", 7),
        ("Patrol", 9),
        ("Commuter", 5),
        ("Trailblazer", 6),
        ("Cab", 8),
        ("Delivery Van", 10),
        ("Hauler", 11),
    ];
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
const CLASSES: [&str; 5] = ["formula", "sport", "everyday", "kart", "fun"];

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

/// Free roam: the main menu's FREE ROAM puts the car on the map beside the circuit race's marker; Y shows the race and A starts it; the
/// race runs to its results, and Return goes back to free roam (not the main menu). Driving away from every road ends in a fade back to one.
#[test]
fn free_roam_starts_an_event_in_the_world_and_comes_back_to_it() {
    let mut g = load();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    for _ in 0..3 {
        tap(&mut g, "key:ArrowDown"); // Rally, Circuit, Time trial -> Free roam
    }
    frame(&mut g, &["key:Enter"]);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "free roam starts", 60 * 6, |l| {
        l.iter()
            .any(|x| x.starts_with("roam: ") && x.contains("3 events"))
    });
    for _ in 0..90 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:KeyY"); // the race's details
    for _ in 0..20 {
        frame(&mut g, &[]); // (the card takes no press for its first moment, so that Y is not also taken as a choice)
    }
    tap(&mut g, "key:Enter"); // START
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "the race starts", 60 * 8, |l| {
        l.iter().any(|x| x == "go")
    });
    assert!(
        log.iter()
            .any(|l| l == "roam: start race on pine_ridge in car"),
        "{log:?}"
    );
    assert!(
        log.iter().any(|l| l == "rally: course pine_ridge"),
        "{log:?}"
    );
    tap(&mut g, "key:F9");
    run_until(&mut g, &mut log, "the results", 60 * 60 * 6, |l| {
        l.iter().any(|x| x.starts_with("results: place"))
    });
    for _ in 0..120 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:ArrowDown"); // Return
    frame(&mut g, &["key:Enter"]);
    let mut log = Vec::new();
    run_until(&mut g, &mut log, "back in free roam", 60 * 4, |l| {
        l.iter()
            .any(|x| x.starts_with("roam: ") && x.contains("3 events"))
    });
    // full throttle, turning gently right: off the circuit and across the grass until the game puts the car back on a road
    let mut log = Vec::new();
    for _ in 0..60 * 40 {
        frame_with(&mut g, &[("key:ArrowUp", 1.0), ("key:ArrowRight", 0.25)]);
        log.extend(g.take_log());
        if log.iter().any(|l| l == "roam: put back on the road") {
            break;
        }
    }
    assert!(
        log.iter().any(|l| l == "roam: put back on the road"),
        "{log:?}"
    );
}

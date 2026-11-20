//! Neon Undertow, slice 1 (the runner): the routes kept in `examples/neon-undertow/tools/r_*.json` are played headless and the
//! values they print are asserted, so later slices cannot quietly break a rule of the feel: the baton chain (2, 2, 4), the
//! 5-frame start-up and 3-frame hit-stop, the roll (3.2 tiles, untouchable for 0.22 s, 0.6 s between rolls), the aim walk (35%),
//! charge pips, health, the blink, the Scrapper's swing, scrap and the restart after dying.
//!
//! The route files are the `play` tool's arguments (`route`, ...); this test turns them into a plan (`steps`) and drops what
//! only the picture tools read (`crop`, `zoom`, `out`, `columns`). Regenerate them with
//! `scripts/env.sh node examples/neon-undertow/tools/routes.mjs`.

use std::path::{Path, PathBuf};
use std::rc::Rc;

use nova_runtime::actions::InputFrame;
use nova_runtime::game::{Game, Uploader};
use nova_runtime::model::{Image, MeshData};
use nova_runtime::playtest::{Plan, Playtest};
use nova_runtime::vfs::{DirVfs, Vfs};
use serde_json::{Map, Value};

struct FakeGpu;
impl Uploader for FakeGpu {
    fn set_atlas(&mut self, _: &Image) {}
    fn add_mesh(&mut self, _: &MeshData) -> usize {
        0
    }
}

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/neon-undertow")
}

fn game() -> Game {
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder()).unwrap());
    let mut g = Game::load(vfs).expect("Neon Undertow loads");
    g.upload(&mut FakeGpu);
    g
}

/// The plan a route file makes: the keys a `Plan` knows, with `route` renamed `steps`.
fn plan_text(name: &str) -> String {
    let path = folder().join("tools").join(format!("r_{name}.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let args: Map<String, Value> = serde_json::from_str(&text).unwrap();
    let mut plan = Map::new();
    for (k, v) in args {
        match k.as_str() {
            "route" => {
                plan.insert("steps".into(), v);
            }
            "start_scene" | "lua" | "print" | "invincible" | "seed" | "frames" => {
                plan.insert(k, v);
            }
            _ => {}
        }
    }
    Value::Object(plan).to_string()
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nova-neon-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Plays a route headless (as `play` does, without a GPU) and returns the report.
fn run(name: &str) -> Value {
    let mut g = game();
    let dir = scratch(name);
    std::fs::write(dir.join("plan.json"), plan_text(name)).unwrap();
    let plan = Plan::from_file(&dir.join("plan.json")).unwrap_or_else(|e| panic!("{name}: {e}"));
    let mut run = Playtest::new(plan, &dir.join("out")).unwrap();
    g.reseed(run.seed().unwrap_or(1));
    if let Some(scene) = run.start_scene() {
        g.start_in_scene(scene).unwrap();
    }
    let mut frame = 0;
    while !run.finished(frame) {
        let mut input = InputFrame::default();
        run.before_frame(frame, &mut g, &mut input);
        g.update_input(1.0 / 60.0, frame as f64 / 60.0, [960.0, 540.0], &input);
        for caption in run.after_frame(frame, &mut g) {
            let _ = run.picture(frame, &caption, &mut g);
        }
        frame += 1;
    }
    let report = run.finish(frame, &mut g).unwrap();
    let report: Value = serde_json::from_str(&std::fs::read_to_string(report).unwrap()).unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(report["error"], Value::Null, "{name}: {report}");
    assert_eq!(
        report["step_errors"].as_array().map_or(0, |a| a.len()),
        0,
        "{name}: {}",
        report["step_errors"]
    );
    assert_eq!(
        report["warnings"].as_array().map_or(0, |a| a.len()),
        0,
        "{name}: {}",
        report["warnings"]
    );
    report
}

/// What the plan's `print` list said at the end, by the expression's text.
fn printed(report: &Value, expr_start: &str) -> String {
    let all = report["end"]["prints"].as_array().unwrap();
    // (the whole expression if one matches, else the first that starts so: "BL" is not "BLOCKED2")
    all.iter()
        .find(|p| p["expr"].as_str().unwrap() == expr_start)
        .or_else(|| {
            all.iter()
                .find(|p| p["expr"].as_str().unwrap().starts_with(expr_start))
        })
        .unwrap_or_else(|| {
            panic!(
                "nothing printed for {expr_start}: {}",
                report["end"]["prints"]
            )
        })["value"]
        .as_str()
        .unwrap()
        .to_string()
}

fn num(report: &Value, expr_start: &str) -> f64 {
    let v = printed(report, expr_start);
    v.parse()
        .unwrap_or_else(|_| panic!("{expr_start} printed {v:?}, not a number"))
}

/// The log lines as (frame, text).
fn log(report: &Value) -> Vec<(u64, String)> {
    report["log"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| {
            (
                l["frame"].as_u64().unwrap(),
                l["text"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

fn frame_of(lines: &[(u64, String)], text: &str) -> u64 {
    lines
        .iter()
        .find(|(_, t)| t.contains(text))
        .unwrap_or_else(|| panic!("no log line with {text:?}: {lines:?}"))
        .0
}

/// The probe's per-frame samples: (x, y, attack frame, hit-stop hold, state).
fn samples(report: &Value) -> Vec<(f64, f64, i64, i64, String)> {
    printed(report, "table.concat(H")
        .split(' ')
        .map(|s| {
            let p: Vec<&str> = s.split(',').collect();
            (
                p[0].parse().unwrap(),
                p[1].parse().unwrap(),
                p[2].parse().unwrap(),
                p[3].parse().unwrap(),
                p[4].to_string(),
            )
        })
        .collect()
}

#[test]
fn the_project_checks_clean() {
    assert!(Path::new(&folder()).join("nova.json").exists());
    let g = game();
    drop(g);
    for name in ["chain", "roll", "die"] {
        let _ = run(name); // (each asserts: no error, no step errors, no warnings)
    }
}

#[test]
fn the_chain_does_2_2_4_and_a_hit_comes_out_5_frames_after_the_press() {
    let r = run("chain");
    let l = log(&r);
    let hits: Vec<&str> = l
        .iter()
        .filter(|(_, t)| t.starts_with("baton hit"))
        .map(|(_, t)| t.as_str())
        .collect();
    assert_eq!(
        hits,
        [
            "baton hit 1: 2 damage",
            "baton hit 2: 2 damage",
            "baton hit 3: 4 damage"
        ],
        "{l:?}"
    );
    assert_eq!(printed(&r, "nova.named('dummy').total"), "8");
    assert_eq!(printed(&r, "nova.named('dummy').last_damage"), "4");
    // the start-up: the frame the attack starts to the frame the hit lands
    for n in 1..=3 {
        let start = frame_of(&l, &format!("attack {n} starts"));
        let hit = frame_of(&l, &format!("baton hit {n}:"));
        assert_eq!(
            hit - start,
            5,
            "hit {n} came {} frames after the press",
            hit - start
        );
    }
    // three hits give a whole pip back (they began with 0)
    assert_eq!(
        printed(&r, "string.format('%.3f', nova.named('runner').charge"),
        "1.000"
    );
}

#[test]
fn a_hit_stops_the_game_for_3_frames() {
    let r = run("hitstop");
    let s = samples(&r);
    let i = s
        .iter()
        .position(|t| t.3 == 4)
        .expect("the hit-stop was set");
    // the runner holds right and was creeping forward before the hit...
    assert!(s[i - 1].0 > s[i - 2].0, "{:?}", &s[i - 3..i]);
    // ...and does not move, nor does his attack clock, for the 3 frames after the hit
    for k in 1..=3 {
        assert_eq!(s[i + k].0, s[i].0, "x moved in hit-stop frame {k}");
        assert_eq!(
            s[i + k].2,
            s[i].2,
            "the attack clock ran in hit-stop frame {k}"
        );
        assert_eq!(s[i + k].3, 4 - k as i64, "hold counter");
    }
    // and the fourth frame carries on
    assert!(s[i + 4].0 > s[i].0);
    assert_eq!(s[i + 4].2, s[i].2 + 1);
}

#[test]
fn a_roll_covers_3_2_tiles_and_the_next_waits_0_6_seconds() {
    let r = run("roll");
    let d = num(&r, "string.format('%.2f', R1)");
    assert!(
        (d - 3.2 * 48.0).abs() <= 0.2 * 48.0,
        "the roll covered {d} units, {} tiles",
        d / 48.0
    );
    let s = samples(&r);
    let first = s.iter().position(|t| t.4 == "roll").unwrap();
    let rolling = s[first..].iter().take_while(|t| t.4 == "roll").count();
    let t = rolling as f64 / 60.0;
    assert!((0.27..=0.30).contains(&t), "the roll lasted {t} s");
    // the second roll starts only after at least 0.6 s of not rolling
    let after = first + rolling;
    let second = s[after..]
        .iter()
        .position(|t| t.4 == "roll")
        .expect("a second roll");
    assert!(
        second >= 36,
        "the second roll came {second} frames after the first ended"
    );
    assert_eq!(printed(&r, "ROLLS_AFTER_1"), "1");
    assert_eq!(
        printed(&r, "EARLY"),
        "1",
        "a roll was allowed during the wait"
    );
    assert_eq!(printed(&r, "LATE"), "2");
}

#[test]
fn a_swing_landing_in_the_first_0_22_s_of_a_roll_does_nothing_and_one_after_it_hurts() {
    // control: the same swing, no roll: 2 points
    let c = run("swing_control");
    assert_eq!(printed(&c, "nova.named('runner').hp"), "10");
    // A: it lands 0.03 s into the roll, with the runner inside the swing's box
    let a = run("roll_through");
    assert_eq!(printed(&a, "A_SWINGS"), "1");
    assert_eq!(printed(&a, "A_HP"), "12");
    assert_eq!(
        printed(&a, "A_BLOCKED"),
        "1",
        "the swing did reach him (and was refused)"
    );
    let la = log(&a);
    assert!(
        la.iter().any(|(_, t)| t.starts_with("hit missed: rolling")),
        "{la:?}"
    );
    // B: it lands 0.233 s in
    let b = run("roll_late");
    assert_eq!(printed(&b, "B_HP"), "10");
    let lb = log(&b);
    let hurt = lb
        .iter()
        .find(|(_, t)| t.starts_with("runner hurt"))
        .expect("hurt")
        .1
        .clone();
    assert!(
        hurt.contains("health 10") && hurt.contains("roll t 0.2"),
        "{hurt}"
    );
}

#[test]
fn holding_ranged_walks_at_35_percent() {
    let r = run("aim_walk");
    let ratio = num(&r, "string.format('%.4f', AIM / WALK)");
    assert!(
        (ratio - 0.35).abs() <= 0.05,
        "aiming walked at {ratio} of full speed"
    );
}

#[test]
fn a_shot_costs_a_pip_an_empty_one_clicks_and_three_baton_hits_give_one_back() {
    let r = run("charge");
    assert_eq!(printed(&r, "C0"), "3.000");
    assert_eq!(printed(&r, "C1"), "2.000");
    assert_eq!(printed(&r, "C2"), "1.000");
    assert_eq!(printed(&r, "C3"), "0.000");
    assert_eq!(printed(&r, "S3"), "3");
    // the fourth shot: no charge, no shot, no damage, one click
    assert_eq!(printed(&r, "C4"), "0.000");
    assert_eq!(printed(&r, "S4"), "3");
    assert_eq!(printed(&r, "K4"), "1");
    assert_eq!(
        printed(&r, "DUMMY4"),
        "9",
        "three shots of 3 damage and nothing from the click"
    );
    // three baton hits: back to exactly one pip
    assert_eq!(printed(&r, "B5"), "3");
    assert_eq!(printed(&r, "C5"), "1.000");
    let sounds = report_sounds(&r);
    assert!(
        sounds.iter().any(|s| s.contains("sound empty")),
        "{sounds:?}"
    );
}

fn report_sounds(r: &Value) -> Vec<String> {
    r["sounds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["text"].as_str().unwrap_or("").to_string())
        .collect()
}

#[test]
fn a_scrapper_hit_costs_2_and_the_blink_stops_a_second_hit_for_0_8_s() {
    let r = run("blink");
    assert_eq!(printed(&r, "HP1"), "10");
    // a second real swing, landing inside the blink, does not land
    assert_eq!(printed(&r, "SW2"), "2");
    assert_eq!(printed(&r, "BLOCKED2"), "1");
    assert_eq!(printed(&r, "HP2"), "10");
    // 25 and 40 frames after the hit: still protected; 51 frames (0.85 s): hurt again
    assert_eq!(printed(&r, "T25"), "false");
    assert_eq!(printed(&r, "T40"), "false");
    assert_eq!(printed(&r, "HP4"), "10");
    let left = num(&r, "BL");
    assert!(
        (0.05..0.3).contains(&left),
        "{left} s of blink left at 0.67 s"
    );
    assert_eq!(printed(&r, "T50"), "true");
    assert_eq!(printed(&r, "HP5"), "8");
}

#[test]
fn the_third_hit_knocks_back() {
    let r = run("knockback");
    let before = num(&r, "string.format('%.1f', X2)");
    let after = num(&r, "string.format('%.1f', X4)");
    assert_eq!(printed(&r, "ST"), "stagger");
    assert!(after - before > 20.0, "pushed {} units", after - before);
    // the first two hits do not push
    let l = log(&r);
    assert!(l.iter().filter(|(_, t)| t.starts_with("baton hit")).count() == 3);
}

#[test]
fn killing_the_scrapper_drops_3_scrap_and_walking_over_them_counts_them() {
    let r = run("kill_scrapper");
    assert_eq!(printed(&r, "DROPPED"), "3");
    assert_eq!(printed(&r, "ALIVE"), "0");
    assert_eq!(printed(&r, "require('lib.juice').scrap"), "3");
    assert_eq!(printed(&r, "nova.count('scrap')"), "0");
    let l = log(&r);
    assert!(l.iter().any(|(_, t)| t == "scrapper dies"), "{l:?}");
    assert_eq!(l.iter().filter(|(_, t)| t.starts_with("scrap ")).count(), 3);
    let s = report_sounds(&r);
    assert!(
        s.iter().any(|x| x.contains("sound enemy_die"))
            && s.iter().any(|x| x.contains("sound scrap")),
        "{s:?}"
    );
}

#[test]
fn the_scrapper_tells_for_at_least_0_4_s_before_it_swings() {
    let r = run("swing_control");
    let l = log(&r);
    // (the route starts the tell by hand at frame 2; the log carries the swing's frame)
    let swing = frame_of(&l, "scrapper swing");
    assert!(swing >= 2 + 24, "the swing came at frame {swing}");
    let k = run("kill_scrapper");
    let lk = log(&k);
    let tell = frame_of(&lk, "scrapper tell");
    let swing = frame_of(&lk, "scrapper swing");
    assert!(
        swing - tell >= 24,
        "the tell lasted {} frames",
        swing - tell
    );
}

#[test]
fn at_zero_the_room_restarts_with_full_health() {
    let r = run("die");
    assert_eq!(printed(&r, "D_STATE"), "dead");
    assert_eq!(printed(&r, "D_HP"), "0");
    assert_eq!(printed(&r, "NEW_HP"), "12");
    assert_eq!(printed(&r, "NEW_STATE"), "free");
    assert_eq!(printed(&r, "NEW_SCRAP"), "0");
    let l = log(&r);
    assert!(l.iter().any(|(_, t)| t == "printed again"), "{l:?}");
    assert_eq!(
        l.iter().filter(|(_, t)| t == "entered test_room").count(),
        2,
        "{l:?}"
    );
}

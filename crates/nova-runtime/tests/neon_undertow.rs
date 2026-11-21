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
    // (tests run in parallel inside one process: a counter keeps two runs of the same route apart)
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("nova-neon-{name}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Plays a route headless (as `play` does, without a GPU) and returns the report.
fn run(name: &str) -> Value {
    play(name, plan_text(name))
}

/// Plays a plan given as text (a route file's, or one made here) and returns the report.
fn play(name: &str, plan: String) -> Value {
    let mut g = game();
    let dir = scratch(name);
    std::fs::write(dir.join("plan.json"), plan).unwrap();
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

// =====================================================================================================================
// Slice 2: a room that plays. The routes (examples/neon-undertow/tools/routes.mjs) run in the card lab (scenes/test_lab) and in
// the two fight rooms; each test asserts the numbers its route printed, so a later slice cannot quietly break a rule.
// =====================================================================================================================

fn has_sound(r: &Value, name: &str) -> bool {
    report_sounds(r)
        .iter()
        .any(|s| s.contains(&format!("sound {name} ")))
}

fn count_sound(r: &Value, name: &str) -> usize {
    report_sounds(r)
        .iter()
        .filter(|s| s.contains(&format!("sound {name} ")))
        .count()
}

/// The frame of the n-th log line that contains `needle` (counting from 0).
fn nth_frame(lines: &[(u64, String)], needle: &str, n: usize) -> u64 {
    lines
        .iter()
        .filter(|(_, t)| t.contains(needle))
        .nth(n)
        .unwrap_or_else(|| panic!("no log line #{n} with {needle:?}: {lines:?}"))
        .0
}

fn assert_between(what: &str, v: f64, lo: f64, hi: f64) {
    assert!(
        (lo..=hi).contains(&v),
        "{what}: {v} is not within {lo}..={hi}"
    );
}

#[test]
fn slice_two_routes_run_clean() {
    // every proof route: no error, no step error, no warning (run() asserts all three)
    for name in [
        "thrower",
        "thrower_keeps_away",
        "drone_wall",
        "drone_cover",
        "drone_contact",
        "mimic",
        "mimic_cans_hurt",
        "tout",
        "tout_shot",
        "tells",
        "room_flow",
        "carry",
        "pause",
        "offers",
    ] {
        let _ = run(name);
    }
}

#[test]
fn every_enemy_tells_for_at_least_0_4_s_before_it_hurts() {
    let t = run("tells");
    for (expr, who) in [
        ("require('data.enemies').scrapper.tell", "scrapper"),
        (
            "require('data.enemies').bottle_thrower.tell",
            "bottle thrower",
        ),
        ("require('data.enemies').rat_drone.tell", "rat-drone"),
        ("require('data.enemies').mimic_vendor.tell", "mimic vendor"),
        ("require('data.enemies').tout.pulse_tell", "tout"),
    ] {
        assert!(num(&t, expr) >= 0.4, "{who}'s tell is {}", num(&t, expr));
    }
    // and what the game really does: tell to attack, in frames (60 = 1 s)
    let l = log(&run("thrower"));
    assert!(frame_of(&l, "bottle thrown") - frame_of(&l, "bottle_thrower tell") >= 24);
    let l = log(&run("drone_wall"));
    assert!(frame_of(&l, "rat_drone charges") - frame_of(&l, "rat_drone tell") >= 24);
    let l = log(&run("mimic"));
    assert!(frame_of(&l, "mimic_vendor spits") - frame_of(&l, "mimic_vendor tell at") >= 24);
}

#[test]
fn the_bottle_thrower_lobs_a_marked_bottle_and_its_fire_burns_runner_and_enemies_for_2_s() {
    let r = run("thrower");
    let l = log(&r);
    // the bottle leaves after the tell and goes where the runner stood (the route does not move him)
    assert!(
        l.iter().any(|(_, t)| t == "bottle thrown at 500,420"),
        "{l:?}"
    );
    // 0.9 s in the air (54 frames), landing where it was marked
    let thrown = frame_of(&l, "bottle thrown");
    let lands = frame_of(&l, "bottle lands at 500,420");
    assert!(
        (52..=56).contains(&(lands - thrown)),
        "the bottle flew {} frames",
        lands - thrown
    );
    // fire for 2 s (121 frames at 60 per second, give or take one hurt-free frame at the end)
    let burns = frame_of(&l, "fire burns at 500,420");
    let out = frame_of(&l, "fire out");
    assert!(
        (118..=124).contains(&(out - burns)),
        "the fire burned {} frames",
        out - burns
    );
    // it hurt the runner AND the (stunned) Scrapper standing in it, several times each
    assert!(l.iter().any(|(_, t)| t == "fire hurts runner"));
    let enemy_hurts = l.iter().filter(|(_, t)| t == "fire hurts scrapper").count();
    assert!(
        enemy_hurts >= 3,
        "the fire hurt the scrapper {enemy_hurts} times"
    );
    assert!(
        num(&r, "SCRAPPER_HP") <= 27.0,
        "scrapper health {}",
        num(&r, "SCRAPPER_HP")
    );
    assert!(num(&r, "RUNNER_HP") < 12.0);
    // the patch is as wide as the data says (40 units: scale 5 on a 16 px picture, circle of 8)
    assert_eq!(num(&r, "FIRE_SCALE"), 5.0);
    for s in ["tell_thrower", "throw", "bottle_smash", "fire_start"] {
        assert!(has_sound(&r, s), "no sound {s}: {:?}", report_sounds(&r));
    }
}

#[test]
fn the_bottle_thrower_backs_away_from_a_runner_who_is_too_near() {
    let r = run("thrower_keeps_away");
    let (g0, g1) = (
        num(&r, "string.format('%.0f', G0)"),
        num(&r, "string.format('%.0f', G1)"),
    );
    assert!(g0 < 230.0, "it starts {g0} away");
    assert!(g1 > g0 + 20.0, "the gap went from {g0} to {g1}");
    assert_eq!(
        printed(&r, "ST1"),
        "keep",
        "(it keeps backing off, it does not throw from point blank)"
    );
}

#[test]
fn a_charging_rat_drone_that_meets_a_wall_is_stunned_1_s_and_takes_the_crash() {
    for (name, lane) in [("drone_wall", "wall"), ("drone_cover", "cover")] {
        let r = run(name);
        let l = log(&r);
        // rev-up, then a charge, then the crash
        assert!(
            frame_of(&l, "rat_drone charges") > frame_of(&l, "rat_drone tell"),
            "{lane}"
        );
        let crash = frame_of(&l, "rat_drone stunned");
        // stunned for 1 s: 60 frames from the crash to "recovers"
        let recovers = frame_of(&l, "rat_drone recovers");
        assert!(
            (59..=61).contains(&(recovers - crash)),
            "{lane}: stunned {} frames",
            recovers - crash
        );
        // the crash took 2 off its 5 health
        assert_eq!(printed(&r, "HP_AT_CRASH"), "3", "{lane}");
        assert_eq!(printed(&r, "CRASHES"), "1", "{lane}");
        assert_eq!(printed(&r, "CHARGES"), "1", "{lane}");
        assert!(
            has_sound(&r, "rev_up") && has_sound(&r, "wall_thud"),
            "{lane}"
        );
        if lane == "wall" {
            // the lane passes through the runner: the charge hurt him (2), then it ran on to the wall (x 63 = the wall's face + its size)
            assert!(l.iter().any(|(_, t)| t == "rat_drone hit lands"));
            assert_eq!(printed(&r, "RUNNER_HP"), "10");
            assert_between(
                "crash x",
                num(&r, "string.format('%.0f', X_CRASH)"),
                55.0,
                70.0,
            );
        } else {
            // cover: the stall (a solid tile) stopped it a short way out, before the runner
            assert!(!l.iter().any(|(_, t)| t == "rat_drone hit lands"));
            assert_eq!(printed(&r, "RUNNER_HP"), "12");
            assert_between(
                "crash y",
                num(&r, "string.format('%.0f', Y_CRASH)"),
                640.0,
                672.0,
            );
        }
    }
}

#[test]
fn a_rat_drone_hurts_on_contact_only_while_charging() {
    let r = run("drone_contact");
    assert_eq!(
        printed(&r, "HP_RECOVER"),
        "12",
        "standing in a recovering drone"
    );
    assert_eq!(
        printed(&r, "HP_TELL"),
        "12",
        "standing in a drone that is revving"
    );
    assert_eq!(printed(&r, "REV_OVERLAP"), "true", "(they did overlap)");
    assert_eq!(printed(&r, "HP_CHARGE"), "10", "the charge costs 2");
}

#[test]
fn the_mimic_vendor_stays_shut_beyond_3_tiles_and_opens_within() {
    let r = run("mimic");
    let l = log(&r);
    // beyond 3 tiles (144 units): shut, for a second at 300 away, and still at 150
    assert_eq!(printed(&r, "FAR_STATE"), "shut");
    assert_eq!(num(&r, "string.format('%.0f', FAR_DIST)"), 300.0);
    assert_eq!(printed(&r, "EDGE_STATE"), "shut");
    assert!(num(&r, "string.format('%.0f', EDGE_DIST)") > 144.0);
    // a shot hurts it at any time (14 -> 11) and does not wake it
    assert_eq!(printed(&r, "SHOT_HP"), "11");
    assert_eq!(printed(&r, "SHOT_STATE"), "shut");
    // within 3 tiles it flickers: the log says how far away the runner was
    let tell = l
        .iter()
        .find(|(_, t)| t.starts_with("mimic_vendor tell at"))
        .expect("a tell")
        .1
        .clone();
    let dist: f64 = tell.rsplit(' ').next().unwrap().parse().unwrap();
    assert!(dist < 144.0 && dist > 120.0, "{tell}");
    // the baton hurts it while it flickers (11 -> 9)
    assert_eq!(printed(&r, "BATON_HP"), "9");
    assert_eq!(printed(&r, "BATON_STATE"), "flicker");
    // three cans, in three directions about 0.5 radians apart; it never moved
    assert_eq!(printed(&r, "NCANS"), "3");
    let dirs: Vec<f64> = printed(&r, "CANS")
        .split(' ')
        .map(|v| {
            let p: Vec<f64> = v.split(',').map(|n| n.parse().unwrap()).collect();
            p[1].atan2(p[0])
        })
        .collect();
    // (angles relative to the first, wrapped to -pi..pi, so "left" is not split at the +-pi seam)
    let wrap = |a: f64| {
        (a + std::f64::consts::PI).rem_euclid(2.0 * std::f64::consts::PI) - std::f64::consts::PI
    };
    let mut angles: Vec<f64> = dirs.iter().map(|a| wrap(a - dirs[0])).collect();
    angles.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert_between("first gap", angles[1] - angles[0], 0.45, 0.55);
    assert_between("second gap", angles[2] - angles[1], 0.45, 0.55);
    assert_eq!(num(&r, "M_MOVED"), 0.0);
    assert!(has_sound(&r, "tell_mimic") && has_sound(&r, "can_spit"));
    // the cans hurt (2)
    let h = run("mimic_cans_hurt");
    assert_eq!(printed(&h, "RUNNER_HP"), "10");
    assert!(log(&h).iter().any(|(_, t)| t == "can hits runner"));
}

#[test]
fn a_tout_makes_every_enemy_near_it_30_percent_faster_until_it_is_hit() {
    let r = run("tout");
    let ratio_buffed = num(&r, "string.format('%.3f', B / A)");
    let ratio_after = num(&r, "string.format('%.3f', C / A)");
    assert_between("buffed speed / normal", ratio_buffed, 1.28, 1.32);
    assert_between(
        "speed after the tout was hit / normal",
        ratio_after,
        0.98,
        1.02,
    );
    assert_eq!(printed(&r, "BUFF_NEAR"), "true");
    assert_eq!(
        printed(&r, "BUFF_FAR"),
        "false",
        "a Scrapper 5+ tiles from the tout is not buffed"
    );
    assert_eq!(printed(&r, "BUFF_AFTER"), "false");
    assert_eq!(printed(&r, "TOUT_HP_HIT"), "true");
    assert_eq!(
        printed(&r, "TOUT_ALIVE"),
        "false",
        "one hit switches it off for good"
    );
    assert!(log(&r).iter().any(|(_, t)| t == "tout switched off"));
    // a real shot does it too
    let s = run("tout_shot");
    assert_eq!(printed(&s, "ALIVE"), "0");
    assert!(has_sound(&s, "tout_off") && has_sound(&s, "tell_tout"));
}

#[test]
fn a_room_shuts_its_doors_spawns_its_waves_in_order_pays_and_raises_three_different_cards() {
    let r = run("room_flow");
    let l = log(&r);
    // doors: open before, shut during every wave, the runner cannot pass a shut door
    assert_eq!(printed(&r, "D_START"), "open,open");
    assert_eq!(printed(&r, "D_SHUT"), "locked,locked");
    assert_eq!(printed(&r, "D_WAVE1"), "locked,locked");
    assert!(
        num(&r, "PUSH_X") < 1872.0,
        "the shut door let him to {}",
        num(&r, "PUSH_X")
    );
    assert_eq!(printed(&r, "PUSH_SCENE"), "market_a");
    // waves: in order, each only after the one before is dead, as the wave table says
    assert_eq!(printed(&r, "W1"), "scrapper,scrapper");
    assert_eq!(printed(&r, "W2"), "rat_drone,scrapper");
    assert_eq!(printed(&r, "W3"), "bottle_thrower,scrapper,scrapper,tout");
    assert_eq!(printed(&r, "W2_ENEMIES_AT_WARN"), "0");
    assert_eq!(printed(&r, "W3_ENEMIES_AT_WARN"), "0");
    let waves = [
        "wave 1: scrapper x2 at sp_w",
        "wave 2: rat_drone x1 at sp_n",
        "wave 2: scrapper x1 at sp_s",
        "wave 3: bottle_thrower x1 at sp_e",
        "wave 3: tout x1 at sp_s",
        "wave 3: scrapper x2 at sp_w",
    ];
    for w in waves {
        assert!(l.iter().any(|(_, t)| t == w), "no log line {w:?}: {l:?}");
    }
    let shut = frame_of(&l, "doors shut");
    let w1 = frame_of(&l, "wave 1 warns");
    let w2 = frame_of(&l, "wave 2 warns");
    let w3 = frame_of(&l, "wave 3 warns");
    let cleared = frame_of(&l, "room cleared");
    let unlocked = frame_of(&l, "doors unlocked");
    let rise = frame_of(&l, "cards rise");
    let taken = frame_of(&l, "card taken");
    let opens = frame_of(&l, "exit door opens");
    assert!(
        shut < w1
            && w1 < w2
            && w2 < w3
            && w3 < cleared
            && cleared <= unlocked
            && unlocked < rise
            && rise < taken
            && taken <= opens,
        "{l:?}"
    );
    // each wave shows its warning mark before the enemies step out (0.9 s)
    assert!(
        nth_frame(&l, "spawned", 0) - w1 >= 50,
        "the first wave's warning lasted {} frames",
        nth_frame(&l, "spawned", 0) - w1
    );
    // cleared: the doors unlock (the exit one stays down until a card is taken), the room pays its 20 scrap
    assert_eq!(printed(&r, "D_CLEARED"), "open,unlocked");
    assert_eq!(printed(&r, "WAVES_DONE"), "3");
    assert_eq!(printed(&r, "SCRAP_START"), "0");
    assert_eq!(printed(&r, "PAID"), "20");
    assert_eq!(printed(&r, "SCRAP_CLEARED"), "20");
    assert!(l.iter().any(|(_, t)| t == "room pays 20 scrap"));
    // three different cards rise
    assert_eq!(printed(&r, "CARDS_DIFFERENT"), "3");
    assert_eq!(printed(&r, "CARD_IDS").split(',').count(), 3);
    assert_eq!(printed(&r, "CARD_STATE"), "cards");
    // before a card is taken the exit door holds; after, it opens, the others sink, the runner goes through
    assert!(num(&r, "NOTYET_X") < 1872.0);
    assert_eq!(printed(&r, "NOTYET_SCENE"), "market_a");
    assert_eq!(printed(&r, "D_BEFORE_TAKE"), "open,unlocked");
    assert_eq!(
        printed(&r, "NEAR_ID"),
        printed(&r, "TAKEN_ID"),
        "the card text was for the card he stood by"
    );
    assert_eq!(printed(&r, "D_AFTER_TAKE"), "open,open");
    assert_eq!(printed(&r, "HELD"), printed(&r, "TAKEN_ID"));
    assert_eq!(printed(&r, "CARDS_LEFT"), "0");
    assert_eq!(printed(&r, "END_SCENE"), "market_b");
    // sounds by purpose
    assert!(
        has_sound(&r, "door_shut") && has_sound(&r, "door_unlock") && has_sound(&r, "door_open")
    );
    assert_eq!(count_sound(&r, "wave_warn"), 3);
    assert!(has_sound(&r, "card_rise") && has_sound(&r, "card_take"));
}

#[test]
fn health_charge_scrap_and_cards_carry_from_room_a_into_room_b() {
    let r = run("carry");
    // a state that is not the default (7 of 12 health, 2.5 of 4 pips, 64 scrap, three cards), through the real clear, rise, take and door
    assert_eq!(printed(&r, "A_HP"), "7");
    assert_eq!(printed(&r, "A_CHARGE"), "2.50");
    assert_eq!(printed(&r, "A_SCRAP"), "64");
    assert_eq!(printed(&r, "B_SCENE"), "market_b");
    for k in ["HP", "CHARGE", "SCRAP", "CARDS", "MAXHP", "MAXCH"] {
        assert_eq!(
            printed(&r, &format!("A_{k}")),
            printed(&r, &format!("B_{k}")),
            "{k} did not carry"
        );
    }
    let cards = printed(&r, "B_CARDS");
    assert!(
        cards.starts_with("long_reach,capacitor,") && cards.split(',').count() == 3,
        "{cards}"
    );
    assert_eq!(printed(&r, "B_MAXCH"), "4");
    assert_eq!(num(&r, "B_REACH"), 1.3);
}

#[test]
fn start_pauses_and_lists_the_cards_held_and_nothing_runs_meanwhile() {
    let r = run("pause");
    assert_eq!(printed(&r, "PAUSED"), "true");
    assert_eq!(
        printed(&r, "string.format('%.3f', CD0)"),
        printed(&r, "string.format('%.3f', CD1)"),
        "the wave timer ran while paused"
    );
    assert_eq!(
        printed(&r, "string.format('%.3f', T0)"),
        printed(&r, "string.format('%.3f', T1)")
    );
    assert_eq!(printed(&r, "PAUSED_AFTER"), "false");
    assert!(
        num(&r, "string.format('%.1f', MOVED_FREE)") > 30.0,
        "he walked after resuming"
    );
    assert!(
        log(&r)
            .iter()
            .any(|(_, t)| t == "paused: cards held plating,long_reach,long_reach,hot_solder")
    );
}

#[test]
fn the_same_seed_gives_the_same_offer_another_seed_another_and_the_pool_is_respected() {
    let r = run("offers");
    assert_eq!(
        printed(&r, "A1"),
        printed(&r, "B1"),
        "the same seed, the first offer"
    );
    assert_eq!(
        printed(&r, "A2"),
        printed(&r, "B2"),
        "the same seed, the second offer"
    );
    assert_ne!(
        printed(&r, "A1"),
        printed(&r, "A2"),
        "two offers of one run differ"
    );
    assert_ne!(
        printed(&r, "A1"),
        printed(&r, "C1"),
        "another seed, another offer"
    );
    assert_ne!(printed(&r, "A1"), printed(&r, "D1"));
    assert_eq!(printed(&r, "A1").split(',').count(), 3);
    assert_eq!(
        printed(&r, "tostring(DISTINCT)"),
        "true",
        "never the same card twice in an offer"
    );
    assert_eq!(
        printed(&r, "POOL_SEEN"),
        "12",
        "every card of the pool turns up"
    );
    assert_eq!(printed(&r, "HELD"), "3");
    assert_eq!(printed(&r, "EXTRA"), "false", "a fourth copy is refused");
    assert_eq!(
        printed(&r, "tostring(MAXED_OFFERED)"),
        "false",
        "a card at its maximum is not offered"
    );
}

// ---- the twelve cards: each changes what it says -----------------------------------------------------------------

#[test]
fn live_wire_third_hit_zaps_two_more_enemies_near_the_target_for_2() {
    let r = run("card_live_wire");
    assert_eq!(
        (printed(&r, "BASE_D2"), printed(&r, "BASE_D3")),
        ("0".into(), "0".into()),
        "no card: nothing chains"
    );
    assert_eq!(
        (printed(&r, "MID_D2"), printed(&r, "MID_D3")),
        ("0".into(), "0".into()),
        "hits 1 and 2 do not chain"
    );
    assert_eq!(
        (printed(&r, "END_D2"), printed(&r, "END_D3")),
        ("2".into(), "2".into()),
        "the third hit does, for 2"
    );
    assert_eq!(
        printed(&r, "END_D1"),
        "16",
        "the target takes its own 8 as before"
    );
    assert!(log(&r).iter().any(|(_, t)| t == "live wire hits 2"));
    assert!(has_sound(&r, "zap"));
}

#[test]
fn long_reach_hits_a_dummy_just_out_of_normal_reach() {
    let r = run("card_long_reach");
    assert_eq!(printed(&r, "BASE"), "0", "out of the normal arc");
    assert_eq!(printed(&r, "WITH"), "2", "inside the wider arc");
    assert_eq!(printed(&r, "string.format('%.2f', REACH)"), "1.30");
}

#[test]
fn riot_stock_stuns_0_6_s_and_knocks_back_twice_as_far() {
    let base = run("card_riot_stock_base");
    let with = run("card_riot_stock");
    let (b, w) = (
        num(&base, "string.format('%.1f', PUSH10)"),
        num(&with, "string.format('%.1f', PUSH10)"),
    );
    assert!(b > 15.0, "the plain third hit pushes {b}");
    assert_between("push ratio", w / b, 1.8, 2.2);
    assert_eq!(printed(&base, "STUN"), "0.00");
    assert_eq!(printed(&with, "STUN"), "0.60");
    // 0.42 s later: the plain scrapper has recovered, the stunned one still is
    assert_ne!(printed(&base, "ST_AT_25"), "stagger");
    assert_eq!(printed(&with, "ST_AT_25"), "stagger");
    assert!(num(&with, "STUN_AT_25") > 0.1);
    assert_eq!(printed(&with, "ST_LATE"), "walk");
    assert!(
        log(&with)
            .iter()
            .any(|(_, t)| t.starts_with("riot stock stuns"))
    );
}

#[test]
fn hot_solder_sets_the_enemy_alight_for_1_damage_a_second_for_3_s() {
    let r = run("card_hot_solder");
    assert_eq!(printed(&r, "BASE"), "2", "no card: the hit only");
    assert_eq!(printed(&r, "HIT"), "4");
    assert_eq!(printed(&r, "T0"), "4", "nothing in the first second");
    assert_eq!(printed(&r, "T1"), "5");
    assert_eq!(printed(&r, "T2"), "6");
    assert_eq!(printed(&r, "T3"), "7", "three ticks");
    assert_eq!(printed(&r, "T4"), "7", "and then it goes out");
    assert_eq!(printed(&r, "BURN_END"), "0");
    assert_eq!(
        log(&r)
            .iter()
            .filter(|(_, t)| t.starts_with("burn ticks"))
            .count(),
        3
    );
}

#[test]
fn ricochet_a_shot_at_the_wall_comes_down_on_a_dummy_behind_cover() {
    let r = run("card_ricochet");
    assert_eq!(printed(&r, "BASE_SHOTS"), "1");
    assert_eq!(
        printed(&r, "BASE"),
        "0",
        "without the card the shot dies on the wall"
    );
    assert_eq!(
        printed(&r, "WITH"),
        "3",
        "with it the bounce hits the dummy"
    );
    assert!(log(&r).iter().any(|(_, t)| t == "shot ricochets"));
    assert_eq!(
        log(&r)
            .iter()
            .filter(|(_, t)| t == "shot ricochets")
            .count(),
        1,
        "once"
    );
    assert!(has_sound(&r, "ricochet"));
}

#[test]
fn scatter_fires_three_pellets_in_a_fan_for_2_each_for_one_pip() {
    let r = run("card_scatter");
    assert_eq!(
        (printed(&r, "B1"), printed(&r, "B2"), printed(&r, "B3")),
        ("0".into(), "3".into(), "0".into()),
        "plain: the middle one only"
    );
    // the second shot: the outer two take 2 each, the middle one 2 more than before
    assert_eq!(
        (printed(&r, "W1"), printed(&r, "W2"), printed(&r, "W3")),
        ("2".into(), "5".into(), "2".into())
    );
    assert_eq!(printed(&r, "PELLETS"), "3");
    assert_eq!(printed(&r, "PELLETS_PER"), "3");
    assert_eq!(
        (printed(&r, "CH0"), printed(&r, "CH1")),
        ("3".into(), "2".into()),
        "one pip for the whole fan"
    );
}

#[test]
fn tracer_a_shot_enemy_takes_50_percent_more_baton_damage_for_3_s() {
    let r = run("card_tracer");
    assert_eq!(printed(&r, "BASE_HIT"), "2");
    assert_between("mark left", num(&r, "MARK"), 2.0, 3.0);
    assert_eq!(
        printed(&r, "SHOT_TOTAL"),
        "5",
        "2 from the baton, 3 from the shot"
    );
    assert_eq!(printed(&r, "MARKED_HIT"), "3", "2 +50%");
    assert_eq!(printed(&r, "MARK_END"), "0", "the mark ran out");
    assert_eq!(printed(&r, "AFTER_HIT"), "2", "back to 2");
}

#[test]
fn shock_wake_a_roll_passes_through_an_enemy_and_zaps_it_for_2() {
    let r = run("card_shock_wake");
    assert!(
        num(&r, "string.format('%.0f', BASE_X)") < 400.0,
        "without the card the dummy stops the roll"
    );
    assert_eq!(printed(&r, "BASE_TOTAL"), "0");
    assert!(
        num(&r, "string.format('%.0f', WITH_X)") > 430.0,
        "with it he rolls through"
    );
    assert_eq!(printed(&r, "WITH_TOTAL"), "2");
    assert_eq!(printed(&r, "ZAPS"), "1", "once per roll");
    assert!(
        log(&r)
            .iter()
            .any(|(_, t)| t == "shock wake zaps dummy" || t.starts_with("shock wake zaps"))
    );
}

#[test]
fn second_wind_gives_two_rolls_inside_0_6_s_then_the_wait() {
    let r = run("card_second_wind");
    assert_eq!(
        printed(&r, "BASE_ROLLS"),
        "1",
        "two presses 20 frames apart: one roll"
    );
    assert_eq!(printed(&r, "WITH_ROLLS"), "2");
    assert_eq!(printed(&r, "ROLLS_ALLOWED"), "2");
    assert_eq!(
        printed(&r, "THIRD"),
        "2",
        "after the second roll the wait is back"
    );
    assert_eq!(printed(&r, "FOURTH"), "3", "and it ends");
    // the two rolls' starts, from the per-frame probe: less than 0.6 s (36 frames) apart
    let s = samples(&r);
    let starts: Vec<usize> = (1..s.len())
        .filter(|&i| s[i].4 == "roll" && s[i - 1].4 != "roll")
        .collect();
    // (the probe began with the route; its marks: the first roll without the card is starts[0])
    let after = num(&r, "START_F") as usize;
    let mine: Vec<usize> = starts
        .iter()
        .copied()
        .filter(|&i| i >= after)
        .take(2)
        .collect();
    assert_eq!(mine.len(), 2, "{starts:?} after frame {after}");
    assert!(
        mine[1] - mine[0] < 36,
        "the second roll began {} frames after the first",
        mine[1] - mine[0]
    );
}

#[test]
fn plating_gives_14_health_points_with_the_2_healed() {
    let r = run("card_plating");
    assert_eq!(
        (printed(&r, "BASE_MAX"), printed(&r, "BASE_HP")),
        ("12".into(), "5".into())
    );
    assert_eq!(
        (printed(&r, "MAX"), printed(&r, "HP")),
        ("14".into(), "7".into())
    );
    assert_eq!(printed(&r, "HEARTS"), "7", "seven hearts on the screen");
    assert_eq!(printed(&r, "RUN_HP"), "7", "and the run knows");
}

#[test]
fn capacitor_gives_a_fourth_charge_pip() {
    let r = run("card_capacitor");
    assert_eq!(
        (printed(&r, "BASE_MAX"), printed(&r, "MAX")),
        ("3".into(), "4".into())
    );
    assert_eq!(printed(&r, "CH"), "4.00");
    assert_eq!(printed(&r, "SHOTS"), "4", "four shots in a row");
    assert_eq!(printed(&r, "CLICKS"), "1", "the fifth clicks");
    assert_eq!(printed(&r, "D"), "12");
}

#[test]
fn deep_pockets_adds_25_percent_scrap() {
    let r = run("card_deep_pockets");
    assert_eq!(printed(&r, "BASE"), "8");
    assert_eq!(printed(&r, "WITH"), "10", "8 pickups count 10");
    assert_eq!(printed(&r, "LEFT"), "0");
    assert_eq!(num(&r, "MULT"), 1.25);
}

// ---- the rooms themselves ----------------------------------------------------------------------------------------

fn scene_json(name: &str) -> Value {
    let path = folder().join("scenes").join(format!("{name}.scene.json"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// How much of the box round the walkable cells of the first tile layer is walkable (1.0 = a plain rectangle).
fn fill(scene: &Value) -> (f64, usize) {
    let layer = &scene["tilemaps"][0];
    let solid: Vec<i64> = layer["solid"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    let rows = layer["tiles"].as_array().unwrap();
    let (mut x0, mut y0, mut x1, mut y1, mut n) = (usize::MAX, usize::MAX, 0, 0, 0usize);
    for (y, row) in rows.iter().enumerate() {
        for (x, t) in row.as_array().unwrap().iter().enumerate() {
            let t = t.as_i64().unwrap();
            if t >= 0 && !solid.contains(&t) {
                (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
                n += 1;
            }
        }
    }
    (n as f64 / (((x1 - x0 + 1) * (y1 - y0 + 1)) as f64), n)
}

#[test]
fn rooms_a_and_b_are_painted_scene_files_bigger_than_the_screen_and_different_in_shape() {
    let (a, b) = (scene_json("market_a"), scene_json("market_b"));
    for (name, s) in [("market_a", &a), ("market_b", &b)] {
        assert!(
            s["width"].as_f64().unwrap() > 960.0 && s["height"].as_f64().unwrap() > 540.0,
            "{name} fits on one screen"
        );
        let objects = s["objects"].as_array().unwrap();
        let kinds = |k: &str| objects.iter().filter(|o| o["kind"] == k).count();
        assert_eq!(kinds("door"), 2, "{name}: an entry and an exit door");
        assert_eq!(kinds("runner"), 1);
        assert!(
            kinds("marker") >= 4,
            "{name}: spawn points and the card spot"
        );
        assert!(
            objects
                .iter()
                .any(|o| o["kind"] == "marker" && o["name"] == "cards"),
            "{name}: a card spot"
        );
        assert!(
            s["tilemaps"][0]["tiles"].as_array().unwrap().len() >= 18,
            "{name} is painted"
        );
    }
    // A is an open square (walkable cells fill their box); B is a long street with an alley (a T: far less)
    let ((fa, na), (fb, nb)) = (fill(&a), fill(&b));
    assert!(fa > 0.9, "room A fills {fa} of its box");
    assert!(fb < 0.65, "room B fills {fb} of its box");
    assert!(na > 500 && nb > 300, "{na} {nb}");
    // B is wider than tall by a lot, A close to square-ish
    let aspect = |s: &Value| s["width"].as_f64().unwrap() / s["height"].as_f64().unwrap();
    assert!(
        aspect(&a) < 1.8 && aspect(&b) > 1.9,
        "{} {}",
        aspect(&a),
        aspect(&b)
    );
    // the wave table names only spawn points the room has
    let waves = std::fs::read_to_string(folder().join("data/waves.lua")).unwrap();
    for (room, s) in [("market_a", &a), ("market_b", &b)] {
        let names: Vec<String> = s["objects"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|o| o["name"].as_str().map(String::from))
            .collect();
        let section = waves.split(&format!("{room} = {{")).nth(1).unwrap();
        let section = section
            .split("market_b = {")
            .next()
            .filter(|_| room == "market_a")
            .unwrap_or(section);
        for part in section.split("at = \"").skip(1) {
            let sp = part.split('"').next().unwrap();
            assert!(
                names.iter().any(|n| n == sp),
                "{room}: the wave table names spawn point {sp}"
            );
        }
    }
    // the exit of A leads to B, the exit of B to the banner
    let exit = |s: &Value| {
        s["objects"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["name"] == "door_e")
            .unwrap()["props"]["leads_to"]
            .clone()
    };
    assert_eq!(exit(&a), "market_b");
    assert_eq!(exit(&b), "slice_end");
}

#[test]
fn every_new_sound_exists_and_the_run_plays_each_by_purpose() {
    let sounds = [
        "door_shut",
        "door_open",
        "door_unlock",
        "wave_warn",
        "tell_thrower",
        "throw",
        "bottle_smash",
        "fire_start",
        "rev_up",
        "wall_thud",
        "tell_mimic",
        "can_spit",
        "tell_tout",
        "tout_off",
        "card_rise",
        "card_take",
        "zap",
        "ricochet",
        "stun",
    ];
    for s in sounds {
        assert!(
            folder().join("sounds").join(format!("{s}.wav")).exists(),
            "no sounds/{s}.wav"
        );
        assert!(
            folder()
                .join("sounds")
                .join(format!("{s}.sfx.json"))
                .exists(),
            "no sounds/{s}.sfx.json"
        );
    }
    // each is played by some proof route (so a rename cannot leave one silent)
    let mut played = std::collections::BTreeSet::new();
    for name in [
        "room_flow",
        "thrower",
        "drone_wall",
        "mimic",
        "tout",
        "tout_shot",
        "card_live_wire",
        "card_ricochet",
        "card_riot_stock",
    ] {
        for line in report_sounds(&run(name)) {
            if let Some(rest) = line.split("sound ").nth(1) {
                played.insert(rest.split(' ').next().unwrap().to_string());
            }
        }
    }
    for s in sounds {
        assert!(played.contains(s), "no route plays {s}: {played:?}");
    }
}

#[test]
fn the_whole_slice_can_be_played_clear_room_a_take_a_card_clear_room_b_to_the_banner() {
    // (the test player is invincible: this proves the rooms, the waves, the doors and the cards, not the fighting)
    let r = run("slice");
    let l = log(&r);
    assert_eq!(printed(&r, "A_DOORS"), "open,unlocked");
    assert_eq!(printed(&r, "A_WAVES"), "3");
    assert_eq!(printed(&r, "A_PAID"), "20");
    assert_eq!(printed(&r, "A_OFFER"), "cards");
    assert_eq!(
        printed(&r, "A_CARDS").split(',').count(),
        1,
        "one card taken in room A"
    );
    assert_eq!(printed(&r, "A_EXIT_DOOR"), "open");
    assert_eq!(printed(&r, "B_SCENE"), "market_b");
    assert_eq!(
        printed(&r, "B_CARDS"),
        printed(&r, "A_CARDS"),
        "the card came along"
    );
    assert!(
        num(&r, "B_SCRAP_ENTER") >= num(&r, "A_SCRAP_EXIT"),
        "the scrap came along"
    );
    assert_eq!(printed(&r, "B_WAVES"), "3");
    assert_eq!(printed(&r, "B_PAID"), "30");
    assert_eq!(printed(&r, "B_DOORS"), "open,unlocked");
    assert_eq!(printed(&r, "END_SCENE"), "slice_end");
    assert_eq!(printed(&r, "END_CARDS"), "2");
    assert!(
        num(&r, "END_SCRAP") >= 50.0,
        "20 + 30 paid, and what the dead dropped"
    );
    assert_eq!(l.iter().filter(|(_, t)| t == "room cleared").count(), 2);
    assert_eq!(l.iter().filter(|(_, t)| t == "doors shut").count(), 2);
    assert!(l.iter().any(|(_, t)| t == "entered market_b"));
    assert!(l.iter().any(|(_, t)| t == "slice ends here"));
}

#[test]
fn dying_in_a_fight_room_ends_the_run_and_starts_again_in_room_a_with_nothing_held() {
    let r = run("die_in_room");
    assert_eq!(printed(&r, "MAX_BEFORE"), "14", "(he held Plating)");
    assert_eq!(printed(&r, "STATE"), "dead");
    assert_eq!(printed(&r, "SCENE"), "market_a");
    assert_eq!(printed(&r, "HP_AFTER"), "12");
    assert_eq!(
        printed(&r, "MAX_AFTER"),
        "12",
        "the card is gone with the run"
    );
    assert_eq!(printed(&r, "CARDS_AFTER"), "0");
    let l = log(&r);
    assert!(l.iter().any(|(_, t)| t == "printed again"));
    assert_eq!(
        l.iter()
            .filter(|(_, t)| t.starts_with("run begins"))
            .count(),
        3,
        "(the route's own, then the new run)"
    );
}

// =====================================================================================================================
// Slice 3a: one run of the Gutter Market, room 1 to the boss door and the summary.
// The routes are `tools/r_*.json` (written by tools/routes.mjs); the numbers asserted here are the design's and the task's.
// =====================================================================================================================

/// The frames between two log lines (the first line containing `a`, the first containing `b` after it).
fn frames_between(lines: &[(u64, String)], a: &str, b: &str) -> u64 {
    let fa = frame_of(lines, a);
    let fb = lines
        .iter()
        .find(|(f, t)| *f >= fa && t.contains(b))
        .unwrap_or_else(|| panic!("no {b:?} after {a:?}: {lines:?}"))
        .0;
    fb - fa
}

fn count_lines(lines: &[(u64, String)], needle: &str) -> usize {
    lines.iter().filter(|(_, t)| t.contains(needle)).count()
}

const GUTTER_ROOMS: [&str; 19] = [
    "s1_square",
    "s1_street",
    "s1_cross",
    "s2_maze",
    "s2_stalls",
    "s2_ring",
    "s3_tram",
    "s3_flood",
    "s3_underpass",
    "elite",
    "s5_courts",
    "s5_market",
    "s5_depot",
    "stranger",
    "s7_yard",
    "s7_junction",
    "s7_hall",
    "boss",
    "walk",
];

#[test]
fn the_same_seed_builds_the_same_chain_another_seed_another_and_every_layout_is_used() {
    let r = run("chain_seeds");
    assert_eq!(
        printed(&r, "CH_A1"),
        printed(&r, "CH_A2"),
        "the same seed, the same chain"
    );
    assert_ne!(
        printed(&r, "CH_A1"),
        printed(&r, "CH_B"),
        "another seed, another chain"
    );
    assert_ne!(printed(&r, "CH_A1"), printed(&r, "CH_C"));
    assert_ne!(printed(&r, "CH_B"), printed(&r, "CH_C"));
    // eight rooms in the design's order, then the walk-through room
    assert_eq!(
        printed(&r, "KINDS8"),
        "fight,fight,fight,elite,fight,stranger,gauntlet,boss,walk"
    );
    assert_eq!(printed(&r, "CH_A1").split(' ').count(), 9);
    // over 300 seeds every one of the 18 layouts (15 fight rooms, the elite arena, the stranger's room, the boss arena) is picked,
    // every elite mark, both strangers, both elite kinds, and every wave table of every slot
    assert_eq!(printed(&r, "LAYOUTS_USED"), printed(&r, "LAYOUTS_TOTAL"));
    assert_eq!(printed(&r, "LAYOUTS_TOTAL"), "18");
    assert_eq!(printed(&r, "MARKS_N"), "5");
    assert_eq!(printed(&r, "WHO_N"), "2");
    assert_eq!(printed(&r, "EK_N"), "2");
    // 5 fight slots x 3 tables + the elite's 1 table, and the two rooms (6, 8) that have none, counted as one each
    assert_eq!(printed(&r, "TABLES_N"), "18");
    assert_eq!(
        printed(&r, "MISSING"),
        "0",
        "every spawn point a wave table names is in every layout of its slot"
    );
}

#[test]
fn a_barrel_lights_a_1_s_fuse_then_hurts_everyone_within_2_tiles_and_lights_its_neighbour() {
    let inside = run("barrel_inside");
    let l = log(&inside);
    let fuse = frames_between(&l, "barrel fuse lit", "blast at 700,420");
    assert!((58..=62).contains(&fuse), "the fuse ran {fuse} frames");
    assert_eq!(
        printed(&inside, "HP"),
        "9",
        "the runner 90 units off (inside 96) takes 3"
    );
    assert_eq!(printed(&inside, "EN_HP"), "24", "an enemy 90 off takes 6");
    assert_eq!(
        printed(&inside, "EF_HP"),
        "30",
        "an enemy 110 off (outside) takes nothing"
    );
    assert_eq!(
        printed(&inside, "STALL_HP"),
        "2",
        "a stall 80 off takes 6 of 8"
    );
    assert_eq!(
        printed(&inside, "B2_STATE"),
        "fuse",
        "a barrel 85 off lights its own fuse"
    );
    let outside = run("barrel_outside");
    assert_eq!(
        printed(&outside, "HP"),
        "12",
        "the runner 110 units off is not hurt"
    );
    assert_eq!(printed(&outside, "EN_HP"), "24");
    assert_eq!(printed(&outside, "EF_HP"), "30");
}

#[test]
fn a_shot_drops_a_sign_and_every_touching_puddle_is_live_for_4_s_but_a_far_one_is_not() {
    let r = run("sign_puddle");
    let l = log(&r);
    assert_eq!(
        printed(&r, "BATON_STATE"),
        "up",
        "the baton cannot reach a sign"
    );
    assert_eq!(printed(&r, "BATON_LIVE"), "0");
    assert_eq!(printed(&r, "SHOT_STATE"), "down");
    assert_eq!(
        printed(&r, "tostring(P1_LIVE)"),
        "true",
        "the puddle touching the sign is live"
    );
    assert_eq!(
        printed(&r, "tostring(P2_LIVE)"),
        "false",
        "the puddle 450 units off is not"
    );
    assert_eq!(printed(&r, "P2_AFTER"), "false");
    assert_eq!(count_lines(&l, "sign drops: 1 puddles live"), 1);
    let live = frames_between(&l, "puddle at 700,340 is live", "puddle at 700,340 is dry");
    assert!(
        (238..=244).contains(&live),
        "live for {live} frames (4 s is 240)"
    );
    // standing in it: 1 a second, 4 times, for the runner and the enemy; the far one's enemy and everyone after the 4 s are untouched
    assert_eq!(printed(&r, "RUNNER_HP"), "8");
    assert_eq!(printed(&r, "ES1_HP"), "26");
    assert_eq!(printed(&r, "ES2_HP"), "30");
    assert_eq!(printed(&r, "RUNNER_HP_LATER"), "8", "dry again: no more");
    assert_eq!(count_lines(&l, "live puddle hurts runner"), 4);
    let first = nth_frame(&l, "live puddle hurts runner", 0);
    let second = nth_frame(&l, "live puddle hurts runner", 1);
    assert!(
        (59..=62).contains(&(second - first)),
        "once a second: {}",
        second - first
    );
}

#[test]
fn the_tram_warns_1_5_s_ahead_then_flattens_runner_and_enemies_on_the_rail_for_6() {
    let r = run("tram");
    let l = log(&r);
    let warn = frames_between(&l, "tram warns", "tram crosses");
    assert!(
        (89..=91).contains(&warn),
        "warned {warn} frames ahead (1.5 s is 90)"
    );
    assert!(count_sound(&r, "tram_bell") >= 2, "a bell");
    assert_eq!(printed(&r, "E1_HP"), "24", "a scrapper on the rail takes 6");
    assert_eq!(
        printed(&r, "E2_HP"),
        "30",
        "one 160 units off the rail is untouched"
    );
    assert_eq!(
        printed(&r, "RUNNER_HP_A"),
        "12",
        "the runner off the rail is untouched"
    );
    assert_eq!(printed(&r, "RUNNER_HP_B"), "6", "on the rail: 6");
    assert_eq!(
        printed(&r, "E1_HP_B"),
        "18",
        "the second crossing flattens it again"
    );
    assert_eq!(printed(&r, "CROSSINGS"), "2");
    // every 12 s: the second warning starts 12 s (720 frames) after the first would have, counted from the crossing's start
    assert!(count_lines(&l, "tram flattens runner") == 1);
}

#[test]
fn a_shielded_elite_is_double_size_and_health_and_shots_from_the_front_do_nothing() {
    let r = run("elite_shielded");
    assert_eq!(printed(&r, "HP0"), "16", "double the scrapper's 8");
    assert_eq!(printed(&r, "SIZE"), "2");
    assert_eq!(printed(&r, "MARK"), "shielded");
    assert_eq!(
        printed(&r, "string.format('%.1f', BIG_SX"),
        "2.0",
        "double size"
    );
    assert_eq!(
        printed(&r, "HP_FRONT"),
        "16",
        "a shot at its front does nothing"
    );
    assert_eq!(printed(&r, "BLOCKED"), "1");
    assert_eq!(printed(&r, "HP_BACK"), "13", "a shot at its back hurts: 3");
    assert_eq!(
        printed(&r, "HP_BATON"),
        "11",
        "the baton works from the front: 2"
    );
}

#[test]
fn a_splitting_elite_leaves_two_small_ones_that_do_not_split_again() {
    let r = run("elite_splitting");
    assert_eq!(printed(&r, "HP0"), "16");
    assert_eq!(printed(&r, "COUNT"), "2");
    assert_eq!(
        printed(&r, "SMALL"),
        "4/0.7 4/0.7",
        "half the health, 0.7 the size"
    );
    assert_eq!(printed(&r, "COUNT2"), "0", "killing them splits nothing");
}

#[test]
fn a_magnetic_elite_pulls_the_runners_shots_into_it_and_the_runner_gently() {
    let r = run("elite_magnetic");
    assert_eq!(
        printed(&r, "CONTROL_HP"),
        "30",
        "without the mark the same shot passes by"
    );
    assert_eq!(
        num(&r, "string.format('%.1f', CONTROL_MOVED)"),
        0.0,
        "and nothing pulls the runner"
    );
    assert_eq!(
        printed(&r, "E_HP"),
        "13",
        "with it the shot bends into the elite: 3"
    );
    // 45 units a second, for 60 frames
    assert_between(
        "the runner's pull in 1 s",
        num(&r, "string.format('%.1f', PULL_MOVED)"),
        38.0,
        50.0,
    );
}

#[test]
fn a_volatile_elite_explodes_1_s_after_it_dies_and_hurts_within_2_tiles() {
    let r = run("elite_volatile");
    let l = log(&r);
    let fuse = frames_between(&l, "volatile: the fuse is lit", "blast at 700,540");
    assert!(
        (58..=62).contains(&fuse),
        "exploded {fuse} frames after death"
    );
    assert_eq!(printed(&r, "RUNNER_HP"), "9", "80 units off: 3");
    assert_eq!(printed(&r, "BY1_HP"), "26", "80 units off: 4");
    assert_eq!(
        printed(&r, "BY2_HP"),
        "30",
        "110 units off (outside 96): nothing"
    );
}

#[test]
fn a_linked_elite_heals_2_a_second_while_its_partner_lives_and_a_line_joins_them() {
    let r = run("elite_linked");
    let l = log(&r);
    assert_eq!(printed(&r, "tostring(HAS_PARTNER)"), "true");
    assert_eq!(
        printed(&r, "H1"),
        "6",
        "no healing before it has found its partner"
    );
    // 2 seconds later: +4 (2 a second); once the partner is dead nothing more
    assert_eq!(printed(&r, "H2"), "10");
    assert_eq!(printed(&r, "H3"), "10");
    assert_eq!(printed(&r, "H4"), "10", "the link is broken");
    assert_eq!(count_lines(&l, "linked to a scrapper"), 1);
    assert_eq!(count_lines(&l, "the link is broken"), 1);
}

#[test]
fn an_offer_never_holds_two_cards_of_one_family_unless_the_pool_cannot_fill_it() {
    let r = run("offers_rule");
    assert_eq!(printed(&r, "OFFERS"), "800");
    assert_eq!(
        printed(&r, "SAME_FAMILY"),
        "0",
        "800 offers, none with two of one family"
    );
    let body: std::collections::BTreeSet<&str> = ["capacitor", "deep_pockets", "plating"].into();
    let only = printed(&r, "ONLY_BODY");
    let got: std::collections::BTreeSet<&str> = only.split(',').collect();
    assert_eq!(
        got, body,
        "only body cards left: the offer repeats the family rather than offer fewer"
    );
    assert_eq!(printed(&r, "BATON_BODY_N"), "3");
    assert_eq!(
        printed(&r, "BATON_BODY_FAMILIES"),
        "2",
        "two families left: both are used"
    );
    // the elite's guarantee: one uncommon card in every one of 200 offers (still never two of a family)
    assert_eq!(printed(&r, "G_BAD"), "0");
    assert_eq!(printed(&r, "G_SAME"), "0");
    assert_eq!(
        printed(&r, "UNCOMMON"),
        "live_wire,riot_stock,hot_solder,ricochet,tracer,shock_wake,deep_pockets",
        "seven cards are marked uncommon"
    );
    assert_ne!(
        printed(&r, "PLAIN"),
        printed(&r, "REROLLED"),
        "a rerolled offer is another draw"
    );
    assert_eq!(
        printed(&r, "FLAG_AFTER"),
        "false",
        "and the reroll is used up"
    );
}

#[test]
fn patch_gives_three_sets_of_lines_over_three_meetings_and_a_choice_that_works() {
    let r = run("stranger_patch");
    assert_eq!(printed(&r, "V1_WHO"), "patch");
    assert_eq!(printed(&r, "V1_SET"), "1");
    assert_eq!(printed(&r, "V1_MET"), "1");
    assert_eq!(printed(&r, "V2_SET"), "2");
    assert_eq!(printed(&r, "V2_MET"), "2");
    assert_eq!(printed(&r, "V3_SET"), "3");
    assert_eq!(printed(&r, "V3_MET"), "3");
    let (a, b, c) = (
        printed(&r, "V1_LINE"),
        printed(&r, "V2_LINE"),
        printed(&r, "V3_LINE"),
    );
    assert!(
        a != b && b != c && a != c,
        "the lines advance: {a} / {b} / {c}"
    );
    // meeting 1: +2 health (12 to 14, healed); meeting 2: heal to full from 5; meeting 3: +2 again (16)
    assert_eq!(printed(&r, "V1_CHOSEN"), "+2 health");
    assert_eq!(printed(&r, "V1_MAXHP"), "14");
    assert_eq!(printed(&r, "V1_HP"), "14");
    assert_eq!(printed(&r, "V1_STAGE"), "done");
    assert_eq!(printed(&r, "V2_CHOSEN"), "Heal to full");
    assert_eq!(printed(&r, "V2_MAXHP"), "14");
    assert_eq!(printed(&r, "V2_HP"), "14");
    assert_eq!(printed(&r, "V3_CHOSEN"), "+2 health");
    assert_eq!(printed(&r, "V3_MAXHP"), "16");
    // a word after the choice is not a new meeting
    assert_eq!(printed(&r, "MET_AFTER_BYE"), "1");
    assert_eq!(printed(&r, "BYE_ACTIVE"), "false");
    assert_eq!(printed(&r, "MET_END"), "3");
}

#[test]
fn old_sal_advances_her_lines_and_the_first_hit_in_each_room_is_ignored_for_the_rest_of_the_run() {
    let r = run("stranger_sal");
    assert_eq!(printed(&r, "V1_SET"), "1");
    assert_eq!(printed(&r, "V2_SET"), "2");
    assert_eq!(printed(&r, "V3_SET"), "3");
    assert_eq!(printed(&r, "V3_MET"), "3");
    let (a, b, c) = (
        printed(&r, "V1_LINE"),
        printed(&r, "V2_LINE"),
        printed(&r, "V3_LINE"),
    );
    assert!(a != b && b != c && a != c);
    assert_eq!(printed(&r, "V1_CHOSEN"), "Take a bowl");
    assert_eq!(
        printed(&r, "V2_CHOSEN"),
        "Not hungry",
        "(the later choices change nothing: the perk stays)"
    );
    assert_eq!(printed(&r, "TRUCE"), "true");
    // room A (the lab): the first hit is ignored, the second lands; room B (a new scene): the same again
    assert_eq!(
        (printed(&r, "A0"), printed(&r, "A1"), printed(&r, "A2")),
        ("12".into(), "12".into(), "10".into())
    );
    assert_eq!(
        (printed(&r, "B0"), printed(&r, "B1"), printed(&r, "B2")),
        ("12".into(), "12".into(), "10".into())
    );
}

#[test]
fn the_shop_heals_4_for_20_rerolls_for_15_has_a_shut_jinx_stall_and_the_bank_gives_a_key_for_4_scrap()
 {
    let r = run("shop_sums");
    assert_eq!(
        printed(&r, "HEAL1"),
        "true 80 10",
        "100 scrap, 6 health: 20 buys 4 points"
    );
    assert_eq!(
        printed(&r, "HEAL_FULL"),
        "false 60 12",
        "at full health nothing is sold (the 60 is after the first heal's 20 more)"
    );
    assert_eq!(
        printed(&r, "HEAL_PART"),
        "40 12",
        "4 points cost 20 even when only 1 fits"
    );
    assert_eq!(
        printed(&r, "REROLL1"),
        "true 25 true",
        "15 scrap, the next offer is rerolled"
    );
    assert_eq!(printed(&r, "REROLL2"), "false 25", "once");
    assert_eq!(
        printed(&r, "JINX"),
        "false 25 You hold no jinx. Lucky you.",
        "no jinx held (slice 4: the stall opens when there is one): nothing is sold and nothing is taken"
    );
    assert_eq!(
        printed(&r, "POOR"),
        "false 10",
        "20 for a heal when there are 10"
    );
    assert_eq!(
        printed(&r, "BANK1"),
        "true 3 20 20 80 scrap into 20 keys",
        "83 scrap: 20 keys, 3 left"
    );
    assert_eq!(printed(&r, "BANK2"), "false 3 20 4 scrap makes a key.");
    assert_eq!(printed(&r, "BANK3"), "0 45", "100 scrap: 25 more keys");
    // and in the room, by walking up and pressing interact
    let room = run("shop_room");
    assert_eq!(printed(&room, "BANK_SCRAP"), "3");
    assert_eq!(printed(&room, "BANK_KEYS"), "20");
    assert_eq!(printed(&room, "BANKED"), "20");
    assert_eq!(printed(&room, "HEAL_SCRAP"), "30");
    assert_eq!(printed(&room, "HEAL_HP"), "10");
    assert_eq!(printed(&room, "JINX_SCRAP"), "30");
    assert_eq!(printed(&room, "JINX_TOAST"), "You hold no jinx. Lucky you.");
}

#[test]
fn health_charge_scrap_and_cards_carry_through_real_doors_and_a_stranger_s_room() {
    let r = run("carry_chain");
    // room 1: hp 7, charge 1.5 + the Capacitor's pip, 44 scrap, three cards after the take
    assert_eq!(printed(&r, "A_HP"), "7");
    assert_eq!(printed(&r, "A_CHARGE"), "2.50");
    assert_eq!(printed(&r, "A_SCRAP"), "60", "44 + the room's 16");
    assert_eq!(printed(&r, "A_CARDS"), "3");
    assert_eq!(printed(&r, "A_MAXHP"), "12");
    assert_eq!(printed(&r, "A_MAXCH"), "4");
    // room 2 (the chain's second): all of it came along
    assert_eq!(printed(&r, "B_IS_2"), "true");
    for (k, v) in [
        ("B_HP", "7"),
        ("B_CHARGE", "2.50"),
        ("B_SCRAP", "60"),
        ("B_CARDS", "3"),
        ("B_MAXHP", "12"),
        ("B_MAXCH", "4"),
        ("B2_CARDS", "4"),
        ("B2_SCRAP", "84"),
    ] {
        assert_eq!(printed(&r, k), v, "{k}");
    }
    // the stranger's room, then the elite's: still all of it
    assert_eq!(printed(&r, "C_SCENE"), "gutter.stranger");
    assert_eq!(printed(&r, "C_STATE"), "quiet");
    for (k, v) in [
        ("C_HP", "7"),
        ("C_CHARGE", "2.50"),
        ("C_SCRAP", "84"),
        ("C_CARDS", "4"),
        ("C_MAXHP", "12"),
        ("D_HP", "7"),
        ("D_CHARGE", "2.50"),
        ("D_SCRAP", "84"),
        ("D_CARDS", "4"),
        ("D_MAXHP", "12"),
        ("D_ROOM", "3"),
    ] {
        assert_eq!(printed(&r, k), v, "{k}");
    }
    assert_eq!(printed(&r, "D_IS_ELITE"), "true");
}

#[test]
fn dying_in_the_elite_room_ends_the_run_at_the_summary_and_interact_starts_room_1_with_a_new_seed()
{
    let r = run("death_summary");
    assert_eq!(printed(&r, "DEAD_STATE"), "dead");
    let sum = printed(&r, "SUM");
    let p: Vec<&str> = sum.split(' ').collect();
    assert_eq!(p[0], "dead");
    assert_eq!(p[1], "3", "rooms cleared");
    assert!(p[2].parse::<u32>().unwrap() >= 1, "time {}", p[2]);
    assert_eq!(p[3], "5", "keys banked");
    assert_eq!(p[4], "2", "cards held");
    assert_eq!(printed(&r, "SUM_ACTIVE"), "false");
    assert_eq!(printed(&r, "SEED_CHANGED"), "true");
    assert_eq!(printed(&r, "ROOM_AFTER"), "0");
    assert_eq!(printed(&r, "CARDS_AFTER"), "0", "nothing held");
    assert_eq!(printed(&r, "HP_AFTER"), "12");
    assert_eq!(
        printed(&r, "MAX_AFTER"),
        "12",
        "Plating is gone with the run"
    );
    assert_eq!(printed(&r, "SCRAP_AFTER"), "0");
    assert_eq!(printed(&r, "FIRST"), "true", "room 1 of the new chain");
    let l = log(&r);
    assert!(
        l.iter()
            .any(|(_, t)| t.starts_with("run ends: dead, 3 rooms"))
    );
}

fn scene_files(name: &str) -> Value {
    scene_json(&format!("gutter/{name}"))
}

#[test]
fn the_nineteen_rooms_are_painted_scene_files_30x18_to_44x26_tiles_none_a_plain_rectangle() {
    let mut fills = vec![];
    for name in GUTTER_ROOMS {
        let s = scene_files(name);
        let (w, h) = (
            s["width"].as_f64().unwrap() / 48.0,
            s["height"].as_f64().unwrap() / 48.0,
        );
        assert!(
            (30.0..=44.0).contains(&w) && (18.0..=26.0).contains(&h),
            "{name} is {w}x{h} tiles"
        );
        assert!(
            s["width"].as_f64().unwrap() > 960.0 && s["height"].as_f64().unwrap() > 540.0,
            "{name} fits on a screen"
        );
        let objects = s["objects"].as_array().unwrap();
        let kinds = |k: &str| objects.iter().filter(|o| o["kind"] == k).count();
        let named = |n: &str| objects.iter().any(|o| o["name"] == n);
        assert_eq!(kinds("door"), 2, "{name}: an entry and an exit door");
        assert!(
            named("door_in") && named("door_out") && kinds("runner") == 1,
            "{name}"
        );
        let exit = objects.iter().find(|o| o["name"] == "door_out").unwrap();
        assert_eq!(exit["props"]["exit"], true, "{name}: door_out is the exit");
        assert!(
            exit["props"].get("leads_to").is_none(),
            "{name}: the chain says where the door leads"
        );
        let (f, n) = fill(&s);
        assert!(n > 300, "{name} has only {n} open cells");
        assert!(f < 0.97, "{name} is a rectangle: it fills {f} of its box");
        fills.push((name, f));
        let fight = !["stranger", "walk", "boss"].contains(&name);
        if fight {
            for sp in ["sp_1", "sp_2", "sp_3", "sp_4", "cards"] {
                assert!(named(sp), "{name} has no {sp}");
            }
        }
        // each scene has its script
        assert!(
            folder()
                .join("scenes/gutter")
                .join(format!("{name}.lua"))
                .exists(),
            "{name}.lua"
        );
    }
    // the three layouts of a slot differ in shape (their painted rows and the open fill)
    let data = std::fs::read_to_string(folder().join("data/layouts.lua")).unwrap();
    for slot in data.split("layouts = { ").skip(1) {
        let names: Vec<&str> = slot
            .split(" }")
            .next()
            .unwrap()
            .split(", ")
            .map(|s| s.trim_matches('"').trim_start_matches("gutter."))
            .collect();
        for i in 0..names.len() {
            for j in i + 1..names.len() {
                let (a, b) = (scene_files(names[i]), scene_files(names[j]));
                assert_ne!(
                    a["tilemaps"][0]["tiles"], b["tilemaps"][0]["tiles"],
                    "{} and {} are the same map",
                    names[i], names[j]
                );
                let (fa, fb) = (fill(&a).0, fill(&b).0);
                let sizes = (a["width"] != b["width"]) || (a["height"] != b["height"]);
                assert!(
                    (fa - fb).abs() > 0.02 || sizes,
                    "{} and {} have the same shape: {fa} {fb}",
                    names[i],
                    names[j]
                );
            }
        }
    }
    eprintln!("fill of each room's box: {fills:?}");
}

#[test]
fn the_hazard_is_in_every_room_from_slot_3_on_and_not_before_and_the_pieces_are_in_the_rooms() {
    let counts = |name: &str, kind: &str| {
        scene_files(name)["objects"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|o| o["kind"] == kind)
            .count()
    };
    let slot = |names: &[&str]| names.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    for name in slot(&[
        "s1_square",
        "s1_street",
        "s1_cross",
        "s2_maze",
        "s2_stalls",
        "s2_ring",
    ]) {
        assert_eq!(counts(&name, "sign"), 0, "{name}: no hazard before room 3");
        assert_eq!(counts(&name, "tram"), 0, "{name}");
        assert!(
            counts(&name, "stall") >= 2
                && counts(&name, "barrel") >= 3
                && counts(&name, "puddle") >= 3,
            "{name}'s pieces"
        );
    }
    for name in slot(&[
        "s3_tram",
        "s3_flood",
        "s3_underpass",
        "elite",
        "s5_courts",
        "s5_market",
        "s5_depot",
        "s7_yard",
        "s7_junction",
        "s7_hall",
    ]) {
        assert!(
            counts(&name, "sign") >= 3,
            "{name} has {} signs",
            counts(&name, "sign")
        );
        assert!(
            counts(&name, "puddle") >= 6,
            "{name} has {} puddles",
            counts(&name, "puddle")
        );
        assert!(
            counts(&name, "stall") >= 2 && counts(&name, "barrel") >= 4,
            "{name}'s pieces"
        );
    }
    // a tram in some rooms, a rail for each tram, at least one room with one in slots 3, 5 and 7
    let with_tram: Vec<&str> = GUTTER_ROOMS
        .iter()
        .copied()
        .filter(|n| counts(n, "tram") > 0)
        .collect();
    assert_eq!(
        with_tram,
        [
            "s3_tram",
            "s3_underpass",
            "s5_depot",
            "s7_yard",
            "s7_junction"
        ]
    );
    for n in &with_tram {
        assert_eq!(
            counts(n, "rail"),
            counts(n, "tram"),
            "{n}: a rail under each tram"
        );
    }
    assert_eq!(counts("s7_junction", "tram"), 2, "a crossing of two rails");
    // the elite arena and the stranger's room, the walk-through room's four counters
    assert_eq!(counts("walk", "counter"), 4);
    assert_eq!(counts("stranger", "marker"), 1);
}

#[test]
fn every_room_of_the_district_starts_and_a_fight_room_spawns_its_first_wave_with_no_warning() {
    for name in GUTTER_ROOMS {
        let plan = serde_json::json!({
            "start_scene": format!("gutter.{name}"),
            "invincible": true,
            "steps": [{ "wait": 220 }],
            "print": ["nova.count('enemy') + nova.count('warn')", "nova.current_scene()"],
        })
        .to_string();
        let r = play(&format!("room-{name}"), plan);
        let n: i64 = printed(&r, "nova.count('enemy') + nova.count('warn')")
            .parse()
            .unwrap();
        let fight = !["stranger", "walk", "boss"].contains(&name);
        assert_eq!(
            n > 0,
            fight,
            "{name}: {n} enemies or warnings after 220 frames"
        );
        assert_eq!(
            printed(&r, "nova.current_scene()"),
            format!("gutter.{name}")
        );
    }
}

fn whole_run(name: &str) -> (Value, Vec<String>) {
    let r = run(name);
    let chain: Vec<String> = printed(&r, "CHAIN").split(' ').map(String::from).collect();
    assert_eq!(chain.len(), 9);
    for (i, scene) in chain.iter().enumerate() {
        assert_eq!(
            &printed(&r, &format!("ROOM{}", i + 1)),
            scene,
            "room {} is the chain's",
            i + 1
        );
    }
    assert_eq!(printed(&r, "KIND4"), "elite");
    assert_eq!(printed(&r, "KIND7"), "gauntlet");
    assert_eq!(printed(&r, "MET0"), "0");
    assert_eq!(
        printed(&r, "MET1"),
        "1",
        "the stranger's counter went up by one"
    );
    assert_eq!(printed(&r, "WON0"), "false");
    assert_eq!(
        printed(&r, "WON9"),
        "true",
        "the boss door ended the run as a win"
    );
    // the fights paid and each took a card (rooms 1 2 3 4 5 7: six)
    assert_eq!(printed(&r, "CARDS1_AFTER"), "1");
    assert_eq!(printed(&r, "CARDS4_AFTER"), "4");
    assert_eq!(printed(&r, "CARDS5_AFTER"), "5");
    assert_eq!(printed(&r, "CARDS7_AFTER"), "6");
    assert_eq!(printed(&r, "PAID4"), "40", "the elite pays 40");
    // the bank: 4 scrap to a key
    let scrap = num(&r, "SCRAP_BEFORE_BANK") as i64;
    assert!(scrap > 150, "scrap {scrap}");
    // (slice 4: the rooms paid keys on the way, so the bank adds to what was held on entering the shop)
    assert_eq!(num(&r, "KEYS1") as i64, num(&r, "KEYS0") as i64 + scrap / 4);
    assert_eq!(num(&r, "SCRAP_AFTER_BANK") as i64, scrap % 4);
    // the summary: a win, 8 rooms, the keys, 6 cards
    assert_eq!(printed(&r, "END_SCENE"), "summary");
    assert_eq!(printed(&r, "SUM"), format!("win 8 {} 6", scrap / 4));
    assert!(num(&r, "SUM_TIME") > 100.0);
    let l = log(&r);
    assert_eq!(count_lines(&l, "room cleared"), 6, "six fights");
    assert_eq!(count_lines(&l, "doors shut"), 6);
    assert_eq!(count_lines(&l, "the boss door: the run is won"), 1);
    assert_eq!(count_lines(&l, "run ends: win, 8 rooms"), 1);
    // the elite: its mark came from the seed and was applied
    assert_eq!(count_lines(&l, "elite: "), 1);
    (r, chain)
}

#[test]
fn a_whole_run_from_room_1_to_the_summary_with_the_test_player_seed_3() {
    // (the test player is invincible for this route and the next: they prove the chain, the rooms, the doors, the waves, the elite, the talk, the
    // bank and the summary, not the fighting, which the routes above and the slice-2 tests prove)
    let (r, _) = whole_run("run_a");
    assert_eq!(printed(&r, "MARK"), "magnetic");
    assert_eq!(printed(&r, "WHO"), "patch");
    assert_eq!(printed(&r, "TALKED"), "+2 health");
}

#[test]
fn a_whole_run_with_another_seed_plays_other_rooms_another_elite_and_the_other_stranger() {
    let (r, chain_b) = whole_run("run_b");
    assert_eq!(printed(&r, "MARK"), "shielded");
    assert_eq!(printed(&r, "WHO"), "old_sal");
    assert_eq!(printed(&r, "TALKED"), "Take a bowl");
    let a = run("run_a");
    let chain_a: Vec<String> = printed(&a, "CHAIN").split(' ').map(String::from).collect();
    for i in [0, 1, 2, 4, 6] {
        assert_ne!(chain_a[i], chain_b[i], "room {} is another layout", i + 1);
    }
}

#[test]
fn the_new_sounds_exist() {
    for s in ["blast", "tram_bell", "tram_pass", "sign_drop", "buy"] {
        assert!(
            folder().join("sounds").join(format!("{s}.wav")).exists(),
            "no sounds/{s}.wav"
        );
        assert!(
            folder()
                .join("sounds")
                .join(format!("{s}.sfx.json"))
                .exists()
        );
    }
    // each is played by some route
    let mut played = std::collections::BTreeSet::new();
    for name in ["barrel_inside", "sign_puddle", "tram", "shop_room"] {
        for line in report_sounds(&run(name)) {
            if let Some(rest) = line.split("sound ").nth(1) {
                played.insert(rest.split(' ').next().unwrap().to_string());
            }
        }
    }
    for s in ["blast", "tram_bell", "tram_pass", "sign_drop", "buy"] {
        assert!(played.contains(s), "no route plays {s}: {played:?}");
    }
}

// =====================================================================================================================
// Slice 3b: Mother Coil, the Den, the Workbench and saving. Routes are in tools/routes.mjs ("SLICE 3b"); each test asserts what its
// route printed. The fight is proven twice: the attacks one at a time (boss_*), then `boss_fair`, a whole fight WITHOUT invincibility
// won by a test player that waits for each tell, walks to the safe place and hits the drum in its window.
// =====================================================================================================================

/// The frame a sound started at (the n-th time, counting from 0).
fn sound_frame(r: &Value, name: &str, n: usize) -> u64 {
    let hits: Vec<u64> = r["sounds"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| {
            s["text"]
                .as_str()
                .unwrap_or("")
                .contains(&format!("sound {name} "))
        })
        .map(|s| s["frame"].as_u64().unwrap())
        .collect();
    *hits
        .get(n)
        .unwrap_or_else(|| panic!("sound {name} #{n} never started: {:?}", report_sounds(r)))
}

fn s(r: &Value, k: &str) -> String {
    printed(r, k)
}

/// Plays a plan with its save data in `save` (a folder): the save is opened before the game's scripts run, as `nova run --save-dir` does.
fn play_saved(name: &str, plan: String, save: &Path) -> Value {
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder()).unwrap());
    let save = save.to_path_buf();
    let mut g = Game::load_with(vfs, &move |_| Some(save.clone())).expect("Neon Undertow loads");
    g.upload(&mut FakeGpu);
    let dir = scratch(name);
    std::fs::write(dir.join("plan.json"), plan).unwrap();
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
    g.flush_save();
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

#[test]
fn junk_lanes_are_lit_0_8_s_ahead_and_hurt_in_the_lane_and_not_between() {
    let hit = run("boss_lane_hit");
    assert_eq!(
        s(&hit, "ROWS").trim(),
        "348 624 900",
        "three lanes across the floor"
    );
    assert_eq!(
        (s(&hit, "HP0"), s(&hit, "HP1")),
        ("12".into(), "10".into()),
        "standing in a lane: 2 damage"
    );
    let l = log(&hit);
    let lit = frame_of(&l, "lane lit at");
    let drag = sound_frame(&hit, "junk_drag", 0);
    assert!(
        (47..=49).contains(&(drag - lit)),
        "the lanes are lit 0.8 s before the junk moves: {} frames",
        drag - lit
    );
    assert_eq!(
        sound_frame(&hit, "tell_lanes", 0),
        lit,
        "the tell has its own sound, at the moment the lanes light"
    );
    assert_eq!(count_lines(&l, "boss hit lands: lane"), 1, "hit once");
    let gap = run("boss_lane_gap");
    assert_eq!(
        (s(&gap, "HP0"), s(&gap, "HP1")),
        ("12".into(), "12".into()),
        "between the lanes: nothing"
    );
}

#[test]
fn a_car_drops_after_a_1_s_shadow_hurts_within_1_5_tiles_leaves_wreckage_and_later_attacks_break_it()
 {
    let r = run("boss_car");
    let l = log(&r);
    let shadow = frames_between(&l, "car shadow at", "car slams at");
    assert!(
        (59..=61).contains(&shadow),
        "the shadow grows for 1 s: {shadow} frames"
    );
    assert!(has_sound(&r, "tell_car") && has_sound(&r, "car_slam"));
    assert_eq!(
        s(&r, "HP1"),
        "12",
        "a car 100 units away (radius 72) hurts no one"
    );
    assert_eq!(s(&r, "WR1"), "1", "it left a wreck");
    assert_eq!(s(&r, "WR1_SETTLED"), "true");
    assert_eq!(s(&r, "HP2"), "9", "a car 50 units away hurts for 3");
    assert_eq!(
        s(&r, "WR2"),
        "1",
        "the second car broke the first wreck and left its own"
    );
    assert_eq!(
        s(&r, "WR2_SOLID"),
        "1",
        "the wreck is solid cover once he has walked out of it"
    );
    assert_eq!(
        s(&r, "WR3"),
        "0",
        "a junk lane through the wrecks broke them"
    );
    assert_eq!(s(&r, "HP3"), "9", "(he stood between the lanes)");
    assert_eq!(
        s(&r, "WR4"),
        "4",
        "five cars in a row: at most four wrecks stand"
    );
    assert!(count_lines(&l, "wreckage breaks") >= 3);
}

#[test]
fn the_drum_takes_no_damage_while_shut_and_for_2_5_s_after_each_slam_it_takes_2_2_4() {
    let r = run("boss_drum");
    assert_eq!(s(&r, "C0"), "96");
    assert_eq!(
        (s(&r, "OPEN_BEFORE"), s(&r, "C1"), s(&r, "CLANGS")),
        ("false".into(), "96".into(), "3".into()),
        "three baton hits on a shut drum: three clangs, no damage"
    );
    assert_eq!(
        (s(&r, "HP0"), s(&r, "HP1")),
        ("12".into(), "9".into()),
        "the slam landed where he stood: 3 damage"
    );
    assert_eq!(s(&r, "C2"), "88", "in the window the chain does 2 + 2 + 4");
    assert_eq!(
        (s(&r, "OPEN_AFTER"), s(&r, "C3"), s(&r, "CLANGS2")),
        ("false".into(), "88".into(), "6".into()),
        "shut again: three more clangs, no damage"
    );
    let l = log(&r);
    let window = frames_between(&l, "drum opens", "drum closes");
    assert!(
        (150..=165).contains(&window),
        "the window is 2.5 s (150 frames; the hit-stops of his three hits freeze it too): {window}"
    );
    let lock = frames_between(&l, "magnet locks", "magnet slams");
    assert_eq!(
        lock, 54,
        "the ring is locked for 0.9 s before the slam (at least 0.6)"
    );
    assert_eq!(
        sound_frame(&r, "tell_magnet", 0),
        frame_of(&l, "magnet locks"),
        "its own tell sound, when the ring locks"
    );
    assert!(
        has_sound(&r, "magnet_slam") && has_sound(&r, "drum_open") && has_sound(&r, "drum_clang"),
        "the drum has a sound when it opens"
    );
    let shot = run("boss_drum_shot");
    assert_eq!(
        (s(&shot, "C1"), s(&shot, "CLANGS"), s(&shot, "C2")),
        ("96".into(), "1".into(), "93".into()),
        "a shot: nothing while shut, 3 when open"
    );
}

#[test]
fn at_half_health_the_floor_is_magnetised_shots_curve_in_a_stripe_and_drones_are_pulled_along_it() {
    let r = run("boss_phase2");
    assert_eq!(
        (s(&r, "PH0"), s(&r, "ARMED0")),
        ("false".into(), "false".into())
    );
    assert_eq!(
        (s(&r, "PH1"), s(&r, "HP_BOSS")),
        ("true".into(), "47".into()),
        "49 health, a hit of 2: 47 is under half of 96 and the phase starts"
    );
    assert_eq!(
        (num(&r, "PAUSE0"), num(&r, "PAUSE1")),
        (1.2, 0.6),
        "her attacks come faster"
    );
    let (x0, x1) = (num(&r, "IN_X0"), num(&r, "IN_X1"));
    assert!(
        (x1 - x0).abs() > 60.0,
        "a shot fired inside a stripe ends {} units off its straight line",
        x1 - x0
    );
    assert!(
        num(&r, "IN_TURN") > 0.5 && num(&r, "IN_DX").abs() > 0.3,
        "it turned: {} rad, heading x {}",
        num(&r, "IN_TURN"),
        num(&r, "IN_DX")
    );
    assert_eq!(
        (
            s(&r, "OUT_X0"),
            s(&r, "OUT_X1"),
            s(&r, "OUT_DX"),
            s(&r, "OUT_TURN")
        ),
        ("800".into(), "800".into(), "0".into(), "0".into()),
        "a shot fired in the gap stays on its line"
    );
    assert_between(
        "drone in stripe 1 (pulled down)",
        num(&r, "DY1"),
        140.0,
        160.0,
    );
    assert_between(
        "drone in stripe 2 (pulled up)",
        num(&r, "DY2"),
        -160.0,
        -140.0,
    );
    assert_eq!(s(&r, "DY3"), "0", "a drone in a gap is not pulled");
    assert!(has_sound(&r, "stripes_on"));
}

#[test]
fn mother_coil_dies_in_a_long_burst_pays_120_scrap_offers_a_rare_card_and_opens_the_door() {
    let r = run("boss_dies");
    assert_eq!(s(&r, "BEFORE_STATE"), "boss");
    assert_eq!(s(&r, "COIL_LEFT"), "0");
    assert_eq!(
        (s(&r, "SCRAP0"), s(&r, "SCRAP1"), s(&r, "PAID")),
        ("0".into(), "120".into(), "120".into()),
        "a big scrap pay"
    );
    assert!(
        num(&r, "RARES") >= 1.0,
        "at least one rare in the offer: {}",
        s(&r, "IDS")
    );
    assert_eq!(s(&r, "DRONES"), "0", "her drones go with her");
    assert!(
        ["scatter", "second_wind", "capacitor"].contains(&s(&r, "TAKEN").as_str()),
        "the rare cards are Scatter, Second Wind and Capacitor"
    );
    assert_eq!(s(&r, "HELD"), s(&r, "TAKEN"));
    assert_eq!(
        (s(&r, "DOOR_STATE"), s(&r, "DOOR2")),
        ("unlocked".into(), "open".into()),
        "the door unlocks at the pay and opens when the card is taken"
    );
    assert!(
        count_sound(&r, "boss_burst") >= 8,
        "a long burst: {} blasts",
        count_sound(&r, "boss_burst")
    );
    assert!(has_sound(&r, "boss_die"));
    let sounds = report_sounds(&r).join(" | ");
    let boss = sounds
        .find("music mother_coil")
        .expect("the boss track plays when the fight does");
    let after = sounds
        .rfind("music undertow")
        .expect("the district track again");
    assert!(
        boss < after,
        "the boss track gives way to the district track: {sounds}"
    );
}

#[test]
fn the_fight_is_fair_a_whole_fight_without_invincibility_is_won_by_dodging_and_not_one_attack_lands()
 {
    let r = run("boss_fair");
    assert_eq!(s(&r, "RUNNER.hp"), "12", "not a point of health lost");
    assert_eq!(s(&r, "RUNNER.state"), "free");
    assert_eq!(s(&r, "nova.count('mother_coil')"), "0", "she is gone");
    assert_eq!(s(&r, "nova.scene_now().state"), "cards");
    assert_eq!(s(&r, "#nova.all('card')"), "3");
    let l = log(&r);
    assert_eq!(count_lines(&l, "boss hit lands"), 0);
    assert!(
        count_lines(&l, "mother coil casts lanes") >= 2
            && count_lines(&l, "mother coil casts cars") >= 2
            && count_lines(&l, "mother coil casts slam") >= 5,
        "every attack was played"
    );
    assert_eq!(
        count_lines(&l, "phase 2: the floor is magnetised"),
        1,
        "and the stripe phase"
    );
    assert!(count_lines(&l, "mother coil takes") >= 10);
    assert!(l.last().unwrap().0 < 6000, "a minute or so of fighting");
}

#[test]
fn every_boss_sound_exists_and_the_routes_play_each_by_purpose() {
    let names = [
        "tell_lanes",
        "junk_drag",
        "tell_car",
        "car_slam",
        "tell_magnet",
        "magnet_slam",
        "drum_open",
        "drum_clang",
        "stripes_on",
        "boss_burst",
        "boss_die",
        "boss_bark",
        "printed",
        "lullaby_blip",
        "menu_move",
        "menu_select",
        "move_in",
        "revive",
        "reroll",
        "wreck_break",
    ];
    for n in names {
        assert!(
            folder().join("sounds").join(format!("{n}.wav")).exists(),
            "no sounds/{n}.wav"
        );
        assert!(
            folder()
                .join("sounds")
                .join(format!("{n}.sfx.json"))
                .exists()
        );
    }
    assert!(
        folder().join("music/mother_coil.ogg").exists() && folder().join("music/den.ogg").exists()
    );
    let mut played = std::collections::BTreeSet::new();
    for name in [
        "boss_lane_hit",
        "boss_car",
        "boss_drum",
        "boss_phase2",
        "boss_dies",
        "den_tour",
        "up_second",
        "up_streets",
        "movein_patch",
    ] {
        for line in report_sounds(&run(name)) {
            if let Some(rest) = line.split("sound ").nth(1) {
                played.insert(rest.split(' ').next().unwrap().to_string());
            }
        }
    }
    for n in names {
        assert!(played.contains(n), "no route plays {n}: {played:?}");
    }
}

#[test]
fn the_workbench_buys_with_the_right_keys_never_below_zero_or_past_the_last_tier() {
    let r = run("workbench_sums");
    assert_eq!(s(&r, "B1"), "true 38 1", "Thicker Print tier 1 costs 12");
    assert_eq!(s(&r, "B2"), "true 14 2", "tier 2 costs 24");
    assert!(
        s(&r, "B3").starts_with("false 14 2 40 keys needed"),
        "{}",
        s(&r, "B3")
    );
    assert_eq!(s(&r, "B4"), "true 60 3", "tier 3 costs 40");
    assert_eq!(s(&r, "B5"), "false 60 3 Fully upgraded.");
    assert!(
        s(&r, "B6").starts_with("false 0 0 15 keys needed"),
        "no keys: nothing is bought, nothing goes below zero"
    );
    assert_eq!(
        s(&r, "COSTS").trim(),
        "thicker_print=12/24/40 warm_start=14/36/70 good_solder=15/40/80 bigger_magazine=18/50 loose_change=10/30/60 familiar_streets=24/50/90 fast_print=150 lullaby_eye=12/40 deeper_deck=20/45/80/130 second_chance=70"
    );
    let l = run("up_locked");
    assert_eq!(s(&l, "FAST"), "false Locked: after the second district");
    assert_eq!(
        s(&l, "DEEP"),
        "true Deeper Deck: +6 cards in the pool (18 of 36)",
        "slice 4: Deeper Deck is for sale"
    );
    assert_eq!(
        (s(&l, "KEYS"), s(&l, "TIER_F"), s(&l, "TIER_D")),
        ("480".into(), "0".into(), "1".into()),
        "Fast Print took nothing; Deeper Deck tier 1 cost 20"
    );
    assert!(s(&l, "NAMES").starts_with("Thicker Print/3 Warm Start/3 Good Solder/3 Bigger Magazine/2 Loose Change/3 Familiar Streets/3 Fast Print/1 LULLABY's Eye/2 Deeper Deck/4 Second Chance/1"), "ten upgrades with their tiers");
}

#[test]
fn each_of_the_ten_upgrades_changes_what_it_says() {
    // Thicker Print tier 2: a run starts with 14 points
    let r = run("up_thicker");
    assert_eq!(
        (s(&r, "MAX"), s(&r, "HP"), s(&r, "RUN_MAX")),
        ("14".into(), "14".into(), "14".into())
    );
    // Good Solder: 100 hits of 2 do 200 / 210 (tier 1, +5%) / 230 (tier 3, +15%); a chain of 2, 2, 4 five times is 40 and 46 at tier 3
    let r = run("up_solder");
    assert_eq!(
        (s(&r, "T0"), s(&r, "T1"), s(&r, "T3")),
        ("200".into(), "210".into(), "230".into())
    );
    assert_eq!(
        s(&r, "CHAINS5_T3"),
        "46",
        "5 chains of 8 at +15% (46 of 46): {}",
        s(&r, "CH")
    );
    let r = run("up_solder_real");
    assert_eq!(
        (s(&r, "BASE"), s(&r, "SOLDER")),
        ("24".into(), "27".into()),
        "three real chains on a dummy: 24, and 27 at tier 3 (9.2 each, the fractions carried)"
    );
    // Warm Start: a common, then + an uncommon, then + the chosen card
    let r = run("up_warm");
    assert_eq!(s(&r, "W0"), "");
    assert_eq!(s(&r, "W1"), "long_reach:common");
    assert_eq!(s(&r, "W2"), "long_reach:common,live_wire:uncommon");
    assert_eq!(
        s(&r, "W3"),
        "long_reach:common,live_wire:uncommon,plating:common"
    );
    assert_eq!(
        s(&r, "MAXHP3"),
        "14",
        "(the chosen Plating is held from the start)"
    );
    // Bigger Magazine: +1 pip a tier
    let r = run("up_magazine");
    assert_eq!((s(&r, "PIPS"), s(&r, "CH")), ("5".into(), "5".into()));
    // Loose Change: 10% a tier of unbanked scrap as keys on death: 100 scrap at tier 2 is 20 keys, on top of the 5 held
    let r = run("up_loose");
    assert_eq!(
        (
            s(&r, "KEYS0"),
            s(&r, "KEYS1"),
            s(&r, "LOOSE"),
            s(&r, "BANKED")
        ),
        ("5".into(), "25".into(), "20".into(), "0".into())
    );
    // Familiar Streets: 2 rerolls at tier 2, each draws the offer again; the third does nothing
    let r = run("up_streets");
    assert_eq!(
        (
            s(&r, "LEFT0"),
            s(&r, "LEFT1"),
            s(&r, "LEFT2"),
            s(&r, "LEFT3")
        ),
        ("2".into(), "1".into(), "0".into(), "0".into())
    );
    assert_ne!(s(&r, "IDS"), s(&r, "IDS1"));
    assert_ne!(s(&r, "IDS1"), s(&r, "IDS2"));
    assert_eq!(
        s(&r, "IDS2"),
        s(&r, "IDS3"),
        "no rerolls left: the cards stay"
    );
    assert_eq!((s(&r, "N1"), s(&r, "N2")), ("3".into(), "3".into()));
    // LULLABY's Eye: nothing, the next room's kind, then the elite's mark too
    let r = run("up_eye");
    assert_eq!(s(&r, "E0"), "nil");
    assert_eq!(s(&r, "E1"), "NEXT: An elite");
    assert_eq!(
        s(&r, "E2"),
        format!("NEXT: An elite: {}", {
            let m = s(&r, "MARK");
            format!("{}{}", m[..1].to_uppercase(), &m[1..])
        })
    );
    assert_eq!(
        s(&r, "E_BOSS"),
        "NEXT: The shop and the bank",
        "(from room 8 the next room is the walk-through room)"
    );
    // Deeper Deck: 12 cards, +6 a tier; a made-up 13th card is never offered at tier 0 and is at tier 1
    let r = run("up_deck");
    assert_eq!(
        (s(&r, "POOL0"), s(&r, "POOL1"), s(&r, "POOL4")),
        ("12".into(), "18".into(), "36".into())
    );
    assert_eq!(s(&r, "SEEN0"), "0");
    assert!(num(&r, "SEEN1") > 10.0, "{}", s(&r, "SEEN1"));
    assert_eq!(s(&r, "BUY"), "true", "slice 4: the tiers are for sale");
    // Second Chance: once a run a killing blow leaves him on half health, 2 s untouchable; the second one kills
    let r = run("up_second");
    assert_eq!(
        (
            s(&r, "HP1"),
            s(&r, "STATE1"),
            s(&r, "BLINK1"),
            s(&r, "LEFT1")
        ),
        ("6".into(), "free".into(), "2.0".into(), "0".into())
    );
    assert_eq!((s(&r, "HP2"), s(&r, "STATE2")), ("0".into(), "dead".into()));
    // Fast Print: stored, locked (see the Workbench test)
}

#[test]
fn lullaby_has_many_different_lines_by_what_brought_you_to_the_den() {
    let r = run("lullaby_lines");
    assert_eq!(s(&r, "KINDS").trim(), "first=4 dead=10 win=7");
    assert_eq!(s(&r, "TOTAL"), "21");
    assert_eq!(s(&r, "DUP"), "0", "no line is used twice");
    assert_eq!(
        s(&r, "NEXT_DIFFERENT"),
        "true",
        "the next line is not the last one"
    );
    assert_eq!(s(&r, "SCREEN").trim(), "fresh=3 won=3 veteran=3 default=3");
}

#[test]
fn the_den_has_its_stations_and_the_title_leads_to_a_run_through_the_workbench() {
    let r = run("den_tour");
    assert_eq!(
        (s(&r, "WAKE_KIND"), s(&r, "WAKE_STATE")),
        ("first".into(), "wake".into()),
        "the first boot: a 'printing' beat with LULLABY's first-boot line"
    );
    assert_eq!(
        s(&r, "WAKE_LINE"),
        "Oh, it worked. Don't thank me. Thank the loose wire."
    );
    assert_eq!(
        (s(&r, "FREE"), s(&r, "DEN_SCENE")),
        ("free".into(), "den".into())
    );
    assert_eq!(
        (s(&r, "SCREEN_SET"), s(&r, "SCREEN_N")),
        ("fresh".into(), "3".into()),
        "her screen: a few lines that change with your runs and wins"
    );
    assert!(
        s(&r, "PLATE").starts_with("Empty stall. Met 0 of 3 times"),
        "{}",
        s(&r, "PLATE")
    );
    assert_eq!(
        (s(&r, "BENCH"), s(&r, "SEL0"), s(&r, "SEL1")),
        ("bench".into(), "1".into(), "2".into())
    );
    assert_eq!(
        (s(&r, "KEYS_AFTER"), s(&r, "TIER"), s(&r, "TOAST")),
        (
            "28".into(),
            "1".into(),
            "Thicker Print: 13 health points".into()
        ),
        "40 keys, tier 1 costs 12"
    );
    assert_eq!(
        (s(&r, "KEYS_AFTER2"), s(&r, "TIER2")),
        ("4".into(), "2".into()),
        "tier 2 costs 24"
    );
    assert_eq!(s(&r, "CLOSED"), "free");
    assert_eq!(
        s(&r, "RUN_MAX"),
        "14",
        "the door starts a run with the bought upgrade"
    );
    assert_eq!(s(&r, "FROM_DEN"), "true");
}

fn movein(name: &str, who: &str, nth_line: &str) {
    let r = run(name);
    assert_eq!(
        (s(&r, "IN1"), s(&r, "IN2"), s(&r, "IN3")),
        ("nil".into(), "nil".into(), "true".into()),
        "{who}: moves in at the third meeting"
    );
    assert_eq!(
        (s(&r, "MET1"), s(&r, "MET2"), s(&r, "MET3")),
        ("1".into(), "2".into(), "3".into())
    );
    assert_eq!(s(&r, "MOVED"), who);
    assert_eq!(
        (s(&r, "ANN"), s(&r, "ANN_WHO"), s(&r, "SEEN")),
        ("movein".into(), who.into(), "true".into()),
        "the Den announces it, once"
    );
    assert_eq!(s(&r, "LINE"), s(&r, "LINE_1"), "a new line set in the Den");
    assert!(s(&r, "LINE").starts_with(nth_line), "{}", s(&r, "LINE"));
    assert_eq!(s(&r, "STATE_R"), "resident");
}

#[test]
fn three_meetings_move_patch_in_her_den_perk_is_2_health_at_the_start_of_each_run() {
    movein("movein_patch", "patch", "Sit. Good.");
    let r = run("movein_patch");
    assert_eq!(
        (s(&r, "MAX1"), s(&r, "HP1"), s(&r, "NOTES")),
        ("14".into(), "14".into(), "Patch: +2 health".into())
    );
    assert_eq!(
        (s(&r, "H0"), s(&r, "H1"), s(&r, "H2")),
        ("14".into(), "12".into(), "10".into()),
        "(no bowl: every hit lands)"
    );
}

#[test]
fn three_meetings_move_old_sal_in_her_bowl_ignores_the_first_hit_of_the_first_room_only() {
    movein("movein_sal", "old_sal", "Eat first.");
    let r = run("movein_sal");
    assert_eq!(
        (s(&r, "MAX1"), s(&r, "NOTES")),
        ("12".into(), "Old Sal: the first hit is ignored".into())
    );
    assert_eq!(
        (s(&r, "H0"), s(&r, "H1"), s(&r, "H2")),
        ("12".into(), "12".into(), "10".into()),
        "room 1: the first hit is ignored, the second lands"
    );
    assert_eq!(
        (s(&r, "G0"), s(&r, "G1")),
        ("10".into(), "8".into()),
        "room 2: the bowl is gone, the first hit lands"
    );
}

#[test]
fn a_death_leads_to_the_summary_then_the_den_with_lullabys_death_line_and_not_into_a_run() {
    let r = run("death_den");
    assert_eq!(s(&r, "LINE0"), "first");
    assert_eq!(
        (s(&r, "SUM_DEN"), s(&r, "LAST"), s(&r, "PRINTS")),
        ("true".into(), "dead".into(), "1".into())
    );
    assert_eq!(
        (s(&r, "KIND"), s(&r, "STATE"), s(&r, "IN_RUN")),
        ("dead".into(), "wake".into(), "false".into()),
        "the Den, waking: not a run"
    );
    assert_eq!(s(&r, "RUNS"), "1");
    assert!(s(&r, "LINE").starts_with("That's the fourth you this week."));
}

#[test]
fn keys_upgrades_meetings_move_ins_runs_wins_and_best_time_are_saved_and_new_game_wipes_them() {
    let dir = scratch("save");
    // boot 1: a fresh save, the title's Start, the Workbench buys Thicker Print (50 keys, 12 spent), counters set, then the game "quits"
    let r1 = play_saved("save1", plan_text("save_boot1"), &dir);
    assert_eq!(printed(&r1, "require('lib.meta').keys"), "38");
    assert!(dir.read_dir().unwrap().count() > 0, "a save was written");
    // boot 2: the same folder, a new game process: everything is there
    let r2 = play_saved("save2", plan_text("save_boot2"), &dir);
    for (k, v) in [
        ("L_KEYS", "38"),
        ("L_TIER", "1"),
        ("L_MET", "3"),
        ("L_IN", "true"),
        ("L_RUNS", "4"),
        ("L_WINS", "1"),
        ("L_BEST", "311.5"),
    ] {
        assert_eq!(printed(&r2, k), v, "{k} after the restart");
    }
    assert_eq!(printed(&r2, "ITEMS"), "Continue/New game");
    assert_eq!(printed(&r2, "MODE1"), "confirm", "New game asks first");
    assert_eq!(
        (printed(&r2, "MODE2"), printed(&r2, "KEYS_KEPT")),
        ("menu".into(), "38".into()),
        "'Keep my save' keeps everything"
    );
    for (k, v) in [
        ("W_KEYS", "0"),
        ("W_TIER", "0"),
        ("W_MET", "0"),
        ("W_IN", "nil"),
        ("W_RUNS", "0"),
        ("W_WINS", "0"),
        ("W_LAST", "first"),
    ] {
        assert_eq!(printed(&r2, k), v, "{k} after 'Erase it all'");
    }
    // boot 3: the wipe is on disk too
    let r3 = play_saved("save3", plan_text("save_boot3"), &dir);
    for (k, v) in [
        ("N_KEYS", "0"),
        ("N_TIER", "0"),
        ("N_IN", "nil"),
        ("N_RUNS", "0"),
    ] {
        assert_eq!(printed(&r3, k), v, "{k} at the next boot");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_whole_route_title_den_workbench_eight_rooms_mother_coil_bank_district_cleared_and_a_win_in_the_den()
 {
    // (the test player is invincible for this route: it proves the whole flow; the fighting is proven by the routes above, boss_fair without invincibility)
    let r = run("full_run");
    assert_eq!(
        (s(&r, "DEN0"), s(&r, "WINS0")),
        ("first".into(), "0".into())
    );
    assert_eq!(
        (s(&r, "BOUGHT"), s(&r, "KEYS_SPENT"), s(&r, "MAX_START")),
        ("1".into(), "12".into(), "13".into()),
        "one upgrade bought for 12 keys, and the run starts with 13 points"
    );
    let chain: Vec<String> = s(&r, "CHAIN").split(' ').map(String::from).collect();
    assert_eq!(chain.len(), 9);
    assert_eq!(s(&r, "ROOM8"), "gutter.boss");
    assert_eq!(chain[7], "gutter.boss");
    assert!(
        num(&r, "RARE_OFFER") >= 1.0,
        "a rare card on offer after Mother Coil"
    );
    assert!(
        num(&r, "BOSS_PAID") >= 120.0,
        "the boss pays 120 (more with Deep Pockets, which this seed's run took)"
    );
    assert_eq!(
        s(&r, "CARDS8"),
        "7",
        "six fight rooms and Mother Coil's rare card"
    );
    assert_eq!(
        (s(&r, "ROOM9"), s(&r, "WON9"), s(&r, "WINS1")),
        ("gutter.walk".into(), "true".into(), "1".into())
    );
    let scrap = num(&r, "SCRAP_BEFORE_BANK") as i64;
    assert!(scrap > 300, "the boss's 120 is in it: {scrap}");
    assert_eq!(num(&r, "KEYS1") as i64, num(&r, "KEYS0") as i64 + scrap / 4);
    assert_eq!(s(&r, "END_SCENE"), "summary", "the district cleared screen");
    assert_eq!(s(&r, "SUM"), format!("win 8 {} 7", scrap / 4));
    assert!(num(&r, "BEST") > 100.0);
    assert_eq!(
        (s(&r, "BACK"), s(&r, "DEN1"), s(&r, "WINS2"), s(&r, "LAST")),
        ("den".into(), "win".into(), "1".into(), "win".into()),
        "back in the Den, a win counted, LULLABY's win line"
    );
    // the rooms paid 4 fights x 1, the elite 3, the gauntlet 2 and the boss 10 = 19 keys on the way (slice 4)
    assert_eq!(num(&r, "KEYS_END") as i64, 28 + 19 + scrap / 4);
    let l = log(&r);
    assert_eq!(count_lines(&l, "mother coil is gone"), 1);
    assert_eq!(count_lines(&l, "run ends: win, 8 rooms"), 1);
}

#[test]
fn a_rough_gauge_a_test_player_with_no_dodging_and_no_invincibility_dies_in_rooms_2_or_3_on_five_seeds()
 {
    // (a scripted bot that only walks up and swings is worse than a person at avoiding hits and better at nothing: the numbers are a floor)
    let mut rows = vec![];
    for seed in [3, 7, 11, 20, 31] {
        let r = run(&format!("gauge_{seed}"));
        assert_eq!(s(&r, "G_DIED"), "true", "seed {seed}");
        rows.push(format!(
            "seed {seed}: died in room {} with {} rooms cleared (health on entering rooms 1 to 4: {} {} {} {})",
            s(&r, "G_ROOM"), s(&r, "G_CLEARED"), s(&r, "G_HP1"), s(&r, "G_HP2"), s(&r, "G_HP3"), s(&r, "G_HP4")
        ));
        assert!(num(&r, "G_ROOM") <= 4.0);
    }
    eprintln!("{}", rows.join("\n"));
}

// =====================================================================================================================
// Slice 4: the other 24 cards, tags and sets, jinxes, keys for every cleared room, the codex, the soak. Routes: tools/routes.mjs ("SLICE 4").
// =====================================================================================================================

fn lines_with(r: &Value, needle: &str) -> usize {
    count_lines(&log(r), needle)
}

#[test]
fn metronome_a_hit_in_the_rhythm_does_plus_one_and_the_window_is_half_a_second() {
    let r = run("s4_metronome");
    // a real chain: 2, then +1, then 4+1 (hits about a third of a second apart); a hit a second later is alone: 2
    assert_eq!(s(&r, "CH"), "10");
    assert_eq!(s(&r, "LONE"), "2");
    // the window: gaps of 0.2 s and 0.4 s are inside it, 0.6 s is not
    assert_eq!(
        (s(&r, "G02"), s(&r, "G04"), s(&r, "G06")),
        ("true".into(), "true".into(), "false".into())
    );
}

#[test]
fn skim_the_first_hit_on_a_healthy_enemy_makes_it_leak_one_scrap_a_hit() {
    let r = run("s4_skim");
    assert_eq!(s(&r, "LEAKY"), "1");
    assert_eq!(
        s(&r, "HURT_LEAKY"),
        "nil",
        "a hurt enemy does not start to leak"
    );
    assert_eq!(
        lines_with(&r, "leaks 1 scrap"),
        3,
        "the first hit and the two after it"
    );
}

#[test]
fn backhand_a_swing_soon_after_a_roll_also_hits_behind_for_double() {
    let r = run("s4_backhand");
    assert_eq!(
        (s(&r, "REAR"), s(&r, "FRONT"), s(&r, "BACKHANDS")),
        ("4".into(), "2".into(), "1".into()),
        "after a real roll: 4 behind, 2 in front"
    );
    assert_eq!(
        (s(&r, "REAR2"), s(&r, "FRONT2"), s(&r, "BACKHANDS2")),
        ("4".into(), "4".into(), "1".into()),
        "a second later: only in front"
    );
}

#[test]
fn overpressure_a_held_shot_is_a_slug_7_damage_through_two_for_two_pips() {
    let r = run("s4_overpressure");
    assert_eq!(s(&r, "READY"), "true");
    assert_eq!(
        (s(&r, "D1"), s(&r, "D2"), s(&r, "D3")),
        ("7".into(), "7".into(), "0".into()),
        "two enemies in line, not the third"
    );
    assert_eq!(
        (s(&r, "CH1"), s(&r, "SLUGS")),
        ("1.00".into(), "1".into()),
        "3 pips, 2 spent"
    );
    assert_eq!(
        (s(&r, "Q1"), s(&r, "Q2"), s(&r, "CH2"), s(&r, "SLUGS2")),
        ("3".into(), "0".into(), "2.00".into(), "1".into()),
        "a short hold is the plain shot: 3, one pip"
    );
    assert!(has_sound(&r, "slug_ready"));
}

#[test]
fn incendiary_a_shot_leaves_a_2_s_fire_that_burns_enemies_and_never_the_runner() {
    let r = run("s4_incendiary");
    assert_eq!(
        (s(&r, "FIRES"), s(&r, "FRIENDLY")),
        ("1".into(), "true".into())
    );
    assert_eq!(
        (s(&r, "RHP0"), s(&r, "RHP1")),
        ("12".into(), "12".into()),
        "standing in it: no damage"
    );
    assert!(
        num(&r, "HP1") < num(&r, "HP0"),
        "the enemy burns: {} to {}",
        s(&r, "HP0"),
        s(&r, "HP1")
    );
    assert_eq!(s(&r, "FIRES_LATE"), "0", "out after 2 s");
}

#[test]
fn siphon_a_kill_with_a_shot_refunds_its_pip_a_plain_hit_does_not() {
    let r = run("s4_siphon");
    assert_eq!(
        (s(&r, "KILLED"), s(&r, "CH_KILL")),
        ("true".into(), "3.00".into())
    );
    assert_eq!(
        (s(&r, "CH_HIT"), s(&r, "S2HP")),
        ("2.00".into(), "27".into())
    );
}

#[test]
fn smart_round_a_shot_aimed_well_off_curves_onto_the_enemy() {
    let r = run("s4_smart_round");
    assert_eq!((s(&r, "MISS"), s(&r, "HIT")), ("30".into(), "27".into()));
}

#[test]
fn afterimage_an_enemy_attacks_the_copy_for_1_5_s_then_returns_to_the_runner() {
    let r = run("s4_afterimage");
    assert_eq!(s(&r, "DECOYS"), "1");
    assert_eq!(
        (s(&r, "TARGET1"), s(&r, "TARGET2")),
        ("decoy".into(), "decoy".into())
    );
    assert_eq!(
        s(&r, "HP_MID"),
        "12",
        "the runner was not touched while the copy took the attention"
    );
    assert_eq!(
        (s(&r, "TARGET3"), s(&r, "DECOYS3"), s(&r, "TARGET4")),
        ("player".into(), "0".into(), "player".into())
    );
}

#[test]
fn slipstream_30_percent_faster_for_1_5_s_after_a_roll() {
    let r = run("s4_slipstream");
    assert_eq!(
        (s(&r, "SLIP"), s(&r, "SLIP_END")),
        ("1.50".into(), "0.00".into())
    );
    assert_eq!(s(&r, "RATIO"), "1.30");
    assert!(
        (num(&r, "string.format('%.1f', BASE)") - num(&r, "string.format('%.1f', AFTER)")).abs()
            < 0.2
    );
}

#[test]
fn burn_rubber_the_roll_leaves_a_trail_of_fire_that_ignites_enemies_for_1_s() {
    let r = run("s4_burn_rubber");
    assert!(num(&r, "TRAIL") >= 3.0, "{}", s(&r, "TRAIL"));
    assert!(num(&r, "BURN") > 0.0);
    assert_eq!(s(&r, "RHP"), "12");
    assert!(num(&r, "S1HP") < 30.0);
    assert_eq!(s(&r, "TRAIL_LATE"), "0");
}

#[test]
fn phase_a_perfect_roll_slows_the_enemies_for_1_s_an_early_hit_does_not() {
    let r = run("s4_phase");
    assert_eq!(
        (s(&r, "EARLY"), s(&r, "LATE"), s(&r, "PERFECT")),
        ("0.00".into(), "1.00".into(), "1".into())
    );
    assert!(
        num(&r, "SLOWED") < 0.3,
        "an enemy's clock ran {} in 0.5 s of slowed time",
        s(&r, "SLOWED")
    );
    assert_eq!(
        (s(&r, "SLOW_END"), s(&r, "NORMAL")),
        ("0.00".into(), "0.50".into()),
        "and normally again afterwards"
    );
    assert!(has_sound(&r, "phase_slow"));
}

#[test]
fn ghost_in_the_shell_a_killing_blow_leaves_1_point_once_a_run() {
    let r = run("s4_ghost");
    assert_eq!(
        (s(&r, "H1"), s(&r, "S1"), s(&r, "B1"), s(&r, "USED")),
        ("1".into(), "free".into(), "2.0".into(), "true".into())
    );
    assert_eq!(
        (s(&r, "H2"), s(&r, "S2")),
        ("0".into(), "dead".into()),
        "the second kills"
    );
}

#[test]
fn adrenal_below_half_health_25_percent_more_damage_and_speed() {
    let r = run("s4_adrenal");
    assert_eq!(
        (s(&r, "FULL"), s(&r, "FULL_SPEED")),
        ("200".into(), "1".into())
    );
    assert_eq!(
        (s(&r, "LOW"), s(&r, "LOW_SPEED")),
        ("250".into(), "1.25".into())
    );
    assert_eq!(s(&r, "HALF"), "200", "exactly half is not below half");
}

#[test]
fn friendly_fire_cans_pipes_and_bottles_hurt_other_enemies() {
    let r = run("s4_friendly_fire");
    assert_eq!(
        (s(&r, "CAN"), s(&r, "PIPE"), s(&r, "BOTTLE")),
        ("2".into(), "2".into(), "4".into()),
        "a can 2, a pipe 2, a bottle 3 and its fire 1"
    );
    let b = run("s4_friendly_fire_base");
    assert_eq!(
        (s(&b, "CAN"), s(&b, "PIPE"), s(&b, "BOTTLE")),
        ("0".into(), "0".into(), "1".into()),
        "without the card only the fire hurts"
    );
}

#[test]
fn bad_wiring_a_barrel_blasts_twice_as_wide_and_never_hurts_the_runner() {
    let r = run("s4_bad_wiring");
    assert_eq!(
        (s(&r, "RHP"), s(&r, "S1HP")),
        ("12".into(), "24".into()),
        "runner untouched; an enemy 3 tiles away took 6"
    );
    let b = run("s4_bad_wiring_base");
    assert_eq!(
        (s(&b, "RHP"), s(&b, "S1HP")),
        ("9".into(), "30".into()),
        "without it: the runner 80 units away takes 3 and the far enemy nothing"
    );
}

#[test]
fn brownout_all_enemies_are_stunned_1_s_at_20_s_of_the_fight() {
    let r = run("s4_brownout");
    assert_eq!(s(&r, "NS0"), "0");
    assert!(num(&r, "N1") >= 1.0);
    assert_eq!(s(&r, "N1"), s(&r, "NS1"), "every enemy stunned");
    assert!(num(&r, "DIP") > 0.3, "the lights dip");
    assert_eq!(
        (s(&r, "NS2"), s(&r, "NEXT")),
        ("0".into(), "40".into()),
        "1 s later nobody is; the next dip is at 40 s"
    );
    assert!(has_sound(&r, "brownout"));
}

#[test]
fn bounty_board_one_enemy_is_marked_and_pays_15_only_as_the_rooms_first_kill() {
    let a = run("s4_bounty_board");
    assert_eq!(
        (
            s(&a, "MARKED"),
            s(&a, "BOUNTY"),
            s(&a, "PAID"),
            s(&a, "PAID2")
        ),
        ("1".into(), "15".into(), "15".into(), "15".into())
    );
    assert!(has_sound(&a, "bounty_pay"));
    let b = run("s4_bounty_board_other");
    assert_eq!(
        (s(&b, "PAID"), s(&b, "PAID2")),
        ("0".into(), "0".into()),
        "another enemy first: no pay"
    );
    assert_eq!(lines_with(&b, "bounty lost"), 1);
}

#[test]
fn loop_trap_the_first_enemy_to_die_fights_for_you_for_8_s_and_its_kills_count() {
    let r = run("s4_loop_trap");
    assert_eq!(s(&r, "ALLIES"), "1");
    assert_eq!(
        (s(&r, "KILLS1"), s(&r, "BDEAD"), s(&r, "ROOM_KILLS")),
        ("1".into(), "true".into(), "2".into()),
        "the ally killed the next enemy"
    );
    assert_eq!(
        s(&r, "ALLIES2"),
        "1",
        "a second death in the room raises no second ally"
    );
    assert_eq!(s(&r, "ALLIES_END"), "0", "gone after 8 s");
    assert_eq!(lines_with(&r, "loop trap:"), 1);
}

#[test]
fn open_channel_elites_lose_their_escort_and_bosses_start_at_85_percent() {
    let a = run("s4_open_channel");
    let b = run("s4_open_channel_base");
    assert_eq!((s(&a, "WARN1"), s(&a, "ELITES")), ("1".into(), "1".into()));
    assert_eq!(
        s(&b, "WARN1"),
        "3",
        "the elite and two Scrappers without the card"
    );
    assert_eq!(
        (
            s(&run("s4_open_channel_boss"), "HP"),
            s(&run("s4_open_channel_boss_base"), "HP")
        ),
        ("82".into(), "96".into())
    );
}

#[test]
fn clot_a_room_cleared_without_a_hit_heals_a_point() {
    let a = run("s4_clot");
    assert_eq!(
        (s(&a, "HP"), s(&a, "NOTE")),
        ("9".into(), "+1 health (Clot)".into())
    );
    let b = run("s4_clot_hit");
    assert_eq!((s(&b, "HP"), s(&b, "NOTE")), ("8".into(), "nil".into()));
}

fn wave_counts(r: &Value) -> Vec<u32> {
    log(r)
        .iter()
        .filter(|(_, t)| {
            t.starts_with("wave ") && t.contains(": ") && t.contains(" x") && t.contains(" at ")
        })
        .map(|(_, t)| {
            t.split_whitespace()
                .nth(3)
                .unwrap()
                .trim_start_matches('x')
                .parse()
                .unwrap()
        })
        .collect()
}

#[test]
fn crowd_pleaser_four_cards_an_offer_and_a_quarter_more_enemies_a_room() {
    let a = run("s4_crowd_pleaser");
    let b = run("s4_crowd_pleaser_base");
    assert_eq!((s(&a, "CARDS"), s(&b, "CARDS")), ("4".into(), "3".into()));
    let base = wave_counts(&b);
    let crowd = wave_counts(&a);
    // the same carry as the room's: 25% more, the fractions carried from row to row
    let mut frac = 0.0_f64;
    let want: Vec<u32> = base
        .iter()
        .map(|&c| {
            let total = c as f64 * 1.25 + frac;
            let n = (total + 1e-9).floor();
            frac = total - n;
            n as u32
        })
        .collect();
    assert_eq!(crowd, want, "base {base:?}");
    assert!(crowd.iter().sum::<u32>() > base.iter().sum::<u32>());
}

#[test]
fn debt_spiral_double_keys_and_a_point_lost_at_each_rooms_start() {
    let r = run("s4_debt_spiral");
    assert_eq!(s(&r, "HP"), "11", "12 less 1 on entering room 1");
    assert_eq!(
        (s(&r, "BANK"), s(&r, "ROOM"), s(&r, "KEYS2")),
        ("20".into(), "2".into(), "22".into()),
        "40 scrap banked is 20 keys, not 10; a fight room pays 2, not 1"
    );
}

#[test]
fn overclock_and_red_line_each_gain_and_cost_what_they_say() {
    let o = run("s4_overclock");
    assert_eq!(
        (s(&o, "DEALT"), s(&o, "HP")),
        ("280".into(), "9".into()),
        "100 hits of 2 do 280; a 2-point hit does 3"
    );
    let r = run("s4_red_line");
    assert_eq!(
        (s(&r, "MAX"), s(&r, "HP"), s(&r, "REGEN")),
        ("8".into(), "8".into(), "1.00".into()),
        "max health 8; a pip in 1.4 s"
    );
    assert_eq!(
        (s(&r, "MAX2"), s(&r, "MAX3"), s(&r, "REGEN2")),
        ("8".into(), "14".into(), "0.00".into()),
        "Plating cannot lift the cap; removing the jinx lifts it and stops the refill"
    );
}

#[test]
fn volt_burn_leak_and_echo_sets_each_switch_on_at_three_different_cards() {
    let c = run("s4_set_copies");
    assert_eq!(
        (
            s(&c, "COPIES"),
            s(&c, "TWO"),
            s(&c, "THREE"),
            s(&c, "FLASH")
        ),
        (
            "1 false".into(),
            "2 false".into(),
            "3 true".into(),
            "volt".into()
        ),
        "three copies of one card are one card"
    );
    assert_eq!(
        (s(&c, "LINE1"), s(&c, "LINE2"), s(&c, "LINE3")),
        (
            "SET: 2/3 Volt".into(),
            "SET: 3/3 Volt - this completes it!".into(),
            "SET: 3/3 Volt (ON)".into()
        )
    );
    assert_eq!(lines_with(&c, "set complete: volt"), 1);
    assert!(has_sound(&c, "set_done"), "the flourish");
    // Volt: the third hit's lightning arcs twice (2 and 2 more)
    let (v, v0) = (run("s4_set_volt"), run("s4_set_volt_base"));
    assert_eq!(
        (s(&v, "D2"), s(&v, "D3"), s(&v, "ON")),
        ("4".into(), "4".into(), "true".into())
    );
    assert_eq!(
        (s(&v0, "D2"), s(&v0, "D3"), s(&v0, "ON")),
        ("2".into(), "2".into(), "false".into())
    );
    // Burn: a burning enemy explodes on death for 3 within 2 tiles (the neighbour at 10 takes 3; the runner nothing); a cold one does not
    let (b, b0) = (run("s4_set_burn"), run("s4_set_burn_base"));
    assert_eq!(
        (s(&b, "BHP"), s(&b, "EHP"), s(&b, "RHP")),
        ("7".into(), "10".into(), "12".into())
    );
    assert_eq!(s(&b0, "BHP"), "10", "two Burn cards are no set");
    // Leak: 50 scrap picked up heal 2 points (1 per 20; 10 waiting)
    let (l, l0) = (run("s4_set_leak"), run("s4_set_leak_base"));
    assert_eq!(
        (s(&l, "SCRAP"), s(&l, "HP"), s(&l, "ACC")),
        ("50".into(), "8".into(), "10".into())
    );
    assert_eq!((s(&l0, "HP"), s(&l0, "ACC")), ("6".into(), "0".into()));
    // Echo: a copy repeats the chain's 2, 2, 4 on the enemy beside it
    let (e, e0) = (run("s4_set_echo"), run("s4_set_echo_base"));
    assert_eq!((s(&e, "HP"), s(&e, "ON")), ("22".into(), "true".into()));
    assert_eq!((s(&e0, "HP"), s(&e0, "ON")), ("30".into(), "false".into()));
}

#[test]
fn a_jinx_never_takes_the_first_two_offers_and_turns_up_at_the_stated_rate_later() {
    let r = run("s4_jinx_offers");
    let per = |k: &str| -> Vec<f64> { s(&r, k).split(',').map(|v| v.parse().unwrap()).collect() };
    let j4 = per("J4");
    assert_eq!((j4[0], j4[1]), (0.0, 0.0), "offers 1 and 2 of a run: never");
    for (i, n) in j4.iter().enumerate().skip(2) {
        let k = (i + 1) as f64;
        let p = (0.10 + 0.05 * (k - 3.0)).min(0.40);
        let got = n / 600.0;
        eprintln!(
            "offer {}: jinx {:.1}% (stated {:.0}%)",
            i + 1,
            got * 100.0,
            p * 100.0
        );
        assert!((got - p).abs() < 0.05, "offer {}: {got} against {p}", i + 1);
    }
    assert!(
        per("J0").iter().all(|&n| n == 0.0) && per("J3").iter().all(|&n| n == 0.0),
        "not in a pool below Deeper Deck 4"
    );
    assert_eq!(
        (s(&r, "TWO_JINX"), s(&r, "HELD_OFFERED")),
        ("0".into(), "0".into()),
        "one jinx at most in an offer; a held one is not offered again"
    );
}

#[test]
fn deeper_deck_reveals_six_cards_a_tier_and_both_guarantees_hold_at_every_tier() {
    let r = run("s4_deck_tiers");
    assert_eq!(s(&r, "TIERS").trim(), "12 18 24 30 36");
    assert_eq!(
        s(&r, "GR_BAD").trim(),
        "0 0 0 0 0",
        "the boss's rare, at tiers 0 to 4 (Second Wind is the base pool's rare)"
    );
    assert_eq!(s(&r, "GU_BAD").trim(), "0 0 0 0 0", "the elite's uncommon");
    let new = s(&r, "NEW");
    let tiers: Vec<&str> = new.split('|').map(|t| t.trim()).collect();
    for (i, t) in tiers.iter().skip(1).take(4).enumerate() {
        assert_eq!(t.split(',').count(), 6, "tier {} reveals six: {t}", i + 1);
    }
    assert!(
        tiers[4].ends_with("overclock,red_line,crowd_pleaser,debt_spiral"),
        "the jinxes come last: {}",
        tiers[4]
    );
    assert!(tiers[1].starts_with("metronome"));
    assert_eq!(
        s(&run("s4_deck_buy"), "BUYS"),
        "true:20:18 true:45:24 true:80:30 true:130:36 false:0:36",
        "Deeper Deck is bought tier by tier and stops after the fourth"
    );
}

#[test]
fn the_shops_jinx_stall_removes_the_jinx_you_took_last_for_30_scrap() {
    let r = run("s4_shop_jinx");
    assert_eq!(s(&r, "NONE"), "false 100 You hold no jinx. Lucky you.");
    assert_eq!(s(&r, "BEFORE"), "8 1 2");
    assert_eq!(s(&r, "ONE"), "true 70 Overclock is gone. 0 1");
    assert_eq!(
        s(&r, "TWO"),
        "true 40 Red Line is gone. 12 0",
        "Red Line's cap lifts with it"
    );
    assert_eq!(s(&r, "POOR"), "false 10 Not enough scrap (30). 1");
    let room = run("s4_shop_jinx_room");
    assert_eq!(
        (s(&room, "SCRAP"), s(&room, "HELD"), s(&room, "TOAST")),
        ("20".into(), "0".into(), "Overclock is gone.".into())
    );
    assert_eq!(
        (s(&room, "SCRAP2"), s(&room, "TOAST2")),
        ("20".into(), "You hold no jinx. Lucky you.".into())
    );
}

#[test]
fn every_cleared_room_pays_keys_at_once_1_a_fight_3_the_elite_2_the_gauntlet_10_the_boss() {
    let r = run("s4_keys_kinds");
    assert_eq!(s(&r, "K_FIGHT"), "1");
    assert_eq!((num(&r, "K_ELITE") - num(&r, "K_FIGHT")) as i64, 3);
    assert_eq!((num(&r, "K_GAUNTLET") - num(&r, "K_ELITE")) as i64, 2);
    assert_eq!((num(&r, "K_BOSS") - num(&r, "K_GAUNTLET")) as i64, 10);
    assert_eq!(s(&r, "ROOM_KEYS"), "16");
    assert!(has_sound(&r, "key_pay"));
}

#[test]
fn keys_from_cleared_rooms_are_kept_when_the_run_dies_and_are_there_after_a_reboot() {
    let dir = scratch("keys_death");
    let r1 = play_saved("keys1", plan_text("s4_keys_death_boot1"), &dir);
    assert_eq!(
        (s(&r1, "K_BEFORE"), s(&r1, "K_AFTER")),
        ("2".into(), "2".into()),
        "died in room 3 with rooms 1 and 2 cleared: 2 keys, none lost"
    );
    assert_eq!(
        (s(&r1, "SUM_ROOM_KEYS"), s(&r1, "SUM_CLEARED")),
        ("2".into(), "2".into()),
        "and the summary says so"
    );
    let r2 = play_saved("keys2", plan_text("s4_keys_death_boot2"), &dir);
    assert_eq!(
        s(&r2, "K_LOADED"),
        "2",
        "in the save after a reboot with the same save folder"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_codex_lists_seen_unseen_and_locked_cards_and_the_seen_ones_survive_a_reboot() {
    let dir = scratch("codex");
    let r1 = play_saved("codex1", plan_text("s4_codex_boot1"), &dir);
    let offered = s(&r1, "OFFERED");
    assert_eq!(s(&r1, "SEEN_N"), "6");
    let r2 = play_saved("codex2", plan_text("s4_codex_boot2"), &dir);
    assert_eq!(s(&r2, "STATE"), "codex");
    assert_eq!(s(&r2, "SEEN_COUNT"), "6", "the same six after the reboot");
    for entry in s(&r2, "STATES").split(' ') {
        let (id, st) = entry.split_once('=').unwrap();
        let want = if id == "metronome" || id == "overclock" {
            "locked"
        } else if offered.split(',').any(|o| o == id) {
            "seen"
        } else {
            "unseen"
        };
        assert_eq!(st, want, "{id}");
    }
    assert_eq!(
        (s(&r2, "TIER_METRO"), s(&r2, "TIER_OVER")),
        ("1".into(), "4".into()),
        "locked cards say which Deeper Deck tier opens them"
    );
    assert_eq!(
        (s(&r2, "CSEL"), s(&r2, "CLOSED")),
        ("3".into(), "free".into())
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_workbench_costs_fit_the_new_income() {
    // income: a run that dies in room 4 has cleared rooms 1 to 3 (3 keys); in room 5, rooms 1 to 4 (6 keys); Loose Change comes on top
    let r = run("workbench_sums");
    let mut firsts = vec![];
    let mut total = 0i64;
    for part in s(&r, "COSTS").split_whitespace() {
        let (_, costs) = part.split_once('=').unwrap();
        let v: Vec<i64> = costs.split('/').map(|c| c.parse().unwrap()).collect();
        firsts.push(v[0]);
        total += v.iter().sum::<i64>();
    }
    let cheapest = *firsts.iter().min().unwrap();
    assert!(
        cheapest <= 3 * 4,
        "a first purchase after two or three early runs of 3 to 6 keys: cheapest tier-1 is {cheapest}"
    );
    assert!(
        firsts.iter().filter(|&&c| c <= 18).count() >= 5,
        "five of the first tiers can be bought with three runs' keys: {firsts:?}"
    );
    eprintln!(
        "bench total {total} keys: {} runs at 6 keys, {} at 15, {} at 40",
        total / 6,
        total / 15,
        total / 40
    );
    assert!(
        total / 40 >= 25,
        "the full bench takes dozens of runs even at 40 keys a run: {total}"
    );
}

#[test]
fn the_new_sounds_exist_and_the_routes_play_them() {
    for sname in [
        "set_done",
        "jinx_take",
        "brownout",
        "phase_slow",
        "slug_ready",
        "ally_rise",
        "key_pay",
        "bounty_pay",
    ] {
        assert!(
            folder()
                .join("sounds")
                .join(format!("{sname}.wav"))
                .exists(),
            "no sounds/{sname}.wav"
        );
        assert!(
            folder()
                .join("sounds")
                .join(format!("{sname}.sfx.json"))
                .exists()
        );
    }
    assert!(has_sound(&run("s4_loop_trap"), "ally_rise"));
}

// ---- the soak: a whole district on 30 seeds, random cards (jinxes too), invincible, the test player rolling and shooting in fights
fn soak(seeds: std::ops::RangeInclusive<u32>) {
    for seed in seeds {
        let r = run(&format!("soak_{seed}"));
        assert_eq!(
            s(&r, "SOAK_BAD"),
            "",
            "seed {seed}: {}",
            s(&r, "SOAK_PICKS")
        );
        assert_eq!(
            (s(&r, "END_SCENE"), s(&r, "WON9")),
            ("summary".into(), "true".into()),
            "seed {seed} reached the summary: {}",
            s(&r, "SOAK_PICKS")
        );
        assert!(
            num(&r, "SOAK_ROLLS") > 20.0 && num(&r, "SOAK_SHOTS") > 5.0,
            "seed {seed}: the roll and the sidearm ran"
        );
    }
}
#[test]
fn soak_seeds_1_to_5() {
    soak(1..=5)
}
#[test]
fn soak_seeds_6_to_10() {
    soak(6..=10)
}
#[test]
fn soak_seeds_11_to_15() {
    soak(11..=15)
}
#[test]
fn soak_seeds_16_to_20() {
    soak(16..=20)
}
#[test]
fn soak_seeds_21_to_25() {
    soak(21..=25)
}
#[test]
fn soak_seeds_26_to_30() {
    soak(26..=30)
}

// ---- UI pass: the prompts over things that can be used, the wipes, the district card and the banners (routes: tools/routes.mjs, the "UI pass" block)

#[test]
fn a_prompt_rises_only_near_a_thing_only_for_the_nearest_and_slides_away_when_it_is_used() {
    let r = run("ui_prompts");
    // far from everything: no panel and nothing is "the target"; every usable thing carries only its quiet cue
    assert_eq!(
        (s(&r, "FAR_N"), s(&r, "FAR_KEY"), s(&r, "ALL_FAR")),
        ("0".into(), "nil".into(), "0".into()),
        "no panel, no target, nothing within reach"
    );
    assert!(
        num(&r, "CUES") >= 5.0,
        "the screen, the codex, the bench, the door and the stalls are cued"
    );
    // it fades in over about 0.12 s: partway two frames in, up after a few more
    let k2 = num(&r, "K2");
    assert!(k2 > 0.0 && k2 < 1.0, "fading in, not there at once: {k2}");
    assert_eq!(num(&r, "K14"), 1.0, "fully up soon after");
    assert_eq!(
        (s(&r, "BENCH_N"), s(&r, "BENCH_KEY")),
        ("1".into(), "bench".into())
    );
    // two things within reach: one panel, the nearer thing's
    assert_eq!(
        num(&r, "IN1"),
        2.0,
        "the screen and the codex are both within reach"
    );
    assert_eq!(
        (s(&r, "T1"), s(&r, "N1"), s(&r, "V1")),
        ("screen".into(), "1".into(), "screen".into())
    );
    assert_eq!(
        (s(&r, "T2"), s(&r, "N2"), s(&r, "V2")),
        ("codex".into(), "1".into(), "codex".into()),
        "a step nearer the codex and only the codex shows"
    );
    // a little further than its reach: nothing
    assert_eq!(
        (s(&r, "OUT_N"), s(&r, "OUT_KEY")),
        ("0".into(), "nil".into())
    );
    // used: the workbench opens and the panel has slid away
    assert_eq!(
        (s(&r, "USED_STATE"), s(&r, "USED_N")),
        ("bench".into(), "0".into())
    );
}

#[test]
fn leaving_the_den_the_runner_steps_in_a_wipe_closes_the_district_card_holds_and_lets_go_comes_when_it_has_opened()
 {
    let r = run("ui_run_start");
    assert_eq!(
        s(&r, "TAG_DIFF"),
        "true",
        "never the same tagline twice running"
    );
    assert_eq!(s(&r, "S_CLOSE"), "closing");
    assert_eq!(s(&r, "CARD"), "LOW MERIDIAN / GUTTER MARKET");
    assert!(
        !s(&r, "TAGLINE").is_empty(),
        "a one-line tagline on the card"
    );
    assert_eq!(
        s(&r, "LATE_HOLD"),
        "true",
        "the first room is loaded behind the card"
    );
    assert_eq!(
        s(&r, "S_HOLD_1S"),
        "hold",
        "the card is still held a second after the wipe closed"
    );
    // input is ignored through the whole wipe: the buttons pressed did nothing
    assert_eq!(
        (
            s(&r, "ROLLS0"),
            s(&r, "ROLLS1"),
            s(&r, "HITS0"),
            s(&r, "HITS1")
        ),
        ("0".into(), "0".into(), "0".into(), "0".into())
    );
    // nothing can hurt the runner before the room has opened: nothing was spawned during the wipe and the room's clock had not started
    assert_eq!(
        num(&r, "BAD"),
        0.0,
        "no enemy, warning or clock during the wipe"
    );
    let open = s(&r, "OPEN");
    assert!(
        open.starts_with("intro t=0.0") && open.contains("enemies=0"),
        "the room begins when the shutter has opened: {open}"
    );
    // LET'S GO! and the room tab, then they are gone
    assert!(s(&r, "BANNERS").contains("go:LET'S GO!"));
    assert!(s(&r, "BANNERS").contains("room:ROOM 1 / 8   FIGHT"));
    assert_eq!(
        s(&r, "LATER"),
        "",
        "the banners are whipped off after a moment"
    );
    assert_eq!(s(&r, "WIPE_DONE"), "1");
}

#[test]
fn between_rooms_a_quick_wipe_without_a_card_and_the_next_room_begins_only_when_it_has_opened() {
    let r = run("ui_rooms");
    let wn = num(&r, "WN");
    assert!(
        (26.0..=42.0).contains(&wn),
        "about 0.25 s each way, {wn} frames in all"
    );
    assert_eq!(s(&r, "HAS_CARD"), "no", "no card between rooms");
    assert_eq!(
        num(&r, "BAD"),
        0.0,
        "nothing in the new room while the wipe runs"
    );
    assert_eq!(s(&r, "ROOM2"), "true");
    assert!(
        s(&r, "TAB2").contains("room:ROOM 2 / 8   FIGHT") && !s(&r, "TAB2").contains("go:"),
        "the room counter, and no LET'S GO!: {}",
        s(&r, "TAB2")
    );
    assert!(
        num(&r, "S2T") < 0.1,
        "the room's clock starts when the shutter has opened"
    );
    // CLEARED! with what the room paid
    assert_eq!(s(&r, "CLEARED_B"), "clear:CLEARED!");
    assert!(
        s(&r, "CLEARED_SUB").contains("scrap") && s(&r, "CLEARED_SUB").contains("+1 key"),
        "{}",
        s(&r, "CLEARED_SUB")
    );
}

#[test]
fn banners_never_stop_play_the_elite_has_its_mark_and_the_boss_its_name_before_the_fight_and_death_has_lullabys_joke()
 {
    let p = run("ui_banner_play");
    assert!(s(&p, "BP").contains("go:LET'S GO!"));
    assert_eq!(
        s(&p, "DOWN"),
        "true",
        "the runner walked while the banners were up"
    );
    assert!(s(&p, "BP1").contains("go:"), "still up while he walked");
    assert_eq!(s(&p, "BP2"), "", "and gone later");

    let e = run("ui_banner_elite");
    assert!(s(&e, "TAB4").contains("ROOM 4 / 8   ELITE"));
    assert!(s(&e, "ELITE_B").contains("elite:ELITE!"));
    assert!(
        s(&e, "ELITE_SUB").starts_with(&s(&e, "MARK_NAME")),
        "ELITE! names its mark: {} / {}",
        s(&e, "ELITE_SUB"),
        s(&e, "MARK_NAME")
    );

    let b = run("ui_banner_boss");
    assert!(s(&b, "BOSS_B").contains("boss:MOTHER COIL"));
    assert_eq!(
        (s(&b, "BOSS_STATE"), s(&b, "COIL_STATE")),
        ("boss_intro".into(), "dormant".into()),
        "the name card comes before the fight"
    );
    assert_eq!(
        (s(&b, "BOSS_STATE_1S"), s(&b, "COIL_STATE_1S")),
        ("boss_intro".into(), "dormant".into()),
        "a second later she still sleeps"
    );
    assert_eq!(
        (s(&b, "BOSS_STATE_NOW"), s(&b, "COIL_AWAKE")),
        ("boss".into(), "true".into())
    );

    let d = run("ui_banner_death");
    assert!(s(&d, "DEATH_B").contains("death:FLATLINED!"));
    assert!(
        s(&d, "DEATH_SUB").starts_with("LULLABY: "),
        "{}",
        s(&d, "DEATH_SUB")
    );
}

#[test]
fn back_to_the_den_a_wipe_holds_with_a_lullaby_line_and_the_wake_beat_starts_when_it_has_opened() {
    let r = run("ui_den_return");
    assert_eq!(s(&r, "S0"), "closing");
    assert!(s(&r, "LINE").starts_with("LULLABY: "), "{}", s(&r, "LINE"));
    assert_eq!(
        (s(&r, "SCENE_NOW"), s(&r, "WAKE0")),
        ("den".into(), "wake".into())
    );
    assert_eq!(s(&r, "T0"), "0.00", "the Den's clock waits for the shutter");
    assert!(num(&r, "T1") < 0.2);
    assert_eq!(s(&r, "WAKE1"), "wake");
}

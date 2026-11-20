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

//! Scripted headless runs (`nova run --headless --play plan.json`, `playtest.rs`): a route of steps drives a real `Game`,
//! and the report says what happened. Also the helpers a run uses (start in a scene, run Lua, read a value, list what is
//! alive), the fixed random seed, the names scene objects give their entities, and `"ignore"` in `nova.json`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::model::{Image, MeshData};
use nova_runtime::playtest::Plan;
use nova_runtime::vfs::{MemVfs, Vfs};
use serde_json::Value;

struct FakeGpu;
impl Uploader for FakeGpu {
    fn set_atlas(&mut self, _: &Image) {}
    fn add_mesh(&mut self, _: &MeshData) -> usize {
        0
    }
}

fn png(w: u32, h: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut e = png::Encoder::new(&mut out, w, h);
    e.set_color(png::ColorType::Rgba);
    e.set_depth(png::BitDepth::Eight);
    e.write_header()
        .unwrap()
        .write_image_data(&vec![255u8; (w * h * 4) as usize])
        .unwrap();
    out
}

const HERO: &str = r#"
local Hero = nova.entity { tags = { "hero" }, hitbox = { -4, -4, 8, 8 }, hp = 3, speed = 60 }
function Hero:create() nova.log("hero is called " .. tostring(self.name)) end
function Hero:update(dt)
  -- (the stick or the button, as a real machine sets both when an arrow key is down)
  local dx = nova.input.axis("move_x")
  if nova.input.down("right") then dx = 1 end
  self.x = self.x + dx * self.speed * dt
  if nova.input.pressed("a") then nova.log("swing at " .. math.floor(self.x + 0.5)) end
end
function Hero:on_collide_coin(coin) coin:destroy(); nova.log("coin") end
return Hero
"#;

/// Something that walks where the stick says, as seen by a camera turned `turn` radians (and mirrored when `mirror`):
/// with the stick or with the four buttons, on x and y or (ground = "z") on x and z.
const ROVER: &str = r#"
local Rover = nova.entity { tags = { "rover" }, speed = 120, turn = 0, mirror = false, ground = "y", buttons = false, wall = false }
function Rover:update(dt)
  local sx, sy = nova.input.axis("move_x"), nova.input.axis("move_y")
  if self.buttons then
    sx = (nova.input.down("right") and 1 or 0) - (nova.input.down("left") and 1 or 0)
    sy = (nova.input.down("down") and 1 or 0) - (nova.input.down("up") and 1 or 0)
  end
  if self.mirror then sy = -sy end
  local c, s = math.cos(self.turn), math.sin(self.turn)
  local dx, dy = sx * c - sy * s, sx * s + sy * c
  local nx = self.x + dx * self.speed * dt
  if not (self.wall and nx > self.wall) then self.x = nx end
  self[self.ground] = self[self.ground] + dy * self.speed * dt
end
return Rover
"#;

fn files() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("nova.json", br#"{"format":1,"name":"T","ignore":["shots","notes.md"]}"#.to_vec()),
        ("main.lua", b"nova.start(\"title\")".to_vec()),
        ("scenes/title.lua", b"return nova.scene {}".to_vec()),
        ("scenes/room.lua", b"local R = nova.scene {}\nfunction R:enter() nova.log('room ' .. math.random(1000)) end\nreturn R".to_vec()),
        (
            "scenes/room.scene.json",
            br#"{"version":1,"objects":[{"kind":"hero","name":"hero","x":100,"y":50},{"kind":"coin","x":200,"y":50},{"kind":"coin","name":"far","x":900,"y":50}]}"#.to_vec(),
        ),
        ("entities/hero.lua", HERO.as_bytes().to_vec()),
        ("entities/coin.lua", b"return nova.entity { tags = { \"coin\" }, hitbox = { -4, -4, 8, 8 } }".to_vec()),
        ("entities/rover.lua", ROVER.as_bytes().to_vec()),
        ("scenes/yard.lua", b"return nova.scene {}".to_vec()),
        (
            "scenes/yard.scene.json",
            br#"{"version":1,"objects":[{"kind":"rover","name":"rover","x":100,"y":100},{"kind":"rover","name":"walker","x":0,"y":1,"z":0,"props":{"ground":"z","speed":4}}]}"#.to_vec(),
        ),
        // (not part of the game: a screenshot far too big for the sprite atlas, and a note)
        ("shots/big.png", b"not even a picture".to_vec()),
        ("notes.md", b"todo".to_vec()),
    ]
}

fn game() -> Game {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(files()));
    let mut game = Game::load(vfs).expect("project loads");
    game.upload(&mut FakeGpu);
    game
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nova-play-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Plays a plan the way the headless runner does, without a GPU. Returns the report and the frames pictures were asked for.
fn play(game: &mut Game, plan: &str, _name: &str) -> (Value, Vec<(u32, String)>) {
    // (the runtime's own harness: every key of the plan, a scratch folder of its own per run)
    let report = nova_runtime::testing::play(game, plan).expect("the plan plays");
    (report.json, report.pictures)
}

fn texts(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|l| format!("{} {}", l["frame"], l["text"].as_str().unwrap()))
        .collect()
}

#[test]
fn a_route_drives_the_game_and_the_report_says_what_happened() {
    let mut g = game();
    let plan = r#"{
      "start_scene": "room",
      "lua": "nova.named('hero').hp = 1",
      "steps": [
        { "hold": ["move_x=1"], "frames": 30, "capture": "walked" },
        { "press": "a" },
        { "wait": 5 },
        { "hold": ["right"], "until": "nova.count('coin') == 1", "max": 300, "capture": "got the coin" },
        { "lua": "nova.log('done')" }
      ],
      "capture_at": [1],
      "print": ["nova.named('hero').hp", "nova.count('coin')", "nova.named('hero')", "nope.x"]
    }"#;
    let (report, pictures) = play(&mut g, plan, "route");
    assert_eq!(report["error"], Value::Null, "{report}");
    assert_eq!(report["warnings"].as_array().unwrap().len(), 0, "{report}");
    // frame 1 is the scene coming up; the steps start at frame 2: 30 frames at 60 units a second is 30 units
    assert_eq!(pictures[0], (1, String::new()));
    assert_eq!(pictures[1], (31, "walked".to_string()));
    let walked = &report["captures"][1];
    assert_eq!(walked["label"], "walked");
    assert_eq!(walked["state"]["scene"], "room");
    let hero = &walked["state"]["entities"][0];
    assert_eq!(hero["kind"], "hero");
    assert_eq!(hero["name"], "hero");
    assert!((hero["x"].as_f64().unwrap() - 130.0).abs() < 0.01, "{hero}");
    assert_eq!(walked["prints"][0]["value"], "1"); // the plan's lua ran before the route
    assert_eq!(walked["prints"][1]["value"], "2");
    assert_eq!(walked["prints"][2]["value"], "<hero at 130, 50>");
    assert!(
        walked["prints"][3]["value"]
            .as_str()
            .unwrap()
            .starts_with("error: ")
    );
    // the `until` step ended when the coin was taken, long before its `max`
    assert_eq!(pictures[2].1, "got the coin");
    assert!(pictures[2].0 > 40 && pictures[2].0 < 140, "{pictures:?}");
    assert_eq!(report["end"]["prints"][1]["value"], "1");
    let log = texts(&report["log"]);
    assert_eq!(log[0], "1 hero is called hero"); // the scene object's name is the entity's `name`
    assert!(log[1].starts_with("1 room "), "{log:?}");
    assert_eq!(log[2], "32 swing at 130"); // pressed on the frame after the walk
    assert!(log.iter().any(|l| l.ends_with(" coin")));
    assert!(log.last().unwrap().ends_with(" done"));
    // (the picture of an `until` is of the frame after it held, which here is the last frame of the run)
    assert_eq!(report["frames"].as_u64().unwrap() as u32, pictures[2].0);
}

#[test]
fn the_same_plan_and_seed_give_the_same_run_and_another_seed_another() {
    let plan = |seed: u32| format!(r#"{{ "start_scene": "room", "seed": {seed}, "frames": 3 }}"#);
    let (a, _) = play(&mut game(), &plan(7), "seed-a");
    let (b, _) = play(&mut game(), &plan(7), "seed-b");
    let (c, _) = play(&mut game(), &plan(8), "seed-c");
    assert_eq!(texts(&a["log"]), texts(&b["log"]));
    assert_ne!(texts(&a["log"])[1], texts(&c["log"])[1]);
}

#[test]
fn mistakes_in_a_plan_are_said_plainly() {
    // an action the game does not have, and a condition that never holds
    let plan = r#"{ "start_scene": "room", "steps": [ { "hold": ["jump"], "frames": 2 }, { "hold": ["left"], "until": "nova.count('coin') == 0", "max": 5 } ] }"#;
    let (report, _) = play(&mut game(), plan, "warn");
    let warnings: Vec<&str> = report["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w.as_str().unwrap())
        .collect();
    assert!(
        warnings[0].starts_with("'jump' is not an input action of this game"),
        "{warnings:?}"
    );
    assert!(warnings[0].contains("move_x"));
    assert!(
        warnings[1].contains("step 2: `nova.count('coin') == 0` never held in 5 frames"),
        "{warnings:?}"
    );
    // a step whose Lua fails is written down with its number, and the run goes on: what came before and after is kept
    let (report, pictures) = play(
        &mut game(),
        r#"{ "start_scene": "room", "lua": "nope.x = 1", "steps": [ { "wait": 2, "capture": "before" }, { "lua": "nothing.here = 1" },
            { "hold": ["right"], "until": "nothing.here", "max": 50 }, { "hold": ["right"], "frames": 10, "capture": "after" } ],
            "print": ["nova.named('hero').x"] }"#,
        "lua-error",
    );
    assert_eq!(report["error"], Value::Null, "{report}");
    let errors: Vec<&str> = report["step_errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w.as_str().unwrap())
        .collect();
    assert!(errors[0].starts_with("the plan's lua: "), "{errors:?}");
    assert!(errors[1].starts_with("step 2 lua: "), "{errors:?}");
    assert!(
        errors[2].starts_with("step 3 until `nothing.here`: "),
        "{errors:?}"
    );
    assert_eq!(errors.len(), 3, "{errors:?}");
    assert_eq!(
        pictures.iter().map(|p| p.1.as_str()).collect::<Vec<_>>(),
        ["before", "after"]
    );
    assert_eq!(report["captures"][1]["prints"][0]["value"], "111"); // (one frame of the failed until, ten of the last step)
    // a group must not also be a step, a tap_every needs a length, and a plane is one of two
    for (plan, wanted) in [
        (
            r#"{ "steps": [ { "repeat": 2, "hold": ["a"], "steps": [ { "wait": 1 } ] } ] }"#,
            "step 1 is a group",
        ),
        (
            r#"{ "steps": [ { "wait": 1 }, { "tap": "a", "tap_every": 10 } ] }"#,
            "step 2 has \"tap_every\" but no length",
        ),
        (
            r#"{ "steps": [ { "walk_to": [1, 2], "plane": "yz" } ] }"#,
            "\"plane\" is \"xy\"",
        ),
    ] {
        let dir = scratch("bad-step");
        std::fs::write(dir.join("plan.json"), plan).unwrap();
        let e = Plan::from_file(&dir.join("plan.json")).unwrap_err();
        assert!(e.contains(wanted), "{e}");
    }
    // a scene that does not exist is the game's own error
    let (report, _) = play(
        &mut game(),
        r#"{ "start_scene": "nowhere", "frames": 2 }"#,
        "no-scene",
    );
    assert!(
        report["error"].as_str().unwrap().contains("scenes.nowhere"),
        "{report}"
    );
    // a plan that is not one says what a plan is
    let dir = scratch("bad-plan");
    std::fs::write(
        dir.join("plan.json"),
        r#"{ "steps": [ { "hodl": ["a"] } ] }"#,
    )
    .unwrap();
    let e = Plan::from_file(&dir.join("plan.json")).unwrap_err();
    assert!(e.contains("hodl") && e.contains("a plan is"), "{e}");
}

fn warnings(report: &Value) -> Vec<String> {
    report["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w.as_str().unwrap().to_string())
        .collect()
}

#[test]
fn a_route_walks_and_acts_at_once_and_repeats_groups() {
    // tapping while holding: 30 frames of walking with a swing every ten
    let plan = r#"{ "start_scene": "room", "steps": [ { "hold": ["move_x=1"], "tap": "a", "tap_every": 10, "frames": 30 } ] }"#;
    let (report, _) = play(&mut game(), plan, "tap");
    let log = texts(&report["log"]);
    let swings: Vec<&String> = log.iter().filter(|l| l.contains("swing")).collect();
    assert_eq!(
        swings,
        ["2 swing at 101", "12 swing at 111", "22 swing at 121"],
        "{log:?}"
    );
    // a group played until something holds: it stops in the middle of a round, the rest is passed over, and the
    // step after the group plays
    let plan = r#"{ "start_scene": "room", "steps": [
        { "repeat": 20, "until": "nova.named('hero').x >= 130", "capture": "there", "steps": [ { "hold": ["right"], "frames": 8 }, { "press": "a" } ] },
        { "lua": "nova.log('after the group')" } ] }"#;
    let (report, pictures) = play(&mut game(), plan, "group");
    assert_eq!(warnings(&report), Vec::<String>::new());
    let log = texts(&report["log"]);
    assert_eq!(
        log.iter().filter(|l| l.contains("swing")).count(),
        3,
        "{log:?}"
    );
    assert!(log.last().unwrap().ends_with("after the group"), "{log:?}");
    assert_eq!(pictures.len(), 1);
    assert_eq!(pictures[0].1, "there");
    assert_eq!(report["end"]["state"]["entities"][0]["x"], 130.0);
    // a group that runs out says so with its rounds; a step repeated by itself is named by its round
    let plan = r#"{ "start_scene": "room", "steps": [
        { "repeat": 2, "until": "false", "steps": [ { "wait": 1 } ] },
        { "repeat": 3, "hold": ["right"], "until": "false", "max": 2 },
        { "hold": ["right"], "until": "false", "max": 2, "may_time_out": true },
        { "repeat": 2, "until": "false", "quiet": true, "steps": [ { "wait": 1 } ] } ] }"#;
    let (report, _) = play(&mut game(), plan, "rounds");
    let w = warnings(&report);
    assert_eq!(w.len(), 4, "{w:?}");
    assert!(
        w[0].starts_with("step 1: `false` never held in 2 rounds"),
        "{w:?}"
    );
    assert!(
        w[1].starts_with("step 2 (round 1 of 3): `false` never held in 2 frames"),
        "{w:?}"
    );
    assert!(w[1].contains("may_time_out"), "{w:?}");
    assert!(w[3].starts_with("step 2 (round 3 of 3)"), "{w:?}");
}

#[test]
fn walk_to_steers_to_a_point_whatever_way_the_stick_points() {
    let there = |report: &Value, name: &str, x: f64, other: (&str, f64), radius: f64| {
        let e = report["end"]["state"]["entities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["name"] == name)
            .unwrap()
            .clone();
        let d = ((e["x"].as_f64().unwrap() - x).powi(2)
            + (e[other.0].as_f64().unwrap() - other.1).powi(2))
        .sqrt();
        assert!(d <= radius, "{name} ended {d} away: {e}");
    };
    // straight, with the stick: no warning, a note that says what it drives
    let plan = r#"{ "start_scene": "yard", "steps": [ { "walk_to": [400, 300], "who": "rover", "capture": "there" }, { "lua": "nova.log('next')" } ] }"#;
    let (report, pictures) = play(&mut game(), plan, "walk");
    assert_eq!(warnings(&report), Vec::<String>::new());
    assert_eq!(
        report["step_errors"].as_array().unwrap().len(),
        0,
        "{report}"
    );
    there(&report, "rover", 400.0, ("y", 300.0), 12.0);
    assert!(pictures[0].0 < 200, "{pictures:?}"); // (360 units at 2 a frame)
    let note = report["notes"][0].as_str().unwrap();
    assert!(
        note.contains("'rover'")
            && note.contains("move_x, move_y, left, right, up, down")
            && note.contains("x, y plane"),
        "{note}"
    );
    // a stick relative to a camera turned any way, mirrored or not, and a game that reads only the four buttons
    for setup in [
        "r.turn = 2.4",
        "r.turn = -1.57",
        "r.turn = 3.14",
        "r.mirror = true",
        "r.turn = 1.0 r.mirror = true",
        "r.buttons = true",
        "r.buttons = true r.turn = 2.0",
    ] {
        let plan = format!(
            r#"{{ "start_scene": "yard", "lua": "local r = nova.named('rover') {setup}", "steps": [ {{ "walk_to": [400, 300], "who": "rover", "max": 900 }} ] }}"#
        );
        let (report, _) = play(&mut game(), &plan, "walk-turned");
        assert_eq!(warnings(&report), Vec::<String>::new(), "{setup}");
        there(&report, "rover", 400.0, ("y", 300.0), 12.0);
        assert!(
            report["frames"].as_u64().unwrap() < 500,
            "{setup}: {}",
            report["frames"]
        );
    }
    // on the ground of a 3D game: [x, z], to within half a unit, and the list of entities gives z
    let plan = r#"{ "start_scene": "yard", "lua": "nova.named('walker').turn = 0.8", "steps": [ { "walk_to": [6, -9], "who": "walker", "plane": "xz" } ], "print": ["nova.named('walker')"] }"#;
    let (report, _) = play(&mut game(), plan, "walk-3d");
    assert_eq!(warnings(&report), Vec::<String>::new());
    there(&report, "walker", 6.0, ("z", -9.0), 0.5);
    let shown = report["end"]["prints"][0]["value"].as_str().unwrap();
    assert!(shown.starts_with("<rover at "), "{shown}");
    assert_eq!(shown.matches(", ").count(), 2, "{shown}");
    assert!(report["notes"][0].as_str().unwrap().contains("x, z plane"));
    // something in the way: it gives up long before its max and says where it is; told that this may happen, it is quiet
    for (extra, count) in [("", 1), (r#", "may_time_out": true"#, 0)] {
        let plan = format!(
            r#"{{ "start_scene": "yard", "lua": "nova.named('rover').wall = 200", "steps": [ {{ "walk_to": [400, 100], "who": "rover", "max": 2000{extra} }} ] }}"#
        );
        let (report, _) = play(&mut game(), &plan, "walk-wall");
        let w = warnings(&report);
        assert_eq!(w.len(), count, "{w:?}");
        assert!(
            report["frames"].as_u64().unwrap() < 400,
            "{}",
            report["frames"]
        );
        if count == 1 {
            assert!(
                w[0].starts_with("step 1: walk_to stopped getting nearer")
                    && w[0].contains("'rover' is at x 20"),
                "{w:?}"
            );
        }
    }
    // nobody to walk: said with the step, and the run goes on
    let plan = r#"{ "start_scene": "yard", "steps": [ { "walk_to": [1, 1], "who": "ghost" }, { "walk_to": [1, 1] } ] }"#;
    let (report, _) = play(&mut game(), plan, "walk-nobody");
    let e = report["step_errors"].as_array().unwrap();
    assert!(
        e[0].as_str()
            .unwrap()
            .starts_with("step 1 walk_to: there is no entity named or tagged 'ghost'"),
        "{e:?}"
    );
    assert!(
        e[1].as_str()
            .unwrap()
            .starts_with("step 2 walk_to: say who walks"),
        "{e:?}"
    );
}

/// A window reloads the game when its files change; files the manifest ignores are not the game's, and a headless run
/// does not watch at all (a run that wrote its pictures into the project used to restart itself).
#[test]
fn only_the_games_own_files_reload_it_and_a_headless_run_never_does() {
    let dir = scratch("watch");
    for (path, bytes) in files() {
        if !path.starts_with("shots/") {
            write(&dir, path, &bytes);
        }
    }
    let vfs: Rc<dyn Vfs> = Rc::new(nova_runtime::vfs::DirVfs::new(&dir).unwrap());
    let mut g = Game::load(vfs).expect("project loads");
    g.upload(&mut FakeGpu);
    let wait = || std::thread::sleep(std::time::Duration::from_millis(450));
    wait();
    assert!(!g.changed_on_disk());
    write(&dir, "shots/run1/frame-00001-0.png", &png(4, 4));
    write(&dir, "notes.md", b"more");
    wait();
    assert!(
        !g.changed_on_disk(),
        "ignored files changed, the game did not"
    );
    g.watch_files(false);
    write(
        &dir,
        "entities/coin.lua",
        b"return nova.entity { tags = { \"coin\" } }",
    );
    wait();
    assert!(!g.changed_on_disk(), "a headless run does not watch");
    g.watch_files(true);
    wait();
    write(
        &dir,
        "entities/coin.lua",
        b"return nova.entity { tags = { \"coin\", \"shiny\" } }",
    );
    wait();
    assert!(g.changed_on_disk());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn ignored_files_are_neither_loaded_nor_packed() {
    // (shots/big.png is not a picture at all: loading it would fail the project)
    let g = game();
    assert!(
        g.project
            .assets
            .iter()
            .all(|a| !a.id.starts_with("shots/") && a.id != "notes.md")
    );
    let vfs = MemVfs::new(files());
    let pak = nova_runtime::pak::pack(&vfs).unwrap();
    let packed = nova_runtime::pak::PakVfs::new(std::sync::Arc::new(pak)).unwrap();
    let names: Vec<String> = packed.list().unwrap().into_iter().map(|e| e.path).collect();
    assert!(names.contains(&"entities/hero.lua".to_string()));
    assert!(
        !names
            .iter()
            .any(|n| n.starts_with("shots/") || n == "notes.md"),
        "{names:?}"
    );
    // a folder is ignored whole, a file by its exact path, and a name that only starts the same is not
    let list = vec!["shots".to_string(), "notes.md".to_string()];
    assert!(nova_runtime::project::ignored(&list, "shots/a/b.png"));
    assert!(!nova_runtime::project::ignored(&list, "shots2/a.png"));
    assert!(!nova_runtime::project::ignored(&list, "docs/notes.md"));
}

fn write(dir: &Path, rel: &str, bytes: &[u8]) {
    let path = dir.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

#[test]
fn the_command_line_plays_a_plan_takes_pictures_and_writes_the_sound() {
    let dir = scratch("cli");
    for (path, bytes) in files() {
        if path != "shots/big.png" {
            write(&dir, path, &bytes);
        }
    }
    write(&dir, "sprites/dot.png", &png(4, 4));
    // a one-second beep, played when the run starts
    let mut wav = Vec::new();
    {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 22050,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::new(std::io::Cursor::new(&mut wav), spec).unwrap();
        for i in 0..22050 {
            w.write_sample(((i as f32 * 0.2).sin() * 12000.0) as i16)
                .unwrap();
        }
        w.finalize().unwrap();
    }
    write(&dir, "sounds/beep.wav", &wav);
    write(
        &dir,
        "setup.lua",
        b"nova.sound.play('beep')\nnova.named('hero').x = 150",
    );
    let out = dir.join("build/run");
    let plan = format!(
        r#"{{ "out": {:?}, "steps": [ {{ "hold": ["right"], "frames": 10, "capture": "ten" }} ], "print": ["nova.named('hero').x"] }}"#,
        out.to_string_lossy()
    );
    write(&dir, "build/plan.json", plan.as_bytes());
    let run = Command::new(env!("CARGO_BIN_EXE_nova"))
        .args([
            "run",
            &dir.to_string_lossy(),
            "--headless",
            "--size",
            "320x180",
            "--start-scene",
            "room",
        ])
        .args(["--run-lua", &dir.join("setup.lua").to_string_lossy()])
        .args(["--play", &dir.join("build/plan.json").to_string_lossy()])
        .args([
            "--audio-out",
            &dir.join("build/run.wav").to_string_lossy(),
            "--seed",
            "3",
        ])
        .output()
        .expect("runs nova");
    let said = format!(
        "{}{}",
        String::from_utf8_lossy(&run.stdout),
        String::from_utf8_lossy(&run.stderr)
    );
    assert!(run.status.success(), "{said}");
    let report: Value =
        serde_json::from_str(&std::fs::read_to_string(out.join("report.json")).unwrap()).unwrap();
    assert_eq!(report["frames"], 11);
    assert_eq!(report["captures"][0]["frame"], 11);
    assert_eq!(report["captures"][0]["prints"][0]["value"], "160"); // --run-lua put the hero at 150, then ten frames right
    assert_eq!(texts(&report["sounds"]), vec!["1 sound beep"]);
    let picture = std::fs::read(report["captures"][0]["file"].as_str().unwrap()).unwrap();
    assert_eq!(&picture[1..4], b"PNG");
    // the sound of the run: eleven frames of it, and not silence
    let mut reader = hound::WavReader::open(dir.join("build/run.wav")).unwrap();
    assert_eq!(reader.spec().sample_rate, 48000);
    let samples: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();
    assert_eq!(samples.len(), 11 * 800 * 2);
    assert!(samples.iter().any(|s| s.abs() > 3000));
    let _ = std::fs::remove_dir_all(&dir);
}

/// The starter that `docs/agent-guide.md` points at can be played from end to end by a plan: up the path, into the house,
/// stopped by a rock, and out again. It keeps the example and what the docs say about it (solid things, doors, names) true.
#[test]
fn the_top_down_starter_plays_through() {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/starter-topdown");
    let vfs: Rc<dyn Vfs> = Rc::new(nova_runtime::vfs::DirVfs::new(&folder).unwrap());
    let mut g = Game::load(vfs).expect("the starter loads");
    g.upload(&mut FakeGpu);
    let plan = r#"{
      "steps": [
        { "hold": ["up"], "until": "nova.named('hero').y <= 330", "max": 200 },
        { "hold": ["right"], "until": "nova.named('hero').x >= 744", "max": 300 },
        { "hold": ["up"], "until": "nova.current_scene() == 'house'", "max": 120, "capture": "inside" },
        { "lua": "local h = nova.named('hero') h.x, h.y = 120, 220" },
        { "hold": ["up"], "frames": 60, "capture": "under the rock" },
        { "lua": "local h = nova.named('hero') h.x, h.y = 264, 300" },
        { "hold": ["down"], "until": "nova.current_scene() == 'meadow'", "max": 200, "capture": "out" }
      ],
      "print": ["nova.named('hero').y", "nova.named('hero').depth", "nova.named('hero').flip_x"]
    }"#;
    let (report, pictures) = play(&mut g, plan, "starter");
    assert_eq!(report["error"], Value::Null, "{report}");
    // the one warning: the hold into the rock is stopped by it, and the answer says so and names the rock
    let warnings: Vec<&str> = report["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w.as_str().unwrap())
        .collect();
    assert_eq!(warnings.len(), 1, "{report}");
    assert!(
        warnings[0].starts_with("step 5 held up for 59 frames, but 'hero' stood still for ")
            && warnings[0].contains("it is against 'rock' (tagged solid) at x 120, y 144"),
        "{warnings:?}"
    );
    let captions: Vec<&str> = pictures.iter().map(|p| p.1.as_str()).collect();
    assert_eq!(captions, ["inside", "under the rock", "out"]);
    let log = texts(&report["log"]);
    assert!(
        log.iter()
            .any(|l| l.ends_with("through house_door to house")),
        "{log:?}"
    );
    assert!(
        log.iter().any(|l| l.ends_with("through way_out to meadow")),
        "{log:?}"
    );
    // the rock in the house is at 120, 144 with a box from 21 to 6 units above its feet: the hero's head stops under it
    let under = &report["captures"][1];
    let y: f64 = under["prints"][0]["value"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((152.0..156.0).contains(&y), "the hero stopped at y = {y}");
    assert_eq!(
        under["prints"][1]["value"],
        format!("-{}", under["prints"][0]["value"].as_str().unwrap())
    );
    assert!(
        texts(&report["sounds"])
            .iter()
            .any(|s| s.ends_with("sound door"))
    );
    assert_eq!(report["end"]["state"]["scene"], "meadow");
}

/// The game made with only the makers (`examples/maker-demo`) plays: the sword beats the slime, a coin is taken, the
/// door leads into the room and the chest opens. It keeps the makers' output (tags by name, pivots, painted layers,
/// solid terrains) working in the game itself.
#[test]
fn the_maker_demo_plays_through() {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/maker-demo");
    let vfs: Rc<dyn Vfs> = Rc::new(nova_runtime::vfs::DirVfs::new(&folder).unwrap());
    let mut g = Game::load(vfs).expect("the demo loads");
    g.upload(&mut FakeGpu);
    let plan = r#"{
      "steps": [
        { "repeat": 6, "until": "nova.count('enemy') < 4", "steps": [{ "lua": "local h, s = nova.named('hero'), nova.named('slime') if s then h.x, h.y = s.x - 44, s.y; h.facing = 'right' end" }, { "press": "attack" }, { "wait": 24 }] },
        { "walk_to": [504, 408], "who": "hero", "max": 200 },
        { "lua": "local h = nova.named('hero') h.x, h.y = 264, 300" },
        { "hold": ["up"], "until": "nova.current_scene() == 'room'", "max": 200, "capture": "inside" },
        { "walk_to": [640, 200], "who": "hero", "max": 300 },
        { "walk_to": [716, 190], "who": "hero", "max": 200, "may_time_out": true },
        { "press": "attack" },
        { "wait": 30, "capture": "the chest" }
      ],
      "print": ["require('lib.game').coins", "nova.named('chest').frame"]
    }"#;
    let (report, _) = play(&mut g, plan, "maker-demo");
    assert_eq!(report["error"], Value::Null, "{report}");
    let log = texts(&report["log"]);
    for wanted in [
        "slime hit, hp 0",
        "through house_door to room",
        "chest opened",
    ] {
        assert!(log.iter().any(|l| l.contains(wanted)), "{wanted}: {log:?}");
    }
    assert_eq!(report["captures"][1]["prints"][1]["value"], "10");
    let sounds = texts(&report["sounds"]);
    for wanted in [
        "sound sword_swing",
        "sound hit",
        "sound enemy_die",
        "sound coin",
        "sound door",
        "sound chest_open",
        "music village",
        "music cellar",
    ] {
        assert!(
            sounds.iter().any(|s| s.contains(wanted)),
            "{wanted}: {sounds:?}"
        );
    }
}

/// The platformer starter (`project_create`'s "platformer" template) plays from its first screen to its second: up the
/// steps, over the gap by the planks, over the slime, and through the door. It keeps the example and what it shows
/// (coyote time, one-way planks, a pickup, a hazard, a door) true.
#[test]
fn the_platformer_starter_plays_through() {
    let folder =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/starter-platformer");
    let vfs: Rc<dyn Vfs> = Rc::new(nova_runtime::vfs::DirVfs::new(&folder).unwrap());
    let mut g = Game::load(vfs).expect("the starter loads");
    g.upload(&mut FakeGpu);
    let plan = r#"{
      "steps": [
        { "repeat": 12, "until": "nova.named('hero').x > 600 and nova.named('hero').on_ground", "steps": [{ "hold": ["right", "jump"], "frames": 22 }, { "hold": ["right"], "frames": 14 }] },
        { "hold": ["right"], "until": "nova.named('hero').x > 650", "max": 100 },
        { "hold": ["right", "jump"], "until": "nova.named('hero').x > 760 and nova.named('hero').on_ground", "max": 200, "capture": "first plank" },
        { "hold": ["right"], "until": "nova.named('hero').x > 800", "max": 100 },
        { "hold": ["right", "jump"], "until": "nova.named('hero').x > 900 and nova.named('hero').on_ground", "max": 200, "capture": "second plank" },
        { "hold": ["right"], "until": "nova.named('hero').x > 1100", "max": 200 },
        { "hold": ["right"], "until": "math.abs(nova.named('slime').x - nova.named('hero').x) < 100", "max": 300 },
        { "hold": ["right", "jump"], "frames": 45 },
        { "repeat": 20, "until": "nova.named('hero').x > 1800", "steps": [{ "hold": ["right", "jump"], "frames": 22 }, { "hold": ["right"], "frames": 14 }] },
        { "wait": 12 },
        { "press": "up" },
        { "wait": 20, "capture": "in the cave" }
      ],
      "print": ["nova.named('hero').y", "require('lib.level').gems"]
    }"#;
    let (report, pictures) = play(&mut g, plan, "platformer");
    assert_eq!(report["error"], Value::Null, "{report}");
    assert_eq!(report["warnings"].as_array().unwrap().len(), 0, "{report}");
    assert_eq!(pictures.len(), 3);
    // he stands on the planks (their tops are at y = 384 and 336), having come up onto them from below
    assert_eq!(report["captures"][0]["prints"][0]["value"], "384");
    assert_eq!(report["captures"][1]["prints"][0]["value"], "336");
    let log = texts(&report["log"]);
    assert!(log.iter().any(|l| l.ends_with("gem 2")), "{log:?}");
    assert!(!log.iter().any(|l| l.contains("hurt")), "{log:?}");
    assert!(
        log.iter().any(|l| l.ends_with("through cave_door to cave")),
        "{log:?}"
    );
    let sounds = texts(&report["sounds"]);
    for wanted in [
        "sound jump",
        "sound land",
        "sound pickup",
        "sound door",
        "music field",
    ] {
        assert!(
            sounds.iter().any(|s| s.contains(wanted)),
            "{wanted}: {sounds:?}"
        );
    }
    assert_eq!(report["end"]["state"]["scene"], "cave");
}

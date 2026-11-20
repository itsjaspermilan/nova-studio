//! Scripted headless runs (`nova run --headless --play plan.json`, `playtest.rs`): a route of steps drives a real `Game`,
//! and the report says what happened. Also the helpers a run uses (start in a scene, run Lua, read a value, list what is
//! alive), the fixed random seed, the names scene objects give their entities, and `"ignore"` in `nova.json`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;

use nova_runtime::actions::InputFrame;
use nova_runtime::game::{Game, Uploader};
use nova_runtime::model::{Image, MeshData};
use nova_runtime::playtest::{Plan, Playtest};
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
  self.x = self.x + nova.input.axis("move_x") * self.speed * dt
  if nova.input.down("right") then self.x = self.x + self.speed * dt end
  if nova.input.pressed("a") then nova.log("swing at " .. math.floor(self.x + 0.5)) end
end
function Hero:on_collide_coin(coin) coin:destroy(); nova.log("coin") end
return Hero
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
fn play(game: &mut Game, plan: &str, name: &str) -> (Value, Vec<(u32, String)>) {
    let dir = scratch(name);
    std::fs::write(dir.join("plan.json"), plan).unwrap();
    let plan = Plan::from_file(&dir.join("plan.json")).expect("the plan reads");
    let mut run = Playtest::new(plan, &dir.join("out")).unwrap();
    game.reseed(run.seed().unwrap_or(1));
    if let Some(scene) = run.start_scene() {
        game.start_in_scene(scene).unwrap();
    }
    let mut pictures = Vec::new();
    let mut frame = 0;
    while !run.finished(frame) {
        let mut input = InputFrame::default();
        run.before_frame(frame, game, &mut input);
        game.update_input(1.0 / 60.0, frame as f64 / 60.0, [960.0, 540.0], &input);
        for caption in run.after_frame(frame, game) {
            let _ = run.picture(frame, &caption, game);
            pictures.push((frame + 1, caption));
        }
        frame += 1;
    }
    let report = run.finish(frame, game).unwrap();
    let report: Value = serde_json::from_str(&std::fs::read_to_string(report).unwrap()).unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    (report, pictures)
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
    assert_eq!(report["frames"].as_u64().unwrap() as u32, pictures[2].0 + 1);
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
    // Lua that fails stops the run and says which step
    let (report, _) = play(
        &mut game(),
        r#"{ "start_scene": "room", "steps": [ { "wait": 2 }, { "lua": "nothing.here = 1" } ] }"#,
        "lua-error",
    );
    assert!(
        report["error"]
            .as_str()
            .unwrap()
            .starts_with("step 2 lua: "),
        "{report}"
    );
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

/// The starter that `docs/agents.md` points at can be played from end to end by a plan: up the path, into the house,
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
    assert_eq!(report["warnings"].as_array().unwrap().len(), 0, "{report}");
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

//! The test player of scripted runs (`playtest.rs`) playing like a person: `walk_to` finds a way round what is solid and
//! walks up to things, `fight` beats what is tagged, `invincible` keeps the hero alive, `stop_on_fail` ends a route at
//! the step that failed, a hold of a direction moves a hero that reads the axis, and a hold nothing reads is said.

use std::path::PathBuf;
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

/// Walks with the stick only (as a 3D game's hero would), stops at entities tagged `solid`, swings with `a`.
const HERO: &str = r#"
local Hero = nova.entity { tags = { "hero" }, hitbox = { -6, -6, 12, 12 }, hp = 3, speed = 120, face = 1, hurt = 0 }
function Hero:update(dt)
  local dx, dy = nova.input.axis("move_x"), nova.input.axis("move_y")
  local x, y = self.x, self.y
  self.x = x + dx * self.speed * dt
  if self:touching("solid") then self.x = x end
  self.y = y + dy * self.speed * dt
  if self:touching("solid") then self.y = y end
  self.hurt = self.hurt - dt
  if nova.input.pressed("a") then
    nova.log("swing")
    for _, e in ipairs(nova.all("enemy")) do
      if self:distance_to(e) < 40 then e.hp = e.hp - 1; if e.hp <= 0 then e:destroy() end end
    end
  end
end
function Hero:on_collide_enemy()
  if self.hurt > 0 then return end
  self.hurt = 0.3
  self.hp = self.hp - 1
  nova.log("hurt " .. self.hp)
  if self.hp <= 0 then nova.log("dead"); self:destroy() end
end
function Hero:on_collide_key(key) key:destroy(); nova.log("key taken") end
return Hero
"#;

/// A wall of blocks from y = 0 to 300 at x = 200, with the hero on its left and the chest behind it.
const YARD: &str = r#"{"version":1,"objects":[
  {"kind":"hero","name":"hero","x":100,"y":100},
  {"kind":"block","x":200,"y":20},{"kind":"block","x":200,"y":60},{"kind":"block","x":200,"y":100},
  {"kind":"block","x":200,"y":140},{"kind":"block","x":200,"y":180},{"kind":"block","x":200,"y":220},{"kind":"block","x":200,"y":260},
  {"kind":"chest","name":"chest","x":320,"y":100},
  {"kind":"key","name":"key","x":100,"y":260}
]}"#;

const ARENA: &str = r#"{"version":1,"objects":[
  {"kind":"hero","name":"hero","x":100,"y":100},
  {"kind":"bat","x":300,"y":100},{"kind":"bat","x":100,"y":300},{"kind":"bat","x":400,"y":400}
]}"#;

fn game() -> Game {
    let files: Vec<(&'static str, Vec<u8>)> = vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", b"nova.start(\"yard\")".to_vec()),
        ("scenes/yard.lua", b"return nova.scene {}".to_vec()),
        ("scenes/yard.scene.json", YARD.as_bytes().to_vec()),
        ("scenes/arena.lua", b"return nova.scene {}".to_vec()),
        ("scenes/arena.scene.json", ARENA.as_bytes().to_vec()),
        ("entities/hero.lua", HERO.as_bytes().to_vec()),
        ("entities/block.lua", b"return nova.entity { tags = { \"solid\" }, hitbox = { -20, -20, 40, 40 } }".to_vec()),
        ("entities/chest.lua", b"return nova.entity { tags = { \"solid\", \"chest\" }, hitbox = { -10, -10, 20, 20 } }".to_vec()),
        ("entities/key.lua", b"return nova.entity { tags = { \"key\" }, hitbox = { -4, -4, 8, 8 } }".to_vec()),
        (
            "entities/bat.lua",
            b"local B = nova.entity { tags = { \"enemy\" }, hitbox = { -6, -6, 12, 12 }, hp = 2, velocity = false }\nfunction B:update(dt) local h = nova.named('hero') if h then self:move_toward(h, 30 * dt) end end\nreturn B".to_vec(),
        ),
    ];
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(files));
    let mut game = Game::load(vfs).expect("project loads");
    game.upload(&mut FakeGpu);
    game
}

fn play(game: &mut Game, plan: &str, _name: &str) -> (Value, Vec<(u32, String)>) {
    // (the runtime's own harness: every key of the plan, a scratch folder of its own per run)
    let report = nova_runtime::testing::play(game, plan).expect("the plan plays");
    (report.json, report.pictures)
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_string())
        .collect()
}

fn log(report: &Value) -> Vec<String> {
    report["log"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["text"].as_str().unwrap().to_string())
        .collect()
}

fn hero_x(report: &Value) -> f64 {
    report["end"]["state"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["name"] == "hero")
        .expect("the hero lives")["x"]
        .as_f64()
        .unwrap()
}

#[test]
fn walk_to_goes_round_a_wall_and_straight_stops_at_it() {
    // behind the wall of blocks: the straight line from the hero runs into it
    let (report, _) = play(
        &mut game(),
        r#"{ "steps": [ { "walk_to": [300, 100] } ] }"#,
        "round",
    );
    assert_eq!(strings(&report["warnings"]).len(), 0, "{report}");
    let route = strings(&report["route"]);
    assert!(
        route[0].contains("walk_to [300, 100]: there after"),
        "{route:?}"
    );
    assert!(
        strings(&report["notes"])
            .iter()
            .any(|n| n.contains("found a way round what is solid")),
        "{report}"
    );
    assert!((hero_x(&report) - 300.0).abs() <= 12.0);

    // the old way, asked for: it walks into the wall and says where it stuck
    let (report, _) = play(
        &mut game(),
        r#"{ "steps": [ { "walk_to": [300, 100], "straight": true } ] }"#,
        "straight",
    );
    let w = strings(&report["warnings"]);
    assert!(
        w.len() == 1
            && w[0].contains("gave up")
            && w[0].contains("blocked by 'block' (tagged solid) at x 200, y 100")
            && w[0].contains("It tried walking straight at the place"),
        "{w:?}"
    );
    assert!(hero_x(&report) < 180.0);
}

#[test]
fn walk_to_a_thing_ends_touching_it_or_having_taken_it() {
    // a solid chest behind the wall: the walk ends standing against it, and says how far apart the hitboxes are
    let (report, pictures) = play(
        &mut game(),
        r#"{ "steps": [ { "walk_to": "chest", "capture": "at the chest" } ], "print": ["nova.named('hero'):near('chest', 4) ~= nil"] }"#,
        "chest",
    );
    assert_eq!(strings(&report["warnings"]).len(), 0, "{report}");
    assert_eq!(
        report["step_errors"].as_array().unwrap().len(),
        0,
        "{report}"
    );
    let route = strings(&report["route"]);
    assert!(
        route[0].contains("walk_to 'chest': stopped against it") && route[0].contains("apart"),
        "{route:?}"
    );
    assert_eq!(report["end"]["prints"][0]["value"], "true", "{report}");
    assert_eq!(pictures.len(), 1);

    // a key that is taken on touch: gone is reached
    let (report, _) = play(
        &mut game(),
        r#"{ "steps": [ { "walk_to": "key" } ] }"#,
        "key",
    );
    assert_eq!(
        report["step_errors"].as_array().unwrap().len(),
        0,
        "{report}"
    );
    assert!(log(&report).contains(&"key taken".to_string()));
    assert!(
        strings(&report["route"])[0].contains("it is gone now"),
        "{report}"
    );

    // a name nothing has is said with what there is
    let (report, _) = play(
        &mut game(),
        r#"{ "steps": [ { "walk_to": "door" } ] }"#,
        "nodoor",
    );
    let e = strings(&report["step_errors"]);
    assert!(
        e[0].contains("no entity with the name, tag or kind 'door'") && e[0].contains("chest"),
        "{e:?}"
    );
}

#[test]
fn fight_beats_what_is_tagged_and_says_how_it_went() {
    let plan = r#"{ "start_scene": "arena", "invincible": true, "steps": [ { "fight": "enemy", "attack": "a", "max": 1500 } ], "print": ["nova.count('enemy')"] }"#;
    let (report, _) = play(&mut game(), plan, "fight");
    assert_eq!(report["end"]["prints"][0]["value"], "0", "{report}");
    let route = strings(&report["route"]);
    assert!(
        route[0].contains("fight 'enemy': all 3 beaten"),
        "{route:?}"
    );
    // every attack it counted is one the game saw
    let swings = log(&report).iter().filter(|l| *l == "swing").count();
    assert!(
        route[0].contains(&format!("with {swings} attacks")),
        "{route:?} {swings}"
    );
    assert!(
        strings(&report["notes"])
            .iter()
            .any(|n| n.contains("invincible: 'hero' kept hp 3 from going down")),
        "{report}"
    );
    assert_eq!(strings(&report["warnings"]).len(), 0, "{report}");

    // out of time: a failure that says how many are left
    let plan = r#"{ "start_scene": "arena", "invincible": true, "lua": "for _, e in ipairs(nova.all('enemy')) do e.hp = 999 end", "steps": [ { "fight": "enemy", "max": 200 } ] }"#;
    let (report, _) = play(&mut game(), plan, "fight-long");
    let w = strings(&report["warnings"]);
    assert!(
        w.iter()
            .any(|w| w.contains("3 of 3 still alive after 200 frames")),
        "{w:?}"
    );
}

#[test]
fn invincible_keeps_a_clumsy_route_alive() {
    // standing among the bats without it: the hero dies
    let plan = r#"{ "start_scene": "arena", "steps": [ { "wait": 900 } ] }"#;
    let (report, _) = play(&mut game(), plan, "mortal");
    assert!(log(&report).contains(&"dead".to_string()));
    let plan = r#"{ "start_scene": "arena", "god": true, "steps": [ { "wait": 900 } ], "print": ["nova.named('hero').hp", "nova.testing.invincible"] }"#;
    let (report, _) = play(&mut game(), plan, "god");
    assert!(!log(&report).contains(&"dead".to_string()));
    assert!(log(&report).iter().any(|l| l.starts_with("hurt")));
    assert_eq!(report["end"]["prints"][0]["value"], "3");
    assert_eq!(report["end"]["prints"][1]["value"], "true");

    // one blow bigger than all it has, with the game's own "dead?" check right after it in the same call: refused as it
    // lands (it used to be put back only after the frame, by which time the hero was gone)
    let plan = r#"{ "start_scene": "arena", "invincible": true, "steps": [
        { "lua": "local h = nova.named('hero'); h.hp = h.hp - 10; if h.hp <= 0 then nova.log('dead'); h:destroy() end" },
        { "wait": 5 } ], "print": ["nova.named('hero').hp"] }"#;
    let (report, _) = play(&mut game(), plan, "god-blow");
    assert!(!log(&report).contains(&"dead".to_string()), "{report}");
    assert_eq!(report["end"]["prints"][0]["value"], "3");
    // and the hp can still go up
    let plan = r#"{ "start_scene": "arena", "invincible": true, "steps": [ { "lua": "nova.named('hero').hp = 5" }, { "wait": 2 } ], "print": ["nova.named('hero').hp"] }"#;
    let (report, _) = play(&mut game(), plan, "god-heal");
    assert_eq!(report["end"]["prints"][0]["value"], "5");
}

/// `always` checks a condition after every frame (of the whole run, a step or a group) and says the first frame it was
/// false on; `record` writes a value down after every frame.
#[test]
fn always_and_record_watch_every_frame() {
    let plan = r#"{ "always": "nova.named('hero').x < 160",
        "steps": [
          { "hold": ["move_x=1"], "frames": 40, "record": "math.floor(nova.named('hero').x)", "always": "nova.named('hero').hp == 3" },
          { "repeat": 2, "always": ["nova.named('hero').y >= 0"], "steps": [ { "wait": 3 } ] }
        ] }"#;
    let (report, _) = play(&mut game(), plan, "always");
    let w = strings(&report["warnings"]);
    // 120 units a second from x 100: past 160 after 30 frames of walking (the steps start at frame 2)
    assert!(
        w.iter().any(|w| w.contains("always `nova.named('hero').x < 160` (for the whole run) was false after frame 31, in step 1")),
        "{w:?}"
    );
    assert!(
        w.iter()
            .any(|w| w.contains("was false on ") && w.contains("first after frame 31 (in step 1)")),
        "{w:?}"
    );
    let notes = strings(&report["notes"]);
    assert!(
        notes.iter().any(|n| n.contains(
            "always `nova.named('hero').hp == 3` (on step 1) held after every one of the 40 frames"
        )),
        "{notes:?}"
    );
    assert!(
        notes.iter().any(|n| n.contains(
            "always `nova.named('hero').y >= 0` (on step 2) held after every one of the 6 frames"
        )),
        "{notes:?}"
    );
    let rec = &report["records"][0];
    assert_eq!(rec["scope"], "step 1");
    // every frame, as runs of one value: [first frame, last frame, value]
    assert_eq!(rec["frames"], 40);
    let runs = rec["runs"].as_array().unwrap();
    assert_eq!(runs[0], serde_json::json!([2, 2, "102"]));
    assert_eq!(runs.last().unwrap()[1], 41);
    let covered: u64 = runs
        .iter()
        .map(|r| r[1].as_u64().unwrap() - r[0].as_u64().unwrap() + 1)
        .sum();
    assert_eq!(covered, 40);
    assert!(
        runs.iter()
            .all(|v| v[2].as_str().unwrap().parse::<i64>().is_ok())
    );

    // a long run keeps every frame (it used to stop after 3600 values, and the answer after 200): a value held is one run
    let plan = r#"{ "frames": 5000, "record": ["nova.time() < 40 and 1 or 2", "math.floor(nova.time() * 60) % 7"] }"#;
    let (report, _) = play(&mut game(), plan, "record-long");
    let held = &report["records"][0];
    assert_eq!(
        held["frames"], 4999,
        "every frame after the first (the scene coming up)"
    );
    assert_eq!(
        held["runs"].as_array().unwrap().len(),
        2,
        "{}",
        held["runs"]
    );
    let busy = &report["records"][1];
    assert_eq!(busy["frames"], 4999);
    let covered: u64 = busy["runs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r[1].as_u64().unwrap() - r[0].as_u64().unwrap() + 1)
        .sum();
    assert_eq!(covered, 4999, "no frame left out");

    // with stop_on_fail the route ends at the frame it was first false
    let plan = r#"{ "stop_on_fail": true, "steps": [ { "hold": ["move_x=1"], "frames": 40, "always": "nova.named('hero').x < 130" }, { "lua": "nova.log('later')" } ] }"#;
    let (report, _) = play(&mut game(), plan, "always-stop");
    assert!(
        report["stopped"].as_str().unwrap().contains("step 1"),
        "{report}"
    );
    assert!(!log(&report).contains(&"later".to_string()));
    assert_eq!(report["frames"], 16); // (x is 130 after frame 16)
}

#[test]
fn stop_on_fail_ends_the_route_at_the_step_that_failed() {
    let plan = r#"{ "stop_on_fail": true, "steps": [
        { "hold": ["move_x=-1"], "until": "nova.named('hero').x > 5000", "max": 20 },
        { "lua": "nova.log('later step')" },
        { "wait": 30, "capture": "never" } ] }"#;
    let (report, pictures) = play(&mut game(), plan, "stop");
    assert!(
        report["stopped"]
            .as_str()
            .unwrap()
            .contains("stopped at step 1"),
        "{report}"
    );
    assert!(
        report["stopped"]
            .as_str()
            .unwrap()
            .contains("2 later steps were not played")
    );
    assert!(!log(&report).contains(&"later step".to_string()));
    assert_eq!(pictures.len(), 1);
    assert!(pictures[0].1.starts_with("stopped: step 1"));
    assert_eq!(report["frames"], 21);

    // a step that may time out does not stop it; without the option the run goes on as before
    let plan = r#"{ "stop_on_fail": true, "steps": [
        { "hold": ["move_x=-1"], "until": "false", "max": 20, "may_time_out": true },
        { "lua": "nova.log('later step')" } ] }"#;
    let (report, _) = play(&mut game(), plan, "nostop");
    assert_eq!(report["stopped"], Value::Null);
    assert!(log(&report).contains(&"later step".to_string()));
}

#[test]
fn a_direction_held_moves_a_hero_that_reads_the_axis_and_an_unread_hold_is_said() {
    // this hero reads move_x only; "right" is the button
    let plan =
        r#"{ "steps": [ { "hold": ["left"], "frames": 30 }, { "hold": ["b"], "frames": 30 } ] }"#;
    let (report, _) = play(&mut game(), plan, "links");
    assert!((hero_x(&report) - 40.0).abs() < 1.0, "{}", hero_x(&report));
    assert!(
        strings(&report["notes"])
            .iter()
            .any(|n| n.contains("a hold of `left` also sets `move_x`")),
        "{report}"
    );
    let w = strings(&report["warnings"]);
    assert!(
        w.len() == 1
            && w[0].contains("step 2 held b for 30 frames, but nothing in the game asked about it")
            && w[0].contains("move_x"),
        "{w:?}"
    );
    // a step that sets both is left as written
    let plan = r#"{ "steps": [ { "hold": ["left", "move_x=1"], "frames": 30 } ] }"#;
    let (report, _) = play(&mut game(), plan, "both");
    assert!((hero_x(&report) - 160.0).abs() < 1.0);
}

#[test]
fn the_picture_of_an_until_is_of_the_frame_after() {
    let plan = r#"{ "steps": [
        { "hold": ["move_x=1"], "until": "nova.named('hero').x >= 110", "max": 60, "capture": "there" },
        { "wait": 10, "capture": "later" } ] }"#;
    let (report, pictures) = play(&mut game(), plan, "after");
    assert_eq!(report["warnings"].as_array().unwrap().len(), 0, "{report}");
    // 2 units a frame from 100: the condition holds after frame 6 (the fifth frame of the step); the picture is of frame 7
    assert_eq!(pictures[0], (7, "there".to_string()));
    assert_eq!(pictures[1], (16, "later".to_string()));

    // the last step of a route still gets its picture
    let plan = r#"{ "steps": [ { "hold": ["move_x=1"], "until": "nova.named('hero').x >= 110", "max": 60, "capture": "there" } ] }"#;
    let (_, pictures) = play(&mut game(), plan, "after-last");
    assert_eq!(pictures, vec![(7, "there".to_string())]);
}

#[test]
fn the_starter_is_walked_by_path_and_through_its_door() {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/starter-topdown");
    let vfs: Rc<dyn Vfs> = Rc::new(nova_runtime::vfs::DirVfs::new(&folder).unwrap());
    let mut g = Game::load(vfs).expect("the starter loads");
    g.upload(&mut FakeGpu);
    // from the bottom left to behind the house, round the pond and the trees; then to the door, which takes him inside
    let plan = r#"{ "stop_on_fail": true, "overlay": ["hitboxes", "solids", "names"], "steps": [
        { "walk_to": [1056, 144] }, { "walk_to": "rock" }, { "walk_to": "house_door" } ],
        "print": ["nova.current_scene()"] }"#;
    let (report, _) = play(&mut g, plan, "starter-path");
    assert_eq!(report["stopped"], Value::Null, "{report}");
    assert_eq!(strings(&report["warnings"]).len(), 0, "{report}");
    assert_eq!(report["end"]["prints"][0]["value"], "house");
    let route = strings(&report["route"]);
    assert_eq!(route.len(), 3, "{route:?}");
    assert!(route[1].contains("stopped against it"), "{route:?}");
    assert!(
        route[2].contains("the scene changed to 'house'"),
        "{route:?}"
    );
    assert!(report["render"].is_null());
    assert_eq!(report["end"]["render"]["three_d"], false);
}

/// Props with `on_ground = true` (as `prop3d_make` writes them) placed on a hill of `ground3d_make`'s rolling grass stand
/// with their base on the ground under their x, z: a tree, a rock and a crate on the slope, at y 0 in the scene file.
#[test]
fn props_on_ground_stand_on_a_sloping_hill() {
    let starter = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/starter-3d");
    let dir = std::env::temp_dir().join(format!("nova-on-ground-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for sub in ["models", "entities", "scenes"] {
        std::fs::create_dir_all(dir.join(sub)).unwrap();
    }
    for m in ["ground", "tree", "rock", "crate"] {
        std::fs::copy(
            starter.join(format!("models/{m}.glb")),
            dir.join(format!("models/{m}.glb")),
        )
        .unwrap();
    }
    let write = |rel: &str, text: &str| std::fs::write(dir.join(rel), text).unwrap();
    write("nova.json", r#"{"format":1,"name":"Hill"}"#);
    write("main.lua", "nova.start(\"probe\")\n");
    write(
        "entities/ground.lua",
        "return nova.entity { model = \"ground\", solid = true }\n",
    );
    write(
        "entities/tree.lua",
        "return nova.entity { model = \"tree\", static = true, sway = 0.2, on_ground = true }\n",
    );
    write(
        "entities/rock.lua",
        "return nova.entity { model = \"rock\", static = true, solid = true, on_ground = true }\n",
    );
    write(
        "entities/crate.lua",
        "return nova.entity { model = \"crate\", static = true, solid = true, on_ground = true }\n",
    );
    for s in ["probe", "hill"] {
        write(&format!("scenes/{s}.lua"), "return nova.scene {}\n");
    }
    let camera = r#""camera": { "eye": [0, 4, 14], "target": [0, 0, 0], "fov": 55 }"#;
    write(
        "scenes/probe.scene.json",
        &format!(
            r#"{{ "version": 1, {camera}, "objects": [ {{ "kind": "ground", "x": 0, "y": 0, "z": 0 }} ] }}"#
        ),
    );
    let load = || {
        let vfs: Rc<dyn Vfs> = Rc::new(nova_runtime::vfs::DirVfs::new(&dir).unwrap());
        let mut g = Game::load(vfs).expect("the hill loads");
        g.upload(&mut FakeGpu);
        g
    };
    let frame =
        |g: &mut Game| g.update_input(1.0 / 60.0, 0.0, [960.0, 540.0], &InputFrame::default());
    // the ground alone: find three places on the slope of the grass (high, and not level)
    let mut g = load();
    frame(&mut g);
    frame(&mut g);
    let probe = r#"(function()
      local best = {}
      for ix = -10, 10 do for iz = -8, 8 do
        local x, z = ix * 1.1 + 0.3, iz * 1.1 + 0.2
        local y, nx, ny, nz = nova.solid.floor_below(x, 1000, z, 2000)
        if y and ny < 0.995 then best[#best + 1] = { x = x, z = z, y = y } end
      end end
      table.sort(best, function(a, b) return a.y > b.y end)
      local out, used = {}, {}
      for _, p in ipairs(best) do
        local far = true
        for _, q in ipairs(used) do if math.abs(p.x - q.x) + math.abs(p.z - q.z) < 4 then far = false end end
        if far then used[#used + 1] = p; out[#out + 1] = string.format("%.3f %.3f %.4f", p.x, p.z, p.y) end
        if #used == 3 then break end
      end
      return table.concat(out, ";")
    end)()"#;
    let text = g.lua_text(probe).unwrap();
    let spots: Vec<(f64, f64, f64)> = text
        .split(';')
        .map(|s| {
            let v: Vec<f64> = s.split(' ').map(|n| n.parse().unwrap()).collect();
            (v[0], v[1], v[2])
        })
        .collect();
    assert_eq!(spots.len(), 3, "{text}");
    assert!(
        spots.iter().all(|s| s.2 > 0.05),
        "the places are up the hill: {spots:?}"
    );
    let objects: Vec<String> = ["tree", "rock", "crate"]
        .iter()
        .zip(&spots)
        .map(|(k, (x, z, _))| {
            format!(r#"{{ "kind": "{k}", "name": "{k}", "x": {x}, "y": 0, "z": {z} }}"#)
        })
        .collect();
    write(
        "scenes/hill.scene.json",
        &format!(
            r#"{{ "version": 1, {camera}, "objects": [ {{ "kind": "ground", "x": 0, "y": 0, "z": 0 }}, {} ] }}"#,
            objects.join(", ")
        ),
    );
    // the props: each one's base (its y plus its model's lowest point) is on the ground the probe measured
    let mut g = load();
    g.start_in_scene("hill").unwrap();
    frame(&mut g);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    for (kind, (_, _, ground)) in ["tree", "rock", "crate"].iter().zip(&spots) {
        let expr = format!(
            "(function() local low = math.huge for _, p in pairs(nova.model_pose(\"{kind}\")) do low = math.min(low, p.low) end return nova.scene_now().{kind}.y + low end)()"
        );
        let base: f64 = g.lua_text(&expr).unwrap().parse().unwrap();
        assert!(
            (base - ground).abs() <= 0.02,
            "{kind}: base at {base}, ground at {ground}"
        );
        let y: f64 = g
            .lua_text(&format!("nova.scene_now().{kind}.y"))
            .unwrap()
            .parse()
            .unwrap();
        assert!(y > 0.05, "{kind} was lifted off y 0: {y}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// A walk to a tag ("door": both rooms have one) that goes through a door ends in the next room as a success, and does
/// not walk on to the next room's door and out again.
#[test]
fn walk_to_a_tag_ends_when_the_scene_changes() {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/starter-topdown");
    let vfs: Rc<dyn Vfs> = Rc::new(nova_runtime::vfs::DirVfs::new(&folder).unwrap());
    let mut g = Game::load(vfs).expect("the starter loads");
    g.upload(&mut FakeGpu);
    let plan = r#"{ "stop_on_fail": true, "steps": [ { "walk_to": "door" }, { "wait": 30 } ],
        "print": ["nova.current_scene()"] }"#;
    let (report, _) = play(&mut g, plan, "door-by-tag");
    assert_eq!(report["stopped"], Value::Null, "{report}");
    assert_eq!(strings(&report["warnings"]).len(), 0, "{report}");
    assert_eq!(report["end"]["prints"][0]["value"], "house", "{report}");
    let route = strings(&report["route"]);
    assert!(
        route[0].contains("the scene changed to 'house'")
            && route[0].contains("the step ends there"),
        "{route:?}"
    );
    let through: Vec<String> = log(&report)
        .into_iter()
        .filter(|l| l.starts_with("through"))
        .collect();
    assert_eq!(through.len(), 1, "one door, not two: {through:?}");
}

#[test]
fn mistakes_in_the_new_options_are_said() {
    let dir = std::env::temp_dir().join(format!("nova-player-bad-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for (plan, expected) in [
        (
            r#"{ "steps": [ { "fight": "enemy", "walk_to": [1, 2] } ] }"#,
            "both \"fight\" and \"walk_to\"",
        ),
        (
            r#"{ "steps": [ { "fight": "enemy", "attack_every": 2 } ] }"#,
            "\"attack_every\" is 2",
        ),
    ] {
        std::fs::write(dir.join("plan.json"), plan).unwrap();
        let e = Plan::from_file(&dir.join("plan.json")).unwrap_err();
        assert!(e.contains(expected), "{e}");
    }
    std::fs::write(dir.join("plan.json"), r#"{ "overlay": ["boxes"] }"#).unwrap();
    let plan = Plan::from_file(&dir.join("plan.json")).unwrap();
    let e = Playtest::new(plan, &dir.join("out")).err().unwrap();
    assert!(
        e.contains("\"boxes\"") && e.contains("hitboxes, solids, names"),
        "{e}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_follow_camera_says_when_it_is_squeezed_and_can_hide_its_target() {
    let g = game();
    let mut frame = InputFrame::default();
    frame.overrides.clear();
    let mut g = g;
    g.update_input(1.0 / 60.0, 0.0, [960.0, 540.0], &frame);
    // two units behind and level: nearer than 3, so it is squeezed and the hero is not drawn; then far enough again
    g.run_lua("local h = nova.named(\"hero\") nova.cam3.follow(h, { distance = 2, height = 1, look_height = 1, smooth = 0, min_distance = 3, hide = true })", "t").unwrap();
    assert_eq!(g.lua_text("nova.cam3.squeezed").unwrap(), "true");
    assert_eq!(g.lua_text("nova.cam3.distance").unwrap(), "2");
    assert_eq!(g.lua_text("nova.named(\"hero\").visible").unwrap(), "false");
    g.run_lua("local h = nova.named(\"hero\") nova.cam3.follow(h, { distance = 6, height = 1, look_height = 1, smooth = 0, min_distance = 3, hide = true })", "t").unwrap();
    assert_eq!(g.lua_text("nova.cam3.squeezed").unwrap(), "false");
    assert_eq!(g.lua_text("nova.named(\"hero\").visible").unwrap(), "true");
    // a target the game hid itself is left alone
    g.run_lua("local h = nova.named(\"hero\") h.visible = false nova.cam3.follow(h, { distance = 6, smooth = 0, min_distance = 3, hide = true })", "t").unwrap();
    assert_eq!(g.lua_text("nova.named(\"hero\").visible").unwrap(), "false");
}

fn starter_3d() -> Game {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/starter-3d");
    let vfs: Rc<dyn Vfs> = Rc::new(nova_runtime::vfs::DirVfs::new(&folder).unwrap());
    let mut g = Game::load(vfs).expect("the 3D starter loads");
    g.upload(&mut FakeGpu);
    g
}

/// The 3D starter (`project_create`'s "3d" template) is walked by the test player: to three gems by name, one of them
/// through the arch, with a camera that swings behind the hero as it goes (the stick is relative to it), and up to a
/// solid crate. Footsteps come from the walk and run clips' events.
#[test]
fn the_3d_starter_is_walked_gem_by_gem() {
    let plan = r#"{
      "steps": [
        { "walk_to": "gem_court", "max": 600 },
        { "walk_to": "gem_arch", "max": 900 },
        { "walk_to": "gem_path", "max": 1200 },
        { "walk_to": "crate", "max": 900 }
      ],
      "print": ["nova.scene_now().found", "nova.named('hero').steps", "nova.named('hero').y"]
    }"#;
    let (report, _) = play(&mut starter_3d(), plan, "starter3d");
    assert_eq!(report["error"], Value::Null, "{report}");
    assert_eq!(strings(&report["warnings"]).len(), 0, "{report}");
    let route = strings(&report["route"]);
    assert_eq!(route.len(), 4, "{route:?}");
    for (i, gem) in ["gem_court", "gem_arch", "gem_path"].iter().enumerate() {
        assert!(
            route[i].contains(&format!("walk_to '{gem}': reached after")),
            "{route:?}"
        );
    }
    // the crate is solid: the walk ends against it, and that is being there
    assert!(
        route[3].contains("walk_to 'crate': stopped against it"),
        "{route:?}"
    );
    let log = log(&report);
    for n in 1..=3 {
        assert!(
            log.iter().any(|l| l.starts_with(&format!("gem {n} of 4"))),
            "{log:?}"
        );
    }
    let prints = &report["end"]["prints"];
    assert_eq!(prints[0]["value"], "3");
    let steps: f64 = prints[1]["value"].as_str().unwrap().parse().unwrap();
    assert!(steps > 20.0, "footsteps from the clips' events: {steps}");
    let sounds = report["sounds"].to_string();
    assert!(
        sounds.contains("step") && sounds.contains("pickup"),
        "{sounds}"
    );
}

/// A walk that cannot get there (a point inside the crate) says what it is against and what it tried, and the camera
/// minds the scenery without the game adding it.
#[test]
fn a_stuck_3d_walk_names_what_blocks_and_the_camera_minds_tree_crowns() {
    let plan = r#"{
      "steps": [
        { "walk_to": [1.4, -2.6], "radius": 0.2, "max": 900 }
      ]
    }"#;
    let (report, _) = play(&mut starter_3d(), plan, "stuck3d");
    let w = strings(&report["warnings"]);
    assert!(
        w.len() == 1
            && w[0].contains("gave up")
            && w[0].contains("blocked by 'crate' (model crate) at x 1.4, z -2.6")
            && w[0].contains("no way round what is solid reaches that point")
            && w[0].contains("It tried: 1 plan of a way round what is solid"),
        "{w:?}"
    );

    // Under a tree (static scenery: only its trunk blocks a body), with the camera where its crown is: the follow
    // camera's line of sight is stopped by the crown, though a body's ray along the same line is not.
    let mut g = starter_3d();
    g.update_input(1.0 / 60.0, 0.0, [960.0, 540.0], &InputFrame::default());
    g.run_lua(
        "nova.cam3.yaw = 0 local h = nova.named('hero') h.x, h.y, h.z = -8, 0, -11.5 nova.cam3.follow(h, { distance = 6, height = 2.9, look_height = 1.2, smooth = 0, collide = true })",
        "t",
    )
    .unwrap();
    let near: f64 = g.lua_text("nova.cam3.distance").unwrap().parse().unwrap();
    assert!(near < 5.0, "the camera came in front of the crown: {near}");
    assert_eq!(
        g.lua_text("nova.solid.raycast(-8, 1.2, -11.5, 0, 1.7, 6, 6.3) == nil")
            .unwrap(),
        "true",
        "a body's ray does not see the crown"
    );
    assert_eq!(
        g.lua_text("nova.solid.sightline(-8, 1.2, -11.5, 0, 1.7, 6, 6.3) ~= nil")
            .unwrap(),
        "true"
    );
    // entering the scene again does not add its solid things a second time
    let before = g.lua_text("nova.solid.count()").unwrap();
    g.start_in_scene("garden").unwrap();
    g.update_input(1.0 / 60.0, 0.1, [960.0, 540.0], &InputFrame::default());
    assert_eq!(g.lua_text("nova.solid.count()").unwrap(), before);
}

/// The racing starter (`project_create`'s "racing" template, made only with car_make, engine_make, driving_sounds_make,
/// road_make, land_make and prop3d_make) is driven a whole lap by its autopilot: the car stays on the road, the
/// six-speed box goes up through the gears, the lap is counted and timed, and the engine is heard through
/// nova.engine_sound (its bands and the tyres, wind and turbo loops start).
#[test]
fn the_racing_starter_drives_a_lap() {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/starter-racing");
    let vfs: Rc<dyn Vfs> = Rc::new(nova_runtime::vfs::DirVfs::new(&folder).unwrap());
    let mut g = Game::load(vfs).expect("the racing starter loads");
    g.upload(&mut FakeGpu);
    let plan = r#"{
      "steps": [
        { "lua": "nova.named('car').autopilot = true" },
        { "repeat": 40, "until": "nova.scene_now().laps >= 1", "steps": [
          { "wait": 30 },
          { "lua": "local c = nova.named('car') if not nova.scene_now():on_road(c.x, c.z) then nova.log('off the road at ' .. math.floor(c.x) .. ', ' .. math.floor(c.z)) end" }
        ] }
      ],
      "print": ["nova.scene_now().laps", "nova.scene_now().best", "nova.named('car').gear"]
    }"#;
    let (report, _) = play(&mut g, plan, "racing");
    assert_eq!(report["error"], Value::Null, "{report}");
    let prints = &report["end"]["prints"];
    assert_eq!(prints[0]["value"], "1", "{report}");
    let best: f64 = prints[1]["value"].as_str().unwrap().parse().unwrap();
    assert!(
        (12.0..40.0).contains(&best),
        "a lap from a standing start: {best} s"
    );
    let gear: f64 = prints[2]["value"].as_str().unwrap().parse().unwrap();
    assert!(gear >= 4.0, "up through the gears: {gear}");
    let log = log(&report);
    assert!(!log.iter().any(|l| l.contains("off the road")), "{log:?}");
    assert!(log.iter().any(|l| l.starts_with("lap 1 in")), "{log:?}");
    let sounds = report["sounds"].to_string();
    for s in [
        "eng_car_1",
        "eng_car_off_1",
        "eng_car_4",
        "tyre_road",
        "wind_loop",
        "turbo_loop",
    ] {
        assert!(sounds.contains(s), "{s} never started: {sounds}");
    }
}

/// `view` films an entity where it is seen: on the hills of `nova.terrain` the renderer lifts it by the ground under it, so
/// the view does too; the eye stays above the ground, and `from: [dx, dy, dz]`, `yaw` and `pitch` place it freely.
#[test]
fn a_view_follows_an_entity_up_the_hills_and_never_films_from_under_the_ground() {
    let mut g =
        nova_runtime::testing::load_dir("examples/starter-3d").expect("the 3D starter loads");
    let plan = r#"{ "frames": 3, "lua": "nova.terrain { waves = { { wavelength = 60, direction = 0, height = 6, phase = 1.2 } } }" }"#;
    let report = nova_runtime::testing::play(&mut g, plan).unwrap();
    assert!(report.errors().is_empty(), "{:?}", report.errors());
    let num = |g: &Game, e: &str| {
        g.lua_text(e)
            .unwrap()
            .trim_matches('"')
            .parse::<f64>()
            .unwrap()
    };
    let (hx, hy, hz) = (
        num(&g, "nova.named('hero').x"),
        num(&g, "nova.named('hero').y"),
        num(&g, "nova.named('hero').z"),
    );
    let ground = num(&g, &format!("nova.terrain_height({hx}, {hz})"));
    assert!(
        ground.abs() > 1.0,
        "the hero stands on a slope ({ground} m)"
    );
    let camera = |view: &str| {
        let plan = Plan::from_json(&format!(r#"{{ "view": {view} }}"#), "view").unwrap();
        let dir = std::env::temp_dir().join(format!("nova-view-{}", std::process::id()));
        let mut run = Playtest::new(plan, &dir).unwrap();
        let cam = run.view_camera(&g).expect("a camera beside the hero");
        let _ = std::fs::remove_dir_all(&dir);
        cam
    };
    // looks at the hero as drawn: its own y plus the ground under it
    let side = camera(r#"{ "follow": "hero", "from": "side", "distance": 4, "height": 0 }"#);
    assert!(
        (side.target.y as f64) > hy + ground && (side.target.y as f64) < hy + ground + 2.0,
        "the middle of the hero as it is seen: {} (y {hy}, ground {ground})",
        side.target.y
    );
    // never from under the ground: an eye asked for below the hill comes up above it
    let low = camera(r#"{ "follow": "hero", "from": [4, -20, 0] }"#);
    let under = num(
        &g,
        &format!("nova.terrain_height({}, {})", low.eye.x, low.eye.z),
    );
    assert!(
        (low.eye.y as f64) >= under + 0.29,
        "eye {} over ground {under}",
        low.eye.y
    );
    // a free offset, a turn round the hero and a look down
    let offset = camera(r#"{ "follow": "hero", "from": [0, 3, 5] }"#);
    assert!(
        (offset.eye.x - offset.target.x).abs() < 0.01
            && (offset.eye.z - offset.target.z - 5.0).abs() < 0.01,
        "{:?} {:?}",
        offset.eye,
        offset.target
    );
    let turned = camera(r#"{ "follow": "hero", "from": "side", "yaw": 90, "height": 0 }"#);
    assert!(
        turned.eye.z < turned.target.z - 3.0 && (turned.eye.x - turned.target.x).abs() < 0.1,
        "90 takes side (+x) to back (-z): {:?} {:?}",
        turned.eye,
        turned.target
    );
    let down = camera(r#"{ "follow": "hero", "from": "side", "pitch": 60, "height": 0 }"#);
    assert!(
        down.eye.y - down.target.y > 3.0,
        "60 degrees above: {:?} {:?}",
        down.eye,
        down.target
    );
    let bad = Playtest::new(
        Plan::from_json(r#"{ "view": { "follow": "hero", "from": "under" } }"#, "v").unwrap(),
        &std::env::temp_dir(),
    );
    assert!(bad.err().unwrap().contains("or [dx, dy, dz]"));
}

/// What was drawn: `nova.testing.drawn` in a route's `print`, and the harness's report, list the frame's draw calls with
/// their names or words, so a test can say "this text is on the screen" or "the map is not drawn" without flags in the game.
#[test]
fn a_run_says_what_the_last_frame_drew() {
    let mut g = nova_runtime::testing::load_files(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        (
            "main.lua",
            b"function draw() nova.ui.rect(10, 20, 100, 40, {0,0,0}) nova.ui.text(30, 30, 'LAP 2/3') if nova.time() > 100 then nova.ui.text(0, 0, 'MAP') end end"
                .to_vec(),
        ),
    ])
    .unwrap();
    let report = nova_runtime::testing::play(
        &mut g,
        r#"{ "frames": 5, "print": ["nova.testing.drawn_count('ui_text', 'LAP')", "nova.testing.drawn('ui_text')[1].name", "nova.testing.drawn_count('ui')"] }"#,
    )
    .unwrap();
    assert_eq!(
        report
            .printed("nova.testing.drawn_count('ui_text', 'LAP')")
            .as_deref(),
        Some("1")
    );
    assert_eq!(
        report
            .printed("nova.testing.drawn('ui_text')[1].name")
            .as_deref(),
        Some("LAP 2/3")
    );
    assert_eq!(
        report.printed("nova.testing.drawn_count('ui')").as_deref(),
        Some("2")
    );
    assert_eq!(
        report.drawn_count("ui_text", Some("MAP")),
        0,
        "the map is not drawn"
    );
    let lap = &report.drawn("ui_text", Some("LAP"))[0];
    assert_eq!(
        (lap["x"].as_f64(), lap["y"].as_f64()),
        (Some(30.0), Some(30.0))
    );
    assert_eq!(report.drawn("ui_rect", None)[0]["w"].as_f64(), Some(100.0));
    assert_eq!(report.json["drawn"]["ui_text"], 1);
    // outside a run (nothing asked to keep them) it says so instead of a count of 0
    let mut g2 = nova_runtime::testing::load_files(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", b"function draw() end".to_vec()),
    ])
    .unwrap();
    g2.update_input(1.0 / 60.0, 0.0, [960.0, 540.0], &InputFrame::default());
    assert!(
        g2.lua_text("nova.testing.drawn_count('ui_text')")
            .unwrap_err()
            .contains("only in a play run")
    );
}

/// A route file written for the `play` tool runs in a test as it is, every key honoured (`route`, `always`, `record`),
/// the tool's own keys about pictures left out with a note.
#[test]
fn a_play_tool_route_file_runs_whole_in_the_test_harness() {
    let mut g = game();
    let report = nova_runtime::testing::play(
        &mut g,
        r#"{ "start_scene": "arena", "size": "1280x720", "crop_to": "hero",
             "route": [ { "hold": ["move_x=1"], "frames": 20, "record": "math.floor(nova.named('hero').x)" } ],
             "always": "nova.named('hero').hp == 3", "record": "nova.named('hero').hp" }"#,
    )
    .unwrap();
    assert!(
        report
            .notes()
            .iter()
            .any(|n| n.contains("held after every one of")),
        "{:?}",
        report.notes()
    );
    assert!(
        report.notes().iter().any(|n| n.contains("left out size")),
        "{:?}",
        report.notes()
    );
    let hp = report.record("nova.named('hero').hp");
    assert_eq!(hp.len(), 1, "one value all along: {hp:?}");
    assert_eq!(hp[0].2, "3");
    assert!(report.record("math.floor(nova.named('hero').x)").len() > 5);
}

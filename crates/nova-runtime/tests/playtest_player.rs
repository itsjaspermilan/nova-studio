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

fn play(game: &mut Game, plan: &str, name: &str) -> (Value, Vec<(u32, String)>) {
    let dir = std::env::temp_dir().join(format!("nova-player-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
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
            .any(|n| n.contains("invincible: 'hero' had hp 3 put back")),
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
    assert!(route[2].contains("it is gone now"), "{route:?}");
    assert!(report["render"].is_null());
    assert_eq!(report["end"]["render"]["three_d"], false);
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

//! Keyframe animations (`animations/*.anim.json`, `nova.play_anim`) played through a real `Game`
//! with in-memory projects, in the framework's 60 Hz steps. Lua reports through `nova.log`.

use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::input::Actions;
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{MemVfs, Vfs};

struct FakeGpu;
impl Uploader for FakeGpu {
    fn set_atlas(&mut self, _: &Image) {}
    fn add_mesh(&mut self, _: &MeshData) -> usize {
        0
    }
}

fn load(files: &[(&str, &str)]) -> Result<Game, String> {
    let mut all = vec![("nova.json", br#"{"format":1,"name":"T"}"#.to_vec())];
    all.extend(files.iter().map(|(p, s)| (*p, s.as_bytes().to_vec())));
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut game = Game::load(vfs)?;
    game.upload(&mut FakeGpu);
    Ok(game)
}

fn project(files: &[(&str, &str)]) -> Game {
    load(files).expect("project loads")
}

fn steps(game: &mut Game, n: usize) {
    for i in 0..n {
        game.update(
            1.0 / 60.0,
            i as f64 / 60.0,
            [960.0, 540.0],
            Actions::default(),
            false,
        );
        assert!(game.error.is_none(), "lua error: {:?}", game.error);
    }
}

const SLIDE: &str = r#"{
  "version": 1, "length": 1,
  "tracks": [
    { "field": "x", "keys": [ { "time": 0, "value": 0 }, { "time": 1, "value": 60 } ] },
    { "field": "y", "keys": [ { "time": 0, "value": 5, "ease": "step" }, { "time": 0.5, "value": 9 } ] },
    { "field": "tint", "keys": [ { "time": 0, "value": [0, 100, 200] }, { "time": 1, "value": [100, 100, 0] } ] },
    { "type": "event", "keys": [ { "time": 0, "call": "ping", "args": ["start"] }, { "time": 0.5, "call": "ping", "args": ["half", 2] } ] }
  ]
}"#;

const BOX: &str = "local B = nova.entity { tags = {'box'} }\nfunction B:ping(what, n) nova.log('ping ' .. what .. ' ' .. tostring(n) .. ' x=' .. string.format('%.1f', self.x)) end\nreturn B";

#[test]
fn values_move_events_fire_and_on_finish_runs_once() {
    let mut g = project(&[
        ("animations/slide.anim.json", SLIDE),
        ("entities/box.lua", BOX),
        (
            "scenes/main.lua",
            r#"local S = nova.scene {}
function S:enter()
  self.b = nova.spawn('box', 100, 100)
  self.p = self.b:play_anim('slide', { on_finish = function(t, p) nova.log('done ' .. tostring(t == self.b) .. ' ' .. tostring(p:finished())) end })
  nova.log(string.format('start x=%.1f y=%.1f', self.b.x, self.b.y))
end
local n = 0
function S:update()
  n = n + 1
  if n == 15 or n == 30 or n == 31 or n == 60 or n == 61 then
    local b = self.b
    nova.log(string.format('%d x=%.2f y=%.1f tint=%.0f,%.0f,%.0f playing=%s', n, b.x, b.y, b.tint[1], b.tint[2], b.tint[3], tostring(self.p:playing())))
  end
end
return S"#,
        ),
        ("main.lua", "nova.start('main')"),
    ]);
    steps(&mut g, 70);
    let log = g.take_log();
    assert_eq!(
        log,
        vec![
            "ping start nil x=0.0",
            "start x=0.0 y=5.0",
            "15 x=15.00 y=5.0 tint=25,100,150 playing=true",
            "ping half 2 x=30.0",
            "30 x=30.00 y=9.0 tint=50,100,100 playing=true",
            "31 x=31.00 y=9.0 tint=52,100,97 playing=true",
            "done true true",
            "60 x=60.00 y=9.0 tint=100,100,0 playing=false",
            "61 x=60.00 y=9.0 tint=100,100,0 playing=false",
        ],
        "{log:#?}"
    );
}

#[test]
fn loops_fire_their_events_every_time_round_and_play_backwards() {
    let file = r#"{ "version": 1, "length": 0.5, "loop": true, "tracks": [
      { "field": "x", "keys": [ { "time": 0, "value": 0 }, { "time": 0.5, "value": 30 } ] },
      { "type": "event", "keys": [ { "time": 0, "call": "ping", "args": ["top"] }, { "time": 0.25, "call": "ping", "args": ["mid"] } ] } ] }"#;
    let mut g = project(&[
        ("animations/spin.anim.json", file),
        ("entities/box.lua", BOX),
        (
            "scenes/main.lua",
            r#"local S = nova.scene {}
function S:enter() self.b = nova.spawn('box') self.p = self.b:play_anim('spin') end
local n = 0
function S:update()
  n = n + 1
  if n == 75 then self.p.speed = -1 nova.log('reverse') end
  if n == 90 then nova.log(string.format('x=%.1f', self.b.x)) self.p:stop() end
end
return S"#,
        ),
        ("main.lua", "nova.start('main')"),
    ]);
    steps(&mut g, 100);
    let log = g.take_log();
    let tops = log.iter().filter(|l| l.starts_with("ping top")).count();
    let mids = log.iter().filter(|l| l.starts_with("ping mid")).count();
    // forward for 75 steps (1.25 s: rounds start at 0, 0.5, 1.0), then backward for 15 (0.25 s, from t=0.25 down to 0)
    assert_eq!(tops, 4, "{log:#?}");
    assert_eq!(mids, 3, "{log:#?}");
    assert!(log.contains(&"x=0.0".to_string()), "{log:#?}");
    assert_eq!(log.last().map(String::as_str), Some("x=0.0"));
}

#[test]
fn pause_resume_seek_and_several_at_once() {
    let a = r#"{ "version": 1, "length": 1, "tracks": [ { "field": "x", "keys": [ { "time": 0, "value": 0 }, { "time": 1, "value": 60 } ] } ] }"#;
    let b = r#"{ "version": 1, "length": 2, "tracks": [ { "field": "alpha", "keys": [ { "time": 0, "value": 1 }, { "time": 2, "value": 0 } ] },
       { "type": "event", "keys": [ { "time": 1.5, "call": "ping" } ] } ] }"#;
    let mut g = project(&[
        ("animations/a.anim.json", a),
        ("animations/b.anim.json", b),
        ("entities/box.lua", BOX),
        (
            "scenes/main.lua",
            r#"local S = nova.scene {}
function S:enter()
  self.b = nova.spawn('box')
  self.pa = self.b:play_anim('a')
  self.pb = self.b:play_anim('b')
end
local n = 0
function S:update()
  n = n + 1
  local b = self.b
  if n == 10 then self.pa:pause() end
  if n == 40 then nova.log(string.format('paused x=%.1f alpha=%.3f count=%d', b.x, b.alpha, nova.anims_playing())) self.pa:resume() end
  if n == 41 then nova.log(string.format('resumed x=%.1f', b.x)) self.pb:seek(1.9) nova.log(string.format('seek alpha=%.3f', b.alpha)) end
  if n == 50 then self.pa:seek(0.25) nova.log(string.format('seek x=%.1f', b.x)) end
end
return S"#,
        ),
        ("main.lua", "nova.start('main')"),
    ]);
    steps(&mut g, 60);
    let log = g.take_log();
    assert_eq!(
        log,
        vec![
            "paused x=10.0 alpha=0.667 count=2",
            "resumed x=11.0",
            "seek alpha=0.050",
            "seek x=15.0",
        ],
        "a seek past an event key does not fire it: {log:#?}"
    );
}

#[test]
fn targets_scene_objects_the_scene_the_camera_and_relative_tracks() {
    let file = r#"{ "version": 1, "length": 1, "tracks": [
      { "target": "door", "field": "y", "relative": true, "keys": [ { "time": 0, "value": 0, "ease": "in_quad" }, { "time": 1, "value": -40 } ] },
      { "target": "scene", "field": "hud.slide", "keys": [ { "time": 0, "value": -300, "ease": [0.25, 0.1, 0.25, 1] }, { "time": 1, "value": 0 } ] },
      { "target": "camera", "field": "x", "keys": [ { "time": 0, "value": 100 }, { "time": 1, "value": 200 } ] },
      { "target": "camera", "field": "fov", "keys": [ { "time": 0, "value": 40 }, { "time": 1, "value": 80 } ] },
      { "target": "lamp", "field": "alpha", "keys": [ { "time": 0, "value": 0.5 } ] },
      { "type": "event", "target": "scene", "keys": [ { "time": 1, "call": "opened" } ] }
    ] }"#;
    let mut g = project(&[
        ("animations/open.anim.json", file),
        ("entities/box.lua", BOX),
        (
            "entities/lamp.lua",
            "return nova.entity { tags = {'lamp'} }",
        ),
        (
            "scenes/main.scene.json",
            r#"{ "version": 1, "objects": [ { "kind": "box", "name": "door", "x": 50, "y": 300 } ] }"#,
        ),
        (
            "scenes/main.lua",
            r#"local S = nova.scene {}
function S:enter()
  self.lamp = nil
  nova.spawn('lamp')
  self.p = nova.play_anim('open', { target = self })
end
function S:opened() nova.log(string.format('opened door.y=%.1f slide=%.1f cam=%.1f lamp=%.1f', self.door.y, self.hud.slide, select(1, nova.cam.position()), nova.first('lamp').alpha)) end
local n = 0
function S:update()
  n = n + 1
  if n == 30 then nova.log(string.format('half door.y=%.1f slide=%.2f cam=%.1f', self.door.y, self.hud.slide, select(1, nova.cam.position()))) end
end
return S"#,
        ),
        ("main.lua", "nova.start('main')"),
    ]);
    steps(&mut g, 70);
    let log = g.take_log();
    // in_quad at half way is a quarter of the way; the curve (CSS "ease") is about 0.80 of the way at half time
    assert_eq!(
        log[0], "half door.y=290.0 slide=-59.28 cam=150.0",
        "{log:#?}"
    );
    assert_eq!(
        log[1], "opened door.y=260.0 slide=0.0 cam=200.0 lamp=0.5",
        "{log:#?}"
    );
}

#[test]
fn pause_holds_an_entitys_animation_but_not_the_scenes() {
    let file = r#"{ "version": 1, "length": 1, "tracks": [ { "field": "x", "keys": [ { "time": 0, "value": 0 }, { "time": 1, "value": 60 } ] } ] }"#;
    let mut g = project(&[
        ("animations/a.anim.json", file),
        ("entities/box.lua", BOX),
        (
            "scenes/main.lua",
            r#"local S = nova.scene {}
function S:enter()
  self.b = nova.spawn('box')
  self.x = 0
  self.b:play_anim('a')
  self:play_anim('a')
  nova.pause(true)
end
local n = 0
function S:update()
  n = n + 1
  if n == 30 then nova.log(string.format('box=%.1f scene=%.1f', self.b.x, self.x)) end
end
return S"#,
        ),
        ("main.lua", "nova.start('main')"),
    ]);
    steps(&mut g, 31);
    assert_eq!(g.take_log(), vec!["box=0.0 scene=30.0"]);
}

#[test]
fn replaying_on_the_same_target_replaces_and_destroying_the_target_stops_it() {
    let file = r#"{ "version": 1, "length": 1, "tracks": [ { "field": "x", "keys": [ { "time": 0, "value": 0 }, { "time": 1, "value": 60 } ] },
      { "type": "event", "keys": [ { "time": 1, "call": "ping", "args": ["end"] } ] } ] }"#;
    let mut g = project(&[
        ("animations/a.anim.json", file),
        ("entities/box.lua", BOX),
        (
            "scenes/main.lua",
            r#"local S = nova.scene {}
function S:enter()
  self.b = nova.spawn('box')
  self.c = nova.spawn('box')
  self.b:play_anim('a')
  self.c:play_anim('a')
end
local n = 0
function S:update()
  n = n + 1
  if n == 20 then self.b:play_anim('a', { from = 0.5 }) nova.log('count ' .. nova.anims_playing()) end
  if n == 30 then self.c:destroy() end
  if n == 31 then nova.log('count ' .. nova.anims_playing()) end
end
return S"#,
        ),
        ("main.lua", "nova.start('main')"),
    ]);
    steps(&mut g, 80);
    let log = g.take_log();
    assert_eq!(
        log,
        vec!["count 2", "count 1", "ping end nil x=60.0"],
        "{log:#?}"
    );
}

#[test]
fn mistakes_are_explained() {
    // a broken file stops the project at load, naming the file and the place
    let e = match load(&[
        (
            "animations/bad.anim.json",
            r#"{ "version": 1, "length": 1, "tracks": [ { "field": "x", "keys": [ { "time": 3, "value": 0 } ] } ] }"#,
        ),
        ("main.lua", ""),
    ]) {
        Err(e) => e,
        Ok(_) => panic!("a broken animation file should stop the project"),
    };
    assert!(e.starts_with("animations/bad.anim.json"), "{e}");

    for (lua, want) in [
        ("nova.play_anim('missing')", "no animation 'missing'"),
        (
            "nova.play_anim('a', { target = {} })",
            "nothing called 'door'",
        ),
        (
            "nova.play_anim('b', { target = {} })",
            "has no function 'ring'",
        ),
        ("nova.play_anim('c')", "unknown sound 'creak'"),
    ] {
        let mut g = project(&[
            (
                "animations/a.anim.json",
                r#"{ "version": 1, "length": 1, "tracks": [ { "target": "door", "field": "x", "keys": [] } ] }"#,
            ),
            (
                "animations/b.anim.json",
                r#"{ "version": 1, "length": 1, "tracks": [ { "type": "event", "keys": [ { "time": 0, "call": "ring" } ] } ] }"#,
            ),
            (
                "animations/c.anim.json",
                r#"{ "version": 1, "length": 1, "tracks": [ { "type": "sound", "keys": [ { "time": 0, "sound": "creak" } ] } ] }"#,
            ),
            (
                "scenes/main.lua",
                &format!("local S = nova.scene {{}}\nfunction S:enter() {lua} end\nreturn S"),
            ),
            ("main.lua", "nova.start('main')"),
        ]);
        g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
        let err = g.error.clone().unwrap_or_default();
        assert!(err.contains(want), "{lua}: wanted {want:?} in {err:?}");
    }
}

#[test]
fn the_same_run_gives_the_same_numbers() {
    let file = r#"{ "version": 1, "length": 0.7, "loop": true, "tracks": [
      { "field": "x", "keys": [ { "time": 0, "value": 0, "ease": "out_elastic" }, { "time": 0.35, "value": 100, "ease": "in_out_back" }, { "time": 0.7, "value": 0 } ] } ] }"#;
    let run = || {
        let mut g = project(&[
            ("animations/w.anim.json", file),
            ("entities/box.lua", BOX),
            (
                "scenes/main.lua",
                "local S = nova.scene {}\nfunction S:enter() self.b = nova.spawn('box') self.b:play_anim('w', { speed = 1.3 }) end\nfunction S:update() nova.log(string.format('%.6f', self.b.x)) end\nreturn S",
            ),
            ("main.lua", "nova.start('main')"),
        ]);
        steps(&mut g, 200);
        g.take_log()
    };
    let a = run();
    assert_eq!(a.len(), 200);
    assert_eq!(a, run());
}

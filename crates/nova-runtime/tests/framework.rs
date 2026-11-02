//! The Lua framework (entities, scenes, timers, collisions, camera) driven through a real
//! `Game`, using in-memory projects. Lua reports what happened through `nova.log`.

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

fn project(files: Vec<(&str, Vec<u8>)>) -> Game {
    let mut all = vec![("nova.json", br#"{"format":1,"name":"T"}"#.to_vec())];
    all.extend(files);
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut game = Game::load(vfs).expect("project loads");
    game.upload(&mut FakeGpu);
    game
}

fn lua(source: &str) -> Vec<u8> {
    source.as_bytes().to_vec()
}

/// Advances `frames` frames of `dt` seconds each.
fn run(game: &mut Game, frames: usize, dt: f32) {
    for i in 0..frames {
        game.update(
            dt,
            i as f64 * dt as f64,
            [960.0, 540.0],
            Actions::default(),
            false,
        );
    }
}

fn steps(game: &mut Game, n: usize) {
    run(game, n, 1.0 / 60.0);
}

fn logs(game: &Game) -> Vec<String> {
    game.take_log()
}

#[test]
fn spawn_applies_defaults_props_tags_and_integrates_velocity() {
    let mut g = project(vec![
        (
            "entities/ball.lua",
            lua(
                "local B = nova.entity { tags = {'ball'}, hp = 3, bag = {}, vx = 60 }\nfunction B:create() self.born = true end\nreturn B",
            ),
        ),
        (
            "scenes/main.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  local a = nova.spawn('ball', 10, 20, { hp = 9 })\n  local b = nova.spawn('ball', 0, 0)\n  a.bag[1] = 'x'\n  nova.log(string.format('%d %d %s %d %d %s %s', a.hp, b.hp, tostring(a.born), nova.count('ball'), #b.bag, tostring(a.bag ~= b.bag), tostring(nova.first('ball') == a)))\n  self.a = a\nend\nfunction S:update(dt) if not self.logged then self.logged = true end end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('main')")),
    ]);
    steps(&mut g, 60);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    assert_eq!(l[0], "9 3 true 2 0 true true", "{l:?}");
}

#[test]
fn velocity_moves_entities_by_whole_steps_regardless_of_frame_rate() {
    let mut g = project(vec![
        (
            "entities/mover.lua",
            lua("local M = nova.entity { tags = {'m'}, vx = 60 }\nreturn M"),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() self.m = nova.spawn('mover', 0, 0) end\nfunction S:update(dt) nova.log(string.format('%.4f', self.m.x)) end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    // 30 fps frames: each frame runs two 1/60 steps. After 30 frames = 60 steps = 1 second = 60 units.
    run(&mut g, 30, 1.0 / 30.0);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    assert_eq!(l.len(), 60, "one scene update per fixed step");
    assert_eq!(l.last().unwrap(), "60.0000");
}

#[test]
fn a_long_hitch_catches_up_at_most_five_steps() {
    let mut g = project(vec![
        (
            "scenes/s.lua",
            lua("local S = nova.scene {}\nfunction S:update(dt) nova.log('step') end\nreturn S"),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    run(&mut g, 1, 0.1); // the host caps frames at 0.1 s; six steps' worth, only five run
    assert_eq!(logs(&g).len(), 5);
}

#[test]
fn destroy_removes_entities_counts_tags_and_calls_on_destroy_once() {
    let mut g = project(vec![
        (
            "entities/e.lua",
            lua(
                "local E = nova.entity { tags = {'e'} }\nfunction E:on_destroy() nova.log('bye') end\nreturn E",
            ),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  local a, b = nova.spawn('e', 0, 0), nova.spawn('e', 5, 5)\n  a:destroy() a:destroy()\n  nova.log(nova.count('e') .. ' ' .. #nova.all('e') .. ' ' .. tostring(a:is_alive()) .. ' ' .. tostring(b:is_alive()))\nend\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 3);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(logs(&g), ["bye", "1 1 false true"]);
}

#[test]
fn collisions_call_handlers_for_boxes_circles_and_default_sprite_boxes() {
    let mut g = project(vec![
        ("sprites/box.png", png(10, 10)),
        (
            "entities/player.lua",
            lua(
                "local P = nova.entity { sprite = 'box', tags = {'player'} }\nfunction P:on_collide_coin(c) nova.log('coin ' .. c.id) c:destroy() end\nfunction P:on_collide_wall(w) nova.log('wall') end\nreturn P",
            ),
        ),
        (
            "entities/coin.lua",
            lua("return nova.entity { hitbox = { r = 4 }, tags = {'coin'} }"),
        ),
        (
            "entities/wall.lua",
            lua("return nova.entity { hitbox = { -5, -5, 10, 10 }, tags = {'wall'} }"),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  nova.spawn('player', 100, 100)\n  nova.spawn('coin', 108, 100)   -- circle r4 at x=108 vs box 95..105: gap of 3 < 4, touches\n  nova.spawn('coin', 130, 100)   -- far away\n  nova.spawn('wall', 200, 100)   -- far away\nend\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 4);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    assert_eq!(
        l.len(),
        1,
        "the near coin is collected once (then destroyed), nothing else touches: {l:?}"
    );
    assert!(l[0].starts_with("coin "));
}

#[test]
fn destroying_inside_a_handler_stops_further_handlers_for_that_entity() {
    let mut g = project(vec![
        ("sprites/box.png", png(10, 10)),
        (
            "entities/a.lua",
            lua(
                "local A = nova.entity { sprite = 'box', tags = {'a'} }\nfunction A:on_collide_b(b) nova.log('hit') self:destroy() end\nreturn A",
            ),
        ),
        (
            "entities/b.lua",
            lua("return nova.entity { sprite = 'box', tags = {'b'} }"),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() nova.spawn('a', 0, 0) nova.spawn('b', 1, 1) nova.spawn('b', 2, 2) end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 3);
    assert_eq!(
        logs(&g),
        ["hit"],
        "A dies on the first hit and is not called for the second B"
    );
}

#[test]
fn timers_after_every_go_and_tween_run_in_game_time_and_die_with_their_owner() {
    let mut g = project(vec![
        ("entities/t.lua", lua("return nova.entity { tags = {'t'} }")),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  local e = nova.spawn('t', 0, 0)\n  self.e = e\n  e:after(0.5, function() nova.log('after') end)\n  e:every(0.25, function() nova.log('every') end)\n  e:go(function() nova.wait(0.3) nova.log('go1') nova.wait(0.3) nova.log('go2') end)\n  e:tween({ x = 100 }, 1.0, 'linear', function() nova.log('tween done') end)\n  local doomed = nova.spawn('t', 0, 0)\n  doomed:after(0.1, function() nova.log('should not run') end)\n  doomed:destroy()\nend\nfunction S:update(dt) if self.e.x >= 49.9 and not self.half then self.half = true nova.log('half ' .. math.floor(self.e.x + 0.5)) end end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 70); // a little over one second
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    assert!(!l.contains(&"should not run".to_string()), "{l:?}");
    assert_eq!(
        l.iter().filter(|s| *s == "every").count(),
        4,
        "0.25, 0.5, 0.75, 1.0: {l:?}"
    );
    assert_eq!(l.iter().filter(|s| *s == "after").count(), 1);
    let pos = |name: &str| {
        l.iter()
            .position(|s| s == name)
            .unwrap_or_else(|| panic!("{name} missing in {l:?}"))
    };
    assert!(pos("go1") < pos("go2"));
    assert!(l.contains(&"half 50".to_string()), "{l:?}");
    assert!(l.contains(&"tween done".to_string()));
}

#[test]
fn bad_tween_and_timer_arguments_raise_clear_errors() {
    for (call, expected) in [
        ("e:tween({ x = 1 }, 1, 'wobble')", "unknown easing 'wobble'"),
        (
            "e:every(0, function() end)",
            "interval must be greater than 0",
        ),
    ] {
        let source = format!(
            "local S = nova.scene {{}}\nfunction S:enter() local e = nova.spawn('t', 0, 0) {call} end\nreturn S"
        );
        let mut g = project(vec![
            ("entities/t.lua", lua("return nova.entity {}")),
            ("scenes/s.lua", lua(&source)),
            ("main.lua", lua("nova.start('s')")),
        ]);
        steps(&mut g, 2);
        let e = g.error.clone().expect("error");
        assert!(e.contains(expected), "{call}: {e}");
    }
}

#[test]
fn scene_files_spawn_named_objects_images_and_texts_and_pass_enter_arguments() {
    let mut g = project(vec![
        ("sprites/sky.png", png(8, 8)),
        (
            "entities/crate.lua",
            lua("return nova.entity { tags = {'crate'}, weight = 1 }"),
        ),
        (
            "scenes/play.scene.json",
            lua(
                r#"{"version":1,"background":[10,20,30],"width":2000,"height":540,
                    "objects":[{"kind":"crate","name":"first","x":5,"y":6,"props":{"weight":7}},{"kind":"crate","x":9,"y":9}],
                    "images":[{"image":"sprites/sky.png","name":"sky","x":1,"y":2,"scale":3,"layer":"ui"}],
                    "texts":[{"text":"HI","name":"label","x":4,"y":4}]}"#,
            ),
        ),
        (
            "scenes/play.lua",
            lua(
                "local P = nova.scene {}\nfunction P:enter(level, flag)\n  nova.log(string.format('%s %s %d %d %d %d %s %s %s', tostring(level), tostring(flag), self.first.x, self.first.y, self.first.weight, nova.count('crate'), self.sky.image, self.label.text, tostring(self.sky.screen)))\nend\nreturn P",
            ),
        ),
        (
            "scenes/start.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() nova.goto_scene('play', 'lvl1', true) end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('start')")),
    ]);
    steps(&mut g, 3);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(logs(&g), ["lvl1 true 5 6 7 2 sprites/sky.png HI true"]);
}

#[test]
fn changing_scenes_destroys_entities_cancels_timers_and_calls_leave() {
    let mut g = project(vec![
        ("entities/e.lua", lua("return nova.entity { tags = {'e'} }")),
        (
            "scenes/a.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  nova.spawn('e', 0, 0) nova.spawn('e', 0, 0)\n  self:after(0.05, function() nova.log('a timer') end)\n  self:after(0.5, function() nova.log('stale timer') end)\n  self:after(0.1, function() nova.goto_scene('b') end)\nend\nfunction S:leave() nova.log('leave a') end\nreturn S",
            ),
        ),
        (
            "scenes/b.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() nova.log('enter b ' .. nova.count('e') .. ' ' .. nova.current_scene()) end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('a')")),
    ]);
    steps(&mut g, 60);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(logs(&g), ["a timer", "leave a", "enter b 0 b"]);
}

#[test]
fn restart_scene_rebuilds_from_the_file() {
    let mut g = project(vec![
        ("entities/e.lua", lua("return nova.entity { tags = {'e'} }")),
        (
            "scenes/s.scene.json",
            lua(r#"{"version":1,"objects":[{"kind":"e"},{"kind":"e"}]}"#),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() nova.log('enter ' .. nova.count('e')) nova.spawn('e', 0, 0) if not nova.restarted then nova.restarted = true self:after(0.05, nova.restart_scene) end end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 20);
    assert_eq!(
        logs(&g),
        ["enter 2", "enter 2"],
        "the extra spawn did not survive the restart"
    );
}

#[test]
fn scene_file_errors_and_reserved_names_surface_as_clear_errors() {
    let broken = |scene_json: &str| {
        let mut g = project(vec![
            ("entities/e.lua", lua("return nova.entity {}")),
            ("scenes/s.scene.json", lua(scene_json)),
            ("scenes/s.lua", lua("return nova.scene {}")),
            ("main.lua", lua("nova.start('s')")),
        ]);
        steps(&mut g, 2);
        g.error.clone().expect("an error is shown")
    };
    assert!(
        broken(r#"{"version":1,"objects":[{"x":1}]}"#)
            .contains("scenes/s.scene.json.objects[0]: missing \"kind\"")
    );
    assert!(broken(r#"{"version":9}"#).contains("unsupported \"version\" 9"));
    assert!(
        broken(r#"{"version":1,"objects":[{"kind":"e","name":"update"}]}"#)
            .contains("'update' is the name of something every scene already has")
    );
    assert!(
        broken(r#"{"version":1,"objects":[{"kind":"ghost"}]}"#).contains("entities/ghost"),
        "unknown kinds point at the file"
    );
}

#[test]
fn entity_files_that_forget_to_return_a_class_are_explained() {
    let mut g = project(vec![
        ("entities/e.lua", lua("local E = nova.entity {}")),
        (
            "scenes/s.lua",
            lua("local S = nova.scene {}\nfunction S:enter() nova.spawn('e', 0, 0) end\nreturn S"),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 2);
    let e = g.error.clone().expect("error");
    assert!(
        e.contains("must end with 'return <the entity class>'"),
        "{e}"
    );
}

#[test]
fn inheritance_shares_methods_defaults_tags_and_collision_handlers() {
    let mut g = project(vec![
        ("sprites/box.png", png(10, 10)),
        (
            "entities/enemy.lua",
            lua(
                "local E = nova.entity { sprite = 'box', tags = {'enemy'}, hp = 10 }\nfunction E:hurt(n) self.hp = self.hp - n end\nfunction E:on_collide_shot(s) self:hurt(s.damage) s:destroy() end\nreturn E",
            ),
        ),
        (
            "entities/boss.lua",
            lua(
                "local Boss = nova.entity(require('entities.enemy'), { hp = 50, tags = {'boss'} })\nfunction Boss:hurt(n) self.hp = self.hp - n / 2 end\nreturn Boss",
            ),
        ),
        (
            "entities/shot.lua",
            lua("return nova.entity { sprite = 'box', tags = {'shot'}, damage = 8 }"),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  self.boss = nova.spawn('boss', 0, 0)\n  nova.spawn('shot', 1, 1)\nend\nfunction S:update(dt) if nova.count('shot') == 0 and not self.done then self.done = true nova.log(self.boss.hp .. ' ' .. nova.count('enemy') .. ' ' .. nova.count('boss')) end end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 3);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(
        logs(&g),
        ["46.0 1 1"],
        "boss overrides hurt (8/2), inherits the handler and both tags"
    );
}

#[test]
fn camera_follow_and_limit_offset_world_sprites_but_not_ui() {
    let mut g = project(vec![
        ("sprites/dot.png", png(4, 4)),
        (
            "entities/hero.lua",
            lua("return nova.entity { sprite = 'dot', vx = 0 }"),
        ),
        (
            "entities/hud.lua",
            lua("return nova.entity { sprite = 'dot', screen = true }"),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  self.hero = nova.spawn('hero', 1000, 300)\n  nova.spawn('hud', 50, 60)\n  nova.cam.limit(0, 0, 1200, 600)\n  nova.cam.follow(self.hero)\nend\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 3);
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(540);
    // View is 960x540: the camera centre clamps to x = 1200 - 480 = 720, y = 300 (limit height 600 > 540).
    // The hero (1000, 300) therefore draws at (1000 - 240, 300 - 30) = (760, 270).
    let hero = input.sprites_back.last().expect("hero sprite");
    assert_eq!(hero.center, [760.0, 270.0]);
    let hud = input
        .sprites_front
        .iter()
        .find(|s| s.center == [50.0, 60.0]);
    assert!(hud.is_some(), "UI entities ignore the camera");
}

#[test]
fn drawing_is_ordered_by_depth_with_bigger_depth_further_back() {
    let mut g = project(vec![
        ("sprites/dot.png", png(4, 4)),
        (
            "entities/far.lua",
            lua("return nova.entity { sprite = 'dot', depth = 10 }"),
        ),
        (
            "entities/near.lua",
            lua("return nova.entity { sprite = 'dot', depth = -5 }"),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() nova.spawn('near', 1, 1) nova.spawn('far', 2, 2) nova.spawn('near', 3, 3) end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 2);
    let xs: Vec<f32> = g
        .frame_input(540)
        .sprites_back
        .iter()
        .map(|s| s.center[0])
        .collect();
    // Camera centre starts at the view centre (480, 270), so screen x equals world x.
    assert_eq!(
        xs,
        [2.0, 1.0, 3.0],
        "far first, then the near ones in creation order"
    );
}

#[test]
fn pause_freezes_entities_but_not_the_scene_and_input_still_reaches_it() {
    let mut g = project(vec![
        ("entities/c.lua", lua("return nova.entity { vx = 60 }")),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() self.c = nova.spawn('c', 0, 0) nova.pause(true) end\nfunction S:update(dt) self.n = (self.n or 0) + 1 if self.n == 30 then nova.log(string.format('%.1f %d', self.c.x, self.n)) end end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 40);
    assert_eq!(logs(&g), ["0.0 30"]);
}

// ---------------------------------------------------------------- sprite sheets

const SHEET: &str = r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"frame_duration_ms":100,
    "tags":[{"name":"idle","from":0,"to":3,"direction":"pingpong"},
            {"name":"run","from":2,"to":5},
            {"name":"hit","from":6,"to":7,"loop":false}]}"#;

fn sheet_files() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("sprites/sheet.png", png(128, 64)),
        ("sprites/sheet.png", png(128, 64)),
        ("sprites/hero.sprite.json", lua(SHEET)),
    ]
}

fn with_sheet(mut files: Vec<(&'static str, Vec<u8>)>) -> Game {
    let mut all = sheet_files();
    all.dedup_by(|a, b| a.0 == b.0);
    all.append(&mut files);
    project(all)
}

#[test]
fn a_sheet_draws_one_frame_at_frame_size() {
    let mut g = with_sheet(vec![(
        "main.lua",
        lua(
            "function update(dt)\n nova.sprite('hero', 10, 10, { frame = 0 })\n nova.sprite('hero', 10, 10, { frame = 5 })\n nova.sprite('sheet', 10, 10)\n end",
        ),
    )]);
    steps(&mut g, 1);
    assert!(g.error.is_none(), "{:?}", g.error);
    let sprites = g.frame_input(540).sprites_back;
    assert_eq!(sprites.len(), 3);
    assert_eq!(
        sprites[0].size,
        [32.0, 32.0],
        "the frame, not the whole sheet"
    );
    let (a, b) = (sprites[0].uv, sprites[1].uv);
    assert!(
        b[0] > a[0] && b[1] > a[1],
        "frame 5 is one column right and one row down of frame 0"
    );
    assert!(
        ((b[0] - a[0]) - (b[1] - a[1])).abs() < 1e-6,
        "square frames in a square atlas"
    );
    assert_eq!(
        sprites[2].size,
        [128.0, 64.0],
        "the plain image is still the whole sheet"
    );
}

#[test]
fn tags_play_with_directions_durations_and_end_callbacks() {
    let mut g = with_sheet(vec![
        (
            "entities/h.lua",
            lua(
                "local H = nova.entity { sprite = 'hero', tags = {'h'} }\nfunction H:on_animation_end(tag) nova.log('end ' .. tag .. ' ' .. self.frame) end\nreturn H",
            ),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  self.h = nova.spawn('h', 0, 0)\n  self.h:play('run')\n  self.h:play('run') -- same tag again keeps going\n  self.n = 0\nend\nfunction S:update(dt)\n  self.n = self.n + 1\n  if self.n == 1 then nova.log('run start ' .. self.h.frame) end\n  if self.n == 7 then nova.log('run 0.1s ' .. self.h.frame) end\n  if self.n == 40 then nova.log('run 0.67s ' .. self.h.frame) self.h:play('idle') end\n  if self.n == 80 then nova.log('idle 0.67s ' .. self.h.frame) self.h:play('hit') end\n  if self.n == 120 then nova.log('hit done ' .. self.h.frame) end\nend\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 130);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    // run = frames 2..5 forward, loop. 100 ms per frame at 60 Hz steps: a frame change after 6 steps.
    assert_eq!(l[0], "run start 2");
    assert_eq!(l[1], "run 0.1s 3");
    assert_eq!(l[2], "run 0.67s 4", "{l:?}");
    // idle = pingpong 0..3 plays 0,1,2,3,2,1 then loops: six frames advanced in 0.6 s is one full
    // cycle, so it is back on frame 0.
    assert_eq!(l[3], "idle 0.67s 0", "{l:?}");
    // hit = frames 6..7, no loop: ends on the last frame and reports it once.
    assert_eq!(l[4], "end hit 7");
    assert_eq!(l[5], "hit done 7");
    assert_eq!(l.len(), 6, "{l:?}");
}

#[test]
fn play_reports_unknown_tags_and_plain_images() {
    for (sprite, call, expected) in [
        ("hero", "e:play('nope')", "has no tag 'nope'"),
        ("sheet", "e:play('run')", "is not a sprite sheet"),
    ] {
        let source = format!(
            "local S = nova.scene {{}}\nfunction S:enter() local e = nova.spawn('e', 0, 0) {call} end\nreturn S"
        );
        let mut g = with_sheet(vec![
            (
                "entities/e.lua",
                lua(&format!("return nova.entity {{ sprite = '{sprite}' }}")),
            ),
            ("scenes/s.lua", lua(&source)),
            ("main.lua", lua("nova.start('s')")),
        ]);
        steps(&mut g, 2);
        let e = g.error.clone().expect("error");
        assert!(e.contains(expected), "{call}: {e}");
    }
}

#[test]
fn a_sheet_with_a_missing_image_fails_the_load_naming_the_file() {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", lua("")),
        (
            "sprites/hero.sprite.json",
            lua(r#"{"version":1,"image":"gone.png","frame_width":8,"frame_height":8}"#),
        ),
    ]));
    let e = Game::load(vfs).err().expect("must fail");
    assert!(e.starts_with("sprites/hero.sprite.json.image"), "{e}");
}

// ---------------------------------------------------------------- tilemaps

fn tile_project(extra: Vec<(&'static str, Vec<u8>)>) -> Game {
    let mut files = vec![("sprites/tiles.png", png(64, 32))];
    files.extend(extra);
    project(files)
}

#[test]
fn tilemaps_draw_only_what_the_view_can_see() {
    let row = vec!["0"; 100].join(",");
    let rows = vec![format!("[{row}]"); 50].join(",");
    let scene = format!(
        r#"{{"version":1,"tilemaps":[{{"name":"ground","tileset":{{"image":"sprites/tiles.png","tile_width":16,"tile_height":16}},"tiles":[{rows}]}}]}}"#
    );
    let mut g = tile_project(vec![
        ("scenes/s.scene.json", lua(&scene)),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() nova.log(table.concat({ self.ground:size() }, ' ')) end\nfunction S:update(dt) if self.far then nova.cam.set(9000, 9000) end end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 2);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(logs(&g)[0], "100 50 16 16");
    // 960x540 view, camera centred on it: columns 0..=60 and rows 0..=33 touch the view.
    assert_eq!(g.frame_input(540).sprites_back.len(), 61 * 34);
}

#[test]
fn tilemap_cells_can_be_read_and_changed_from_lua() {
    let mut g = tile_project(vec![
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  local m = nova.tilemap { image = 'tiles', tile_width = 16, tile_height = 16, x = 100, y = 50, tiles = { { 0, 1, -1 }, { 7, 2, 3 } }, solid = { 1 } }\n  nova.log(m:get(1, 0) .. ' ' .. m:get(2, 0) .. ' ' .. m:get(0, 1) .. ' ' .. m:get(9, 9))\n  nova.log(m:tile_at(100 + 16 + 3, 50 + 4) .. ' ' .. table.concat({ m:cell_at(100 + 40, 50 + 20) }, ','))\n  m:set(2, 0, 5)\n  nova.log(tostring(m:get(2, 0)) .. ' ' .. tostring(m:is_solid_at(100 + 20, 50 + 5)) .. ' ' .. tostring(m:is_solid_at(100 + 4, 50 + 5)) .. ' ' .. tostring(nova.solid_at(100 + 20, 50 + 5)))\nend\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 2);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(logs(&g), ["1 -1 7 -1", "1 2,1", "5 true false true"]);
}

#[test]
fn bad_tilemap_data_is_explained() {
    for (spec, expected) in [
        (
            "{ image = 'tiles', tile_width = 16, tile_height = 16, tiles = { { 99 } } }",
            "99 is not a tile of this tileset",
        ),
        (
            "{ image = 'tiles', tile_width = 16, tile_height = 16, tiles = { { 0, 1 }, { 0 } } }",
            "row 1 has 1 tiles but row 0 has 2",
        ),
        (
            "{ image = 'ghost', tile_width = 16, tile_height = 16, tiles = { { 0 } } }",
            "unknown tileset image 'ghost'",
        ),
        (
            "{ tile_width = 16, tile_height = 16, tiles = { { 0 } } }",
            "missing 'image'",
        ),
        (
            "{ image = 'tiles', tile_height = 16, tiles = { { 0 } } }",
            "missing 'tile_width'",
        ),
    ] {
        let source = format!(
            "local S = nova.scene {{}}\nfunction S:enter() nova.tilemap({spec}) end\nreturn S"
        );
        let mut g = tile_project(vec![
            ("scenes/s.lua", lua(&source)),
            ("main.lua", lua("nova.start('s')")),
        ]);
        steps(&mut g, 2);
        let e = g.error.clone().expect("error");
        assert!(e.contains(expected), "{spec}: {e}");
    }
}

#[test]
fn sliding_stops_against_solid_tiles_and_follows_walls() {
    // A floor of solid tiles (tile 1) along row 6 (y 96..112) and a wall at column 10 (x 160..176).
    let mut rows = vec![vec![-1; 20]; 8];
    rows[6] = vec![1; 20];
    for row in rows.iter_mut() {
        row[10] = 1;
    }
    let tiles = rows
        .iter()
        .map(|r| {
            let cells: Vec<String> = r.iter().map(|n| n.to_string()).collect();
            format!("{{{}}}", cells.join(","))
        })
        .collect::<Vec<_>>()
        .join(",");
    let mut g = tile_project(vec![
        (
            "entities/box.lua",
            lua("return nova.entity { hitbox = { -4, -4, 8, 8 }, tags = {'box'} }"),
        ),
        (
            "scenes/s.lua",
            lua(&format!(
                "local S = nova.scene {{}}\nfunction S:enter()\n  nova.tilemap {{ image = 'tiles', tile_width = 16, tile_height = 16, solid = {{ 1 }}, tiles = {{ {tiles} }} }}\n  local falling = nova.spawn('box', 40, 20)\n  for i = 1, 30 do falling:slide(0, 8) end\n  nova.log(string.format('floor %.1f', falling.y))\n  local walker = nova.spawn('box', 150, 60)\n  local bx, by = walker:slide(30, 5)\n  nova.log(string.format('wall %.1f %.1f %s %s', walker.x, walker.y, tostring(bx), tostring(by)))\n  local free = nova.spawn('box', 20, 20)\n  local fx, fy = free:slide(10, 10)\n  nova.log(string.format('free %.1f %.1f %s %s', free.x, free.y, tostring(fx), tostring(fy)))\nend\nreturn S"
            )),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 2);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    assert_eq!(
        l[0], "floor 92.0",
        "box bottom (y + 4) rests on the floor top at y = 96: {l:?}"
    );
    assert_eq!(
        l[1], "wall 156.0 65.0 true false",
        "right edge (x + 4) stops at the wall at x = 160, y is free: {l:?}"
    );
    assert_eq!(l[2], "free 30.0 30.0 false false");
}

// ---------------------------------------------------------------- limits

#[test]
fn an_endless_loop_is_stopped_with_a_clear_error_instead_of_hanging() {
    let mut g = project(vec![(
        "main.lua",
        lua("function update(dt) while true do end end"),
    )]);
    let started = std::time::Instant::now();
    steps(&mut g, 1);
    let took = started.elapsed();
    let e = g.error.clone().expect("the loop was stopped");
    assert!(e.contains("ran for too long"), "{e}");
    assert!(
        took < std::time::Duration::from_secs(5),
        "stopped in {took:?}"
    );
}

#[test]
fn an_endless_loop_while_loading_is_stopped_too() {
    let g = project(vec![("main.lua", lua("while true do end"))]);
    assert!(g.error.clone().expect("error").contains("ran for too long"));
}

#[test]
fn a_waiting_coroutine_that_spins_is_covered_by_the_same_limit() {
    let mut g = project(vec![
        ("entities/e.lua", lua("return nova.entity {}")),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() self:go(function() while true do end end) end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 3);
    assert!(g.error.clone().expect("error").contains("ran for too long"));
}

#[test]
fn runaway_memory_use_fails_cleanly() {
    let mut g = project(vec![(
        "main.lua",
        lua(
            "function update(dt) local t = {} for i = 1, 1e9 do t[i] = string.rep('x', 1000) .. i end end",
        ),
    )]);
    steps(&mut g, 1);
    let e = g.error.clone().expect("memory limit hit");
    assert!(e.to_lowercase().contains("memory"), "{e}");
}

// ---------------------------------------------------------------- save data

#[test]
fn save_values_round_trip_with_defaults_nesting_and_clear_errors() {
    let mut g = project(vec![(
        "main.lua",
        lua(r#"
local missing = nova.save.get('nothing')
nova.save.set('best', 12)
nova.save.set('cfg', { volume = 0.5, names = { 'a', 'b' }, on = true })
local cfg = nova.save.get('cfg')
nova.log(string.format('%s %d %s %s %s %s %s', tostring(missing), nova.save.get('best'), tostring(nova.save.get('x', 'dflt')), cfg.volume, cfg.names[2], tostring(cfg.on), table.concat(nova.save.keys(), ',')))
nova.save.delete('best')
nova.log(tostring(nova.save.get('best')))
local ok, err = pcall(nova.save.set, 'f', function() end)
nova.log(tostring(ok) .. ' ' .. tostring(err):match('cannot be saved') )
local ok2, err2 = pcall(nova.save.set, '', 1)
nova.log(tostring(ok2) .. ' ' .. tostring(err2):match('1 to 128'))
"#),
    )]);
    assert!(g.error.is_none(), "{:?}", g.error);
    steps(&mut g, 1);
    assert_eq!(
        logs(&g),
        [
            "nil 12 dflt 0.5 b true best,cfg",
            "nil",
            "false cannot be saved",
            "false 1 to 128"
        ]
    );
}

#[test]
fn save_data_persists_across_games_and_scripts_can_read_it_at_load() {
    let dir = std::env::temp_dir().join(format!("nova-game-save-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let make = |source: &str| {
        let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
            ("nova.json", br#"{"format":1,"name":"Saver"}"#.to_vec()),
            ("main.lua", lua(source)),
        ]));
        let d = dir.clone();
        Game::load_with(vfs, &move |_| Some(d.clone())).expect("loads")
    };
    {
        let g = make(
            "nova.save.set('runs', (nova.save.get('runs', 0)) + 1) nova.log('runs ' .. nova.save.get('runs'))",
        );
        assert!(g.error.is_none(), "{:?}", g.error);
        assert_eq!(logs(&g), ["runs 1"]);
        // dropped here: unsaved changes are written
    }
    let g = make("nova.log('at load ' .. nova.save.get('runs', 0))");
    assert_eq!(
        logs(&g),
        ["at load 1"],
        "the save was read before the entry script ran"
    );
    assert!(dir.join("save.json").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_damaged_save_file_warns_and_the_game_still_starts() {
    let dir = std::env::temp_dir().join(format!("nova-game-badsave-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("save.json"), "{ broken").unwrap();
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"Saver"}"#.to_vec()),
        ("main.lua", lua("nova.log(tostring(nova.save.get('x')))")),
    ]));
    let d = dir.clone();
    let g = Game::load_with(vfs, &move |_| Some(d.clone())).expect("loads");
    assert!(g.error.is_none());
    assert!(
        g.warnings.iter().any(|w| w.contains("could not be read")),
        "{:?}",
        g.warnings
    );
    assert_eq!(logs(&g), ["nil"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_view_size_is_whole_numbers_even_on_odd_aspect_ratios() {
    let mut g = project(vec![(
        "main.lua",
        lua(
            "function update(dt)\n local w, h = nova.view()\n nova.log(math.type(w) .. ' ' .. math.type(h) .. ' ' .. w .. ' ' .. h .. ' ' .. math.random(24, w - 24))\nend",
        ),
    )]);
    // A 1920x944 surface (as on the Android emulator) is 1098.5 logical units wide at 540 high.
    g.update(0.016, 0.0, [1098.5, 540.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    assert!(l[0].starts_with("integer integer 1098 540 "), "{l:?}");
}

// ---------------------------------------------------------------- sound

fn wav_bytes(rate: u32, frames: usize) -> Vec<u8> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
        for i in 0..frames {
            w.write_sample((i % 100) as i16 * 50).unwrap();
        }
        w.finalize().unwrap();
    }
    cursor.into_inner()
}

#[test]
fn sound_calls_queue_mixer_commands_with_options_and_short_names() {
    use nova_runtime::mixer::Command;
    let g = project(vec![
        ("sounds/jump.wav", wav_bytes(22050, 2000)),
        ("music/theme.wav", wav_bytes(22050, 4000)),
        (
            "main.lua",
            lua(
                "local id = nova.sound.play('jump', { volume = 0.5, pan = -2, pitch = 2 })\nlocal full = nova.sound.play('sounds/jump.wav', { loop = true })\nnova.music.play('theme', { fade = 1.5, volume = 0.3 })\nnova.music.play('music/theme.wav', { loop = false })\nnova.sound.stop(id, 0.25)\nnova.sound.stop_all()\nnova.music.stop(2)\nnova.sound.volume(0.5)\nnova.music.volume(0.25)\nnova.log(id .. ' ' .. full)",
            ),
        ),
    ]);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(logs(&g), ["1 2"], "play returns ids that count up");
    let cmds = g.take_audio();
    assert_eq!(cmds.len(), 9);
    match &cmds[0] {
        Command::Play(p) => {
            assert_eq!(
                (p.id, p.volume, p.pan, p.pitch, p.looping, p.music),
                (1, 0.5, -1.0, 2.0, false, false),
                "pan clamps to -1"
            );
            assert_eq!(p.sample.frames.len(), 2000);
            assert_eq!(p.sample.rate, 22050);
        }
        _ => panic!("first command is a play"),
    }
    assert!(
        matches!(&cmds[1], Command::Play(p) if p.looping),
        "loop = true is honoured"
    );
    assert!(
        matches!(&cmds[2], Command::Play(p) if p.music && p.looping && p.fade_in == 1.5),
        "music loops by default and can fade in"
    );
    assert!(
        matches!(&cmds[3], Command::Play(p) if p.music && !p.looping),
        "music can opt out of looping"
    );
    assert!(matches!(&cmds[4], Command::Stop { id: 1, fade } if (*fade - 0.25).abs() < 1e-6));
    assert!(matches!(&cmds[5], Command::StopAll));
    assert!(matches!(&cmds[6], Command::StopMusic { fade } if *fade == 2.0));
    assert!(matches!(&cmds[7], Command::SfxVolume(v) if *v == 0.5));
    assert!(matches!(&cmds[8], Command::MusicVolume(v) if *v == 0.25));
    assert!(
        g.take_audio().is_empty(),
        "taking the commands empties the queue"
    );
}

#[test]
fn unknown_sounds_and_bad_audio_files_are_explained() {
    let mut g = project(vec![
        ("sounds/a.wav", wav_bytes(22050, 100)),
        (
            "main.lua",
            lua("function update(dt) nova.sound.play('nope') end"),
        ),
    ]);
    steps(&mut g, 1);
    let e = g.error.clone().expect("error");
    assert!(
        e.contains("unknown sound 'nope'") && e.contains("sounds/a.wav"),
        "{e}"
    );

    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", lua("")),
        ("sounds/broken.wav", b"RIFF nope".to_vec()),
    ]));
    let e = Game::load(vfs).err().expect("must fail");
    assert!(
        e.starts_with("sounds/broken.wav:") && e.contains("not a readable WAV"),
        "{e}"
    );

    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", lua("")),
        ("music/theme.ogg", b"OggS".to_vec()),
    ]));
    let g = Game::load(vfs).expect("an OGG file is skipped with a warning, not fatal");
    assert!(
        g.warnings
            .iter()
            .any(|w| w.contains("music/theme.ogg") && w.contains("only WAV")),
        "{:?}",
        g.warnings
    );
}

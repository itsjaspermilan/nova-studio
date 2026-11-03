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
            "function update(dt) local t = {} for i = 1, 1e6 do t[i] = string.rep('x', 1000000) .. i end end",
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
    let e = Game::load(vfs)
        .err()
        .expect("a broken OGG is an error that names the file");
    assert!(
        e.starts_with("music/theme.ogg:") && e.contains("not a readable Ogg Vorbis"),
        "{e}"
    );
}

// ---------------------------------------------------------------- text

fn text_game(source: &str) -> Game {
    project(vec![("main.lua", lua(source))])
}

#[test]
fn text_draws_letters_measures_wraps_and_aligns() {
    let mut g = text_game(
        "function update(dt)\n  nova.ui.text(10, 20, 'Hello', { size = 24 })\n  local w, h = nova.ui.text_size('Hello', { size = 24 })\n  local w2, h2 = nova.ui.text_size('Hello there friend', { size = 24, width = 90 })\n  local legacy = nova.ui.text_width('Hi', 2)\n  nova.log(string.format('%.0f %.0f %s %s', w, h, tostring(h2 > h * 1.5), tostring(legacy > 8)))\n  nova.ui.text(0, 100, 'centred', { size = 20, width = 200, align = 'center', shadow = true })\nend",
    );
    steps(&mut g, 1);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    assert!(
        l[0].ends_with("true true"),
        "wrapped text is taller, legacy width works: {l:?}"
    );
    let input = g.frame_input(540);
    assert!(
        input.text.len() > 5 + 7,
        "Hello plus a shadowed 'centred' draws letters and shadow copies: {}",
        input.text.len()
    );
    assert_eq!(
        input.sprites_front.len(),
        0,
        "text is not in the sprite list"
    );
}

#[test]
fn every_builtin_font_name_works_and_unknown_fonts_list_the_choices() {
    for name in [
        "sans", "rounded", "pixel", "terminal", "mono", "serif", "comic", "display", "script",
    ] {
        let mut g = text_game(&format!(
            "function update(dt) nova.ui.text(0, 0, 'Abc', {{ font = '{name}', size = 20 }}) end"
        ));
        steps(&mut g, 1);
        assert!(g.error.is_none(), "{name}: {:?}", g.error);
        assert_eq!(g.frame_input(540).text.len(), 3, "{name}");
    }
    let mut g =
        text_game("function update(dt) nova.ui.text(0, 0, 'x', { font = 'wingdings' }) end");
    steps(&mut g, 1);
    let e = g.error.clone().expect("error");
    assert!(
        e.contains("unknown font 'wingdings'")
            && e.contains("pixel")
            && e.contains("fonts/title.ttf"),
        "{e}"
    );
    let mut g = text_game("function update(dt) nova.ui.text(0, 0, 'x', { align = 'middle' }) end");
    steps(&mut g, 1);
    assert!(g.error.clone().unwrap().contains("align must be"));
}

#[test]
fn project_fonts_load_by_path_and_short_name_and_bad_ones_fail_the_load() {
    let font = nova_runtime::text::BUILTIN[0].1.to_vec();
    let mut g = project(vec![
        ("fonts/title.ttf", font.clone()),
        (
            "main.lua",
            lua(
                "function update(dt) nova.ui.text(0, 0, 'Hi', { font = 'title' }) nova.ui.text(0, 30, 'Hi', { font = 'fonts/title.ttf' }) end",
            ),
        ),
    ]);
    steps(&mut g, 1);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.frame_input(540).text.len(), 4);

    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", lua("")),
        ("fonts/broken.ttf", b"nope".to_vec()),
    ]));
    let e = Game::load(vfs).err().expect("must fail");
    assert!(
        e.starts_with("fonts/broken.ttf:") && e.contains("not a usable font"),
        "{e}"
    );
}

#[test]
fn text_is_rasterised_at_the_screens_pixel_size_and_the_atlas_reaches_the_host() {
    let mut g = text_game("function update(dt) nova.ui.text(10, 10, 'Sharp', { size = 20 }) end");
    g.set_pixel_scale(2.0);
    steps(&mut g, 1);
    let at_2x = g
        .frame_input(540)
        .text
        .iter()
        .map(|q| q.size[1])
        .fold(0.0f32, f32::max);
    let atlas = g.take_glyph_atlas().expect("new glyphs mean a new atlas");
    assert!(atlas.iter().any(|&c| c > 200));
    assert!(
        g.take_glyph_atlas().is_none(),
        "not again until something changes"
    );
    let mut g1 = text_game("function update(dt) nova.ui.text(10, 10, 'Sharp', { size = 20 }) end");
    steps(&mut g1, 1);
    let at_1x = g1
        .frame_input(540)
        .text
        .iter()
        .map(|q| q.size[1])
        .fold(0.0f32, f32::max);
    // Quads are in logical units, so both cover the same logical height (rasterised at different pixel sizes).
    assert!((at_2x - at_1x).abs() < 1.5, "{at_2x} vs {at_1x}");
}

// ---------------------------------------------------------------- input actions

use nova_runtime::actions::InputFrame;

fn input(sources: &[(&str, f32)]) -> InputFrame {
    InputFrame {
        sources: sources.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ..Default::default()
    }
}

fn project_with(manifest: &str, files: Vec<(&'static str, Vec<u8>)>) -> Result<Game, String> {
    let mut all = vec![("nova.json", manifest.as_bytes().to_vec())];
    all.extend(files);
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut game = Game::load(vfs)?;
    game.upload(&mut FakeGpu);
    Ok(game)
}

fn frame_with(game: &mut Game, dt: f32, frame: &InputFrame) {
    game.update_input(dt, 0.0, [960.0, 540.0], frame);
}

#[test]
fn actions_report_down_value_and_edges_from_sources() {
    let mut g = project(vec![(
        "main.lua",
        lua(
            "function update(dt)\n nova.log(string.format('%s %s %s %.1f %.1f', tostring(nova.input.down('a')), tostring(nova.input.pressed('a')), tostring(nova.input.released('a')), nova.input.axis('move_x'), nova.input.axis('move_y')))\nend",
        ),
    )]);
    frame_with(&mut g, 1.0 / 60.0, &input(&[]));
    frame_with(
        &mut g,
        1.0 / 60.0,
        &input(&[("key:KeyZ", 1.0), ("axis:left_x", 1.0)]),
    );
    frame_with(
        &mut g,
        1.0 / 60.0,
        &input(&[("key:KeyZ", 1.0), ("axis:left_y", 0.6)]),
    );
    frame_with(&mut g, 1.0 / 60.0, &input(&[]));
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    assert_eq!(l[0], "false false false 0.0 0.0");
    assert_eq!(l[1], "true true false 1.0 0.0", "{l:?}");
    assert!(
        l[2].starts_with("true false false 0.0 0.5"),
        "held, not pressed again; stick down: {l:?}"
    );
    assert_eq!(l[3], "false false true 0.0 0.0", "{l:?}");
}

#[test]
fn a_press_is_seen_by_exactly_one_game_step_at_any_frame_rate() {
    let counting = |source: &str| {
        project(vec![
            ("scenes/s.lua", lua(source)),
            ("main.lua", lua("nova.start('s')")),
        ])
    };
    for (label, dt) in [
        ("120 Hz frames", 1.0 / 120.0),
        ("30 Hz frames", 1.0 / 30.0),
        ("60 Hz frames", 1.0 / 60.0),
    ] {
        let mut g = counting(
            "local S = nova.scene {}\nfunction S:enter() self.n = 0 self.r = 0 end\nfunction S:update(dt)\n  if nova.input.pressed('a') then self.n = self.n + 1 end\n  if nova.input.released('a') then self.r = self.r + 1 end\nend\nfunction S:draw() nova.log(self.n .. ' ' .. self.r) end\nreturn S",
        );
        let hold = input(&[("key:KeyZ", 1.0)]);
        let idle = input(&[]);
        for _ in 0..6 {
            frame_with(&mut g, dt, &idle);
        }
        for _ in 0..12 {
            frame_with(&mut g, dt, &hold); // held for 0.1 s whatever the frame rate
        }
        for _ in 0..12 {
            frame_with(&mut g, dt, &idle);
        }
        assert!(g.error.is_none(), "{label}: {:?}", g.error);
        let last = logs(&g).last().cloned().expect("draw ran");
        assert_eq!(
            last, "1 1",
            "{label}: one press and one release, no more and no fewer"
        );
    }
}

#[test]
fn manifest_bindings_add_and_replace_actions() {
    let mut g = project_with(
        r#"{"format":1,"name":"T","input":{"fire":["key:KeyJ","pad:west"],"move_x":{"negative":["key:KeyH"],"positive":["key:KeyL"]}}}"#,
        vec![(
            "main.lua",
            lua("function update(dt) nova.log(tostring(nova.input.down('fire')) .. ' ' .. nova.input.axis('move_x')) end"),
        )],
    )
    .unwrap();
    frame_with(
        &mut g,
        0.016,
        &input(&[("key:KeyJ", 1.0), ("key:KeyL", 1.0)]),
    );
    frame_with(&mut g, 0.016, &input(&[("key:KeyD", 1.0)]));
    assert_eq!(
        logs(&g),
        ["true 1.0", "false 0.0"],
        "the default D key no longer drives move_x"
    );
}

#[test]
fn bad_manifest_bindings_stop_the_load_with_the_exact_place() {
    for (manifest, expected) in [
        (
            r#"{"format":1,"name":"T","input":{"fire":["key:Nope"]}}"#,
            "nova.json.input.fire[0]: 'Nope' is not a key name",
        ),
        (
            r#"{"format":1,"name":"T","input":{"Fire":["key:KeyJ"]}}"#,
            "not a valid action name",
        ),
        (
            r#"{"format":1,"name":"T","input":[]}"#,
            "\"input\" must be an object",
        ),
    ] {
        let e = project_with(manifest, vec![("main.lua", lua(""))])
            .err()
            .expect("must fail");
        assert!(e.contains(expected), "{manifest}: {e}");
    }
}

#[test]
fn scripts_can_rebind_actions_list_them_and_learn_the_last_pressed_source() {
    let mut g = project(vec![(
        "main.lua",
        lua(r#"
local step = 0
function update(dt)
  step = step + 1
  if step == 1 then
    nova.input.bind('jump', { 'key:KeyM', 'pad:east' })
    nova.input.bind('move_x', { negative = { 'key:KeyJ' }, positive = { 'key:KeyK' } })
    nova.log(table.concat(nova.input.bindings('jump'), ','))
    local mx = nova.input.bindings('move_x')
    nova.log(mx.negative[1] .. ' ' .. mx.positive[1])
    nova.log(tostring(nova.input.last_source()))
  elseif step == 2 then
    nova.log(tostring(nova.input.down('jump')) .. ' ' .. nova.input.axis('move_x') .. ' ' .. tostring(nova.input.last_source()))
    nova.input.reset_bindings()
    local ok, err = pcall(nova.input.bind, 'jump', { 'key:Nope' })
    nova.log(tostring(ok) .. ' ' .. tostring(err):match("not a key name"))
    local ok2, err2 = pcall(nova.input.down, 'nonexistent')
    nova.log(tostring(ok2) .. ' ' .. tostring(err2):match("unknown input action 'nonexistent' %(actions: "))
    local names = nova.input.actions()
    local has = {}
    for _, n in ipairs(names) do has[n] = true end
    nova.log(tostring(has.a and has.move_x and has.start and has.steer and not has.jump))
  end
end"#),
    )]);
    frame_with(&mut g, 0.016, &input(&[]));
    let mut second = input(&[("key:KeyM", 1.0), ("key:KeyK", 1.0)]);
    second.last_source = Some("key:KeyM".into());
    frame_with(&mut g, 0.016, &second);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = logs(&g);
    assert_eq!(l[0], "key:KeyM,pad:east");
    assert_eq!(l[1], "key:KeyJ key:KeyK");
    assert_eq!(l[2], "nil", "nothing pressed yet");
    assert_eq!(l[3], "true 1.0 key:KeyM");
    assert_eq!(l[4], "false not a key name");
    assert_eq!(l[5], "false unknown input action 'nonexistent' (actions: ");
    assert_eq!(
        l[6], "true",
        "reset_bindings restores the project's actions and removes added ones"
    );
}

#[test]
fn the_older_four_actions_and_the_compat_update_still_work() {
    let mut g = project(vec![(
        "main.lua",
        lua(
            "function update(dt) nova.log(nova.input.axis('steer') .. ' ' .. nova.input.axis('throttle') .. ' ' .. tostring(nova.input.down('action'))) end",
        ),
    )]);
    g.update(
        0.016,
        0.0,
        [960.0, 540.0],
        Actions {
            steer: -1.0,
            throttle: 1.0,
            brake: 0.0,
            action: true,
        },
        false,
    );
    g.update_input(
        0.016,
        0.0,
        [960.0, 540.0],
        &input(&[("key:KeyD", 1.0), ("key:Space", 1.0), ("key:KeyW", 1.0)]),
    );
    assert_eq!(logs(&g), ["-1.0 1.0 true", "1.0 1.0 true"]);
}

#[test]
fn a_pivot_puts_that_point_of_the_sprite_on_the_entity_and_moves_its_box() {
    let mut g = project(vec![
        ("sprites/box.png", png(10, 20)),
        (
            "entities/feet.lua",
            lua("return nova.entity { sprite = 'box', pivot = { 0.5, 1 } }"),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter()\n  local e = nova.spawn('feet', 100, 100)\n  local x0, y0, x1, y1 = e:bounds()\n  nova.log(x0 .. ' ' .. y0 .. ' ' .. x1 .. ' ' .. y1)\nend\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 2);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(
        logs(&g),
        ["95.0 80.0 105.0 100.0"],
        "the box hangs from the pivot"
    );
    let input = g.frame_input(540);
    let sprite = input.sprites_back.last().expect("sprite");
    // Centre = position + (0.5 - pivot) * size = (100, 100 - 10).
    assert_eq!(sprite.center, [100.0, 90.0]);
}

#[test]
fn rotation_turns_a_pivoted_sprite_about_the_pivot() {
    let mut g = project(vec![
        ("sprites/box.png", png(10, 20)),
        (
            "entities/arm.lua",
            lua("return nova.entity { sprite = 'box', pivot = { 0.5, 1 }, angle = math.pi / 2 }"),
        ),
        (
            "scenes/s.lua",
            lua(
                "local S = nova.scene {}\nfunction S:enter() nova.spawn('arm', 100, 100) end\nreturn S",
            ),
        ),
        ("main.lua", lua("nova.start('s')")),
    ]);
    steps(&mut g, 2);
    assert!(g.error.is_none(), "{:?}", g.error);
    let c = g
        .frame_input(540)
        .sprites_back
        .last()
        .expect("sprite")
        .center;
    // The offset (0, -10) turned a quarter turn clockwise (y down) becomes (10, 0).
    assert!(
        (c[0] - 110.0).abs() < 1e-3 && (c[1] - 100.0).abs() < 1e-3,
        "{c:?}"
    );
}

fn particle_game(scene_body: &str) -> Game {
    project(vec![
        ("sprites/spark.png", png(8, 8)),
        (
            "scenes/s.lua",
            lua(&format!(
                "local S = nova.scene {{}}\nfunction S:enter()\n{scene_body}\nend\nreturn S"
            )),
        ),
        ("main.lua", lua("nova.start('s')")),
    ])
}

#[test]
fn a_burst_draws_its_particles_moves_them_with_gravity_and_cleans_itself_up() {
    let mut g = particle_game(
        "nova.burst(100, 100, { count = 10, life = 0.5, speed = 0, gravity = 100, size = 4, color = {255,0,0,255} })",
    );
    steps(&mut g, 1);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.frame_input(540).sprites_back.len(), 10);
    steps(&mut g, 28); // nearly half a second of falling
    let early = g.frame_input(540).sprites_back.len();
    assert_eq!(
        early, 10,
        "still alive just before the end of their life: {early}"
    );
    let y = g.frame_input(540).sprites_back[0].center[1];
    assert!(
        y > 100.0 && y < 100.0 + 0.5 * 100.0 * 0.25 + 2.0,
        "fell about 12 units, got {y}"
    );
    steps(&mut g, 10);
    assert_eq!(
        g.frame_input(540).sprites_back.len(),
        0,
        "all gone after their life"
    );
    assert!(g.error.is_none(), "{:?}", g.error);
    // The emitter entity removed itself.
}

#[test]
fn continuous_emitters_follow_their_rate_the_cap_and_stop_cleanly() {
    let mut g = particle_game(
        "self.fx = nova.particles(50, 50, { rate = 60, life = 100, max = 25, speed = 0, size = 2 })\nnova.log('n')",
    );
    steps(&mut g, 60);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.frame_input(540).sprites_back.len(), 25, "capped by max");
    let mut g =
        particle_game("self.fx = nova.particles(0, 0, { rate = 60, life = 100, speed = 0 })");
    steps(&mut g, 30);
    let n = g.frame_input(540).sprites_back.len();
    assert!(
        (29..=31).contains(&n),
        "30 steps at 60/s is 30 particles, got {n}"
    );
}

#[test]
fn particles_can_be_sprites_follow_the_camera_and_stay_in_range() {
    let mut g = particle_game(
        "nova.burst(480, 270, { count = 5, image = 'spark', life = 1, speed = {10, 30}, angle = 0, spread = 0.5, size = 8, size_end = 2, color = {255,255,255,255}, color_end = {255,255,255,0} })",
    );
    steps(&mut g, 30);
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(540);
    assert_eq!(input.sprites_back.len(), 5);
    for s in input.sprites_back {
        assert!(
            s.center[0] > 480.0,
            "launched to the right (angle 0): {:?}",
            s.center
        );
        assert!(
            s.size[0] > 8.0 - 0.01 && s.size[0] < 16.1,
            "grows toward size_end: {:?}",
            s.size
        );
        assert!(s.color[3] < 230, "fades out: {:?}", s.color);
    }
}

#[test]
fn bad_particle_arguments_do_not_crash_the_game() {
    let mut g = particle_game(
        "nova.burst(0, 0, { count = 3, life = {0.1}, speed = {5}, size = 1 })\nnova.burst(0, 0)",
    );
    steps(&mut g, 20);
    assert!(g.error.is_none(), "{:?}", g.error);
}

#[test]
fn music_position_and_seek_follow_what_is_playing() {
    let mut g = project(vec![
        ("music/theme.wav", wav_bytes(22050, 44100)),
        (
            "main.lua",
            lua(
                "local state = 0\nfunction update(dt)\n  state = state + 1\n  if state == 1 then nova.log('before ' .. tostring(nova.music.position()) .. ' ' .. tostring(nova.music.seek(1)))\n    nova.music.play('theme')\n  elseif state == 2 then nova.log('seek ' .. tostring(nova.music.seek(0.5)))\n  elseif state == 3 then nova.log('pos ' .. tostring(nova.music.position()))\n  elseif state == 4 then nova.music.stop() nova.log('after ' .. tostring(nova.music.position()) .. ' ' .. tostring(nova.music.seek(2)))\n  end\nend",
            ),
        ),
    ]);
    run(&mut g, 1, 1.0 / 60.0);
    g.set_music_position(Some(1.25)); // the audio thread reports in
    run(&mut g, 1, 1.0 / 60.0);
    run(&mut g, 1, 1.0 / 60.0);
    run(&mut g, 1, 1.0 / 60.0);
    assert!(g.error.is_none(), "{:?}", g.error);
    let log = g.take_log();
    assert_eq!(
        log[0], "before nil false",
        "nothing playing: no position, seek says so"
    );
    assert_eq!(log[1], "seek true");
    assert_eq!(
        log[2], "pos 0.5",
        "right after a seek the position is the one asked for"
    );
    assert_eq!(log[3], "after nil false", "stopping clears both");
    use nova_runtime::mixer::Command;
    let commands = g.take_audio();
    assert!(
        commands.iter().any(|c| matches!(c, Command::SeekMusic { seconds, feed: None } if (*seconds - 0.5).abs() < 1e-9)),
        "music in memory seeks by moving its playhead"
    );
}

#[test]
fn bad_seek_times_are_explained() {
    for script in ["nova.music.seek(-1)", "nova.music.seek(1/0)"] {
        let mut g = project(vec![(
            "main.lua",
            lua(&format!("function update(dt) {script} end")),
        )]);
        run(&mut g, 1, 1.0 / 60.0);
        let e = g.error.clone().unwrap_or_default();
        assert!(e.contains("seek needs a time in seconds"), "{script}: {e}");
    }
}

#[test]
fn sound_set_queues_a_change_and_explains_a_mistake() {
    use nova_runtime::mixer::Command;
    let g = project(vec![
        ("sounds/engine.wav", wav_bytes(22050, 2000)),
        (
            "main.lua",
            lua(
                "local id = nova.sound.play('engine', { loop = true })\nnova.sound.set(id, { pitch = 99, volume = 0.4 })\nnova.sound.set(id, { pan = -0.5 })",
            ),
        ),
    ]);
    assert!(g.error.is_none(), "{:?}", g.error);
    let cmds = g.take_audio();
    assert_eq!(cmds.len(), 3);
    assert!(
        matches!(&cmds[1], Command::Set { id: 1, volume: Some(v), pan: None, pitch: Some(p) } if *v == 0.4 && *p == 16.0),
        "pitch clamps to 16"
    );
    assert!(
        matches!(&cmds[2], Command::Set { id: 1, volume: None, pan: Some(p), pitch: None } if *p == -0.5)
    );
    for (script, expected) in [
        (
            "nova.sound.set(1, {})",
            "needs at least one of volume, pan or pitch",
        ),
        ("nova.sound.set(1, { pitch = 'high' })", "number"),
    ] {
        let g = project(vec![
            ("sounds/engine.wav", wav_bytes(22050, 2000)),
            ("main.lua", lua(script)),
        ]);
        let e = g.error.clone().unwrap_or_default();
        assert!(e.contains(expected), "{script}: '{e}'");
    }
}

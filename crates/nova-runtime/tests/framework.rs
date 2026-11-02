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

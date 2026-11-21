//! The 2D traps an assistant's first game fell into, fixed in the framework: a sprite mirrored without moving its
//! hitbox (`flip_x`), world points to screen points (`nova.cam.to_screen`), a camera that can snap when told to follow,
//! and lines of text set further apart (`line_spacing`).

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

fn project(files: Vec<(&str, &str)>) -> Game {
    let mut all = vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("sprites/dot.png", png(4, 4)),
    ];
    all.extend(files.into_iter().map(|(p, s)| (p, s.as_bytes().to_vec())));
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut game = Game::load(vfs).expect("project loads");
    game.upload(&mut FakeGpu);
    game
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
    }
}

#[test]
fn flip_mirrors_the_picture_and_leaves_the_hitbox_alone() {
    let mut g = project(vec![
        (
            "entities/hero.lua",
            "return nova.entity { sprite = 'dot', hitbox = { 2, 0, 6, 4 } }",
        ),
        (
            "scenes/s.lua",
            r#"local S = nova.scene {}
function S:enter()
  local a = nova.spawn('hero', 100, 100)
  a.flip_x = true
  local b = nova.spawn('hero', 300, 100)
  b.sx = -1
  nova.log(string.format('%d %d %d %d', a:bounds()))
  nova.log(string.format('%d %d %d %d', b:bounds()))
end
return S"#,
        ),
        ("main.lua", "nova.start('s')"),
    ]);
    steps(&mut g, 2);
    assert!(g.error.is_none(), "{:?}", g.error);
    // flip_x: the box is where it is for a hero facing right; a negative sx puts it on the other side of the position
    assert_eq!(g.take_log(), ["102 100 108 104", "298 100 304 104"]);
    let input = g.frame_input(540);
    let sizes: Vec<f32> = input.sprites_back.iter().map(|s| s.size[0]).collect();
    assert_eq!(sizes, [-4.0, -4.0], "both pictures are mirrored");
}

#[test]
fn the_camera_gives_screen_points_snaps_on_request_and_set_stops_following() {
    let mut g = project(vec![
        ("entities/hero.lua", "return nova.entity { sprite = 'dot' }"),
        (
            "scenes/s.lua",
            r#"local S = nova.scene {}
local function at() return string.format('%d %d', nova.cam.position()) end
function S:enter()
  self.hero = nova.spawn('hero', 1000, 300)
  nova.cam.set(0, 0)
  nova.cam.follow(self.hero, 0.1)
  nova.log(at())
  nova.cam.follow(self.hero, 0.1, true)
  nova.log(at())
  nova.log(string.format('%d %d', nova.cam.to_screen(1000, 300)))
  nova.log(string.format('%d %d', nova.cam.to_world(480, 270)))
end
function S:update()
  if self.stop then nova.cam.set(50, 60) end
end
function S:draw() nova.log(at()) end
return S"#,
        ),
        ("main.lua", "nova.start('s')"),
    ]);
    steps(&mut g, 1);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(
        g.take_log(),
        ["0 0", "1000 300", "480 270", "1000 300", "1000 300"],
        "follow after set glides unless asked to snap; the followed entity is in the middle of the screen"
    );
    g.run_lua(
        "nova.world.scene.stop = true; nova.world.scene.hero.x = 2000",
        "test",
    )
    .unwrap();
    steps(&mut g, 2);
    assert_eq!(g.take_log(), ["50 60", "50 60"], "set stops the following");
}

#[test]
fn lines_of_text_can_be_set_further_apart() {
    let mut g = project(vec![(
        "main.lua",
        r#"function draw()
  local _, h1 = nova.ui.text_size('a\nb', { font = 'pixel', size = 8 })
  local _, h2 = nova.ui.text_size('a\nb', { font = 'pixel', size = 8, line_spacing = 2 })
  local _, one = nova.ui.text_size('a', { font = 'pixel', size = 8 })
  nova.log(string.format('%.2f', (h2 - one) / (h1 - one)))
end"#,
    )]);
    steps(&mut g, 1);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.take_log(), ["2.00"]);
    let mut bad = project(vec![(
        "main.lua",
        "function draw() nova.ui.text(0, 0, 'a', { line_spacing = 9 }) end",
    )]);
    steps(&mut bad, 1);
    assert!(
        bad.error
            .clone()
            .unwrap_or_default()
            .contains("line_spacing must be from 0.5 to 4"),
        "{:?}",
        bad.error
    );
}

/// A solid thing is never overlapped by a mover that stops at it, so its collide callback never runs: `near` is how the
/// two notice each other. And asking for a kind where a tag is meant says so once.
#[test]
fn near_finds_what_a_solid_thing_stops_and_a_kind_given_as_a_tag_is_explained() {
    let mut g = project(vec![
        (
            "entities/hero.lua",
            r#"local H = nova.entity { tags = { "hero" }, hitbox = { 0, 0, 10, 10 } }
function H:update(dt)
  local x = self.x
  self.x = self.x + 60 * dt
  if self:touching("solid") then self.x = x end
end
function H:on_collide_solid() nova.log("never: the move was taken back") end
return H"#,
        ),
        (
            "entities/chest.lua",
            r#"local C = nova.entity { tags = { "solid" }, hitbox = { 0, 0, 10, 10 } }
function C:update()
  if not self.opened and self:near("hero", 3) then self.opened = true nova.log("opened at " .. math.floor(nova.first("hero").x)) end
end
return C"#,
        ),
        (
            "scenes/s.lua",
            r#"local S = nova.scene {}
function S:enter()
  nova.spawn("hero", 0, 0)
  self.chest = nova.spawn("chest", 40, 0)
  nova.log(tostring(nova.first("chest")) .. " " .. #nova.all("chest") .. " " .. tostring(nova.first("ghost")))
  nova.log(tostring(self.chest:near("hero")) .. " " .. tostring(self.chest:near("nobody")) .. " " .. tostring(self.chest:near("hero", 31) ~= nil))
end
return S"#,
        ),
        ("main.lua", "nova.start('s')"),
    ]);
    steps(&mut g, 60);
    assert!(g.error.is_none(), "{:?}", g.error);
    let log = g.take_log();
    assert_eq!(
        log[0],
        "note: nova.first(\"chest\") looks for the tag \"chest\" and no entity has it. \"chest\" is a kind (entities/chest.lua), whose tags are: solid. Ask for a tag, or add tags = { \"chest\" } to it."
    );
    assert_eq!(log[1], "nil 0 nil"); // (said once, not again for nova.all; a name that is no kind either says nothing)
    assert_eq!(log[2], "nil nil true");
    // the hero stops with his box against the chest's (x = 30 - one step): within 3 units, never overlapping
    assert_eq!(log.len(), 4, "{log:?}");
    assert!(
        log[3] == "opened at 27" || log[3] == "opened at 28",
        "{log:?}"
    );
}

/// A body that starts a move inside something solid is never thrown through it: it is moved out the nearest way by no
/// more than its own size, or stays put. `{ solid = "tag" }` makes entities block a slide too, and says which one did.
#[test]
fn slide_never_throws_a_body_through_a_wall_and_can_stop_at_tagged_entities() {
    let mut g = project(vec![
        (
            "entities/box.lua",
            "return nova.entity { hitbox = { 0, 0, 10, 10 } }",
        ),
        (
            "entities/crate.lua",
            "return nova.entity { tags = { 'crate' }, hitbox = { 0, 0, 20, 20 } }",
        ),
        (
            "scenes/s.lua",
            r#"local S = nova.scene {}
local function say(what, e, bx, by, thing)
  nova.log(string.format('%s %.1f %.1f %s %s %s', what, e.x, e.y, tostring(bx), tostring(by), thing and thing.label or '-'))
end
function S:enter()
  -- a wall three tiles thick: x 32 to 80, y 0 to 16 (4-pixel tiles drawn 16 units big)
  nova.tilemap { image = 'dot', tile_width = 4, tile_height = 4, scale = 4, solid = { 0 }, tiles = { { -1, -1, 0, 0, 0, -1, -1, -1 } } }
  local deep = nova.spawn('box', 60, 4)
  say('deep', deep, deep:slide(-2, 0))
  local shallow = nova.spawn('box', 75, 4)
  say('shallow', shallow, shallow:slide(0, 0))
  local walker = nova.spawn('box', 0, 4)
  say('walker', walker, walker:slide(40, 0))
  local c = nova.spawn('crate', 200, 0, { label = 'crate' })
  local pusher = nova.spawn('box', 150, 4)
  say('crate', pusher, pusher:slide(60, 0, { solid = 'crate' }))
  local ghost = nova.spawn('box', 150, 4)
  say('ghost', ghost, ghost:slide(60, 0))
  local inside = nova.spawn('box', 195, 4)
  say('inside', inside, inside:slide(0, 0, { solid = 'crate' }))
end
return S"#,
        ),
        ("main.lua", "nova.start('s')"),
    ]);
    steps(&mut g, 1);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(
        g.take_log(),
        [
            // 20 units out on the right, 38 on the left: both more than its size, so it stays (it used to land at 80)
            "deep 60.0 4.0 true false -",
            // 5 units from the far side: out that way
            "shallow 80.0 4.0 false false -",
            "walker 22.0 4.0 true false -",
            "crate 190.0 4.0 true false crate",
            "ghost 210.0 4.0 false false -",
            // 5 units into the crate's left side: out to the left
            "inside 190.0 4.0 false false -",
        ]
    );
}

/// A body knocked into a thick wall at speed, and into a corner, stops against it, frame after frame, and never ends up
/// in it or beyond it: the room's floor is x < 64 and y < 64, with a wall three tiles thick on the right and below.
#[test]
fn a_body_knocked_into_a_thick_wall_or_a_corner_at_speed_stays_in_the_room() {
    let mut g = project(vec![
        (
            "entities/box.lua",
            "return nova.entity { hitbox = { -10, -10, 20, 20 } }",
        ),
        (
            "scenes/s.lua",
            r#"local S = nova.scene {}
function S:enter()
  local t = {}
  for r = 0, 6 do t[r + 1] = {} for c = 0, 6 do t[r + 1][c + 1] = (c >= 4 or r >= 4) and 0 or -1 end end
  nova.tilemap { image = 'dot', tile_width = 4, tile_height = 4, scale = 4, solid = { 0 }, tiles = t }
  self.a = nova.spawn('box', 30, 30)
  self.b = nova.spawn('box', 30, 30)
end
function S:update()
  -- knock-back: 1500 units a second to the right; into the corner: 1200 a second down and right
  self.a:slide(25, 0)
  self.b:slide(20, 20)
  local worst = 0
  for _, e in ipairs({ self.a, self.b }) do
    local x0, y0, x1, y1 = e:bounds()
    worst = math.max(worst, x1 - 64, y1 - 64)
    if nova.solid_at(x1 - 0.01, y1 - 0.01) then worst = 999 end
  end
  self.worst = math.max(self.worst or -999, worst)
end
return S"#,
        ),
        ("main.lua", "nova.start('s')"),
    ]);
    steps(&mut g, 60);
    assert!(g.error.is_none(), "{:?}", g.error);
    g.run_lua(
        "local s = nova.scene_now(); nova.log(string.format('%.1f %.1f %.1f %.1f %.2f', s.a.x, s.a.y, s.b.x, s.b.y, s.worst))",
        "t",
    )
    .unwrap();
    // flush against the wall (x 54: its box ends at 64), and in the corner; never a unit into the wall
    assert_eq!(g.take_log(), ["54.0 30.0 54.0 54.0 0.00"]);
}

/// `hitbox_units = "world"`: the drawing's scale leaves the box alone (a negative sx still mirrors it); without it the
/// box is in the sprite's pixels and scaled, as before.
#[test]
fn a_hitbox_in_world_units_is_not_scaled_with_the_drawing() {
    let mut g = project(vec![
        (
            "entities/new.lua",
            "return nova.entity { sprite = 'dot', hitbox_units = 'world', hitbox = { 2, 0, 10, 6 }, sx = 3, sy = 3 }",
        ),
        (
            "entities/old.lua",
            "return nova.entity { sprite = 'dot', hitbox = { 2, 0, 10, 6 }, sx = 3, sy = 3 }",
        ),
        (
            "scenes/s.lua",
            r#"local S = nova.scene {}
function S:enter()
  local a = nova.spawn('new', 100, 100)
  local b = nova.spawn('new', 100, 100, { sx = -1.5, sy = 1.5 })
  local c = nova.spawn('old', 100, 100)
  local d = nova.spawn('new', 100, 100, { hitbox = { r = 5 } })
  for _, e in ipairs({ a, b, c, d }) do nova.log(string.format('%g %g %g %g', e:bounds())) end
end
return S"#,
        ),
        ("main.lua", "nova.start('s')"),
    ]);
    steps(&mut g, 1);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(
        g.take_log(),
        [
            "102 100 112 106",
            "98 100 108 106",
            "106 100 136 118",
            "95 95 105 105"
        ]
    );
}

/// `self.sprite` reads the sprite the class gave (it was nil, so a copy spawned with `{ sprite = self.sprite }` drew
/// nothing); an instance's own still wins.
#[test]
fn self_sprite_reads_the_class_sprite() {
    let mut g = project(vec![
        ("entities/hero.lua", "return nova.entity { sprite = 'dot' }"),
        (
            "entities/kid.lua",
            "return nova.entity(require('entities.hero'), {})",
        ),
        (
            "scenes/s.lua",
            r#"local S = nova.scene {}
function S:enter()
  local a = nova.spawn('hero', 0, 0)
  local b = nova.spawn('hero', 0, 0, { sprite = 'other' })
  local c = nova.spawn('kid', 0, 0)
  nova.log(tostring(a.sprite) .. ' ' .. tostring(b.sprite) .. ' ' .. tostring(c.sprite) .. ' ' .. tostring(a.model))
  b:destroy() -- (there is no picture called other)
end
return S"#,
        ),
        ("main.lua", "nova.start('s')"),
    ]);
    steps(&mut g, 1);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.take_log(), ["dot other dot nil"]);
}

/// Game time: `nova.time_scale` for all or for a tag, an entity's own `time_scale`, `unscaled` things that run in real
/// time, `nova.hit_stop` freezing the rest (velocity, timers, collisions too) and `nova.cam.shake` moving only the picture.
#[test]
fn time_scale_hit_stop_and_shake() {
    let mut g = project(vec![
        (
            "entities/mover.lua",
            r#"local M = nova.entity { hitbox = { 0, 0, 4, 4 }, t = 0, vx = 60 }
function M:update(dt) self.t = self.t + dt end
return M"#,
        ),
        (
            "entities/foe.lua",
            r#"local F = nova.entity { tags = { "enemy" }, hitbox = { 0, 0, 4, 4 }, t = 0, rings = 0 }
function F:create() self:every(0.25, function() self.rings = self.rings + 1 end) end
function F:update(dt) self.t = self.t + dt end
return F"#,
        ),
        (
            "scenes/s.lua",
            r#"local S = nova.scene {}
function S:enter()
  self.hero = nova.spawn('mover', 0, 0, { unscaled = true })
  self.box = nova.spawn('mover', 0, 100)
  self.half = nova.spawn('mover', 0, 200, { time_scale = 0.5 })
  self.foe = nova.spawn('foe', 0, 300)
end
function S:draw() if self.say then nova.log(string.format('drawn at %.1f %.1f', nova.cam.position())) end end
return S"#,
        ),
        ("main.lua", "nova.start('s')"),
    ]);
    let say = "local s = nova.scene_now(); nova.log(string.format('%.3f %.3f %.3f %.3f x%.1f %d', s.hero.t, s.box.t, s.half.t, s.foe.t, s.box.x, s.foe.rings))";
    steps(&mut g, 1); // (the scene comes up)
    g.run_lua("local s = nova.scene_now(); for _, e in ipairs({ s.hero, s.box, s.half, s.foe }) do e.t = 0 end; s.box.x = 0", "t").unwrap();
    steps(&mut g, 60);
    g.run_lua(say, "t").unwrap();
    // only the enemies slowed: the foe's time and its timer run at half speed
    g.run_lua("nova.time_scale(0.5, 'enemy')", "t").unwrap();
    steps(&mut g, 60);
    g.run_lua(say, "t").unwrap();
    // the whole game at a quarter, but the hero runs on in real time
    g.run_lua("nova.time_scale(1, 'enemy'); nova.time_scale(0.25)", "t")
        .unwrap();
    steps(&mut g, 60);
    g.run_lua(say, "t").unwrap();
    // a hit-stop of three frames: everything but the hero holds still, then carries on
    g.run_lua("nova.time_scale(1); nova.hit_stop(3 / 60)", "t")
        .unwrap();
    steps(&mut g, 3);
    g.run_lua(say, "t").unwrap();
    steps(&mut g, 3);
    g.run_lua(say, "t").unwrap();
    g.run_lua(
        "nova.log(string.format('%.2f %.2f %.2f', nova.time_scale(), nova.time_scale(nil, 'enemy'), nova.hit_stop()))",
        "t",
    )
    .unwrap();
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(
        g.take_log(),
        [
            "1.000 1.000 0.500 1.000 x60.0 4",
            "2.000 2.000 1.000 1.500 x120.0 6",
            "3.000 2.250 1.125 1.750 x135.0 7",
            "3.050 2.250 1.125 1.750 x135.0 7",
            "3.100 2.300 1.150 1.800 x138.0 7",
            "1.00 1.00 0.00",
        ]
    );
    // the shake moves what is drawn, and only while it lasts; the camera itself stays
    g.run_lua(
        "local s = nova.scene_now(); s.say = true; nova.cam.set(480, 270); nova.cam.shake(10, 0.1)",
        "t",
    )
    .unwrap();
    steps(&mut g, 1); // (each step draws too)
    g.run_lua(
        "nova.log(string.format('kept at %.1f %.1f', nova.cam.position()))",
        "t",
    )
    .unwrap();
    steps(&mut g, 8);
    let log = g.take_log();
    assert_eq!(log[1], "kept at 480.0 270.0", "{log:?}");
    assert_ne!(log[0], "drawn at 480.0 270.0", "{log:?}");
    assert_eq!(log.last().unwrap(), "drawn at 480.0 270.0", "{log:?}");
}

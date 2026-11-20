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

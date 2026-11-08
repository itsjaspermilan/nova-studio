//! Rigid-body physics through the framework: entities with `body = ...` fall, stack, bounce, report hits and follow their
//! bodies, in 2D (pixels, tilemaps) and 3D, from code and from scene files. Lua reports what happened through `nova.log`.

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
    let mut all = vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("sprites/crate.png", png(32, 32)),
        ("sprites/tiles.png", png(64, 32)),
    ];
    all.extend(files);
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut game = Game::load(vfs).expect("project loads");
    game.upload(&mut FakeGpu);
    game
}

fn lua(source: &str) -> Vec<u8> {
    source.as_bytes().to_vec()
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

fn run(files: Vec<(&str, Vec<u8>)>, n: usize) -> Vec<String> {
    let mut g = project(files);
    steps(&mut g, n);
    assert!(g.error.is_none(), "{:?}", g.error);
    g.take_log()
}

/// A floor of solid tiles (32-pixel tiles, tile 0 solid) across the bottom of a 20 by 10 map at (0, 0): its top is y = 288.
const FLOOR: &str = "local row = {} for i = 1, 20 do row[i] = -1 end\n\
  local tiles = {} for r = 1, 9 do tiles[r] = row end\n\
  local floor = {} for i = 1, 20 do floor[i] = 0 end\n\
  tiles[10] = floor\n\
  nova.tilemap { image = 'tiles', tile_width = 32, tile_height = 32, tiles = tiles, solid = { 0 } }\n";

#[test]
fn a_2d_crate_falls_onto_solid_tiles_and_rests_there() {
    let l = run(
        vec![
            (
                "entities/box.lua",
                lua("return nova.entity { sprite = 'crate', body = 'dynamic' }"),
            ),
            (
                "scenes/s.lua",
                lua(&format!(
                    "local S = nova.scene {{}}\nfunction S:enter()\n{FLOOR}  self.c = nova.spawn('box', 100, 50)\nend\n\
                     function S:update() nova.log(string.format('%.1f %.3f %s', self.c.y, self.c.angle, tostring(self.c:sleeping()))) end\nreturn S"
                )),
            ),
            ("main.lua", lua("nova.start('s')")),
        ],
        240,
    );
    let last: Vec<&str> = l.last().unwrap().split(' ').collect();
    let y: f32 = last[0].parse().unwrap();
    assert!(
        (y - 272.0).abs() < 1.0,
        "rests on the tiles (centre 16 px above 288): {l:?}"
    );
    assert_eq!(last[1].parse::<f32>().unwrap().abs(), 0.0);
    assert_eq!(last[2], "true", "and sleeps");
    // it fell: the first steps go down, never up
    let ys: Vec<f32> = l
        .iter()
        .map(|s| s.split(' ').next().unwrap().parse().unwrap())
        .collect();
    assert!(ys[10] > ys[0] && ys[0] >= 50.0);
}

#[test]
fn on_hit_names_the_other_entity_and_how_hard_and_sensors_report_entering_and_leaving() {
    let l = run(
        vec![
            (
                "entities/ball.lua",
                lua(
                    "local B = nova.entity { sprite = 'crate', body = 'dynamic', shape = 'circle', radius = 10, tags = { 'ball' } }\n\
                     function B:on_hit(other, hit)\n  nova.log(string.format('hit %s %s %.0f %.2f', tostring(other.name), tostring(hit.sensor), hit.speed, hit.ny))\nend\n\
                     return B",
                ),
            ),
            (
                "entities/zone.lua",
                lua(
                    "local Z = nova.entity { body = 'static', sensor = true, w = 200, h = 20 }\n\
                     function Z:on_hit(other) nova.log('enter ' .. tostring(other:is_alive())) end\n\
                     function Z:on_leave(other) nova.log('leave') end\nreturn Z",
                ),
            ),
            (
                "scenes/s.lua",
                lua(&format!(
                    "local S = nova.scene {{}}\nfunction S:enter()\n{FLOOR}  nova.world.tags.nova_tilemap[1].name = 'floor'\n  nova.spawn('zone', 100, 150)\n  nova.spawn('ball', 100, 50)\nend\nreturn S"
                )),
            ),
            ("main.lua", lua("nova.start('s')")),
        ],
        120,
    );
    let i_enter = l
        .iter()
        .position(|s| s == "enter true")
        .expect("entered the zone");
    let i_leave = l.iter().position(|s| s == "leave").expect("left it");
    let i_floor = l
        .iter()
        .position(|s| s.starts_with("hit floor false"))
        .expect("hit the floor");
    assert!(i_enter < i_leave && i_leave < i_floor, "{l:?}");
    let f: Vec<&str> = l[i_floor].split(' ').collect();
    let speed: f32 = f[3].parse().unwrap();
    // fell about 230 px at 9.81 m/s2 x 50 px/m: about 475 px/s
    assert!(speed > 380.0 && speed < 560.0, "{l:?}");
    // the floor is below: the normal from the ball to the floor points down the screen
    assert!(f[4].parse::<f32>().unwrap() > 0.9, "{l:?}");
    // the sensor's entry was reported to the ball as a sensor hit
    assert!(l.iter().any(|s| s.starts_with("hit nil true")), "{l:?}");
}

#[test]
fn a_3d_stack_of_boxes_from_a_scene_file_stands_until_a_heavy_ball_knocks_it_over() {
    // the level is data: a ground and five crates placed in the scene, each with its body in props
    let mut objects = vec![
        r#"{"kind":"block","x":0,"y":-0.5,"z":0,"props":{"body":"static","w":20,"h":1,"d":20,"name_tag":"ground"}}"#.to_string(),
    ];
    for i in 0..5 {
        objects.push(format!(r#"{{"kind":"block","x":0,"y":{},"z":0,"props":{{"body":"dynamic","w":1,"h":1,"d":1}}}}"#, 0.5 + i as f32 * 1.01));
    }
    let scene = format!(r#"{{"version":1,"objects":[{}]}}"#, objects.join(","));
    let files = |kick: bool| {
        vec![
            (
                "entities/block.lua",
                lua("return nova.entity { dim = 3, tags = { 'block' } }"),
            ),
            ("scenes/s.scene.json", scene.clone().into_bytes()),
            (
                "scenes/s.lua",
                lua(&format!(
                    "local S = nova.scene {{}}\nfunction S:update()\n  self.t = (self.t or 0) + 1\n\
                     if {kick} and self.t == 120 then\n    local b = nova.spawn(nova.entity {{ dim = 3, body = 'dynamic', shape = 'sphere', radius = 0.4, mass = 3000, bullet = true }}, -4, 0.6, {{ z = 0, vx = 14 }})\n  end\n\
                     if self.t % 60 == 0 then\n    local top = 0\n    nova.each('block', function(e) if e.body == 'dynamic' then top = math.max(top, e.y) end end)\n    nova.log(string.format('%.2f', top))\n  end\nend\nreturn S"
                )),
            ),
            ("main.lua", lua("nova.start('s')")),
        ]
    };
    let still = run(files(false), 360);
    let top: f32 = still.last().unwrap().parse().unwrap();
    assert!((top - 4.5).abs() < 0.1, "the stack stands: {still:?}");
    let knocked = run(files(true), 360);
    let top: f32 = knocked.last().unwrap().parse().unwrap();
    assert!(top < 2.0, "the stack fell: {knocked:?}");
    // and the same run gives the same numbers again
    assert_eq!(knocked, run(files(true), 360));
}

#[test]
fn a_3d_body_turns_its_entity_and_teleporting_the_entity_moves_the_body() {
    let l = run(
        vec![
            (
                "scenes/s.lua",
                lua(
                    "local S = nova.scene {}\nfunction S:enter()\n  nova.spawn(nova.entity { dim = 3, body = 'static', w = 20, h = 1, d = 20 }, 0, -0.5, { z = 0 })\n\
                     -- a box dropped on its edge topples and lies flat\n\
                     self.c = nova.spawn(nova.entity { dim = 3, body = 'dynamic', w = 1, h = 1, d = 1 }, 0, 2, { z = 0, rz = 0.6 })\nend\n\
                     function S:update()\n  self.t = (self.t or 0) + 1\n  if self.t == 200 then\n    local q = self.c.quat\n\
                     local up = 1 - 2 * (q.x * q.x + q.z * q.z) -- how upright the box's own y is\n    nova.log(string.format('%.2f %.2f', self.c.y, math.abs(up)))\n\
                     self.c.x, self.c.y = 5, 3\n  end\n  if self.t == 209 then nova.log(string.format('%.2f %.2f', self.c.x, self.c.y)) end\nend\nreturn S",
                ),
            ),
            ("main.lua", lua("nova.start('s')")),
        ],
        210,
    );
    let a: Vec<f32> = l[0].split(' ').map(|v| v.parse().unwrap()).collect();
    assert!((a[0] - 0.5).abs() < 0.05, "lies on the ground: {l:?}");
    // lying on a face: its own up is along y, or along x or z (then 0)
    assert!(a[1] > 0.98 || a[1] < 0.02, "flat on a face: {l:?}");
    let b: Vec<f32> = l[1].split(' ').map(|v| v.parse().unwrap()).collect();
    assert!(
        (b[0] - 5.0).abs() < 0.01 && b[1] < 2.95 && b[1] > 2.6,
        "moved and falling from there: {l:?}"
    );
}

#[test]
fn a_character_walks_shoves_a_crate_and_raycasts_find_entities() {
    let l = run(
        vec![
            (
                "scenes/s.lua",
                lua(
                    "local S = nova.scene {}\nfunction S:enter()\n  nova.spawn(nova.entity { dim = 3, body = 'static', w = 20, h = 1, d = 20 }, 0, -0.5, { z = 0 })\n\
                     self.crate = nova.spawn(nova.entity { dim = 3, body = 'dynamic', w = 1, h = 1, d = 1, mass = 10, name = 'crate' }, 0, 0.5, { z = 0 })\n\
                     self.me = nova.spawn(nova.entity { dim = 3, body = 'character', shape = 'capsule', radius = 0.4, height = 1.8 }, -3, 0.9, { z = 0 })\nend\n\
                     function S:update()\n  self.me:walk(3 / 60, -0.1, 0)\n  self.t = (self.t or 0) + 1\n  if self.t == 180 then\n\
                     local e, hit = nova.physics.raycast3(0, 5, 0, 0, -1, 0, 10, { ignore = self.me })\n\
                     nova.log(string.format('%.2f %.2f %s %s', self.crate.x, self.me.x, tostring(self.me.on_ground), tostring(e and e.name)))\n  end\nend\nreturn S",
                ),
            ),
            ("main.lua", lua("nova.start('s')")),
        ],
        185,
    );
    let f: Vec<&str> = l[0].split(' ').collect();
    let (cx, mx): (f32, f32) = (f[0].parse().unwrap(), f[1].parse().unwrap());
    assert!(cx > 0.5 && mx < cx, "{l:?}");
    assert_eq!(f[2], "true", "{l:?}");
    // the ray straight down at x = 0 meets the ground (the crate was pushed off it) or the crate
    assert!(f[3] == "nil" || f[3] == "crate", "{l:?}");
}

#[test]
fn destroying_an_entity_removes_its_body_and_a_new_scene_starts_empty() {
    let l = run(
        vec![
            (
                "scenes/s.lua",
                lua(
                    "local S = nova.scene {}\nfunction S:enter()\n  self.a = nova.spawn(nova.entity { body = 'dynamic', w = 10, h = 10 }, 0, 0)\n  nova.spawn(nova.entity { body = 'dynamic', w = 10, h = 10 }, 50, 0)\nend\n\
                     function S:update()\n  self.t = (self.t or 0) + 1\n  if self.t == 2 then nova.log(nova.physics.count()) self.a:destroy() end\n\
                     if self.t == 3 then nova.log(nova.physics.count()) nova.goto_scene('t') end\nend\nreturn S",
                ),
            ),
            (
                "scenes/t.lua",
                lua(
                    "local T = nova.scene {}\nfunction T:enter() nova.log('t ' .. nova.physics.count()) end\nreturn T",
                ),
            ),
            ("main.lua", lua("nova.start('s')")),
        ],
        6,
    );
    assert_eq!(l, vec!["2", "1", "t 0"]);
}

#[test]
fn a_hinged_plank_swings_under_a_joint_and_push_changes_velocity_whatever_the_mass() {
    let l = run(
        vec![
            (
                "scenes/s.lua",
                lua(
                    "local S = nova.scene {}\nfunction S:enter()\n  self.p = nova.spawn(nova.entity { body = 'dynamic', w = 100, h = 10 }, 50, 0)\n\
                     self.p:join(nil, 'hinge', { x = 0, y = 0 })\n\
                     self.light = nova.spawn(nova.entity { body = 'dynamic', w = 10, h = 10, gravity = 0 }, 500, 0)\n\
                     self.heavy = nova.spawn(nova.entity { body = 'dynamic', w = 10, h = 10, gravity = 0, mass = 500 }, 500, 100)\n\
                     self.light:push(100, 0) self.heavy:push(100, 0)\nend\n\
                     function S:update()\n  self.t = (self.t or 0) + 1\n  if self.t == 30 then\n    local d = math.sqrt(self.p.x ^ 2 + self.p.y ^ 2)\n\
                     nova.log(string.format('%.1f %.2f %.1f %.1f', d, self.p.angle, self.light.vx, self.heavy.vx))\n  end\nend\nreturn S",
                ),
            ),
            ("main.lua", lua("nova.start('s')")),
        ],
        31,
    );
    let f: Vec<f32> = l[0].split(' ').map(|v| v.parse().unwrap()).collect();
    assert!(
        (f[0] - 50.0).abs() < 1.5,
        "the plank's centre stays 50 px from the hinge: {l:?}"
    );
    assert!(
        f[1] > 0.3,
        "and it swings down (clockwise on the screen): {l:?}"
    );
    assert!(
        (f[2] - 100.0).abs() < 1.0 && (f[3] - 100.0).abs() < 1.0,
        "{l:?}"
    );
}

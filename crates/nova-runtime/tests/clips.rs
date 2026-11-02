//! Model animation clips: read from the .glb the studio exports, sampled by `nova.model`, played by entities.

use std::cell::Cell;
use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::input::Actions;
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{MemVfs, Vfs};

/// `animated()` in studio/src/lib/model-anim.test.ts: a `body` (16-unit cube) with a child `wheel` at (6, 2, 8),
/// 1/16 scale, and a 2 second clip "spin": the wheel turns 0 to 180 degrees about z, the body rises from y 0 to
/// 4 units over the first second and then holds.
const CAR: &[u8] = include_bytes!("fixtures/studio_model_anim.glb");

#[derive(Default)]
struct CountingGpu(Cell<usize>);
impl Uploader for CountingGpu {
    fn set_atlas(&mut self, _: &Image) {}
    fn add_mesh(&mut self, _: &MeshData) -> usize {
        let n = self.0.get();
        self.0.set(n + 1);
        n
    }
}

fn game(files: Vec<(&str, &str)>) -> Game {
    let mut all = vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/car.glb", CAR.to_vec()),
    ];
    all.extend(files.into_iter().map(|(p, s)| (p, s.as_bytes().to_vec())));
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut g = Game::load(vfs).expect("project loads");
    g.upload(&mut CountingGpu::default());
    g
}

fn frame(g: &mut Game) {
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
}

/// The body's and the wheel's draw matrices (the wheel was uploaded second, so it has the larger mesh id).
fn body_and_wheel(g: &Game) -> ([[f32; 4]; 4], [[f32; 4]; 4]) {
    let input = g.frame_input(0);
    assert_eq!(input.models.len(), 2, "a clip draws every part separately");
    let mut draws: Vec<_> = input.models.to_vec();
    draws.sort_by_key(|m| m.mesh);
    (draws[0].instance.matrix, draws[1].instance.matrix)
}

fn drawn_at(opts: &str) -> ([[f32; 4]; 4], [[f32; 4]; 4]) {
    let mut g = game(vec![(
        "main.lua",
        &format!("function update(dt) nova.model('car', 0, 0, 0, {opts}) end"),
    )]);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    body_and_wheel(&g)
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-4
}

#[test]
fn the_clip_list_has_names_and_lengths() {
    let mut g = game(vec![(
        "main.lua",
        "local c = nova.model_clips('car')\nnova.log(#c .. ' ' .. c[1].name .. ' ' .. c[1].duration)",
    )]);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.take_log(), ["1 spin 2.0"]);
}

#[test]
fn a_clip_poses_parts_at_a_time_and_the_wheel_inherits_the_body() {
    // t = 0.5: the body has risen halfway (2 units = 0.125), the wheel is a quarter turn into its half turn.
    let (body, wheel) = drawn_at("{ clip = 'spin', time = 0.5 }");
    assert!(close(body[3][1], 2.0 / 16.0), "body y {:?}", body[3]);
    assert!(
        close(wheel[3][0], 6.0 / 16.0)
            && close(wheel[3][1], 4.0 / 16.0)
            && close(wheel[3][2], 8.0 / 16.0),
        "wheel follows the body: {:?}",
        wheel[3]
    );
    // At t = 1 the wheel has turned 90 degrees about z: its x axis points along +y.
    let (_, wheel) = drawn_at("{ clip = 'spin', time = 1.0 }");
    assert!(
        close(wheel[0][0], 0.0) && close(wheel[0][1], 1.0),
        "x axis after a quarter turn of z: {:?}",
        wheel[0]
    );
    // Before any time has passed it is the authored pose.
    let (body, wheel) = drawn_at("{ clip = 'spin' }");
    assert!(close(body[3][1], 0.0));
    assert!(
        close(wheel[0][0], 1.0) && close(wheel[0][1], 0.0),
        "{:?}",
        wheel[0]
    );
}

#[test]
fn looping_wraps_time_and_holding_stops_at_the_end() {
    let (looped, _) = drawn_at("{ clip = 'spin', time = 2.5 }"); // wraps to 0.5
    assert!(close(looped[3][1], 2.0 / 16.0), "{:?}", looped[3]);
    let (held, wheel) = drawn_at("{ clip = 'spin', time = 2.5, loop = false }"); // held at the end: body up 4, wheel half turn
    assert!(close(held[3][1], 4.0 / 16.0), "{:?}", held[3]);
    assert!(close(wheel[0][0], -1.0), "half a turn: {:?}", wheel[0]);
}

#[test]
fn script_turns_apply_on_top_of_the_clip() {
    // The clip leaves the wheel's x shift alone; the script adds a shift in the wheel's (turned) space.
    let (_, plain) = drawn_at("{ clip = 'spin', time = 1.0 }");
    let (_, shifted) = drawn_at("{ clip = 'spin', time = 1.0, parts = { wheel = { x = 1 } } }");
    // The wheel's x axis points along +y at t = 1, so a shift of 1 along x moves it +1 in y.
    assert!(
        close(shifted[3][1], plain[3][1] + 1.0),
        "plain {:?} shifted {:?}",
        plain[3],
        shifted[3]
    );
}

#[test]
fn unknown_clips_are_explained() {
    let mut g = game(vec![(
        "main.lua",
        "function update(dt) nova.model('car', 0, 0, 0, { clip = 'fly' }) end",
    )]);
    frame(&mut g);
    let e = g.error.clone().unwrap_or_default();
    assert!(e.contains("has no clip 'fly' (its clips: spin)"), "{e}");
}

const ENTITY: &str = "local C = nova.entity { model = 'car' }\nfunction C:on_clip_end(name) nova.log('end ' .. name) end\nreturn C";

fn entity_game(enter: &str) -> Game {
    game(vec![
        ("main.lua", "nova.start('s')"),
        ("entities/car.lua", ENTITY),
        (
            "scenes/s.lua",
            &format!(
                "local S = nova.scene {{}}\nfunction S:enter() self.car = nova.spawn('car', 0, 0)\n{enter}\nend\nreturn S"
            ),
        ),
    ])
}

#[test]
fn entities_play_clips_that_advance_with_time_and_loop() {
    let mut g = entity_game("self.car:play_clip('spin')");
    for _ in 0..60 {
        frame(&mut g); // one second of fixed steps
    }
    assert!(g.error.is_none(), "{:?}", g.error);
    let (body, _) = body_and_wheel(&g);
    assert!(
        (body[3][1] - 4.0 / 16.0).abs() < 0.01,
        "after a second the body is up: {:?}",
        body[3]
    );
    for _ in 0..90 {
        frame(&mut g); // 2.5 seconds in: past the 2 second end, so it has wrapped to 0.5
    }
    let (body, _) = body_and_wheel(&g);
    assert!(
        (body[3][1] - 2.0 / 16.0).abs() < 0.01,
        "wrapped around: {:?}",
        body[3]
    );
    assert!(g.take_log().is_empty(), "a looping clip never ends");
}

#[test]
fn a_clip_that_does_not_loop_ends_once_and_holds() {
    let mut g = entity_game("self.car:play_clip('spin', { loop = false })");
    for _ in 0..150 {
        frame(&mut g); // 2.5 seconds
    }
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.take_log(), ["end spin"]);
    let (body, wheel) = body_and_wheel(&g);
    assert!(close(body[3][1], 4.0 / 16.0), "{:?}", body[3]);
    assert!(close(wheel[0][0], -1.0), "{:?}", wheel[0]);
}

#[test]
fn entity_clip_mistakes_are_explained() {
    let mut g = entity_game("self.car:play_clip('dance')");
    frame(&mut g);
    frame(&mut g);
    let e = g.error.clone().unwrap_or_default();
    assert!(e.contains("has no clip 'dance' (its clips: spin)"), "{e}");
    let mut g = game(vec![
        ("main.lua", "nova.start('s')"),
        ("entities/plain.lua", "return nova.entity {}"),
        (
            "scenes/s.lua",
            "local S = nova.scene {}\nfunction S:enter() nova.spawn('plain', 0, 0):play_clip('spin') end\nreturn S",
        ),
    ]);
    frame(&mut g);
    frame(&mut g);
    let e = g.error.clone().unwrap_or_default();
    assert!(e.contains("this entity has no model"), "{e}");
}

#[test]
fn stopping_a_clip_returns_to_the_authored_pose() {
    let mut g = entity_game("self.car:play_clip('spin')\nself.car:stop_clip()");
    frame(&mut g);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(
        g.frame_input(0).models.len(),
        1,
        "back to the single instanced draw"
    );
}

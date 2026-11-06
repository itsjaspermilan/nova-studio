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

#[test]
fn layers_mix_clips_by_weight() {
    let at = |t: f32| drawn_at(&format!("{{ clip = 'spin', time = {t} }}"));
    let (body0, wheel0) = at(0.0);
    let (body1, wheel1) = at(1.0);
    let mid = |a: f32, b: f32, w: f32| a + (b - a) * w;
    // equal weights: halfway between the two instants
    let (body, wheel) = drawn_at(
        "{ layers = { { clip = 'spin', time = 0, weight = 1 }, { clip = 'spin', time = 1, weight = 1 } } }",
    );
    for i in 0..4 {
        assert!(
            (body[3][i] - mid(body0[3][i], body1[3][i], 0.5)).abs() < 1e-4,
            "body {i}: {body:?}"
        );
    }
    // the wheel turns half as far as it does by t = 1 (its angle is linear in time): the same as t = 0.5
    let (_, wheel_half) = at(0.5);
    for c in 0..3 {
        for r in 0..3 {
            assert!(
                (wheel[c][r] - wheel_half[c][r]).abs() < 2e-3,
                "wheel [{c}][{r}]: {wheel:?} vs {wheel_half:?}"
            );
        }
    }
    // weights are relative: 3 to 1 is a quarter of the way
    let (body, _) = drawn_at(
        "{ layers = { { clip = 'spin', time = 0, weight = 3 }, { clip = 'spin', time = 1, weight = 1 } } }",
    );
    for i in 0..4 {
        assert!((body[3][i] - mid(body0[3][i], body1[3][i], 0.25)).abs() < 1e-4);
    }
    // a layer of no weight does nothing; one layer on its own is that clip
    let (body, wheel) = drawn_at(
        "{ layers = { { clip = 'spin', time = 1, weight = 1 }, { clip = 'spin', time = 0, weight = 0 } } }",
    );
    for c in 0..4 {
        for r in 0..4 {
            assert!(
                (body[c][r] - body1[c][r]).abs() < 1e-4
                    && (wheel[c][r] - wheel1[c][r]).abs() < 1e-4
            );
        }
    }
    let _ = (body0, wheel0);
}

#[test]
fn bad_layers_are_explained() {
    for (opts, expect) in [
        ("{ layers = { { clip = 'nope' } } }", "has no clip 'nope'"),
        (
            "{ layers = { { weight = 1 } } }",
            "each layer needs a clip name",
        ),
        (
            "{ layers = { { clip = 'spin', weight = -1 } } }",
            "weight must be 0 or more",
        ),
        (
            "{ layers = {}, clip = 'spin' }",
            "`clip` or `layers`, not both",
        ),
        (
            "{ layers = { { clip = 'spin' } }, lod = 'car' }",
            "lod works on plain models",
        ),
    ] {
        let mut g = game(vec![(
            "main.lua",
            &format!("function update(dt) nova.model('car', 0, 0, 0, {opts}) end"),
        )]);
        frame(&mut g);
        let error = g.error.clone().unwrap_or_default();
        assert!(error.contains(expect), "{opts}: {error}");
    }
}

#[test]
fn an_animator_crossfades_between_states_and_returns_when_a_one_shot_ends() {
    let mut g = game(vec![(
        "main.lua",
        "local anim = nova.animator('car', { start = 'a', fade = 0.5, states = {
  a = { clip = 'spin' },
  b = { clip = 'spin', loop = false, speed = 2, next = 'a' },
  c = { clip = 'spin', loop = false, speed = 2 },
} })
local n = 0
function update(dt)
  n = n + 1
  if n == 1 then anim:play('b') end
  if n == 100 then anim:play('c') end
  anim:update(dt)
  local l, total, parts = anim:layers(), 0, {}
  for _, x in ipairs(l) do total = total + x.weight; parts[#parts + 1] = string.format('%.2f', x.weight) end
  nova.log(string.format('%d %s %d %.3f %s %s', n, anim:state(), #l, total, tostring(anim:finished()), table.concat(parts, ',')))
  anim:draw(0, 0, 0)
end",
    )]);
    let mut log = Vec::new();
    for _ in 0..200 {
        frame(&mut g);
        assert!(g.error.is_none(), "{:?}", g.error);
        log.extend(g.take_log());
    }
    let row = |n: usize| -> Vec<&str> { log[n - 1].split(' ').collect() };
    // right after play: both states, the old one nearly all of it, weights adding up to one
    assert_eq!((row(1)[1], row(1)[2]), ("b", "2"));
    assert!(
        row(1)[3] == "1.000" && row(1)[5].starts_with("0.9"),
        "{:?}",
        row(1)
    );
    // half way through the fade: about half each
    assert!(
        row(15)[5].starts_with("0.5") || row(15)[5].starts_with("0.4"),
        "{:?}",
        row(15)
    );
    // after the fade only the new state remains
    assert_eq!(row(40)[2], "1", "{:?}", row(40));
    // the one-shot (2 s at double speed) ends at about frame 60 and sends it back to 'a', with another crossfade
    assert_eq!(row(55)[1], "b");
    assert!(
        log.iter().any(|l| l.split(' ').nth(4) == Some("true")),
        "it finished"
    );
    assert_eq!(row(80)[1], "a", "{:?}", row(80));
    assert_eq!(row(95)[2], "1", "settled on one clip: {:?}", row(95));
    // a one-shot with nowhere to go holds its end and says it has finished
    assert_eq!(row(200)[1], "c");
    assert_eq!(row(200)[4], "true", "{:?}", row(200));
    // mistakes are explained
    for (script, expect) in [
        (
            "nova.animator('car', { states = { a = { clip = 'nope' } }, start = 'a' })",
            "has no clip 'nope'",
        ),
        (
            "nova.animator('car', { states = { a = { clip = 'spin' } } })",
            "no state 'idle' to start in",
        ),
        (
            "local a = nova.animator('car', { start = 'a', states = { a = { clip = 'spin' } } }) a:play('z')",
            "has no state 'z'",
        ),
        (
            "nova.animator('car', { start = 'a', states = { a = { blend = 'v', points = { { 0, 'spin' } } } } })",
            "at least two",
        ),
    ] {
        let mut g = game(vec![(
            "main.lua",
            &format!("function update(dt) {script} end"),
        )]);
        frame(&mut g);
        let error = g.error.clone().unwrap_or_default();
        assert!(error.contains(expect), "{script}: {error}");
    }
}

#[test]
fn a_blend_state_mixes_the_two_nearest_points_by_a_number() {
    let mut g = game(vec![(
        "main.lua",
        "local anim = nova.animator('car', { start = 'move', states = { move = { blend = 'speed', points = { { 0, 'spin' }, { 2, 'spin' }, { 6, 'spin' } } } } })
local n = 0
function update(dt)
  n = n + 1
  anim:set('speed', ({ 0, 1, 2, 4, 9 })[(n - 1) % 5 + 1])
  anim:update(dt)
  local parts = {}
  for _, x in ipairs(anim:layers()) do parts[#parts + 1] = string.format('%.2f', x.weight) end
  nova.log(table.concat(parts, ','))
end",
    )]);
    let mut log = Vec::new();
    for _ in 0..5 {
        frame(&mut g);
        assert!(g.error.is_none(), "{:?}", g.error);
        log.extend(g.take_log());
    }
    // speed 0: the first point alone; 1: half and half of the first two; 2: the second alone; 4: half of the last two; 9: the last
    assert_eq!(log, ["1.00", "0.50,0.50", "1.00", "0.50,0.50", "1.00"]);
}

#[test]
fn a_masked_layer_is_laid_over_the_mix_on_its_own_parts_only() {
    let at = |t: f32| drawn_at(&format!("{{ clip = 'spin', time = {t} }}"));
    let (body0, wheel0) = at(0.0);
    let (body1, wheel1) = at(1.0);
    // the wheel turns as the overlay's wheel does (t = 1); the body is the base's (t = 0). (The wheel is the body's child, so its place
    // in the world is the base body's carrying the overlay's wheel: its turn is what to compare.)
    let (body, wheel) = drawn_at(
        "{ layers = { { clip = 'spin', time = 0, weight = 1 }, { clip = 'spin', time = 1, weight = 1, mask = { 'wheel' } } } }",
    );
    for c in 0..4 {
        for r in 0..4 {
            assert!(
                (body[c][r] - body0[c][r]).abs() < 1e-4,
                "the body is the base's: {body:?} vs {body0:?}"
            );
        }
    }
    for c in 0..3 {
        for r in 0..3 {
            assert!(
                (wheel[c][r] - wheel1[c][r]).abs() < 2e-3,
                "the wheel turns as the overlay's: {wheel:?} vs {wheel1:?}"
            );
        }
    }
    assert!(
        (wheel[3][1] - wheel0[3][1]).abs() < 2e-3,
        "and stands where the base's body puts it: {wheel:?} vs {wheel0:?}"
    );
    // half an amount is half way (the wheel at t = 0.5, which is half its turn)
    let (_, half) = drawn_at(
        "{ layers = { { clip = 'spin', time = 0, weight = 1 }, { clip = 'spin', time = 1, weight = 0.5, mask = { 'wheel' } } } }",
    );
    let (_, wheel_half) = at(0.5);
    for c in 0..3 {
        for r in 0..3 {
            assert!(
                (half[c][r] - wheel_half[c][r]).abs() < 5e-3,
                "half way: {half:?} vs {wheel_half:?}"
            );
        }
    }
    let _ = body1;
    // a mask naming a part the model does not have is explained
    let mut g = game(vec![(
        "main.lua",
        "function update(dt) nova.model('car', 0, 0, 0, { layers = { { clip = 'spin', mask = { 'tail' } } } }) end",
    )]);
    frame(&mut g);
    let e = g.error.clone().unwrap_or_default();
    assert!(e.contains("has no part 'tail' for a layer's mask"), "{e}");
}

#[test]
fn an_additive_layer_adds_how_far_it_is_from_the_rest_pose() {
    let at = |t: f32| drawn_at(&format!("{{ clip = 'spin', time = {t} }}"));
    // no layer of any weight: the authored pose
    let (rest_body, _) = drawn_at("{ layers = { { clip = 'spin', time = 0, weight = 0 } } }");
    let (body0, _) = at(0.0);
    let (body1, _) = at(1.0);
    let (added, _) = drawn_at(
        "{ layers = { { clip = 'spin', time = 0 }, { clip = 'spin', time = 1, weight = 1, additive = true } } }",
    );
    // the place: the base's plus the overlay's distance from the rest
    for i in 0..3 {
        let expected = body0[3][i] + (body1[3][i] - rest_body[3][i]);
        assert!(
            (added[3][i] - expected).abs() < 1e-4,
            "axis {i}: {added:?} expected {expected}"
        );
    }
    // half the weight, half the distance
    let (half, _) = drawn_at(
        "{ layers = { { clip = 'spin', time = 0 }, { clip = 'spin', time = 1, weight = 0.5, additive = true } } }",
    );
    for i in 0..3 {
        let expected = body0[3][i] + (body1[3][i] - rest_body[3][i]) * 0.5;
        assert!((half[3][i] - expected).abs() < 1e-4, "half, axis {i}");
    }
    // an additive layer of no weight does nothing
    let (none, _) = drawn_at(
        "{ layers = { { clip = 'spin', time = 0 }, { clip = 'spin', time = 1, weight = 0, additive = true } } }",
    );
    for i in 0..4 {
        assert!((none[3][i] - body0[3][i]).abs() < 1e-4);
    }
}

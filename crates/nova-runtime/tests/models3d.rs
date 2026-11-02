//! Lights and model parts: the Lua API, what reaches the renderer, and (when a GPU is present) the pixels.

use std::cell::Cell;
use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::gfx::{Gfx, MAX_POINT_LIGHTS};
use nova_runtime::input::Actions;
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{MemVfs, Vfs};

/// What the studio's exporter writes for its sample: a 16-unit `body` cube and a `wheel` part at (6, 2, 8)
/// units, turned 90 degrees about z, at 1/16 scale (see studio/src/lib/model-doc.test.ts).
const CAR: &[u8] = include_bytes!("fixtures/studio_model.glb");

/// Gives every uploaded mesh its own id, like the real GPU.
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

fn game(main: &str, extra: Vec<(&str, Vec<u8>)>) -> Game {
    let mut all = vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/car.glb", CAR.to_vec()),
        ("main.lua", main.as_bytes().to_vec()),
    ];
    all.extend(extra);
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut g = Game::load(vfs).expect("project loads");
    g.upload(&mut CountingGpu::default());
    g
}

fn frame(g: &mut Game) {
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
}

#[test]
fn model_parts_are_listed_in_tree_order() {
    let mut g = game(
        "nova.log(table.concat(nova.model_parts('car'), ','))",
        vec![],
    );
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.take_log(), ["body,wheel"]);
}

#[test]
fn a_model_is_one_draw_until_a_script_turns_a_part_and_then_one_per_piece() {
    let mut g = game("function update(dt) nova.model('car', 0, 0, 0) end", vec![]);
    frame(&mut g);
    assert_eq!(
        g.frame_input(0).models.len(),
        1,
        "whole model, one instanced draw"
    );
    let mut g = game(
        "function update(dt) nova.model('car', 0, 0, 0, { parts = { wheel = { rx = 1 } } }) end",
        vec![],
    );
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.frame_input(0).models.len(), 2, "body and wheel");
}

#[test]
fn a_part_turns_about_its_pivot_and_shifts_in_its_own_space() {
    let draw = |opts: &str| {
        let mut g = game(
            &format!(
                "function update(dt) nova.model('car', 0, 0, 0, {{ parts = {{ wheel = {opts} }} }}) end"
            ),
            vec![],
        );
        frame(&mut g);
        assert!(g.error.is_none(), "{:?}", g.error);
        let input = g.frame_input(0);
        // The wheel was uploaded after the body, so it has the larger mesh id.
        let wheel = *input.models.iter().max_by_key(|m| m.mesh).expect("a draw");
        wheel.instance.matrix[3]
    };
    let pivot = [6.0 / 16.0, 2.0 / 16.0, 8.0 / 16.0];
    let close = |a: [f32; 4], b: [f32; 3]| (0..3).all(|i| (a[i] - b[i]).abs() < 1e-4);
    assert!(close(draw("{}"), pivot), "unturned: at its authored pivot");
    assert!(
        close(draw("{ ry = 2.0, rx = 0.7 }"), pivot),
        "turning keeps the pivot where it was"
    );
    // A shift of 1 along x in the wheel's own space; the wheel is turned 90 degrees about z, so that is +y in the model.
    assert!(
        close(draw("{ x = 1 }"), [pivot[0], pivot[1] + 1.0, pivot[2]]),
        "shifted in its own space"
    );
}

#[test]
fn bad_part_names_and_values_are_explained() {
    for (script, expect) in [
        (
            "nova.model('car', 0,0,0, { parts = { door = {} } })",
            "has no part 'door' (its parts: body, wheel)",
        ),
        (
            "nova.model('car', 0,0,0, { parts = { wheel = { rx = 1/0 } } })",
            "finite number",
        ),
        (
            "nova.model('car', 0,0,0, { parts = { wheel = { scale = 0 } } })",
            "greater than 0",
        ),
    ] {
        let mut g = game(&format!("function update(dt) {script} end"), vec![]);
        frame(&mut g);
        let e = g.error.clone().unwrap_or_default();
        assert!(e.contains(expect), "{script}: {e}");
    }
}

#[test]
fn entities_pass_their_parts_to_the_model() {
    let mut g = game(
        "nova.start('s')",
        vec![
            ("entities/car.lua", b"return nova.entity { model = 'car' }".to_vec()),
            (
                "scenes/s.lua",
                b"local S = nova.scene {}\nfunction S:enter() self.car = nova.spawn('car', 0, 0, { parts = { wheel = { rx = 0.5 } } }) end\nreturn S".to_vec(),
            ),
        ],
    );
    frame(&mut g);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(
        g.frame_input(0).models.len(),
        2,
        "turned parts reach the draw list"
    );
}

#[test]
fn the_sun_and_ambient_persist_and_point_lights_last_one_frame() {
    let mut g = game(
        "function update(dt)\n  nova.light { dir = {0, -1, 0}, color = {255, 128, 0}, ambient = {51, 51, 51} }\n  if nova.time() < 0.5 then nova.point_light(1, 2, 3, { radius = 5, color = {255, 0, 0} }) end\nend",
        vec![],
    );
    frame(&mut g);
    let l = g.frame_input(0).lighting;
    assert_eq!(l.direction, [0.0, -1.0, 0.0]);
    assert!((l.color[1] - 128.0 / 255.0).abs() < 1e-6 && l.color[2] == 0.0);
    assert!((l.ambient[0] - 0.2).abs() < 1e-6);
    assert_eq!(l.point_count, 1);
    assert_eq!(l.points[0].position, [1.0, 2.0, 3.0]);
    assert_eq!(l.points[0].radius, 5.0);
    g.update(1.0, 1.0, [960.0, 540.0], Actions::default(), false);
    assert_eq!(
        g.frame_input(0).lighting.point_count,
        0,
        "the point light was not asked for again"
    );
    assert_eq!(
        g.frame_input(0).lighting.direction,
        [0.0, -1.0, 0.0],
        "the sun stays"
    );
}

#[test]
fn only_the_first_eight_point_lights_are_used_and_bad_light_arguments_are_explained() {
    let mut g = game(
        "function update(dt) for i = 1, 20 do nova.point_light(i, 0, 0) end end",
        vec![],
    );
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = g.frame_input(0).lighting;
    assert_eq!(l.point_count, MAX_POINT_LIGHTS);
    assert_eq!(l.points[7].position[0], 8.0);
    for (script, expect) in [
        ("nova.light { dir = {0, 0, 0} }", "dir cannot be {0, 0, 0}"),
        ("nova.light { dir = {1, 2} }", "dir must be {x, y, z}"),
        ("nova.light { color = {300, 0, 0} }", "values 0 to 255"),
        (
            "nova.light { ambient = {1, 2} }",
            "ambient must be {r, g, b}",
        ),
        (
            "nova.point_light(0, 0, 0, { radius = 0 })",
            "radius must be greater than 0",
        ),
    ] {
        let mut g = game(&format!("function update(dt) {script} end"), vec![]);
        frame(&mut g);
        let e = g.error.clone().unwrap_or_default();
        assert!(e.contains(expect), "{script}: {e}");
    }
}

// ---- pixels (skipped when this machine has no usable GPU) ---------------------------------------------

fn brightness(script: &str) -> Option<f64> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let mut gfx = match Gfx::new(&instance, None) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("skipping GPU test: {e}");
            return None;
        }
    };
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/car.glb", CAR.to_vec()),
        ("main.lua", script.as_bytes().to_vec()),
    ]));
    let mut g = Game::load(vfs).expect("loads");
    g.upload(&mut gfx);
    g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
    let pixels = gfx.capture((320, 180), &g.frame_input(0));
    // Average the model's pixels only: everything that differs from the corner (the sky).
    let sky = [pixels[0], pixels[1], pixels[2]];
    let (mut sum, mut n) = (0.0, 0.0);
    for p in pixels.as_chunks::<4>().0 {
        if [p[0], p[1], p[2]] != sky {
            sum += (p[0] as f64 + p[1] as f64 + p[2] as f64) / 3.0;
            n += 1.0;
        }
    }
    assert!(
        n > 200.0,
        "the model should cover part of the picture, covered {n} pixels"
    );
    Some(sum / n)
}

const SCENE: &str = "nova.camera(1.6, 1.2, 1.8, 0, 0.4, 0, 50)\nfunction update(dt)\n  %LIGHT%\n  nova.model('car', 0, 0, 0)\nend";

#[test]
fn lighting_changes_what_is_drawn() {
    let lit = |light: &str| brightness(&SCENE.replace("%LIGHT%", light));
    let (Some(day), Some(night)) = (
        lit("nova.light { ambient = {97, 102, 117} }"),
        lit("nova.light { ambient = {5, 5, 5}, color = {20, 20, 20} }"),
    ) else {
        return;
    };
    assert!(
        night < day * 0.5,
        "a dark scene is much dimmer: day {day:.1}, night {night:.1}"
    );
    // A point light beside the model brightens the dark scene.
    let Some(torch) = lit(
        "nova.light { ambient = {5, 5, 5}, color = {20, 20, 20} }\n  nova.point_light(1, 1, 1, { radius = 6, color = {255, 255, 255} })",
    ) else {
        return;
    };
    assert!(
        torch > night * 1.5,
        "a point light adds light: night {night:.1}, torch {torch:.1}"
    );
}

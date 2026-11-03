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

#[test]
fn a_scene_file_sets_the_3d_camera_and_places_model_entities() {
    let mut g = game(
        r#"nova.start("level")"#,
        vec![
            (
                "entities/car.lua",
                br#"return nova.entity { model = "car" }"#.to_vec(),
            ),
            ("scenes/level.lua", b"return nova.scene {}".to_vec()),
            (
                "scenes/level.scene.json",
                br#"{"version":1,"camera":{"eye":[1,2,3],"target":[4,5,6],"fov":50},
                    "objects":[{"kind":"car","x":10,"y":0,"z":-4,"props":{"ry":90}},{"kind":"car","x":-10,"z":5}]}"#
                    .to_vec(),
            ),
        ],
    );
    frame(&mut g);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(0);
    assert_eq!(input.camera.eye.to_array(), [1.0, 2.0, 3.0]);
    assert_eq!(input.camera.target.to_array(), [4.0, 5.0, 6.0]);
    assert_eq!(input.camera.fov_y_degrees, 50.0);
    assert_eq!(input.models.len(), 2, "one car at each place");
    let mut at: Vec<[f32; 3]> = input
        .models
        .iter()
        .map(|m| {
            let c = m.instance.matrix[3];
            [c[0], c[1], c[2]]
        })
        .collect();
    at.sort_by(|a, b| a[0].total_cmp(&b[0]));
    assert_eq!(at, [[-10.0, 0.0, 5.0], [10.0, 0.0, -4.0]]);
}

/// The studio writes a glowing shape as its own material with an emissive factor; the importer turns that into a per-vertex
/// glow (0 for the dark box, 0.8 for the glowing one).
#[test]
fn an_emissive_material_becomes_a_glow_on_its_vertices() {
    let imported =
        nova_runtime::model::import_parts(include_bytes!("fixtures/studio_model_glow.glb"))
            .expect("imports");
    let mesh = imported
        .parts
        .iter()
        .find_map(|p| p.mesh.as_ref())
        .expect("a part with triangles");
    let glows: Vec<f32> = mesh.vertices.iter().map(|v| v.emissive).collect();
    assert!(
        glows.contains(&0.0),
        "the dark box is lit by the scene: {glows:?}"
    );
    assert!(
        glows.iter().any(|&g| (g - 0.8).abs() < 1e-6),
        "the lamp glows 0.8: {glows:?}"
    );
    assert!(
        glows.iter().all(|&g| g == 0.0 || (g - 0.8).abs() < 1e-6),
        "{glows:?}"
    );
}

/// In a scene with almost no light, the shape the studio marked as glowing still shows its colour, and the other box stays dark.
#[test]
fn a_glowing_shape_shows_in_the_dark() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let mut gfx = match Gfx::new(&instance, None) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("skipping GPU test: {e}");
            return;
        }
    };
    let script = "nova.camera(0.25, 0.12, 0.8, 0.25, 0.12, 0, 50)\nfunction update(dt)\n  nova.light { ambient = {2, 2, 2}, color = {0, 0, 0} }\n  nova.model('glow', 0, 0, 0)\nend";
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        (
            "models/glow.glb",
            include_bytes!("fixtures/studio_model_glow.glb").to_vec(),
        ),
        ("main.lua", script.as_bytes().to_vec()),
    ]));
    let mut g = Game::load(vfs).expect("loads");
    g.upload(&mut gfx);
    g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
    let pixels = gfx.capture((320, 180), &g.frame_input(0));
    let sky = [pixels[0], pixels[1], pixels[2]];
    let (mut bright, mut dark) = (0, 0);
    for p in pixels.as_chunks::<4>().0 {
        if [p[0], p[1], p[2]] == sky {
            continue;
        }
        if p[0] > 150 {
            bright += 1;
        } else if p[0] < 30 {
            dark += 1;
        }
    }
    assert!(bright > 50, "the lamp shines: {bright} bright pixels");
    assert!(dark > 50, "the other box stays dark: {dark} dark pixels");
}

/// The pixels of a 320x180 frame of `script` drawing the car, or None without a GPU.
fn frame_pixels(script: &str) -> Option<Vec<u8>> {
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
    Some(gfx.capture((320, 180), &g.frame_input(0)))
}

fn pixel(pixels: &[u8], x: usize, y: usize) -> [u8; 3] {
    let i = (y * 320 + x) * 4;
    [pixels[i], pixels[i + 1], pixels[i + 2]]
}

#[test]
fn a_sky_is_painted_from_the_horizon_up() {
    // looking level: the horizon is the middle of the screen, the top of the screen is higher up
    let script = "nova.camera(0, 1, 5, 0, 1, 0, 60)\nfunction update(dt)\n  nova.sky { top = {20, 40, 200}, horizon = {240, 200, 120} }\nend";
    let Some(p) = frame_pixels(script) else {
        return;
    };
    let top = pixel(&p, 160, 2);
    let low = pixel(&p, 160, 175);
    assert!(top[2] > top[0] + 60, "blue overhead: {top:?}");
    assert!(
        low[0] > low[2] + 60,
        "warm at the horizon and below: {low:?}"
    );
    // without a sky it is the plain clear colour all over
    let plain = frame_pixels("nova.camera(0, 1, 5, 0, 1, 0, 60)").unwrap();
    assert_eq!(pixel(&plain, 160, 2), pixel(&plain, 160, 175));
}

#[test]
fn fog_turns_a_model_into_the_fog_colour_with_distance() {
    // the car is 5 m from the camera
    let draw = |fog: &str| {
        let script = format!(
            "nova.camera(0, 1, 6, 0, 0.4, 0, 50)\nfunction update(dt)\n  {fog}\n  nova.model('car', 0, 0, 1)\nend"
        );
        frame_pixels(&script)
    };
    let magenta = |p: &[u8]| {
        p.as_chunks::<4>()
            .0
            .iter()
            .filter(|c| c[0] > 200 && c[1] < 60 && c[2] > 200)
            .count()
    };
    let (Some(clear), Some(thick), Some(far_off)) = (
        draw(""),
        draw("nova.fog { color = {255, 0, 255}, near = 0, far = 3 }"),
        draw("nova.fog { color = {255, 0, 255}, near = 100, far = 300 }"),
    ) else {
        return;
    };
    assert_eq!(magenta(&clear), 0);
    assert!(
        magenta(&thick) > 500,
        "past `far` the car is all fog: {}",
        magenta(&thick)
    );
    assert_eq!(
        magenta(&far_off),
        0,
        "fog that starts beyond the car does not touch it"
    );
    assert_eq!(clear, far_off, "and the picture is the same as without fog");
}

#[test]
fn a_scene_file_can_have_a_sky_and_fog() {
    let mut g = game(
        r#"nova.start("level")"#,
        vec![
            ("scenes/level.lua", b"return nova.scene {}".to_vec()),
            (
                "scenes/level.scene.json",
                br#"{"version":1,"sky":{"top":[0,0,255],"horizon":[255,255,0]},"fog":{"color":[10,20,30],"near":5,"far":50}}"#
                    .to_vec(),
            ),
        ],
    );
    frame(&mut g);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    let lighting = g.frame_input(0).lighting;
    let sky = lighting.sky.expect("the scene's sky is set");
    assert!(sky.top[2] > 0.9 && sky.top[0] < 0.01);
    assert!(sky.horizon[0] > 0.9 && sky.horizon[1] > 0.9);
    let fog = lighting.fog.expect("the scene's fog is set");
    assert_eq!((fog.near, fog.far), (5.0, 50.0));
}

fn particle_positions(script: &str, frames: usize) -> Vec<[f32; 3]> {
    let scene = format!("local S = nova.scene {{}}\nfunction S:enter() {script} end\nreturn S");
    let mut g = game(
        "nova.start('s')",
        vec![("scenes/s.lua", scene.into_bytes())],
    );
    for _ in 0..frames {
        frame(&mut g);
    }
    assert!(g.error.is_none(), "{:?}", g.error);
    g.frame_input(0)
        .models
        .iter()
        .map(|m| {
            let c = m.instance.matrix[3];
            [c[0], c[1], c[2]]
        })
        .collect()
}

#[test]
fn particles_can_be_models_in_3d() {
    // straight up with no spread: every particle is above the emitter, none to the side
    let up = particle_positions(
        "nova.burst(2, 0, 3, { model = 'car', count = 20, life = 5, speed = 4, spread = 0, size = 0.1 })",
        6,
    );
    assert_eq!(up.len(), 20, "one model per particle");
    for p in &up {
        assert!(
            (p[0] - 2.0).abs() < 1e-3 && (p[2] - 3.0).abs() < 1e-3,
            "{p:?}"
        );
        assert!(p[1] > 0.1, "rising: {p:?}");
    }
    // a wide cone sends them in different directions
    let wide = particle_positions(
        "nova.burst(0, 0, 0, { model = 'car', count = 40, life = 5, speed = 4, spread = 3, size = 0.1 })",
        6,
    );
    assert_eq!(wide.len(), 40);
    assert!(wide.iter().any(|p| p[0] > 0.2) && wide.iter().any(|p| p[0] < -0.2));
    assert!(wide.iter().any(|p| p[2] > 0.2) && wide.iter().any(|p| p[2] < -0.2));
    // gravity pulls them down, and the burst cleans itself up when the particles die
    let falling = particle_positions(
        "nova.burst(0, 0, 0, { model = 'car', count = 5, life = 5, speed = 0, gravity = -10, size = 0.1 })",
        60,
    );
    assert!(falling.iter().all(|p| p[1] < -1.0), "{falling:?}");
    let gone = particle_positions(
        "nova.burst(0, 0, 0, { model = 'car', count = 5, life = 0.1, speed = 1, size = 0.1 })",
        30,
    );
    assert!(gone.is_empty(), "{gone:?}");
}

#[test]
fn the_sun_casts_shadows_and_a_model_can_opt_out() {
    // a big car far below stands for the ground; a small one floats above it with the sun straight down
    let scene = |shadows: &str, cast: &str| {
        format!(
            "nova.camera(0, 14, 7, 0, -2, 0, 55)\nfunction update(dt)\n  nova.light {{ dir = {{0, -1, 0.001}}, ambient = {{40, 40, 40}} }}\n  {shadows}\n  nova.model('car', 0, -14, 0, {{ scale = 8, shadow = false }})\n  nova.model('car', 0, 0, 0, {{ scale = 2, {cast} }})\nend"
        )
    };
    let mean = |script: String| {
        let p = frame_pixels(&script)?;
        let sky = pixel(&p, 0, 0);
        let (mut sum, mut n) = (0.0f64, 0.0f64);
        for c in p.as_chunks::<4>().0 {
            if [c[0], c[1], c[2]] != sky {
                sum += (c[0] as f64 + c[1] as f64 + c[2] as f64) / 3.0;
                n += 1.0;
            }
        }
        Some(sum / n.max(1.0))
    };
    let (Some(off), Some(on), Some(opted_out)) = (
        mean(scene("", "")),
        mean(scene("nova.shadows { radius = 30, strength = 1 }", "")),
        mean(scene(
            "nova.shadows { radius = 30, strength = 1 }",
            "shadow = false",
        )),
    ) else {
        return;
    };
    assert!(
        on < off - 1.0,
        "the floating car shades what is below it: off {off:.2}, on {on:.2}"
    );
    assert!(
        (opted_out - off).abs() < f64::max(on.abs(), 1.0) * 0.5 && opted_out > on + 0.5,
        "a model that does not cast leaves the ground lit: off {off:.2}, on {on:.2}, opted out {opted_out:.2}"
    );
}

/// The studio writes a model's collision circles into the glTF scene's extras; scripts read them with nova.model_colliders.
#[test]
fn a_models_collision_circles_are_read_from_its_file() {
    let imported =
        nova_runtime::model::import_parts(include_bytes!("fixtures/studio_model_colliders.glb"))
            .expect("imports");
    assert_eq!(
        imported.colliders,
        [[0.0, 0.0, 0.5], [0.25, -0.125, 0.1875]]
    );
    let mut g = game(
        "nova.start('s')",
        vec![
            (
                "models/post.glb",
                include_bytes!("fixtures/studio_model_colliders.glb").to_vec(),
            ),
            (
                "scenes/s.lua",
                b"local S = nova.scene {}\nfunction S:enter()\n  local c = nova.model_colliders('post')\n  nova.log(#c .. ' ' .. c[2].x .. ' ' .. c[2].z .. ' ' .. c[2].r)\n  nova.log(#nova.model_colliders('car'))\nend\nreturn S"
                    .to_vec(),
            ),
        ],
    );
    frame(&mut g);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(g.take_log(), ["2 0.25 -0.125 0.1875", "0"]);
}

/// A scene whose trees are `static` entities placed by a scene file; the camera looks from `eye_x`, and `update` is the
/// body of the scene's update function (run every frame).
fn world_game(eye_x: f64, update: &str) -> Game {
    let mut g = game(
        "nova.start('s')",
        vec![
            (
                "models/post.glb",
                include_bytes!("fixtures/studio_model_colliders.glb").to_vec(),
            ),
            (
                "entities/post.lua",
                b"return nova.entity { model = 'post', static = true }".to_vec(),
            ),
            (
                "scenes/s.lua",
                format!(
                    "local S = nova.scene {{}}\nfunction S:draw() nova.camera({eye_x}, 5, 0, {eye_x}, 0, -10, 60) end\nfunction S:update(dt) {update} end\nreturn S"
                )
                .into_bytes(),
            ),
            (
                "scenes/s.scene.json",
                br#"{"version":1,"objects":[
                    {"kind":"post","x":0,"y":0,"z":0},
                    {"kind":"post","x":10,"y":0,"z":-3,"props":{"ry":1.5707963,"sx":2}},
                    {"kind":"post","x":1000,"y":0,"z":0}]}"#
                    .to_vec(),
            ),
        ],
    );
    frame(&mut g);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    g
}

#[test]
fn static_scenery_is_drawn_only_near_the_camera() {
    // from x = 0 the first two posts are within the default 200 m, the third (1000 m away) is not
    let g = world_game(0.0, "");
    assert_eq!(
        g.frame_input(0).models.len(),
        2,
        "two of three posts are drawn"
    );
    // from x = 1000 only the far post is
    let g = world_game(1000.0, "");
    assert_eq!(g.frame_input(0).models.len(), 1);
    // and a game can narrow or switch off the automatic drawing
    let g = world_game(0.0, "nova.scenery.range = 5");
    assert_eq!(
        g.frame_input(0).models.len(),
        1,
        "only the post at the origin is within 5 m"
    );
}

#[test]
fn static_scenery_blocks_with_the_circles_of_its_model() {
    let probes = "if not done then done = true\n\
        local function probe(x, z, r) local px, pz = nova.scenery.push(x, z, r); nova.log(px and string.format('%.3f %.3f', px, pz) or 'free') end\n\
        probe(0.3, 0.0, 0.2)\n\
        probe(50, 50, 0.2)\n\
        probe(10, -3 + 1.0, 0.1)\n\
        nova.log(nova.scenery.count()) end";
    let g = world_game(0.0, probes);
    let log = g.take_log();
    // the first post: a circle of radius 0.5 at the origin; a small circle at x = 0.3 is pushed straight out along +x
    // by 0.5 + 0.2 - 0.3 = 0.4 (the second circle, 0.25 across and 0.125 behind, pushes a little too)
    assert!(
        log[0].starts_with("0.") && !log[0].starts_with("free"),
        "{log:?}"
    );
    assert_eq!(log[1], "free");
    // the second post is turned a quarter and drawn twice the size, so its circle of 0.5 is 1.0 across: a circle one metre
    // from its middle along +z touches it and is pushed
    assert_ne!(log[2], "free", "{log:?}");
    assert_eq!(log[3], "3", "all three posts are in the world");
}

#[test]
fn the_scenery_can_be_looked_through_for_what_is_ahead() {
    let probes = "if not done then done = true\n\
        local function look(x, z, dx, dz, len, r) local d, cx, cz, cr = nova.scenery.ahead(x, z, dx, dz, len, r); nova.log(d and string.format('%.2f %.2f %.2f %.3f', d, cx, cz, cr) or 'clear') end\n\
        look(-5, 0, 1, 0, 10, 0.2)\n\
        look(-5, 3, 1, 0, 10, 0.2)\n\
        look(-5, 0, 1, 0, 3, 0.2)\n\
        look(-5, 0, -1, 0, 10, 0.2)\n\
        look(0.2, 0, 1, 0, 5, 0.2)\n\
        look(-5, 0.6, 1, 0, 10, 0.2)\n\
        look(-90, 0, 1, 0, 120, 0.2)\n\
        end";
    let g = world_game(0.0, probes);
    let log = g.take_log();
    // the first post's big circle: radius 0.5 at the origin; a 0.2 wide look from 5 m away reaches it after 5 - 0.7 = 4.3 m
    assert!(
        log[0].starts_with("4.3") && log[0].ends_with("0.00 0.00 0.500"),
        "{log:?}"
    );
    assert_eq!(log[1], "clear", "three metres to the side: nothing");
    assert_eq!(log[2], "clear", "not long enough to reach it");
    assert_eq!(log[3], "clear", "looking away");
    assert!(log[4].starts_with("0.00"), "already touching: {log:?}");
    assert_ne!(log[5], "clear", "just clipping its edge counts: {log:?}");
    // a long look finds the nearest of everything along it (the first post, not the one 10 m on)
    assert!(
        log[6].contains("0.500") && log[6].starts_with("89.3"),
        "{log:?}"
    );
}

#[test]
fn scenery_can_be_shot_through_and_looked_across() {
    let probes = "if not done then done = true\n\
        local d, hx, hz, cx, cz, cr = nova.scenery.raycast(-5, 0, 1, 0, 20)\n\
        nova.log(d and string.format('%.2f %.2f %.2f %.2f %.3f', d, hx, hz, cx, cr) or 'clear')\n\
        nova.log(tostring(nova.scenery.raycast(-5, 3, 1, 0, 20)))\n\
        nova.log(tostring(nova.scenery.line_clear(-5, 0, 5, 0)) .. ' ' .. tostring(nova.scenery.line_clear(-5, 3, 5, 3)) .. ' ' .. tostring(nova.scenery.line_clear(-5, 0.7, 5, 0.7, 0)) .. ' ' .. tostring(nova.scenery.line_clear(-5, 0.9, 5, 0.9, 0.5)))\n\
        end";
    let g = world_game(0.0, probes);
    let log = g.take_log();
    // the post's circle (radius 0.5 at the origin) is first reached 4.5 m along, at x = -0.5
    assert_eq!(log[0], "4.50 -0.50 0.00 0.00 0.500");
    assert_eq!(log[1], "nil");
    // straight through it: blocked; three metres to the side: clear; just past its edge with no width: clear; with width: blocked
    assert_eq!(log[2], "false true true false");
}

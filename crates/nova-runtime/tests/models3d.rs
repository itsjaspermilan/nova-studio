//! Lights and model parts: the Lua API, what reaches the renderer, and (when a GPU is present) the pixels.

use std::cell::Cell;
use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::gfx::Gfx;
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
fn only_the_nearest_sixteen_point_lights_are_used_and_bad_light_arguments_are_explained() {
    let mut g = game(
        "function update(dt) nova.camera(0, 0, 0, 0, 0, -1) for i = 40, 1, -1 do nova.point_light(i, 0, 0) end end",
        vec![],
    );
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    let l = g.frame_input(0).lighting;
    assert_eq!(l.point_count, 16, "a budget of sixteen, asked for 40");
    assert!(
        l.points[..16].iter().all(|p| p.position[0] <= 16.0),
        "the nearest, not the first asked for"
    );
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

/// Runs `body` in a scene's update the first time, in a game with the 3D camera helper, and returns the game and its log.
fn cam_game(body: &str) -> Game {
    let scene = format!(
        "local S = nova.scene {{}}\nfunction S:update(dt) if not done then done = true\n{body}\nend end\nfunction S:draw() end\nreturn S"
    );
    let mut g = game(
        "nova.start('s')",
        vec![("scenes/s.lua", scene.into_bytes())],
    );
    frame(&mut g);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    g
}

#[test]
fn the_follow_camera_sits_behind_and_above_and_the_first_person_camera_looks_where_it_is_turned() {
    let g = cam_game(
        "nova.cam3.yaw = 0\n\
         nova.cam3.follow({ x = 2, y = 0, z = 3 }, { distance = 10, height = 5, smooth = 0 })\n\
         local e, t = nova.cam3.eye, nova.cam3.target\n\
         nova.log(string.format('follow %.2f %.2f %.2f -> %.2f %.2f %.2f', e.x, e.y, e.z, t.x, t.y, t.z))\n\
         nova.cam3.yaw = math.pi / 2\n\
         nova.cam3.follow({ x = 0, y = 0, z = 0 }, { distance = 10, height = 5, smooth = 0 })\n\
         nova.log(string.format('turned %.2f %.2f %.2f', nova.cam3.eye.x, nova.cam3.eye.y, nova.cam3.eye.z))\n\
         nova.cam3.yaw, nova.cam3.pitch = 0, 0\n\
         nova.cam3.first_person({ x = 1, y = 0, z = 1 })\n\
         local fx, fz = nova.cam3.forward()\n\
         nova.log(string.format('eye %.2f %.2f %.2f forward %.2f %.2f', nova.cam3.eye.x, nova.cam3.eye.y, nova.cam3.eye.z, fx, fz))\n\
         nova.cam3.look(math.pi / 2, 9)\n\
         local rx, rz = nova.cam3.right()\n\
         nova.log(string.format('pitch %.2f right %.2f %.2f', nova.cam3.pitch, rx, rz))",
    );
    let log = g.take_log();
    assert_eq!(
        log[0], "follow 2.00 5.00 13.00 -> 2.00 1.00 3.00",
        "{log:?}"
    );
    assert_eq!(
        log[1], "turned 10.00 5.00 0.00",
        "turning the yaw swings the camera round to the side"
    );
    assert_eq!(log[2], "eye 1.00 1.60 1.00 forward 0.00 -1.00");
    assert!(
        log[3].starts_with("pitch 1.45"),
        "pitch stops short of straight up: {log:?}"
    );
    // the camera the game really got is the last one asked for
    let cam = g.frame_input(0).camera;
    assert_eq!(cam.fov_y_degrees, 75.0);
}

#[test]
fn a_point_on_the_screen_becomes_a_ray_and_a_place_on_the_ground() {
    let g = cam_game(
        "nova.cam3.yaw = 0\n\
         nova.cam3.follow({ x = 0, y = 0, z = 0 }, { distance = 10, height = 10, smooth = 0, look_height = 0, fov = 60 })\n\
         local w, h = nova.view()\n\
         local _, _, _, dx, dy, dz = nova.cam3.ray(w / 2, h / 2)\n\
         nova.log(string.format('centre %.3f %.3f %.3f', dx, dy, dz))\n\
         local gx, gz = nova.cam3.ground_point(w / 2, h / 2)\n\
         nova.log(string.format('ground %.2f %.2f', gx, gz))\n\
         local lx, lz = nova.cam3.ground_point(w * 0.25, h / 2)\n\
         local rx, rz = nova.cam3.ground_point(w * 0.75, h / 2)\n\
         nova.log(string.format('left right %s %s', tostring(lx < 0 and rx > 0 and math.abs(lx + rx) < 1e-6), tostring(math.abs(lz - rz) < 1e-6)))\n\
         nova.log(tostring(nova.cam3.ground_point(w / 2, 0.01 * h, 0)))\n\
         nova.log(tostring(nova.cam3.ground_point(w / 2, h / 2, 50)))",
    );
    let log = g.take_log();
    // looking from (0, 10, 10) at the origin: the middle of the screen is the diagonal, and meets the ground at the origin
    assert_eq!(log[0], "centre 0.000 -0.707 -0.707", "{log:?}");
    assert_eq!(log[1], "ground 0.00 0.00");
    assert_eq!(
        log[2], "left right true true",
        "left of centre is -x, right is +x, level with each other"
    );
    // the very top of the screen looks (almost) at the horizon, far away but still down, so it is a place; a plane above the camera is never met
    assert_ne!(log[3], "nil");
    assert_eq!(log[4], "nil");
}

#[test]
fn script_made_meshes_reuse_their_gpu_buffers() {
    use nova_runtime::gfx::{Camera, DYN_MESH_BASE, FrameInput, Lighting, MeshOp};
    use nova_runtime::model::{Image, MeshVertex};
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
    let quad = |n: usize| {
        let v = MeshVertex {
            position: [0.0; 3],
            normal: [0.0, 1.0, 0.0],
            color: [255; 4],
            uv: [0.0; 2],
            emissive: 0.0,
        };
        (
            vec![v; n * 4],
            (0..n as u32)
                .flat_map(|i| [i * 4, i * 4 + 1, i * 4 + 2])
                .collect::<Vec<u32>>(),
        )
    };
    let render = |gfx: &mut Gfx, ops: &[MeshOp]| {
        let input = FrameInput {
            clear: [0.0, 0.0, 0.0, 1.0],
            camera: Camera {
                eye: glam::Vec3::new(0.0, 0.0, 5.0),
                target: glam::Vec3::ZERO,
                fov_y_degrees: 60.0,
            },
            sprites_back: &[],
            models: &[],
            joints: &[],
            mesh_ops: ops,
            ui_models: &[],
            lighting: Lighting::default(),
            sprites_front: &[],
            text: &[],
            world_height: 0,
        };
        gfx.capture((64, 64), &input);
    };
    let upload = |id: usize, n: usize| {
        let (vertices, indices) = quad(n);
        MeshOp::Upload {
            id,
            vertices,
            indices,
            plain: false,
        }
    };
    let atlas = MeshOp::SetAtlas(Image {
        width: 16,
        height: 16,
        rgba: vec![255; 16 * 16 * 4],
    });
    render(&mut gfx, &[atlas, upload(DYN_MESH_BASE, 100)]);
    assert_eq!(
        (gfx.mesh_buffers_created, gfx.mesh_buffers_reused),
        (2, 0),
        "a new mesh needs a vertex and an index buffer"
    );
    // the same mesh rebuilt a little smaller, then a little bigger: the same buffers
    render(&mut gfx, &[upload(DYN_MESH_BASE, 90)]);
    render(&mut gfx, &[upload(DYN_MESH_BASE, 110)]);
    assert_eq!((gfx.mesh_buffers_created, gfx.mesh_buffers_reused), (2, 4));
    // much bigger: new buffers (with room to grow), and the old ones become spares
    render(&mut gfx, &[upload(DYN_MESH_BASE, 1000)]);
    assert_eq!(gfx.mesh_buffers_created, 4);
    // a freed mesh's buffers go to the next one that fits
    render(&mut gfx, &[MeshOp::Free(DYN_MESH_BASE)]);
    render(&mut gfx, &[upload(DYN_MESH_BASE + 1, 980)]);
    assert_eq!(gfx.mesh_buffers_created, 4, "the freed buffers were reused");
    assert_eq!(gfx.mesh_buffers_reused, 6);
}

#[test]
fn a_quad_with_a_see_through_colour_is_drawn_blended_and_a_solid_one_is_not() {
    let mut g = game(
        "function update(dt)
  nova.quad3(0, 0, 0, 0, 1, 0, 1, { color = { 0, 0, 0, 120 } })
  nova.quad3(2, 0, 0, 0, 1, 0, 1, { color = { 255, 0, 0 } })
  nova.quad3(4, 0, 0, 0, 1, 0, 1, { color = { 0, 0, 0, 90 } })
end",
        vec![],
    );
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(0);
    assert_eq!(input.models.len(), 3);
    // (the frame groups draws of one mesh together)
    let see_through: Vec<usize> = input
        .models
        .iter()
        .filter(|m| m.instance.tint[3] < 0.99)
        .map(|m| m.mesh)
        .collect();
    let solid: Vec<usize> = input
        .models
        .iter()
        .filter(|m| m.instance.tint[3] > 0.99)
        .map(|m| m.mesh)
        .collect();
    assert_eq!((see_through.len(), solid.len()), (2, 1));
    assert_eq!(
        see_through[0], see_through[1],
        "the two see-through ones share a mesh"
    );
    assert_ne!(
        see_through[0], solid[0],
        "the solid one is another mesh, drawn in the solid pass"
    );
}

/// Draws that the camera cannot see are left out of the world pass (and cost nothing there), (skipped without a GPU).
#[test]
fn draws_outside_the_view_are_culled_from_the_world_pass() {
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
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/car.glb", CAR.to_vec()),
        (
            "main.lua",
            b"function update(dt)
  nova.camera(0, 3, 10, 0, 0, 0, 60)
  for i = 1, 10 do nova.model('car', (i - 5.5) * 0.6, 0, 0) end          -- in front of the camera
  for i = 1, 30 do nova.model('car', i, 0, 40 + i) end                   -- behind it
  for i = 1, 20 do nova.model('car', 500 + i, 0, 0) end                  -- far off to the side
end"
            .to_vec(),
        ),
    ]));
    let mut g = Game::load(vfs).expect("loads");
    g.upload(&mut gfx);
    g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(0);
    assert_eq!(input.models.len(), 60);
    let (_, stats) = gfx.capture_with_stats((320, 180), &input);
    assert_eq!(stats.culled, 50, "the thirty behind and the twenty beside");
    // the ten that remain are one instanced draw of the car's meshes
    assert!(
        stats.triangles > 0 && stats.triangles <= 10 * 2000,
        "{stats:?}"
    );
}

/// Meshes that carry the same picture share one texture on the GPU. (Skipped without a GPU.)
#[test]
fn meshes_with_the_same_picture_share_one_texture() {
    use nova_runtime::model::MeshVertex;
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
    let v = MeshVertex {
        position: [0.0; 3],
        normal: [0.0, 1.0, 0.0],
        color: [255; 4],
        uv: [0.0; 2],
        emissive: 0.0,
    };
    let mesh = |colour: u8| MeshData {
        vertices: vec![v; 3],
        indices: vec![0, 1, 2],
        texture: Some(Image {
            width: 2,
            height: 2,
            rgba: vec![colour; 16],
        }),
        notes: Vec::new(),
    };
    gfx.upload_mesh(&mesh(10));
    gfx.upload_mesh(&mesh(10));
    gfx.upload_mesh(&mesh(10));
    gfx.upload_mesh(&mesh(99));
    assert_eq!(
        gfx.textures_shared, 2,
        "three meshes with one picture are one texture"
    );
}

/// The sun's shadow pass leaves out what its own box cannot see, which is not what the camera sees: a car behind the
/// camera still shadows the ground in front of it, a car far off to the side does not. (Skipped without a GPU.)
#[test]
fn the_shadow_pass_culls_by_the_suns_box_not_the_cameras() {
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
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/car.glb", CAR.to_vec()),
        (
            "main.lua",
            b"function update(dt)
  nova.camera(0, 3, 10, 0, 0, 0, 60)
  nova.light({ dir = {0, -1, 0} })
  nova.shadows({ radius = 20, strength = 0.6 })
  for i = 1, 10 do nova.model('car', (i - 5.5) * 0.6, 0, 0) end          -- under the sun's box and in view
  for i = 1, 30 do nova.model('car', i * 0.3, 0, 12) end                 -- behind the camera, inside the box
  for i = 1, 20 do nova.model('car', 500 + i, 0, 0) end                  -- far off to the side, outside both
end"
            .to_vec(),
        ),
    ]));
    let mut g = Game::load(vfs).expect("loads");
    g.upload(&mut gfx);
    g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(0);
    let (_, stats) = gfx.capture_with_stats((320, 180), &input);
    assert_eq!(
        stats.shadow_culled, 20,
        "only the twenty far off the side: {stats:?}"
    );
    assert_eq!(
        stats.culled,
        20 + 30,
        "the camera still culls the thirty behind it: {stats:?}"
    );
}

/// A piece of scenery that names a cheaper model draws it beyond `lod_distance` (on the ground, from the camera) and
/// the model itself nearer, in the same place; both are kept by Rust, not drawn by a Lua call each frame.
#[test]
fn far_scenery_draws_its_cheaper_model() {
    let run = |eye_x: f64| {
        let mut g = game(
            "nova.start('s')",
            vec![
                (
                    "models/hut.glb",
                    include_bytes!("fixtures/studio_model_colliders.glb").to_vec(),
                ),
                (
                    "models/hut_far.glb",
                    include_bytes!("fixtures/studio_model_colliders.glb").to_vec(),
                ),
                (
                    "entities/hut.lua",
                    b"return nova.entity { model = 'hut', static = true, lod = 'hut_far', lod_distance = 50 }"
                        .to_vec(),
                ),
                (
                    "scenes/s.lua",
                    format!(
                        "local S = nova.scene {{}}\nfunction S:draw() nova.camera({eye_x}, 5, 0, {eye_x}, 0, -10, 60) end\nreturn S"
                    )
                    .into_bytes(),
                ),
                (
                    "scenes/s.scene.json",
                    br#"{"version":1,"objects":[{"kind":"hut","x":0,"y":0,"z":0}]}"#.to_vec(),
                ),
            ],
        );
        frame(&mut g);
        frame(&mut g);
        assert!(g.error.is_none(), "{:?}", g.error);
        let input = g.frame_input(0);
        assert_eq!(input.models.len(), 1);
        (input.models[0].mesh, input.models[0].instance.matrix)
    };
    let (near, near_matrix) = run(10.0);
    let (far, far_matrix) = run(80.0);
    assert_ne!(near, far, "the far model is another mesh");
    assert_eq!(near_matrix, far_matrix, "in the same place");
}

/// Does the picture jump as a piece of scenery changes to its far model? The camera and the piece stay put and the
/// distance at which the change happens is moved past the piece in steps, which is the same as walking away from it. The
/// largest step between two neighbouring pictures is compared with the whole difference between the near and the far
/// model: a hard swap does it all in one step, a crossfade spreads it over the steps. (Skipped without a GPU.)
#[test]
fn changing_to_the_far_model_does_not_pop_when_it_fades() {
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
    // the piece is 8 m away; `lod_distance` D with a fade of 10 m is all near at D = 13 and all far at D = 3
    let mut shot = |lod_distance: f32, fade: f32| -> Vec<u8> {
        let script = format!(
            "local added = false
nova.scenery.range = 0
function update(dt)
  if not added then
    nova.scenery.add('car', 0, 0, -8, {{ lod = 'post', lod_distance = {lod_distance}, lod_fade = {fade}, scale = 8 }})
    added = true
  end
  nova.camera(0, 2, 0, 0, 1, -8, 60)
  nova.scenery.draw(0, 0, 100)
end"
        );
        let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
            ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
            ("models/car.glb", CAR.to_vec()),
            (
                "models/post.glb",
                include_bytes!("fixtures/studio_model_colliders.glb").to_vec(),
            ),
            ("main.lua", script.into_bytes()),
        ]));
        let mut g = Game::load(vfs).expect("loads");
        g.upload(&mut gfx);
        for _ in 0..2 {
            g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
        }
        assert!(g.error.is_none(), "{:?}", g.error);
        gfx.capture((320, 180), &g.frame_input(0))
    };
    let diff = |a: &[u8], b: &[u8]| -> f64 {
        a.iter()
            .zip(b)
            .map(|(x, y)| (*x as f64 - *y as f64).abs())
            .sum::<f64>()
            / a.len() as f64
    };
    let steps = |fade: f32, shot: &mut dyn FnMut(f32, f32) -> Vec<u8>| -> (f64, f64) {
        let pictures: Vec<Vec<u8>> = (0..=10).map(|i| shot(13.0 - i as f32, fade)).collect();
        let whole = diff(&pictures[0], &pictures[10]);
        let biggest = pictures
            .windows(2)
            .map(|w| diff(&w[0], &w[1]))
            .fold(0.0, f64::max);
        (whole, biggest)
    };
    let (whole, biggest) = steps(10.0, &mut shot);
    assert!(
        whole > 0.5,
        "the two models must look different for this to mean anything: {whole}"
    );
    assert!(
        biggest < 0.35 * whole,
        "a fade spreads the change over the steps: biggest step {biggest:.3} of {whole:.3}"
    );
    // and the same measure does see a hard swap (no fade): nearly all of it in one step
    let (whole, biggest) = steps(0.0, &mut shot);
    assert!(
        biggest > 0.8 * whole,
        "without a fade it is one jump: biggest step {biggest:.3} of {whole:.3}"
    );
}

/// `nova.model` takes `lod` and `lod_distance` like scenery: the near model, the far one past the distance, and both fading
/// over `lod_fade` metres between them. Animated ones can too (tests/crowd.rs).
#[test]
fn a_drawn_model_can_name_a_cheaper_one_for_when_it_is_far() {
    let drawn = |z: f64| {
        let mut g = game(
            &format!(
                "function update(dt) nova.camera(0, 2, 0, 0, 2, -1)\n  nova.model('car', 0, 0, {z}, {{ lod = 'post', lod_distance = 50, lod_fade = 10 }}) end"
            ),
            vec![(
                "models/post.glb",
                include_bytes!("fixtures/studio_model_colliders.glb").to_vec(),
            )],
        );
        frame(&mut g);
        assert!(g.error.is_none(), "{:?}", g.error);
        let input = g.frame_input(0);
        input
            .models
            .iter()
            .map(|m| (m.mesh, m.instance.matrix[1][3]))
            .collect::<Vec<_>>()
    };
    let near = drawn(-20.0);
    let far = drawn(-80.0);
    let between = drawn(-50.0);
    assert_eq!((near.len(), far.len(), between.len()), (1, 1, 2));
    assert_ne!(near[0].0, far[0].0, "another model far away");
    assert_eq!((near[0].1, far[0].1), (0.0, 0.0), "solid at both ends");
    assert!(between.iter().any(|m| m.1 < 0.0) && between.iter().any(|m| m.1 > 0.0));
    let mut g = game(
        "function update(dt) nova.model('car', 0, 0, -9, { lod = 'car', clip = 'x' }) end",
        vec![],
    );
    frame(&mut g);
    assert!(
        g.error
            .as_deref()
            .is_some_and(|e| e.contains("has no clip 'x'")),
        "{:?}",
        g.error
    );
}

/// `nova.solid`: a model's triangles are ground, walls and rays for a capsule body.
#[test]
fn a_model_is_solid_ground_for_a_capsule() {
    let mut g = game(
        "local added
function update(dt)
  if not added then
    added = nova.solid.add('car', 0, 0, 0, { scale = 10 })
    nova.log('triangles ' .. added .. ' ' .. nova.solid.count())
    local top, nx, ny, nz = nova.solid.floor_below(0, 50, 0)
    nova.log(string.format('top %.3f normal %.1f', top, ny))
    -- fall onto it from above
    local m = nova.solid.move(0, top + 3, 0, 0.3, 1.2, 0, -6, 0)
    nova.log(string.format('landed %.3f ground=%s normal=%.1f', m.y, tostring(m.ground), m.normal and m.normal.y or -9))
    -- in the air beside it
    local a = nova.solid.move(300, 5, 0, 0.3, 1.2, 0, 0, 0)
    nova.log('air ground=' .. tostring(a.ground))
    -- a ray through the middle from the side hits its side
    local d, hx = nova.solid.raycast(-100, top * 0.5, 0, 1, 0, 0, 200)
    nova.log(string.format('ray %s', d and 'hit' or 'miss'))
    local miss = nova.solid.raycast(-100, top + 50, 0, 1, 0, 0, 200)
    nova.log('over ' .. tostring(miss))
    nova.solid.clear()
    nova.log('cleared ' .. nova.solid.count())
  end
end",
        vec![],
    );
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    let log = g.take_log();
    assert!(
        log[0].starts_with("triangles 24 24"),
        "the body and the wheel, 12 each: {log:?}"
    );
    let top: f64 = log[1].split(' ').nth(1).unwrap().parse().unwrap();
    assert!(top > 1.0, "{log:?}");
    assert!(log[1].ends_with("normal 1.0"));
    let landed: f64 = log[2].split(' ').nth(1).unwrap().parse().unwrap();
    assert!(
        (landed - top).abs() < 0.02 && log[2].contains("ground=true normal=1.0"),
        "{log:?}"
    );
    assert_eq!(log[3], "air ground=false");
    assert_eq!(log[4], "ray hit");
    assert_eq!(log[5], "over nil");
    assert_eq!(log[6], "cleared 0");
}

#[test]
fn solid_mistakes_are_explained() {
    for (script, expect) in [
        ("nova.solid.add('nope', 0, 0, 0)", "unknown model 'nope'"),
        (
            "nova.solid.move(0, 0, 0, 0, 1.8, 0, 0, 0)",
            "radius and a height above 0",
        ),
        (
            "nova.solid.move(0, 0, 0, 0.3, 1.8, 0/0, 0, 0)",
            "must be numbers",
        ),
    ] {
        let mut g = game(&format!("function update(dt) {script} end"), vec![]);
        frame(&mut g);
        let error = g.error.clone().unwrap_or_default();
        assert!(error.contains(expect), "{script}: {error}");
    }
}

fn mean_brightness(p: &[u8]) -> f64 {
    p.chunks(4)
        .map(|c| (c[0] as f64 + c[1] as f64 + c[2] as f64) / 3.0)
        .sum::<f64>()
        / (p.len() / 4) as f64
}

fn dark_pixels(p: &[u8]) -> usize {
    p.chunks(4)
        .filter(|c| (c[0] as u32 + c[1] as u32 + c[2] as u32) < 60)
        .count()
}

/// `nova.look`: an outline where depth jumps, a colour adjustment, and flat bands of sun. (Skipped without a GPU.)
#[test]
fn a_look_draws_outlines_adjusts_colour_and_cuts_the_light_into_bands() {
    let scene = |look: &str| {
        format!(
            "function update(dt)
  nova.camera(0, 10, 9, 0, 2.5, 0, 60)
  nova.sky {{ top = {{150, 200, 255}}, horizon = {{220, 235, 255}} }}
  nova.light {{ dir = {{0.9165, -0.4, 0}}, color = {{255, 255, 255}}, ambient = {{0, 0, 0}} }}
  nova.model('car', 0, 0, 0, {{ scale = 5 }})
  {look}
end"
        )
    };
    let Some(plain) = frame_pixels(&scene("")) else {
        return;
    };
    let outlined = frame_pixels(&scene(
        "nova.look { outline = { color = {0, 0, 0}, strength = 1, width = 1 } }",
    ))
    .unwrap();
    assert!(
        dark_pixels(&outlined) > dark_pixels(&plain) + 100,
        "lines were drawn: {} dark pixels against {}",
        dark_pixels(&outlined),
        dark_pixels(&plain)
    );
    // away from edges nothing changed: the same picture except for the line
    let same = plain
        .chunks(4)
        .zip(outlined.chunks(4))
        .filter(|(a, b)| a == b)
        .count();
    assert!(
        same > plain.len() / 4 * 9 / 10,
        "{same} of {} pixels untouched",
        plain.len() / 4
    );
    // exposure brightens and darkens; saturation 0 is grey
    let dim = frame_pixels(&scene("nova.look { exposure = 0.4 }")).unwrap();
    let bright = frame_pixels(&scene("nova.look { exposure = 2.0 }")).unwrap();
    assert!(mean_brightness(&dim) < mean_brightness(&plain) - 5.0);
    assert!(mean_brightness(&bright) > mean_brightness(&plain) + 5.0);
    let grey = frame_pixels(&scene("nova.look { saturation = 0 }")).unwrap();
    assert!(
        grey.chunks(4)
            .all(|c| (c[0] as i32 - c[1] as i32).abs() <= 2
                && (c[1] as i32 - c[2] as i32).abs() <= 2),
        "no colour left"
    );
    // a vignette darkens the corners and leaves the middle
    let vignette = frame_pixels(&scene("nova.look { vignette = 1 }")).unwrap();
    assert!(pixel(&vignette, 2, 2)[2] < pixel(&plain, 2, 2)[2] - 20);
    assert!(
        (pixel(&vignette, 160, 60)[0] as i32 - pixel(&plain, 160, 60)[0] as i32).abs() < 12,
        "the middle is left alone"
    );
    // toon: the top of the cube is lit by a light 66 degrees off (0.4 of it), which three bands make a third
    let top = |p: &[u8]| pixel(p, 160, 60)[0] as f64;
    let toon = frame_pixels(&scene("nova.look { toon = 3 }")).unwrap();
    assert!(
        top(&toon) < top(&plain) - 6.0,
        "banded light: {} against {}",
        top(&toon),
        top(&plain)
    );
}

#[test]
fn look_mistakes_are_explained_and_nothing_resets_it() {
    for (script, expect) in [
        ("nova.look { toon = 1 }", "2 to 8"),
        ("nova.look { exposure = -1 }", "exposure must be from"),
        ("nova.look { outline = 5 }", "outline is true, false or"),
        ("nova.look { vignette = 2 }", "vignette must be from"),
    ] {
        let mut g = game(&format!("function update(dt) {script} end"), vec![]);
        frame(&mut g);
        let error = g.error.clone().unwrap_or_default();
        assert!(error.contains(expect), "{script}: {error}");
    }
    let mut g = game(
        "function update(dt) nova.look { toon = 4, vignette = 0.5 } end",
        vec![],
    );
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    let look = g.frame_input(0).lighting.look;
    assert_eq!((look.toon, look.vignette), (4.0, 0.5));
    let mut g = game(
        "function update(dt) nova.look { toon = 4 } nova.look() end",
        vec![],
    );
    frame(&mut g);
    assert!(g.frame_input(0).lighting.look == nova_runtime::gfx::Look::default());
}

/// Wind bends foliage (a model drawn with `sway`) and nothing else, more at the top, and the swell moves with time. (Skipped
/// without a GPU.)
#[test]
fn wind_bends_what_sways_and_leaves_the_rest_alone() {
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
    let shot = |gfx: &mut Gfx, wind: &str, sway: &str, time: f64| -> Vec<u8> {
        let script = format!(
            "function update(dt)
  nova.camera(0, 6, 26, 0, 4, 0, 50)
  nova.sky {{ top = {{150, 200, 255}}, horizon = {{220, 235, 255}} }}
  {wind}
  nova.model('car', -6, 0, 0, {{ scale = 8 }})
  nova.model('car', 6, 0, 0, {{ scale = 8 {sway} }})
end"
        );
        let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
            ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
            ("models/car.glb", CAR.to_vec()),
            ("main.lua", script.into_bytes()),
        ]));
        let mut g = Game::load(vfs).expect("loads");
        g.upload(gfx);
        g.update(1.0 / 60.0, time, [320.0, 180.0], Actions::default(), false);
        assert!(g.error.is_none(), "{:?}", g.error);
        gfx.capture((320, 180), &g.frame_input(0))
    };
    let differ = |a: &[u8], b: &[u8], left: bool| -> usize {
        a.chunks(4)
            .zip(b.chunks(4))
            .enumerate()
            .filter(|(i, (p, q))| (i % 320 < 160) == left && p != q)
            .count()
    };
    let still = shot(&mut gfx, "", ", sway = 0.4", 3.0);
    let blowing = shot(
        &mut gfx,
        "nova.wind { direction = 0, strength = 1 }",
        ", sway = 0.4",
        3.0,
    );
    // the model that sways (on the right) moves; the other (on the left) does not
    assert!(
        differ(&still, &blowing, false) > 200,
        "the swaying model bends: {}",
        differ(&still, &blowing, false)
    );
    assert_eq!(
        differ(&still, &blowing, true),
        0,
        "the model with no sway is untouched"
    );
    // a later moment is another bend (the swell travels)
    let later = shot(
        &mut gfx,
        "nova.wind { direction = 0, strength = 1 }",
        ", sway = 0.4",
        4.7,
    );
    assert!(
        differ(&blowing, &later, false) > 100,
        "the wind changes with time: {}",
        differ(&blowing, &later, false)
    );
    // no wind, no bend, whatever the sway; and a model with sway 0 under wind does not bend
    let none = shot(
        &mut gfx,
        "nova.wind { direction = 0, strength = 1 }",
        ", sway = 0",
        3.0,
    );
    assert_eq!(differ(&none, &still, false), 0, "sway 0 is not blown about");
    // a stronger wind bends more
    let gale = shot(
        &mut gfx,
        "nova.wind { direction = 0, strength = 3 }",
        ", sway = 0.4",
        3.0,
    );
    assert!(
        differ(&still, &gale, false) > differ(&still, &blowing, false),
        "a gale bends it more"
    );
}

#[test]
fn wind_mistakes_are_explained_and_it_can_be_cleared() {
    let mut g = game(
        "function update(dt) nova.wind { direction = 90, strength = 9 } end",
        vec![],
    );
    frame(&mut g);
    assert!(
        g.error
            .as_deref()
            .is_some_and(|e| e.contains("strength from 0 to 4")),
        "{:?}",
        g.error
    );
    let mut g = game(
        "function update(dt) nova.wind { direction = 90, strength = 2 } end",
        vec![],
    );
    frame(&mut g);
    let w = g.frame_input(0).lighting.wind;
    assert_eq!(
        (w.strength, w.direction[0].round(), w.direction[1].round()),
        (2.0, 0.0, 1.0)
    );
    let mut g = game(
        "function update(dt) nova.wind { strength = 2 } nova.wind() end",
        vec![],
    );
    frame(&mut g);
    assert_eq!(g.frame_input(0).lighting.wind.strength, 0.0);
}

/// `nova.scenery.scatter` puts copies on the ground where the ground allows it, the same ones every time, and a piece with a
/// `max_distance` is not drawn beyond it.
#[test]
fn scattering_fills_an_area_on_ground_that_is_flat_enough_the_same_way_every_time() {
    let run = |camera_x: f64| {
        let mut g = game(
            &format!(
                "local placed
function update(dt)
  nova.camera({camera_x}, 3, 40, {camera_x}, 0, 0, 60)
  if not placed then
    placed = nova.scenery.scatter('car', {{ count = 60, area = {{ -30, -10, 30, 10 }}, seed = 4, scale = {{ 0.5, 1 }},
      ground = function(x, z) return 0, x < 0 and 1 or 0.3 end, max_distance = 25 }})
    nova.log('placed ' .. placed .. ' of ' .. nova.scenery.count())
  end
  nova.scenery.draw({camera_x}, 0, 200)
end"
            ),
            vec![],
        );
        frame(&mut g);
        assert!(g.error.is_none(), "{:?}", g.error);
        let log = g.take_log();
        let xs: Vec<f32> = g
            .frame_input(0)
            .models
            .iter()
            .map(|m| m.instance.matrix[3][0])
            .collect();
        (log, xs)
    };
    let (log, xs) = run(-15.0);
    let placed: usize = log[0].split(' ').nth(1).unwrap().parse().unwrap();
    assert!(
        (45..=59).contains(&placed),
        "half the area is flat enough and each spot is tried up to 3 times (about 7 in 8 find a place): {log:?}"
    );
    assert!(
        !xs.is_empty() && xs.iter().all(|x| *x < 0.0),
        "only on the flat half: {xs:?}"
    );
    let (log2, xs2) = run(-15.0);
    assert_eq!(
        (log, xs.len()),
        (log2, xs2.len()),
        "the same field every time"
    );
    // from far off to the right nothing is near enough (max_distance 25)
    let (_, far) = run(120.0);
    assert!(far.is_empty(), "{far:?}");
    // the bad calls are explained
    let mut g = game(
        "function update(dt) nova.scenery.scatter('car', {}) end",
        vec![],
    );
    frame(&mut g);
    assert!(
        g.error.as_deref().is_some_and(|e| e.contains("needs area")),
        "{:?}",
        g.error
    );
}

/// `nova.look` bloom and ambient occlusion. (Skipped without a GPU.)
#[test]
fn bloom_glows_around_bright_things_and_ao_darkens_creases_and_never_brightens() {
    let scene = |look: &str| {
        format!(
            "function update(dt)
  nova.camera(0, 10, 9, 0, 2.5, 0, 60)
  nova.sky {{ top = {{150, 200, 255}}, horizon = {{220, 235, 255}} }}
  nova.light {{ dir = {{0.9165, -0.4, 0}}, color = {{255, 255, 255}}, ambient = {{40, 40, 40}} }}
  nova.model('car', -1.2, 0, 0, {{ scale = 6 }})
  nova.model('car', 0, 0, 0.8, {{ scale = 6 }})
  nova.model('car', 1.2, 0, 0, {{ scale = 6 }})
  {look}
end"
        )
    };
    let Some(plain) = frame_pixels(&scene("")) else {
        return;
    };
    // bloom adds light and nothing else
    let glow = frame_pixels(&scene("nova.look { bloom = 1, bloom_threshold = 0.5 }")).unwrap();
    assert!(
        mean_brightness(&glow) > mean_brightness(&plain) + 2.0,
        "bloom brightened: {} against {}",
        mean_brightness(&glow),
        mean_brightness(&plain)
    );
    assert!(
        plain
            .chunks(4)
            .zip(glow.chunks(4))
            .all(|(a, b)| b[0] as i32 + 1 >= a[0] as i32),
        "bloom never darkens"
    );
    // ambient occlusion darkens where things meet, and nowhere gets brighter
    let shaded = frame_pixels(&scene("nova.look { ao = 1, ao_radius = 2 }")).unwrap();
    let darker = plain
        .chunks(4)
        .zip(shaded.chunks(4))
        .filter(|(a, b)| (a[0] as i32 - b[0] as i32) >= 4)
        .count();
    assert!(
        darker > 150,
        "ao darkened {darker} pixels where things meet"
    );
    assert!(
        plain
            .chunks(4)
            .zip(shaded.chunks(4))
            .all(|(a, b)| b[0] as i32 <= a[0] as i32 + 1),
        "ao never brightens"
    );
    // the open sky (corner) is left alone by both
    assert_eq!(pixel(&shaded, 2, 2), pixel(&plain, 2, 2));
    for (script, expect) in [
        ("nova.look { ao = 2 }", "ao must be from"),
        ("nova.look { bloom = -1 }", "bloom must be from"),
    ] {
        let mut g = game(&format!("function update(dt) {script} end"), vec![]);
        frame(&mut g);
        let error = g.error.clone().unwrap_or_default();
        assert!(error.contains(expect), "{script}: {error}");
    }
}

/// A spot light lights a cone and not what is behind or beside it. (Skipped without a GPU.)
#[test]
fn a_spot_light_lights_a_cone_and_a_point_light_lights_both_sides() {
    let scene = |light: &str| {
        format!(
            "function update(dt)
  nova.camera(0, 9, 16, 0, 1, 0, 70)
  nova.sky {{ top = {{0, 0, 0}}, horizon = {{0, 0, 0}} }}
  nova.light {{ dir = {{0, -1, 0}}, color = {{0, 0, 0}}, ambient = {{0, 0, 0}} }}
  nova.model('car', -6, 0, 0, {{ scale = 3 }})
  nova.model('car', 6, 0, 0, {{ scale = 3 }})
  {light}
end"
        )
    };
    let half = |p: &[u8], right: bool| {
        let (from, to) = if right { (160, 240) } else { (80, 160) };
        let mut sum = 0.0;
        for y in 0..180 {
            for x in from..to {
                sum += pixel(p, x, y)[0] as f64;
            }
        }
        sum / (80.0 * 180.0)
    };
    let Some(spot) = frame_pixels(&scene(
        "nova.point_light(0, 3, 0, { radius = 30, dir = {-1, 0, 0}, angle = 50 })",
    )) else {
        return;
    };
    let omni = frame_pixels(&scene("nova.point_light(0, 3, 0, { radius = 30 })")).unwrap();
    assert!(
        half(&spot, false) > half(&spot, true) * 4.0 + 0.3,
        "the cone lit the car it points at and not the other: {} against {}",
        half(&spot, false),
        half(&spot, true)
    );
    assert!(
        (half(&omni, false) - half(&omni, true)).abs() < half(&omni, false) * 0.35 + 0.3,
        "a point light lights both: {} and {}",
        half(&omni, false),
        half(&omni, true)
    );
    for (script, expect) in [
        (
            "nova.point_light(0, 3, 0, { dir = {0, 0, 0} })",
            "must not be all zeros",
        ),
        (
            "nova.point_light(0, 3, 0, { dir = {1, 0} })",
            "must be {dx, dy, dz}",
        ),
        (
            "nova.point_light(0, 3, 0, { dir = {1, 0, 0}, angle = 400 })",
            "from 1 to 170",
        ),
    ] {
        let mut g = game(&format!("function update(dt) {script} end"), vec![]);
        frame(&mut g);
        let error = g.error.clone().unwrap_or_default();
        assert!(error.contains(expect), "{script}: {error}");
    }
}

/// A lost GPU device is recovered from: after `simulate_loss` and `recover` the same frame draws the same picture, from the
/// copies of the meshes and atlas kept on the CPU. (Skipped without a GPU.)
#[test]
fn a_lost_gpu_device_is_recovered_and_the_picture_is_the_same() {
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
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/car.glb", CAR.to_vec()),
        (
            "main.lua",
            b"function update(dt)
  nova.camera(0, 6, 9, 0, 1, 0, 60)
  nova.sky { top = {150, 200, 255}, horizon = {220, 235, 255} }
  nova.model('car', 0, 0, 0, { scale = 3 })
  nova.rect(10, 10, 60, 30, { color = {255, 0, 0} })
end"
            .to_vec(),
        ),
    ]));
    let mut g = Game::load(vfs).expect("loads");
    g.upload(&mut gfx);
    g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
    let before = gfx.capture((320, 180), &g.frame_input(0));
    assert!(!gfx.is_lost());
    gfx.simulate_loss();
    assert!(gfx.is_lost(), "the device was destroyed");
    gfx.recover(&instance, None).expect("a new device");
    assert!(!gfx.is_lost(), "the new device is fine");
    g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
    let after = gfx.capture((320, 180), &g.frame_input(0));
    assert_eq!(before, after, "the same picture from the new device");
}

/// `nova.look { blur }`: streaks at the left and right edges, a sharp middle (also above and below it), the same overall brightness. (Skipped without a GPU.)
#[test]
fn speed_blur_smears_the_edges_and_leaves_the_middle() {
    let scene = |look: &str| {
        format!(
            "function update(dt)
  nova.camera(0, 6, 9, 0, 1, 0, 60)
  nova.sky {{ top = {{150, 200, 255}}, horizon = {{220, 235, 255}} }}
  nova.model('car', 0, 0, 0, {{ scale = 3 }})
  nova.model('car', -7.5, 0, 0, {{ scale = 3 }})
  nova.model('car', 7.5, 0, 0, {{ scale = 3 }})
  {look}
end"
        )
    };
    let Some(plain) = frame_pixels(&scene("")) else {
        return;
    };
    let blurred = frame_pixels(&scene("nova.look { blur = 1 }")).unwrap();
    let differ = |from: usize, to: usize, rows: std::ops::Range<usize>| {
        rows.flat_map(|y| (from..to).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let (a, b) = (pixel(&plain, x, y), pixel(&blurred, x, y));
                (a[0] as i32 - b[0] as i32).abs() > 6
            })
            .count()
    };
    assert!(differ(0, 60, 0..180) > 150, "the left edge is smeared");
    assert!(differ(260, 320, 0..180) > 150, "and the right");
    // the middle of the picture, where the car is, is sharp
    assert!(
        differ(145, 175, 100..125) < 20,
        "the middle is not: {}",
        differ(145, 175, 100..125)
    );
    // the whole middle band, top to bottom (the road ahead), is untouched
    assert_eq!(
        differ(95, 225, 0..180),
        0,
        "nothing in the middle band is blurred"
    );
    assert!((mean_brightness(&plain) - mean_brightness(&blurred)).abs() < 3.0);
    let mut g = game("function update(dt) nova.look { blur = 2 } end", vec![]);
    frame(&mut g);
    assert!(
        g.error
            .clone()
            .unwrap_or_default()
            .contains("blur must be from")
    );
}

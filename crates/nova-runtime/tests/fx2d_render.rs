//! The 2D effects (`gfx/fx2d.rs`, `game/fx2d_api.rs`), each rendered on the GPU and read back: they change pixels only when asked,
//! and do what they say. Skips (passes with a note) on a machine without a usable adapter.
//!
//! Every picture is 320 x 180 for a view 960 x 540 units: a pixel is three units.

use std::rc::Rc;

use nova_runtime::game::Game;
use nova_runtime::gfx::Gfx;
use nova_runtime::input::Actions;
use nova_runtime::vfs::{MemVfs, Vfs};

const W: u32 = 320;
const H: u32 = 180;

/// A PNG `w` x `h` whose pixel at (x, y) is `f(x, y)`.
fn png(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            data.extend(f(x, y));
        }
    }
    let mut out = Vec::new();
    let mut e = png::Encoder::new(&mut out, w, h);
    e.set_color(png::ColorType::Rgba);
    e.set_depth(png::BitDepth::Eight);
    e.write_header().unwrap().write_image_data(&data).unwrap();
    out
}

fn gpu() -> Option<Gfx> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    match Gfx::new(&instance, None) {
        Ok(g) => Some(g),
        Err(e) => {
            eprintln!("skipping GPU test: {e}");
            None
        }
    }
}

/// The project's files: a white dot, a flag (red over blue), two floor tiles side by side (16 x 16 each, both grey), then `files`.
fn game(gfx: &mut Gfx, files: &[(&str, &str)]) -> Game {
    let mut all = vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("sprites/dot.png", png(4, 4, |_, _| [255; 4])),
        (
            "sprites/flag.png",
            png(8, 16, |_, y| {
                if y < 8 {
                    [255, 0, 0, 255]
                } else {
                    [0, 0, 255, 255]
                }
            }),
        ),
        ("sprites/floor.png", png(32, 16, |_, _| [90, 90, 90, 255])),
    ];
    all.extend(files.iter().map(|(p, s)| (*p, s.as_bytes().to_vec())));
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut g = Game::load(vfs).expect("loads");
    g.upload(gfx);
    g
}

/// The picture after `frames` frames of `main` (and the game, to ask it things).
fn shot_with(gfx: &mut Gfx, files: &[(&str, &str)], frames: usize) -> (Vec<u8>, Game) {
    let mut g = game(gfx, files);
    for i in 0..frames {
        g.update(
            1.0 / 60.0,
            i as f64 / 60.0,
            [960.0, 540.0],
            Actions::default(),
            false,
        );
        assert!(g.error.is_none(), "{:?}", g.error);
    }
    let pixels = gfx.capture((W, H), &g.frame_input(0));
    (pixels, g)
}

fn shot(gfx: &mut Gfx, main: &str) -> Vec<u8> {
    shot_with(gfx, &[("main.lua", main)], 1).0
}

/// The pixel at a point in units.
fn at(p: &[u8], ux: f32, uy: f32) -> [i32; 3] {
    let (x, y) = ((ux / 3.0) as u32, (uy / 3.0) as u32);
    let i = ((y * W + x) * 4) as usize;
    [p[i] as i32, p[i + 1] as i32, p[i + 2] as i32]
}

fn sum(c: [i32; 3]) -> i32 {
    c[0] + c[1] + c[2]
}

const GREY_FLOOR: &str = "nova.rect(0, 0, 960, 540, { 128, 128, 128, 255 })";

#[test]
fn a_frame_that_asks_for_nothing_carries_no_effects() {
    let Some(mut gfx) = gpu() else { return };
    let (_, g) = shot_with(
        &mut gfx,
        &[("main.lua", &format!("function draw() {GREY_FLOOR} end"))],
        1,
    );
    assert!(
        g.frame_input(0).lighting.fx2d.is_none(),
        "no effect asked for: the renderer's old path"
    );
    assert_eq!(g.render_facts(), serde_json::json!({ "three_d": false }));
}

#[test]
fn an_added_sprite_brightens_and_never_darkens_and_the_rest_is_drawn_as_before() {
    let Some(mut gfx) = gpu() else { return };
    let plain = shot(&mut gfx, &format!("function draw() {GREY_FLOOR} end"));
    // an added red square over the left half; a covering one over the right
    let fx = shot(
        &mut gfx,
        &format!(
            "function draw() {GREY_FLOOR}\n nova.rect(0, 0, 480, 540, {{ 200, 40, 40, 255 }}, {{ blend = 'add' }})\n nova.rect(480, 0, 480, 540, {{ 200, 40, 40, 160 }}) end"
        ),
    );
    let (before, added) = (at(&plain, 200.0, 270.0), at(&fx, 200.0, 270.0));
    for c in 0..3 {
        assert!(
            added[c] >= before[c],
            "adding light never darkens: {before:?} -> {added:?}"
        );
    }
    assert!(
        added[0] > before[0] + 40,
        "red is added: {before:?} -> {added:?}"
    );
    // the covering one does darken green: the difference between the two blends
    assert!(at(&fx, 700.0, 270.0)[1] < before[1] - 20);
    // "screen" brightens too, and never past white
    let screen = shot(
        &mut gfx,
        &format!(
            "function draw() {GREY_FLOOR}\n nova.sprite('dot', 480, 270, {{ sx = 200, sy = 100, color = {{ 255, 255, 255, 255 }}, blend = 'screen' }}) end"
        ),
    );
    assert_eq!(at(&screen, 480.0, 270.0), [255, 255, 255]);
    // a frame with an effect somewhere draws its plain sprites exactly as a frame without
    let elsewhere = shot(
        &mut gfx,
        &format!(
            "function draw() {GREY_FLOOR}\n nova.rect(-50, -50, 10, 10, {{ 255, 0, 0, 255 }}, {{ blend = 'add' }}) end"
        ),
    );
    assert_eq!(
        plain, elsewhere,
        "plain sprites are drawn by the same pipeline when another sprite adds light"
    );
}

#[test]
fn ambient_darkens_the_world_not_the_hud_and_a_light_pools_brightest_at_its_middle() {
    let Some(mut gfx) = gpu() else { return };
    let scene = "function draw()\n nova.rect(0, 0, 960, 540, { 255, 255, 255, 255 })\n nova.ui.rect(0, 480, 120, 60, { 255, 255, 255, 255 })\n";
    let unlit = shot(&mut gfx, &format!("{scene} end"));
    let dark = shot(
        &mut gfx,
        &format!("nova.ambient2d({{ 60, 60, 90 }})\n{scene} end"),
    );
    let corner = at(&dark, 900.0, 60.0);
    assert!(
        sum(corner) < sum(at(&unlit, 900.0, 60.0)) - 300,
        "ambient darkens the world: {corner:?}"
    );
    // a white wall shows the ambient colour itself
    assert!(
        (corner[0] - 60).abs() <= 3 && (corner[2] - 90).abs() <= 3,
        "{corner:?}"
    );
    assert_eq!(
        at(&dark, 60.0, 510.0),
        [255, 255, 255],
        "the HUD is not lit"
    );
    // a light: brightest at the middle, fading out to the ambient at its radius
    let lit = shot(
        &mut gfx,
        &format!(
            "nova.ambient2d({{ 60, 60, 90 }})\n{scene} nova.light2d {{ x = 480, y = 270, radius = 150, color = {{ 255, 200, 120 }} }} end"
        ),
    );
    let (mid, half, edge, far) = (
        sum(at(&lit, 480.0, 270.0)),
        sum(at(&lit, 555.0, 270.0)),
        sum(at(&lit, 627.0, 270.0)),
        sum(at(&lit, 900.0, 60.0)),
    );
    assert!(
        mid > half && half > edge,
        "brighter at the middle: {mid} {half} {edge}"
    );
    assert!(mid > sum(corner) + 150, "the pool is bright: {mid}");
    assert!(
        (edge - far).abs() < 40,
        "at its radius it is about the ambient: {edge} {far}"
    );
    assert_eq!(
        at(&lit, 900.0, 60.0),
        corner,
        "outside its radius nothing changes"
    );
    // `lit = false` keeps a sprite out of the dark (a lit window)
    let window = shot(
        &mut gfx,
        "nova.ambient2d({ 60, 60, 90 })\nfunction draw() nova.rect(0, 0, 960, 540, { 255, 255, 255, 255 }, { lit = false }) end",
    );
    assert_eq!(at(&window, 900.0, 60.0), [255, 255, 255]);
}

#[test]
fn a_reflection_shows_only_on_reflective_tiles_and_is_flipped() {
    let Some(mut gfx) = gpu() else { return };
    // a floor of two tiles 160 units square from y 200: tile 0 (left) reflects, tile 1 (right) does not; a red-over-blue flag stands on
    // each, its foot on the floor's top edge
    let main = |on: bool| {
        format!(
            "local map = nova.raw.tilemap_create {{ image = 'floor', tile_width = 16, tile_height = 16, scale = 10, tiles = {{ {{ 0, 1 }} }}, reflect = {{ 0 }} }}
{}
function draw()
  nova.raw.tilemap_draw(map, 0, 200, 'world')
  nova.sprite('flag', 80, 160, {{ sx = 5, sy = 5, foot = 200 }})
  nova.sprite('flag', 240, 160, {{ sx = 5, sy = 5, foot = 200 }})
end",
            if on { "nova.reflections { strength = 1, ripple = 0, tint = { 255, 255, 255 } }" } else { "" }
        )
    };
    let off = shot(&mut gfx, &main(false));
    let on = shot(&mut gfx, &main(true));
    // just under the foot on the reflective tile: the flag's bottom (blue) first, then its top (red) further down: flipped
    let (near, deep) = (at(&on, 80.0, 215.0), at(&on, 80.0, 265.0));
    assert!(near[2] > near[0] + 60, "blue next to the foot: {near:?}");
    assert!(deep[0] > deep[2] + 60, "red further down: {deep:?}");
    assert_eq!(
        at(&off, 80.0, 215.0),
        [90, 90, 90],
        "nothing without nova.reflections"
    );
    // the tile that does not reflect is untouched, and so is the floor beyond the flipped flag
    for (x, y) in [(240.0, 215.0), (240.0, 265.0), (130.0, 330.0)] {
        assert_eq!(at(&on, x, y), at(&off, x, y), "unchanged at {x}, {y}");
    }
}

#[test]
fn a_shadow_sits_under_the_feet_and_only_when_asked() {
    let Some(mut gfx) = gpu() else { return };
    let files = |shadow: &str| {
        vec![
            ("main.lua", "nova.start('s')".to_string()),
            (
                "entities/box.lua",
                format!("return nova.entity {{ sprite = 'dot', sx = 10, sy = 10, pivot = {{ 0.5, 1 }}, hitbox = {{ -2, -1, 4, 1 }}, shadow = {shadow} }}"),
            ),
            (
                "scenes/s.lua",
                "local S = nova.scene {}\nfunction S:enter() nova.spawn('box', 480, 270); nova.cam.set(480, 270) end\nfunction S:draw() nova.clear(255, 255, 255) end\nreturn S".to_string(),
            ),
        ]
    };
    let run = |gfx: &mut Gfx, shadow: &str| {
        let f = files(shadow);
        let refs: Vec<(&str, &str)> = f.iter().map(|(a, b)| (*a, b.as_str())).collect();
        shot_with(gfx, &refs, 2).0
    };
    let none = run(&mut gfx, "false");
    let with = run(&mut gfx, "true");
    // just under the feet (the box is white on white: only its shadow shows)
    let under = at(&with, 480.0, 274.0);
    assert!(
        sum(under) < sum(at(&none, 480.0, 274.0)) - 60,
        "darker under the feet: {under:?}"
    );
    // centred on the feet: as dark a little above them as below, and lighter further out
    assert!(
        sum(at(&with, 480.0, 280.0)) > sum(under),
        "fading away from the feet"
    );
    // nothing above the box, nor beside the shadow
    for (x, y) in [(480.0, 200.0), (560.0, 274.0)] {
        assert_eq!(at(&with, x, y), at(&none, x, y), "unchanged at {x}, {y}");
    }
}

#[test]
fn rain_falls_over_the_world_and_under_the_hud() {
    let Some(mut gfx) = gpu() else { return };
    let scene = "function draw()\n nova.rect(0, 0, 960, 540, { 10, 10, 20, 255 })\n nova.ui.rect(480, 0, 480, 540, { 40, 40, 40, 255 })\nend";
    let dry = shot(&mut gfx, scene);
    let wet = shot_with(
        &mut gfx,
        &[("main.lua", &format!("nova.weather {{ rain = 1 }}\n{scene}"))],
        3,
    )
    .0;
    let changed = |x0: u32, x1: u32| {
        (0..H)
            .flat_map(|y| (x0..x1).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let i = ((y * W + x) * 4) as usize;
                dry[i..i + 3] != wet[i..i + 3]
            })
            .count()
    };
    assert!(
        changed(0, W / 2) > 400,
        "rain on the world: {} pixels",
        changed(0, W / 2)
    );
    assert_eq!(changed(W / 2, W), 0, "nothing over the HUD");
}

#[test]
fn bloom_and_a_grade_work_on_a_flat_game() {
    let Some(mut gfx) = gpu() else { return };
    let scene = "function draw() nova.rect(0, 0, 960, 540, { 30, 30, 30, 255 }) nova.rect(450, 240, 60, 60, { 255, 255, 255, 255 }) end";
    let plain = shot(&mut gfx, scene);
    let bloom = shot(
        &mut gfx,
        &format!("nova.look {{ bloom = 1, bloom_threshold = 0.6 }}\n{scene}"),
    );
    // the glow spreads past the bright square's edge
    assert!(
        sum(at(&bloom, 518.0, 270.0)) > sum(at(&plain, 518.0, 270.0)) + 15,
        "{:?} {:?}",
        at(&bloom, 518.0, 270.0),
        at(&plain, 518.0, 270.0)
    );
    let graded = shot(
        &mut gfx,
        &format!("nova.look {{ grade = {{ shadows = {{ 180, 200, 255 }} }} }}\n{scene}"),
    );
    let dark = at(&graded, 100.0, 100.0);
    assert!(dark[2] > dark[0], "the darks go blue: {dark:?}");
}

#[test]
fn the_report_says_which_effects_are_on_and_when_lights_are_capped() {
    let Some(mut gfx) = gpu() else { return };
    let (_, g) = shot_with(
        &mut gfx,
        &[(
            "main.lua",
            "nova.ambient2d({ 50, 60, 100 })\nnova.weather { rain = 0.5 }\nnova.look { bloom = 0.4 }\nfunction draw()\n for i = 1, 130 do nova.light2d { x = i * 7, y = 270, radius = 40 } end\n nova.rect(0, 0, 10, 10, { 255, 0, 0, 255 }, { blend = 'add' })\nend",
        )],
        1,
    );
    let f = &g.render_facts()["fx2d"];
    assert_eq!(f["lights"], 128, "{f}");
    assert_eq!(f["lights_asked"], 130);
    assert_eq!(f["max_lights"], 128);
    assert_eq!(f["added"], 1);
    assert_eq!(f["rain"], 0.5);
    assert_eq!(f["ambient"], serde_json::json!([50.0, 60.0, 100.0]));
    assert!((f["bloom"].as_f64().unwrap() - 0.4).abs() < 1e-6);
}

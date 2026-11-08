//! glTF materials (normal maps, metallic-roughness, emission) and custom shaders (`shaders/<name>.wgsl`): what is read, what reaches
//! the renderer, and (when a GPU is present) the pixels. See docs/materials.md and docs/shaders.md.

use std::cell::RefCell;
use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::gfx::Gfx;
use nova_runtime::input::Actions;
use nova_runtime::model::{Image, MeshData, import_glb};
use nova_runtime::vfs::{MemVfs, Vfs};

/// A 2 m quad facing +z (u to the right, v down) whose normal map tips every normal up the picture: (0, 0.6, 0.8).
const TILT: &[u8] = include_bytes!("fixtures/normal_tilt_quad.glb");
const CAR: &[u8] = include_bytes!("fixtures/studio_model.glb");

fn project(manifest: &str, main: &str, extra: Vec<(&str, Vec<u8>)>) -> Rc<dyn Vfs> {
    let mut all = vec![
        ("nova.json", manifest.as_bytes().to_vec()),
        ("models/quad.glb", TILT.to_vec()),
        ("models/car.glb", CAR.to_vec()),
        ("main.lua", main.as_bytes().to_vec()),
    ];
    all.extend(extra);
    Rc::new(MemVfs::new(all))
}

const PLAIN: &str = r#"{"format":1,"name":"T"}"#;
const LIT: &str = r#"{"format":1,"name":"T","materials":true}"#;

/// Records whether each uploaded mesh carries its material.
#[derive(Default)]
struct Recorder(RefCell<Vec<bool>>, RefCell<Vec<String>>);
impl Uploader for Recorder {
    fn set_atlas(&mut self, _: &Image) {}
    fn add_mesh(&mut self, mesh: &MeshData) -> usize {
        let mut list = self.0.borrow_mut();
        list.push(mesh.material.is_some());
        list.len() - 1
    }
    fn add_shader(&mut self, source: &str) -> Result<usize, String> {
        let mut list = self.1.borrow_mut();
        list.push(source.to_string());
        Ok(list.len() - 1)
    }
}

fn frame(g: &mut Game) {
    g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
}

#[test]
fn the_importer_reads_the_normal_map_and_makes_gltf_tangents() {
    let mesh = import_glb(TILT).expect("imports");
    let material = mesh.material.expect("a material");
    let map = material.normal_map.expect("its normal map");
    assert_eq!((map.width, map.height), (4, 4));
    // u runs along +x and the picture's up is +y, so the tangent is +x with handedness +1 (bitangent = n x t = +y)
    for t in &material.tangents {
        assert!(
            (t[0] - 1.0).abs() < 1e-5 && t[1].abs() < 1e-5 && t[2].abs() < 1e-5,
            "{t:?}"
        );
        assert_eq!(t[3], 1.0, "{t:?}");
    }
    for s in &material.surface {
        assert_eq!(
            s,
            &[0.0, 1.0, 1.0, 0.0],
            "not metal, fully rough, normal map at full strength"
        );
    }
    assert!(mesh.notes.is_empty(), "{:?}", mesh.notes);
}

#[test]
fn models_keep_their_look_unless_the_project_opts_in() {
    let count = |manifest: &str| {
        let mut g = Game::load(project(manifest, "", vec![])).expect("loads");
        let mut r = Recorder::default();
        g.upload(&mut r);
        r.0.borrow().iter().filter(|m| **m).count()
    };
    assert_eq!(count(PLAIN), 0, "no material by default");
    // every model (both files, and the car's parts too)
    assert!(count(LIT) >= 2);
    // only the one named
    let one = count(r#"{"format":1,"name":"T","materials":["quad"]}"#);
    assert!(one >= 1 && one < count(LIT), "{one}");
    // a name that is not a model is a warning; a wrong type is an error
    let g = Game::load(project(
        r#"{"format":1,"name":"T","materials":["nope"]}"#,
        "",
        vec![],
    ))
    .unwrap();
    assert!(
        g.warnings.iter().any(|w| w.contains("nope")),
        "{:?}",
        g.warnings
    );
    let e = Game::load(project(
        r#"{"format":1,"name":"T","materials":3}"#,
        "",
        vec![],
    ))
    .err()
    .unwrap();
    assert!(e.contains("materials"), "{e}");
}

#[test]
fn shaders_are_checked_at_load_and_a_broken_one_points_at_its_line() {
    let good = "fn shade(s: Surface) -> vec4<f32> { return s.color; }";
    let bad = "// a typo on line 3\nfn shade(s: Surface) -> vec4<f32> {\n    return s.colour;\n}\n";
    let main = "function update()\n  nova.model('car', 0, 0, 0, { shader = 'bad' })\n  nova.log(table.concat(nova.shaders(), ','))\nend";
    let mut g = Game::load(project(
        PLAIN,
        main,
        vec![
            ("shaders/good.wgsl", good.as_bytes().to_vec()),
            ("shaders/bad.wgsl", bad.as_bytes().to_vec()),
        ],
    ))
    .unwrap();
    assert_eq!(g.shader_errors.len(), 1, "{:?}", g.shader_errors);
    assert!(
        g.shader_errors[0].starts_with("shaders/bad.wgsl:3:"),
        "{:?}",
        g.shader_errors
    );
    let d = nova_runtime::diagnostics::parse(&g.shader_errors[0], "error");
    assert_eq!(
        (d.file.as_deref(), d.line),
        (Some("shaders/bad.wgsl"), Some(3))
    );
    let mut r = Recorder::default();
    g.upload(&mut r);
    assert_eq!(r.1.borrow().len(), 1, "only the good one reaches the GPU");
    frame(&mut g);
    // a draw that names the broken shader is drawn plainly, and the game goes on
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(0);
    assert_eq!((input.models.len(), input.shaded_models.len()), (1, 0));
    let log = g.take_log();
    assert!(log.iter().any(|l| l.contains("did not compile")), "{log:?}");
    assert!(log.iter().any(|l| l == "good"), "{log:?}");
}

#[test]
fn draws_carry_their_shader_params_and_pictures_and_mistakes_are_explained() {
    let shade = "fn shade(s: Surface) -> vec4<f32> { return s.color * s.param; }";
    let png = {
        let mut out = Vec::new();
        let mut e = png::Encoder::new(&mut out, 2, 2);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        e.write_header()
            .unwrap()
            .write_image_data(&[200u8; 16])
            .unwrap();
        out
    };
    let run = |main: &str| {
        let mut g = Game::load(project(
            PLAIN,
            main,
            vec![
                ("shaders/tint.wgsl", shade.as_bytes().to_vec()),
                ("sprites/dot.png", png.clone()),
            ],
        ))
        .unwrap();
        g.upload(&mut Recorder::default());
        frame(&mut g);
        g
    };
    let g = run("function update()
  nova.model('car', 0, 0, 0, { shader = 'tint', params = { 1, 0.5, 0.25, 1, 9 }, textures = { 'dot' }, blend = true })
  nova.sprite('dot', 10, 10)
  nova.sprite('dot', 20, 10, { shader = 'tint' })
  nova.ui.sprite('dot', 30, 10, { shader = 'tint' })
  nova.post('tint', { params = { 1, 1, 1, 1 } })
end");
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(0);
    assert_eq!(input.models.len(), 0);
    let m = &input.shaded_models[0];
    assert_eq!(m.shading.params, [1.0, 0.5, 0.25, 1.0, 9.0, 0.0, 0.0, 0.0]);
    assert!(m.blend && m.shading.textures[0].is_some() && m.shading.textures[1].is_none());
    assert!(!m.draw.casts, "a see-through shaded model casts no shadow");
    assert_eq!(
        input.texture_ops.len(),
        1,
        "the picture is decoded once, for the GPU"
    );
    let sprites: Vec<(usize, bool)> = input
        .shaded_sprites
        .iter()
        .map(|s| (s.index, s.ui))
        .collect();
    assert_eq!(sprites, [(1, false), (0, true)]);
    assert!(input.post.is_some());
    for (main, expect) in [
        (
            "nova.model('car', 0, 0, 0, { shader = 'nope' })",
            "unknown shader 'nope'",
        ),
        (
            "nova.model('car', 0, 0, 0, { shader = 'tint', params = { 1,2,3,4,5,6,7,8,9 } })",
            "at most 8 params",
        ),
        (
            "nova.sprite('dot', 0, 0, { shader = 'tint', textures = { 'missing' } })",
            "no picture 'missing'",
        ),
    ] {
        let g = run(&format!("function update()\n  {main}\nend"));
        let e = g.error.clone().unwrap_or_default();
        assert!(e.contains(expect), "{main}: {e}");
    }
    // the post effect stays until it is cleared
    let mut g = run(
        "local n = 0\nfunction update()\n  n = n + 1\n  if n == 1 then nova.post('tint') elseif n == 3 then nova.post() end\nend",
    );
    assert!(g.frame_input(0).post.is_some());
    frame(&mut g);
    assert!(g.frame_input(0).post.is_some(), "kept on the second frame");
    frame(&mut g);
    assert!(g.frame_input(0).post.is_none(), "cleared");
}

fn gpu() -> Option<(wgpu::Instance, Gfx)> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    match Gfx::new(&instance, None) {
        Ok(g) => Some((instance, g)),
        Err(e) => {
            eprintln!("skipping GPU test: {e}");
            None
        }
    }
}

fn capture(gfx: &mut Gfx, vfs: Rc<dyn Vfs>) -> Vec<u8> {
    let mut g = Game::load(vfs).expect("loads");
    assert!(g.shader_errors.is_empty(), "{:?}", g.shader_errors);
    g.upload(gfx);
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    gfx.capture((320, 180), &g.frame_input(0))
}

fn at(pixels: &[u8], x: usize, y: usize) -> [u8; 3] {
    let i = (y * 320 + x) * 4;
    [pixels[i], pixels[i + 1], pixels[i + 2]]
}

/// The quad seen straight on, the sun coming from high above and a little in front: with its normal map (every normal tipped up
/// the picture, which is up the world) it faces the sun and is bright; drawn plainly it is grazed and dim. A tangent frame the wrong
/// way round would tip the normals down, away from the sun, and darken it. (Skipped without a GPU.)
#[test]
fn a_normal_map_tips_the_light_the_way_gltf_means() {
    let Some((_, mut gfx)) = gpu() else { return };
    let main = "function update()
  nova.camera(0, 0, 4, 0, 0, 0, 50)
  nova.light { dir = { 0, -1, -0.3 }, color = { 255, 255, 255 }, ambient = { 20, 20, 20 } }
  nova.model('quad', 0, 0, 0)
end";
    let plain = capture(&mut gfx, project(PLAIN, main, vec![]));
    let lit = capture(&mut gfx, project(LIT, main, vec![]));
    let (p, l) = (at(&plain, 160, 90), at(&lit, 160, 90));
    assert!(
        l[1] > p[1] + 60,
        "the tipped normals face the sun: plain {p:?}, with the normal map {l:?}"
    );
}

/// Metal reflects the sky and shows the sun's highlight; emission glows in the dark. (Skipped without a GPU.)
#[test]
fn metallic_roughness_and_emission_change_the_pixels_only_when_opted_in() {
    let Some((_, mut gfx)) = gpu() else { return };
    let main = "function update()
  nova.camera(0, 0, 4, 0, 0, 0, 50)
  nova.sky { top = { 40, 90, 200 }, horizon = { 220, 230, 240 } }
  nova.light { dir = { 0, 0, -1 }, color = { 255, 255, 255 }, ambient = { 40, 40, 40 } }
  nova.model('quad', 0, 0, 0)
end";
    let a = capture(&mut gfx, project(PLAIN, main, vec![]));
    let b = capture(&mut gfx, project(PLAIN, main, vec![]));
    assert_eq!(a, b, "the plain look is the same every time");
    let lit = capture(&mut gfx, project(LIT, main, vec![]));
    assert_ne!(a, lit, "opted in, the material changes the picture");
}

/// A custom shader on a model, on a sprite and as a post effect: each makes the pixels it says. (Skipped without a GPU.)
#[test]
fn custom_shaders_draw_on_models_sprites_and_the_whole_picture() {
    let Some((_, mut gfx)) = gpu() else { return };
    let red = "fn shade(s: Surface) -> vec4<f32> { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }";
    let invert = "fn shade(s: Surface) -> vec4<f32> { return vec4<f32>(vec3<f32>(1.0) - s.color.rgb, 1.0); }";
    let png = {
        let mut out = Vec::new();
        let mut e = png::Encoder::new(&mut out, 8, 8);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        e.write_header()
            .unwrap()
            .write_image_data(&[255u8; 256])
            .unwrap();
        out
    };
    let files = || {
        vec![
            ("shaders/red.wgsl", red.as_bytes().to_vec()),
            ("shaders/invert.wgsl", invert.as_bytes().to_vec()),
            ("sprites/box.png", png.clone()),
        ]
    };
    let scene = |model: &str, sprite: &str, post: &str| {
        format!(
            "function update()
  nova.camera(0, 0, 4, 0, 0, 0, 50)
  nova.clear(0, 0, 255)
  {post}
  nova.model('quad', 0, 0, 0{model})
  nova.ui.sprite('box', 40, 40, {{ scale = 4{sprite} }})
end"
        )
    };
    let base = capture(&mut gfx, project(PLAIN, &scene("", "", ""), files()));
    // the quad in the middle, the white sprite near the top left, blue around
    assert_eq!(at(&base, 300, 170), [0, 0, 255]);
    let model = capture(
        &mut gfx,
        project(PLAIN, &scene(", { shader = 'red' }", "", ""), files()),
    );
    assert_eq!(at(&model, 160, 90), [255, 0, 0], "the quad is red");
    assert_eq!(
        at(&model, 300, 170),
        [0, 0, 255],
        "and nothing else changed"
    );
    let sprite = capture(
        &mut gfx,
        project(PLAIN, &scene("", ", shader = 'red'", ""), files()),
    );
    // the sprite's middle: (40, 40) in UI units of a 540-high screen, scaled to 180 high
    let (sx, sy) = (40 * 180 / 540, 40 * 180 / 540);
    assert_eq!(at(&base, sx, sy), [255, 255, 255]);
    assert_eq!(at(&sprite, sx, sy), [255, 0, 0], "the sprite is red");
    assert_eq!(
        at(&sprite, 160, 90),
        at(&base, 160, 90),
        "the quad is as before"
    );
    let post = capture(
        &mut gfx,
        project(PLAIN, &scene("", "", "nova.post('invert')"), files()),
    );
    assert_eq!(
        at(&post, 300, 170),
        [255, 255, 0],
        "the world picture inverted: blue becomes yellow"
    );
    assert_eq!(
        at(&post, sx, sy),
        [255, 255, 255],
        "the UI is drawn after the post effect, unchanged"
    );
}

/// After a lost device, the shaders and their pictures come back with the same ids: the same picture. (Skipped without a GPU.)
#[test]
fn custom_shaders_and_materials_survive_a_lost_device() {
    let Some((instance, mut gfx)) = gpu() else {
        return;
    };
    let tex = "fn shade(s: Surface) -> vec4<f32> { return nova_texture_a(s.uv) * vec4<f32>(s.param.xyz, 1.0); }";
    let png = {
        let mut out = Vec::new();
        let mut e = png::Encoder::new(&mut out, 2, 2);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        e.write_header()
            .unwrap()
            .write_image_data(&[
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
            ])
            .unwrap();
        out
    };
    let vfs = project(
        LIT,
        "function update()
  nova.camera(0, 1, 4, 0, 0, 0, 50)
  nova.model('quad', -1.2, 0, 0)
  nova.model('quad', 1.2, 0, 0, { shader = 'tex', params = { 1, 0.5, 1 }, textures = { 'checks' } })
end",
        vec![
            ("shaders/tex.wgsl", tex.as_bytes().to_vec()),
            ("sprites/checks.png", png),
        ],
    );
    let mut g = Game::load(vfs).unwrap();
    g.upload(&mut gfx);
    frame(&mut g);
    let before = gfx.capture((320, 180), &g.frame_input(0));
    g.clear_mesh_ops();
    gfx.simulate_loss();
    assert!(gfx.is_lost());
    gfx.recover(&instance, None).expect("a new device");
    frame(&mut g);
    let after = gfx.capture((320, 180), &g.frame_input(0));
    assert_eq!(before, after, "the same picture from the new device");
}

//! What menu builders kept asking for: panels with rounded corners, a slant, a gradient and an outline; a rectangle drawn over the
//! text (`layer = "top"`); text turned and grown; hooks that outlive a scene; the exact screen size; and the small things agents
//! had to find out (`flip_x` on `nova.sprite`, a clip's `speed`).

use nova_runtime::actions::InputFrame;
use nova_runtime::game::Game;
use nova_runtime::testing;

fn game(main: &str) -> Game {
    testing::load_files(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", main.as_bytes().to_vec()),
        ("sprites/dot.png", dot()),
        ("scenes/a.lua", b"return nova.scene {}".to_vec()),
        ("scenes/b.lua", b"return nova.scene {}".to_vec()),
    ])
    .expect("the game loads")
}

/// A 4x2 picture.
fn dot() -> Vec<u8> {
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(&mut out, 4, 2);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header()
        .unwrap()
        .write_image_data(&[255u8; 4 * 4 * 2])
        .unwrap();
    out
}

fn frame(g: &mut Game, view: [f32; 2]) {
    g.update_input(1.0 / 60.0, 0.0, view, &InputFrame::default());
    assert!(g.error.is_none(), "{:?}", g.error);
}

#[test]
fn a_rect_with_options_is_a_panel_and_layer_top_draws_it_in_order_with_the_text() {
    let mut g = game(
        "function draw()
           nova.ui.rect(0, 0, 10, 10, {255, 0, 0})
           nova.ui.text(0, 0, 'HUD')
           nova.ui.rect(0, 0, 960, 540, {0, 0, 0, 128}, { layer = 'top' })
           nova.ui.text(0, 100, 'PAUSED')
         end",
    );
    frame(&mut g, [960.0, 540.0]);
    let input = g.frame_input(540);
    // the plain rectangle stays in the UI list; the dimming one is in the text's, after HUD's letters and before PAUSED's
    assert_eq!(input.sprites_front.len(), 1);
    let dim = input
        .text
        .iter()
        .position(|t| t.size == [960.0, 540.0])
        .expect("the dimming rectangle is drawn with the text");
    assert!(dim >= 3, "after the three letters of HUD: {dim}");
    assert_eq!(input.text.len(), dim + 1 + 6, "PAUSED is over it");

    let mut g = game(
        "function draw()
           nova.ui.rect(100, 100, 200, 60, {40, 90, 200}, { radius = 12, slant = 16, gradient = { {40, 90, 200}, {10, 20, 60} }, outline = { color = {255, 255, 255}, width = 3 } })
         end",
    );
    frame(&mut g, [960.0, 540.0]);
    let input = g.frame_input(540);
    let n = input.sprites_front.len();
    assert!(
        n > 20 && n < 2000,
        "a rounded, slanted panel in rows: {n} pieces"
    );
    assert!(
        input
            .sprites_front
            .iter()
            .any(|s| s.color == [255, 255, 255, 255]),
        "the outline"
    );
    assert!(
        input
            .sprites_front
            .iter()
            .any(|s| s.color[3] > 0 && s.color[3] < 255),
        "smooth edges"
    );
    let bad = game("function draw() nova.ui.rect(0, 0, 1, 1, {0,0,0}, { layer = 'over' }) end");
    let mut bad = bad;
    bad.update_input(1.0 / 60.0, 0.0, [960.0, 540.0], &InputFrame::default());
    assert!(
        bad.error
            .as_deref()
            .is_some_and(|e| e.contains("layer is \"top\"")),
        "{:?}",
        bad.error
    );
}

#[test]
fn text_turns_and_grows_about_its_place() {
    let mut g = game("function draw() nova.ui.text(100, 100, 'AB', { size = 20 }) end");
    frame(&mut g, [960.0, 540.0]);
    let plain: Vec<_> = g.frame_input(540).text.to_vec();
    let mut g = game(
        "function draw() nova.ui.text(100, 100, 'AB', { size = 20, rotation = math.pi / 2, zoom = 2 }) end",
    );
    frame(&mut g, [960.0, 540.0]);
    let turned = g.frame_input(540).text.to_vec();
    assert_eq!(plain.len(), turned.len());
    for (a, b) in plain.iter().zip(&turned) {
        assert!((b.rotation - std::f32::consts::FRAC_PI_2).abs() < 1e-5);
        assert!((b.size[0] - a.size[0] * 2.0).abs() < 1e-4);
        // a quarter turn clockwise about (100, 100): what was to the right is now below
        let (dx, dy) = (a.center[0] - 100.0, a.center[1] - 100.0);
        assert!(
            (b.center[0] - (100.0 - dy * 2.0)).abs() < 1e-3
                && (b.center[1] - (100.0 + dx * 2.0)).abs() < 1e-3
        );
    }
}

#[test]
fn hooks_outlive_a_scene_and_the_exact_view_is_fractional() {
    let mut g = game(
        "ticks, drawn = 0, 0
         nova.on_update(function(dt) ticks = ticks + 1 end)
         local off = nova.on_draw_ui(function() drawn = drawn + 1 end)
         nova.start('a')
         function stop_drawing() off() end",
    );
    for _ in 0..3 {
        frame(&mut g, [961.5, 540.0]);
    }
    g.run_lua("nova.goto_scene('b')", "t").unwrap();
    for _ in 0..3 {
        frame(&mut g, [961.5, 540.0]);
    }
    assert_eq!(g.lua_text("ticks").unwrap(), "6");
    assert_eq!(g.lua_text("drawn").unwrap(), "6");
    g.run_lua("stop_drawing()", "t").unwrap();
    frame(&mut g, [961.5, 540.0]);
    assert_eq!(g.lua_text("drawn").unwrap(), "6", "taken away");
    assert_eq!(g.lua_text("(nova.view())").unwrap(), "961");
    assert_eq!(g.lua_text("(nova.view('exact'))").unwrap(), "961.5");
}

#[test]
fn a_sprite_flips_and_a_clip_plays_at_its_speed() {
    let mut g = game(
        "function draw()
           nova.sprite('dot', 10, 10, { scale = 2 })
           nova.sprite('dot', 10, 10, { scale = 2, flip_x = true })
           nova.sprite('dot', 10, 10, { scale = 2, flip_y = true, rotation = 1 })
         end",
    );
    frame(&mut g, [960.0, 540.0]);
    let input = g.frame_input(540);
    let sizes: Vec<[f32; 2]> = input.sprites_back.iter().map(|s| s.size).collect();
    assert_eq!(sizes, vec![[8.0, 4.0], [-8.0, 4.0], [8.0, -4.0]]);
    assert_eq!(
        input.sprites_back[2].rotation, 1.0,
        "the flip first, then the turn"
    );
}

#[test]
fn play_takes_a_speed() {
    let mut g = testing::load_dir("examples/starter-platformer").expect("loads");
    frame(&mut g, [960.0, 540.0]);
    let hero = "nova.named('hero')";
    g.run_lua(
        &format!("{hero}:play('walk_right', {{ speed = 1.5 }})"),
        "t",
    )
    .unwrap();
    assert_eq!(g.lua_text(&format!("{hero}.anim_speed")).unwrap(), "1.5");
    assert!(
        g.run_lua(&format!("{hero}:play('walk_right', {{ speed = -1 }})"), "t")
            .unwrap_err()
            .contains("speed is a number")
    );
}

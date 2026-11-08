//! Menus and HUDs (`nova.ui.menu`, `nova.ui.layout`, `nova.ui.theme`, `nova.ui.load`, text that fits): layout from the screen's
//! edges, focus moved by direction, pressing, going back, scrolling, focus memory and menus read from files.

use std::rc::Rc;

use nova_runtime::actions::InputFrame;
use nova_runtime::game::{Game, NullUploader};
use nova_runtime::vfs::{MemVfs, Vfs};

fn project(files: Vec<(&str, &str)>) -> Game {
    let mut all = vec![("nova.json", br#"{"format":1,"name":"T"}"#.to_vec())];
    all.extend(files.into_iter().map(|(p, s)| (p, s.as_bytes().to_vec())));
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut game = Game::load(vfs).expect("project loads");
    game.upload(&mut NullUploader::default());
    assert!(game.error.is_none(), "{:?}", game.error);
    game
}

struct Run {
    game: Game,
    frame: u32,
}

impl Run {
    fn new(main: &str) -> Self {
        Self::with(vec![("main.lua", main)])
    }
    fn with(files: Vec<(&str, &str)>) -> Self {
        Run {
            game: project(files),
            frame: 0,
        }
    }
    /// One frame with these sources held (a source held across two calls is pressed only on the first).
    fn step(&mut self, sources: &[&str], view: [f32; 2]) -> Vec<String> {
        let frame = InputFrame {
            sources: sources.iter().map(|k| (k.to_string(), 1.0)).collect(),
            ..Default::default()
        };
        self.frame += 1;
        self.game
            .update_input(1.0 / 60.0, self.frame as f64 / 60.0, view, &frame);
        assert!(
            self.game.error.is_none(),
            "{:?}",
            self.game.error_detail.clone().or(self.game.error.clone())
        );
        self.game.take_log()
    }
    /// A press: down for one frame, then up for one.
    fn press(&mut self, source: &str) -> Vec<String> {
        let mut log = self.step(&[source], [960.0, 540.0]);
        log.extend(self.step(&[], [960.0, 540.0]));
        log
    }
    fn idle(&mut self) -> Vec<String> {
        self.step(&[], [960.0, 540.0])
    }
}

fn nums(line: &str) -> Vec<f64> {
    line.split_whitespace()
        .filter_map(|w| w.parse::<f64>().ok())
        .collect()
}

const MAIN_MENU: &str = r#"
function update()
  local r = nova.ui.menu {
    id = "main",
    { "text", "MY GAME", style = "title" },
    { "button", "Play", id = "play" },
    { "button", "Options", id = "options" },
    { "button", "Quit", id = "quit" },
  }
  local a, b = r.rects.play, r.rects.quit
  nova.log(string.format("rect %.1f %.1f %.1f %.1f  %.1f %.1f %.1f %.1f", a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h))
  nova.log("focus " .. tostring(r.focus))
  if r.moved then nova.log("moved") end
  if r.pressed then nova.log("pressed " .. r.pressed) end
  if r.back then nova.log("back") end
end
"#;

#[test]
fn a_column_menu_is_centred_and_the_focus_moves_wraps_presses_and_goes_back() {
    let mut run = Run::new(MAIN_MENU);
    let log = run.idle();
    let rect = nums(&log[0]);
    let (x, y, w, h) = (rect[0], rect[1], rect[2], rect[3]);
    let (qx, qy, qw) = (rect[4], rect[5], rect[6]);
    assert!(
        (x + w / 2.0 - 480.0).abs() < 1.0,
        "centred across the screen: {log:?}"
    );
    assert!(h >= 44.0, "a button is at least the theme's height");
    assert_eq!(
        (x, w),
        (qx, qw),
        "buttons in a column line up and stretch alike"
    );
    assert!(qy > y + 2.0 * h, "Quit is two rows below Play");
    assert_eq!(log[1], "focus play", "the first button has the focus");

    let log = run.press("key:ArrowDown");
    assert!(log.contains(&"focus options".to_string()), "{log:?}");
    assert!(log.contains(&"moved".to_string()));
    run.press("key:ArrowDown");
    let log = run.press("key:ArrowDown");
    assert!(
        log.contains(&"focus play".to_string()),
        "down from the last wraps to the first: {log:?}"
    );
    let log = run.press("key:ArrowUp");
    assert!(log.contains(&"focus quit".to_string()), "{log:?}");
    let log = run.press("pad:south");
    assert!(
        log.contains(&"pressed quit".to_string()),
        "A presses: {log:?}"
    );
    let log = run.press("pad:east");
    assert!(log.contains(&"back".to_string()), "B goes back: {log:?}");
    // the left stick moves it too
    let log = run.press("axis:left_y");
    assert!(log.contains(&"focus play".to_string()), "{log:?}");
}

#[test]
fn holding_a_direction_repeats_after_a_pause() {
    let mut run = Run::new(
        r#"
function update()
  local items = { id = "long" }
  for i = 1, 20 do items[i] = { "button", "Item " .. i, id = "i" .. i } end
  local r = nova.ui.menu(items)
  nova.log(r.focus)
end
"#,
    );
    run.idle();
    let mut last = String::new();
    for _ in 0..60 {
        last = run.step(&["key:ArrowDown"], [960.0, 540.0]).pop().unwrap();
    }
    // one second held: the first press, then after 0.35 s about one move every 0.09 s
    let n: u32 = last[1..].parse().unwrap();
    assert!((6..=10).contains(&n), "held for a second: {last}");
}

#[test]
fn the_focus_goes_to_the_nearest_item_that_way_in_a_grid_and_rows() {
    let mut run = Run::new(
        r#"
function update()
  local grid = { "grid", columns = 3, cell_w = 120, cell_h = 60 }
  for i = 1, 9 do grid[#grid + 1] = { "button", tostring(i), id = "c" .. i } end
  local r = nova.ui.menu {
    id = "grid",
    { "row", { "button", "Back", id = "back", w = 120 }, { "button", "Help", id = "help", w = 120 } },
    grid,
  }
  nova.log(r.focus)
end
"#,
    );
    let focus = |run: &mut Run, key: &str| run.press(key).last().unwrap().clone();
    run.idle();
    assert_eq!(
        focus(&mut run, "key:ArrowDown"),
        "c1",
        "down from Back: the cell under it"
    );
    assert_eq!(focus(&mut run, "key:ArrowRight"), "c2");
    assert_eq!(focus(&mut run, "key:ArrowDown"), "c5");
    assert_eq!(focus(&mut run, "key:ArrowRight"), "c6");
    assert_eq!(
        focus(&mut run, "key:ArrowRight"),
        "c4",
        "along a row it wraps"
    );
    assert_eq!(focus(&mut run, "key:ArrowUp"), "c1");
    assert_eq!(focus(&mut run, "key:ArrowUp"), "back");
    assert_eq!(focus(&mut run, "key:ArrowRight"), "help");
}

#[test]
fn a_long_list_scrolls_to_keep_the_focus_in_view_and_menus_remember_their_focus() {
    let mut run = Run::new(
        r#"
show = "list"
function update()
  if nova.input.pressed("x") then show = show == "list" and "other" or "list" end
  if show == "other" then
    local r = nova.ui.menu { id = "other", { "button", "One", id = "one" }, { "button", "Two", id = "two" } }
    nova.log("other " .. r.focus)
    return
  end
  local list = { "column", visible = 3, id = "box" }
  for i = 1, 8 do list[#list + 1] = { "button", "Item " .. i, id = "i" .. i } end
  local r = nova.ui.menu { id = "list", list }
  local f = r.rects[r.focus]
  local first = r.rects.i1
  nova.log(string.format("%s %.0f %.0f", r.focus, f.y, first.y))
end
"#,
    );
    let first_y = nums(&run.idle()[0])[0];
    for _ in 0..4 {
        run.press("key:ArrowDown");
    }
    let log = run.idle();
    assert!(log[0].starts_with("i5 "), "{log:?}");
    let v = nums(&log[0]);
    // the list moved up by two rows: item 5 is in the last of three places, item 1 is above the window
    assert!(v[0] > first_y, "item 5 shows below the top: {log:?}");
    assert!(v[1] < first_y - 50.0, "item 1 scrolled out above: {log:?}");
    // another menu, and back: the focus is where it was
    run.press("key:KeyC");
    let log = run.idle();
    assert_eq!(log, ["other one"]);
    run.press("key:ArrowDown");
    run.press("key:KeyC");
    let log = run.idle();
    assert!(log[0].starts_with("i5 "), "focus remembered: {log:?}");
    run.press("key:KeyC");
    assert_eq!(run.idle(), ["other two"]);
}

#[test]
fn adjust_buttons_take_left_and_right_and_focus_can_be_set() {
    let mut run = Run::new(
        r#"
volume = 5
nova.ui.focus("opts", "vol")
function update()
  local r = nova.ui.menu {
    id = "opts",
    { "button", "Music", id = "music" },
    { "button", "Volume", value = volume .. "/10", id = "vol", adjust = true },
  }
  if r.step then volume = volume + r.step; nova.log(r.changed .. " " .. volume) end
  nova.log("focus " .. r.focus)
end
"#,
    );
    assert_eq!(run.idle(), ["focus vol"]);
    let log = run.press("key:ArrowRight");
    assert_eq!(log[0], "vol 6");
    let log = run.press("key:ArrowLeft");
    assert_eq!(log[0], "vol 5");
}

#[test]
fn anchors_place_a_hud_at_the_screen_edges_on_any_screen() {
    let src = r#"
function update()
  local r = nova.ui.layout {
    kind = "stack", w = "100%", h = "100%",
    { "text", "SCORE 100", id = "score", anchor = "topleft" },
    { "text", "LAP 1/3", id = "lap", anchor = "topright" },
    { "row", id = "bar", anchor = "bottom", w = "50%", { "text", "a" }, { "text", "b" } },
  }
  local vw, vh = nova.view()
  local s, l, b = r.score, r.lap, r.bar
  nova.log(string.format("%.1f %.1f %.1f %.1f %.1f %.1f %.1f %d %d", s.x, s.y, l.x + l.w, l.y, b.x + b.w / 2, b.y + b.h, b.w, vw, vh))
end
"#;
    let mut run = Run::new(src);
    for view in [[960.0, 540.0], [720.0, 540.0]] {
        let v = nums(&run.step(&[], view)[0]);
        let (vw, vh) = (v[7], v[8]);
        assert_eq!((v[0], v[1]), (24.0, 24.0), "top left inside the margin");
        assert_eq!(v[2], vw - 24.0, "top right inside the margin ({vw})");
        assert_eq!(v[3], 24.0);
        assert_eq!(v[4], vw / 2.0, "the bar is centred");
        assert_eq!(v[5], vh - 24.0, "on the bottom edge");
        assert!(
            (v[6] - (vw - 48.0) / 2.0).abs() < 0.01,
            "half the room across"
        );
    }
}

#[test]
fn text_shrinks_to_fit_its_width_or_wraps_and_shrinks_to_its_height() {
    let run = Run::new(
        r#"
local long = "A very long stage name that will not fit"
local w, h = nova.ui.text_size(long, { size = 30 })
local sw, sh, size = nova.ui.text_size(long, { size = 30, width = 200, fit = "shrink" })
nova.log(string.format("%.1f %.1f %.1f %.1f", w, sw, size, sh))
local para = string.rep("words that wrap ", 30)
local ww, wh, wsize = nova.ui.text_size(para, { size = 24, width = 300, fit = "wrap", height = 120 })
nova.log(string.format("%.1f %.1f %.1f", ww, wh, wsize))
local fw, fh, fsize = nova.ui.text_size("Short", { size = 30, width = 200, fit = "shrink" })
nova.log(string.format("%.1f", fsize))
local ok, err = pcall(nova.ui.text_size, "x", { fit = "shrink" })
nova.log(tostring(err))
"#,
    );
    let log = run.game.take_log();
    let a = nums(&log[0]);
    assert!(a[0] > 300.0, "too wide at full size: {log:?}");
    assert!(a[1] <= 200.0, "shrunk to fit: {log:?}");
    assert!(a[2] < 30.0 && a[2] >= 8.0, "a smaller size: {log:?}");
    let b = nums(&log[1]);
    assert!(
        b[0] <= 300.0 && b[1] <= 120.0,
        "wrapped inside the box: {log:?}"
    );
    assert!(b[2] < 24.0, "{log:?}");
    assert_eq!(nums(&log[2])[0], 30.0, "text that fits keeps its size");
    assert!(log[3].contains("needs a `width`"), "{log:?}");
}

#[test]
fn a_menu_can_be_a_file_and_a_theme_changes_every_menu() {
    let mut run = Run::with(vec![
        (
            "menus/pause.menu.json",
            r#"{ "kind": "panel", "id": "pause", "anchor": "right", "children": [
                 { "kind": "text", "text": "PAUSED", "style": "heading" },
                 { "kind": "button", "text": "Resume", "id": "resume" },
                 { "kind": "button", "text": "Quit", "id": "quit" } ] }"#,
        ),
        (
            "main.lua",
            r#"
nova.ui.theme { button = { h = 60 }, margin = 40 }
function update()
  local m = nova.ui.load("pause")
  local r = nova.ui.menu(m)
  local a = r.rects.resume
  local vw = nova.view()
  nova.log(string.format("%s %.0f %.0f", r.focus, a.h, vw - (a.x + a.w)))
  if r.pressed then nova.log("pressed " .. r.pressed) end
end
"#,
        ),
    ]);
    let log = run.idle();
    let v = nums(&log[0]);
    assert!(log[0].starts_with("resume "), "{log:?}");
    assert_eq!(v[0], 60.0, "the theme's button height");
    // the panel's padding (16) and the theme's margin (40) from the right edge
    assert_eq!(v[1], 56.0, "{log:?}");
    let log = run.press("key:ArrowDown");
    let log2 = run.press("key:Enter");
    assert!(
        log2.contains(&"pressed quit".to_string()),
        "{log:?} {log2:?}"
    );
}

#[test]
fn mistakes_are_named() {
    let g = project(vec![(
        "main.lua",
        r#"
local ok, e = pcall(nova.ui.menu, { { "buton", "Play" } })
nova.log(e)
local ok2, e2 = pcall(nova.ui.load, "nothing")
nova.log(e2)
local ok3, e3 = pcall(nova.ui.layout, { { "text", "x", w = "wide" } })
nova.log(e3)
"#,
    )]);
    let log = g.take_log();
    assert!(log[0].contains("unknown kind 'buton'"), "{log:?}");
    assert!(log[1].contains("menus/nothing.menu.json"), "{log:?}");
    assert!(log[2].contains("not 'wide'"), "{log:?}");
}

#[test]
fn the_press_that_opens_a_menu_does_not_press_its_first_button() {
    let mut run = Run::new(
        r#"
screen = "first"
function update()
  if screen == "first" then
    local r = nova.ui.menu { id = "first", { "button", "Next", id = "next" } }
    if r.pressed then screen = "second"; nova.log("opened") end
  end
  -- (drawn in the same frame as the press that opened it)
  if screen == "second" then
    local r = nova.ui.menu { id = "second", { "button", "Go back", id = "back" } }
    if r.pressed then nova.log("pressed " .. r.pressed) end
  end
end
"#,
    );
    run.idle();
    let log = run.step(&["key:Enter"], [960.0, 540.0]);
    assert_eq!(log, ["opened"]);
    // the same press is still down and nothing new is pressed: the second menu does nothing
    assert!(run.step(&["key:Enter"], [960.0, 540.0]).is_empty());
    assert!(run.idle().is_empty());
    assert_eq!(run.press("key:Enter")[0], "pressed back");
}

#[test]
fn spaced_out_text_is_wider_by_its_spacing_and_a_slant_draws() {
    let g = project(vec![(
        "main.lua",
        r#"
local w0 = nova.ui.text_size("ABCDE", { size = 20 })
local w1 = nova.ui.text_size("ABCDE", { size = 20, spacing = 0.2 })
nova.log(string.format("%.2f", w1 - w0))
nova.ui.slant(10, 10, 200, 40, 12, { 255, 106, 43 })
nova.ui.slant(10, 60, 200, 40, -12)
nova.ui.slant(10, 60, 0, 40, 5)
nova.log("ok")
"#,
    )]);
    let log = g.take_log();
    // four gaps between five letters, a fifth of the size each
    assert_eq!(log[0], "16.00", "{log:?}");
    assert_eq!(log[1], "ok");
}

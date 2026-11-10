# Menus and HUDs (`nova.ui.menu`, `nova.ui.layout`, `nova.ui.theme`)

A menu or a HUD is a tree of plain tables: rows, columns, grids, panels, text, buttons and pictures. The engine lays it out from
the edges and the middle of the screen every frame, fits every text to its box, moves a focus between the buttons with the pad and
draws it all in the game's theme. Nothing is placed by hand pixel by pixel, so a long name cannot run into the next column and a
new row cannot land on top of a button.

The code is Lua, embedded in the runtime (`crates/nova-runtime/lua/ui_layout.lua`, loaded after the framework). Text fitting is
in Rust (`draw_text` in `game.rs`). Tests: `crates/nova-runtime/tests/ui_layout.rs`. A small example with no styling at all is
`examples/menus`; Pine Ridge Rally's title, chooser, pick pages, options, controls, how-to, pause and results screens are built on it
(`examples/pine-ridge-rally/scenes/title.lua`, `scenes/results.lua`, and its theme in `lib/ui.lua`).

## A first menu

```lua
function draw()
  local r = nova.ui.menu {
    id = "title",
    { "text", "MY GAME", style = "title" },
    { "button", "Play", id = "play" },
    { "button", "Options", id = "options" },
    { "button", "Quit", id = "quit" },
  }
  if r.pressed == "play" then start_game() end
  if r.back then ... end
end
```

That is a column in the middle of the screen, the title over three buttons of the same width, the first one focused. Up and down
(the d-pad, the left stick or the arrow keys) move the focus, A (or start, or Enter) presses, B goes back. Holding a direction
moves again after a short pause, then steadily. Call it every frame, from `draw` or a scene's `draw_ui`: it reads the pad as it
draws (immediate mode), and keeps what it must remember (the focus, scrolling, the sliding highlight) under its `id`.

`nova.ui.menu` returns:

| Field | Meaning |
| --- | --- |
| `pressed` | the `id` of the button pressed this frame (A, start, or a click), or nil |
| `back` | true when B was pressed |
| `step`, `changed` | `-1` or `1` when left or right was pressed on a button with `adjust = true`, and that button's id |
| `focus` | the id of the focused button |
| `moved` | the focus moved this frame |
| `rects` | `{ [id] = { x, y, w, h } }` of every focusable thing, where it was drawn |

A menu takes no input in the frame it opens (it was not drawn in the last quarter of a second), so the press that opened it does
not also press its first button.

## The tree

Every item is a table. The first entry is its kind, a string second entry is its text, and further tables in it are what it holds:
`{ "row", { "text", "A" }, { "text", "B" } }`. The same can be written out (`kind`, `text`, `children`), which is how a menu file
says it. Buttons and anything with `focusable = true` take the focus; an `id` names them (otherwise they are named by where they
are, which changes when items are added).

| Kind | What it is |
| --- | --- |
| `column` | children one under another (the default for the outermost table) |
| `row` | children side by side |
| `grid` | children in `columns` columns (2), cells `cell_w` by `cell_h` (by default the width shared out and the tallest child) |
| `stack` | children on top of each other, each placed by its own `anchor` inside (a HUD: `w = "100%", h = "100%"`) |
| `panel` | a column on the theme's panel (any container can have one too: `panel = true`, or a table that changes the look) |
| `button` | a focusable row with its text and an optional `value` on the right; with children inside it is a focusable card |
| `text` | words in the theme's `style` (`title`, `heading`, `body`, `small`, `label`, or your own) |
| `image` | a picture from `sprites/` (`{ "image", "ui/pad_a", w = 30, h = 30 }`, `frame`, `scale`, `color`) |
| `box` | an empty rectangle of a size, drawn by its `draw(r, node, ctx)` function (a course preview, a bar of stats) |
| `space` | room: `h` or `w`, or the rest of the space when it has neither |
| `prompt`, `hints` | a pad button and what it does; `{ "hints", items = { { "a", "Accept" }, { "b", "Back" } } }` is a row of them |

**Sizes** are logical units (the screen is 540 high, the width follows its shape: 960 at 16:9, 720 at 4:3), `"50%"` of the room the
parent has, or `"fill"`. Without a size a thing is as big as what is in it (text measures itself; a button is at least the theme's
button height). `grow` shares out what room is left along a row or a column (weights, like flexbox). `min_w`, `max_w`, `min_h`,
`max_h` bound it.

**Inside a container:** `gap` between children (the theme's 10), `pad` round them (a number, `{ x, y }` or `{ left, top, right,
bottom }`), `align` across (`"start"`, `"center"`, `"end"`, `"stretch"`; a column stretches its children, a row centres them),
`justify` along (`"start"`, `"center"`, `"end"`, `"between"`). A child can say `align_self`. A row whose children do not fit gives
room up from those without a width of their own, and their text shrinks.

**On the screen:** the outermost table is placed by `anchor` (`"center"`, `"top"`, `"bottom"`, `"left"`, `"right"`, `"topleft"`,
`"topright"`, `"bottomleft"`, `"bottomright"`) inside the screen less `margin` (the theme's 24), moved by `x` and `y`. With `x` or
`y` and no anchor it is placed from the top left corner, with no margin. In a `stack`, each child's `anchor`, `x` and `y` place it
in the stack's box. Because everything is measured from edges and the middle, the same tree works at 16:9, 4:3 and any other shape;
1920x1080 is the same 960x540 drawn at twice the pixels.

**Moving things:** `dx`, `dy` shift something and what it holds as it is drawn (rows sliding in), and `alpha` (0 to 1) fades it.
Buttons slide in one after another when a menu opens (the theme's `enter`; `enter = false` on a menu turns it off, `enter = seconds`
drives it from your own clock).

## Focus

The d-pad and the left stick move to the nearest focusable thing in that direction: the one most in line, then the nearest. With
nothing that way the focus wraps round to the far end of the same line (a menu's `wrap = false` stops that). In a grid with
`flow = true` (or a column with it), left and right go to the one before or after in reading order, across the rows (a card chooser, a list that left and right also step through). A button with
`adjust = true` takes left and right itself (`r.step`), for volumes and choices. `disabled = true` shows a button greyed and skips
it; `focusable = false` skips it without greying it. `focus = true` on an item makes it the first focus.

A column or grid with `visible = n` shows n children (a grid: n rows) and scrolls to keep the focus in view, with a small arrow at
its top and bottom right that lights up when there is more that way.

Each menu remembers its focus and scrolling by its `id`, also while it is not on screen, so going back to a menu finds the same
button focused. `nova.ui.focus(menu_id, item_id)` moves the focus (the next time the menu is drawn) and `nova.ui.focus(menu_id)`
says where it is; `nova.ui.forget(menu_id)` makes it open as if for the first time. A menu with `active = false` is drawn but
takes no input (while the game waits for something else).

The pointer works too: moving the mouse over a button focuses it, a click presses it, the wheel moves the focus.

## Text that fits

Every text in a tree is fitted to its box: one line shrinks until it fits (never below 8 units), and `wrap = true` wraps it at its
width instead, shrinking it if it is taller than its box. The same is open to any `nova.ui.text` call:

```lua
nova.ui.text(x, y, name, { size = 24, width = 200, fit = "shrink" })              -- one line, smaller until it is 200 wide
nova.ui.text(x, y, blurb, { size = 18, width = 300, fit = "wrap", height = 80 })  -- wrapped, smaller until it is 80 tall
local w, h, size = nova.ui.text_size(name, { size = 24, width = 200, fit = "shrink" })  -- the size it would be drawn at
```

`min_size` (8) is the smallest it goes. `fit` needs a `width`; `align` places the text inside it. `nova.ui.text` and `text_size`
return the size used as a third result.

## Themes

`nova.ui.theme { ... }` sets the look of every menu in the game; what it gives replaces those parts of the default, so calling it
twice does not pile up. A menu can have its own `theme = { ... }` on top. With no theme at all a menu is dark slate buttons, a gold
focus and white rounded text, which reads well on any background.

```lua
nova.ui.theme {
  font = "rounded", size = 20,                         -- the default text
  color = { 240, 244, 250 }, dim = { 148, 160, 178 },  -- text, quieter text
  accent = { 252, 211, 77 }, ink = { 15, 23, 42 },     -- the focus and titles, words on the focus
  gap = 10, margin = 24,
  styles = { title = { size = 44, color = "accent", align = "center" }, label = { size = 13, font = "future_narrow", color = "dim" } },
  panel = { sprite = "ui/panel_dark", slice = 18, scale = 0.7, tint = { 255, 255, 255, 235 }, pad = 14 },  -- a nine-slice
  button = { h = 44, size = 22, pad = { 16, 6 }, sprite = "ui/button", slice = 12 },  -- or color = {...} without a sprite
  focus = { sprite = "ui/btn_yellow", slice = { 14, 14, 14, 22 }, scale = 0.75, slide = 18, grow = 5 },
  enter = { dx = -50, time = 0.28, stagger = 0.045 },   -- false: no sliding in
  glyphs = { a = "ui/pad_a", b = "ui/pad_b" },          -- pictures of the pad's buttons for prompts (else a drawn key)
  sounds = { move = "menu_move", accept = "menu_accept", back = "menu_back" },  -- or a function(kind)
  actions = { accept = { "a", "start" }, back = { "b" } },
  hold = { delay = 0.35, every = 0.09 },
  draw = { button = function(r, node, ctx) end, focus = function(r, node, ctx) end, panel = function(r, node, ctx) end },
}
```

A panel, a button or the focus can lean: `slant = 12` draws it with its right edge leaning in by 12 units at the bottom
(`nova.ui.slant(x, y, w, h, cut, color)` draws one directly, a screen pixel row at a time). A text style can space its letters out:
`spacing = 0.2` is CSS's `letter-spacing: 0.2em` (also an option of `nova.ui.text`). `nova.ui.line(x1, y1, x2, y2, width, color)`
draws a stroke, for icons drawn as lines (Pine Ridge's pace-note icons are).

Colours can name the theme's own (`"accent"`, `"ink"`, `"dim"`). The focus slides to the focused button (`slide`, 0 jumps); a
focused card (a focusable panel, box or button with children) gets a ring `grow` thick round it, or the `focus.sprite` behind it.
A button's words turn from `button.text` to `focus.text` as the highlight arrives.

`draw` hooks replace the drawing of buttons, the focus or panels for a game with a look of its own: `r` is the rectangle, `node`
the table (with its own fields, so `look = "tab"` can pick a style), and `ctx` has `text`, `kind`, `card`, `focused`, `near` (0 to
1, how near the sliding highlight is), `alpha`, `disabled` and `theme`. Pine Ridge Rally's theme (`lib/ui.lua`) draws its Kenney
look this way: the orange focus bar with a slanted end, list rows with a number and a best time, class tabs, the garage's car
dots and dark buttons on the results' orange panel. Text is always drawn over the UI's rectangles and pictures,
so a hook can draw in any order.

## Menus as files

A menu can be a file, `menus/<name>.menu.json` (dots in the name are folders), with the same tree written out:

```json
{ "kind": "panel", "id": "pause", "anchor": "center", "w": 360, "children": [
  { "kind": "text", "text": "PAUSED", "style": "heading", "align": "center" },
  { "kind": "button", "text": "Resume", "id": "resume" },
  { "kind": "button", "text": "Quit", "id": "quit" } ] }
```

`nova.ui.load("pause")` gives a fresh copy of the tree (fill in values before drawing it), and `nova.ui.menu("pause")` loads and
runs it in one go. The studio's menu editor (File > New menu or HUD…, or open any `.menu.json`) edits the tree: an outline to add, move, duplicate, wrap and delete items,
the settings of the chosen one (the kinds' own and a list of any others), checks in plain words (a button with no id, a name used twice, a
size that is not a number, a percentage or "fill") and a rough picture. The picture is an approximation drawn by the studio, not the engine's layout:
sizes, text fitting and the theme differ, so run the game to see the real thing. The format is plain data (no functions: a `box` in a file draws nothing
unless the game sets its `draw`).

## HUDs

`nova.ui.layout(tree)` lays out and draws a tree with no focus and no input, and returns the rectangle of each item with an `id`.

```lua
nova.ui.layout {
  kind = "stack", w = "100%", h = "100%",
  { "panel", anchor = "topleft", { "text", "LAP 2/3", style = "heading" }, { "text", "1:23.45", style = "small" } },
  { "text", "2nd", anchor = "topright", size = 40 },
  { "hints", anchor = "bottomright", items = { { "a", "Jump" }, { "start", "Pause" } } },
}
```

## Limits

- Menus are laid out and drawn again every frame (text sizes and styles are kept between frames). On a Mac, Pine Ridge's results
  screen takes about 0.6 to 0.7 ms more Lua a frame than its old hand-placed code (1.6 against 0.9 ms, the 3D backdrop behind it
  included; 2026-11-08, with the machine busy). Not measured on the Retroid. Change a theme with `nova.ui.theme`, not by editing
  the table it returns (styles are kept per theme).
- No clipping: a list that scrolls shows whole items and hides the rest; a single item taller than its window is not cut.
- Wrapped text is measured at the width its column gives it. Text in a row that must shrink is fitted one line at a time.
- The focus moves between items that are on the screen's layout; it does not jump between two separate `nova.ui.menu` calls in one
  frame (draw one menu at a time, or put both parts in one tree, as Pine Ridge's results screen does).
- Pointer and wheel are supported; touch dragging a list is not.

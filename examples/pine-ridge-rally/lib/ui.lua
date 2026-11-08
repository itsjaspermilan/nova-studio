-- Drawing and input helpers shared by the menus and the race HUD, and the game's look (2026-11-08: the mockup's dark slate, an orange
-- accent, slanted edges and Barlow type; see the README).
local audio = require("lib.audio")

local ui = {}

-- (the mockup's colours, as the rest of the game knows them by name: gold is the yellow, green the teal for good and ahead, red the
-- soft red for danger)
ui.color = {
  white = { 244, 241, 234 }, dim = { 169, 180, 191 }, gold = { 255, 210, 63 }, red = { 255, 177, 153 },
  green = { 79, 209, 197 }, ink = { 14, 19, 24 }, sky = { 79, 209, 197 },
  orange = { 255, 106, 43 }, ground = { 14, 19, 24 }, panel = { 23, 30, 38 }, panel2 = { 31, 40, 50 }, divider = { 46, 58, 71 },
  footer = { 10, 14, 18 }, hud = { 228, 233, 237 },
}

-- the type: Barlow Condensed (titles in its extra-bold italic, labels in bold and extra bold, spaced-out capitals) and Barlow for words
ui.font = {
  title = "barlow_cond_italic", heavy = "barlow_cond_heavy", bold = "barlow_cond", body = "barlow", medium = "barlow_medium",
  semi = "barlow_semibold",
}
function ui.view() return nova.view() end

-- Kenney's big fonts (Thick, Bold) have no punctuation to speak of: a character a font lacks is drawn as a box. These are the ones
-- each lacks (found by reading the fonts' tables); a text with one of them is set in the next font down that has it (Thick, then
-- Bold, then Future, which has everything).
local LACKS = {
  thick = [[!"#$%&'()*+/:;<=>?@[\]^`{|}~]],
  bold = [[#$%&()*+-/:;<=>@[\]^`{|}~]],
}
local NEXT = { thick = "bold", bold = "future" }
function ui.font_for(text, font)
  text = tostring(text)
  while LACKS[font] do
    local lacking = false
    for ch in text:gmatch(".") do
      if LACKS[font]:find(ch, 1, true) then lacking = true; break end
    end
    if not lacking then break end
    font = NEXT[font]
  end
  return font
end

-- Text centred on the screen (or on `cx`).
function ui.center(text, y, size, color, opts)
  opts = opts or {}
  local w = nova.view()
  local o = { size = size, color = color or ui.color.white, shadow = true, font = ui.font_for(text, opts.font or "rounded") }
  local tw = nova.ui.text_width(text, o)
  nova.ui.text((opts.cx or w / 2) - tw / 2, y, text, o)
end

-- The largest size, up to `size`, at which `text` is no wider than `width` (a long heading in a narrow place).
function ui.fit(text, size, width, font)
  local w = nova.ui.text_width(text, { size = size, font = ui.font_for(text, font or "bold") })
  if w <= width then return size end
  return math.floor(size * width / w)
end

function ui.text(x, y, text, size, color, opts)
  opts = opts or {}
  return nova.ui.text(x, y, text, { size = size, color = color or ui.color.white, shadow = opts.shadow ~= false, font = ui.font_for(text, opts.font or "rounded"), align = opts.align, width = opts.width })
end

function ui.right(text, rx, y, size, color, opts)
  opts = opts or {}
  local o = { size = size, color = color or ui.color.white, shadow = true, font = ui.font_for(text, opts.font or "rounded") }
  local tw = nova.ui.text_width(text, o)
  nova.ui.text(rx - tw, y, text, o)
end

-- A panel: Kenney's dark grey adventure panel (a nine-slice, so any size). (`accent` is no longer used: the coloured line along the top is gone.)
function ui.panel(x, y, w, h, alpha, accent)
  nova.ui.panel("ui/panel_dark", x, y, w, h, { slice = 18, scale = 0.7, color = { 255, 255, 255, math.min(255, (alpha or 205) + 30) } })
end

-- A picture of a button on the handheld (pad_a, pad_x, pad_zr, pad_stick_l...), `size` units across, at (x, y) top left.
function ui.pad(name, x, y, size)
  nova.ui.sprite("ui/" .. name, x, y, { anchor = "topleft", w = size or 28, h = size or 28 })
end

-- A small dim label above or beside a value ("LAP", "TIME").
function ui.label(x, y, text, color)
  nova.ui.text(x, y, text, { size = 13, color = color or ui.color.dim, font = "future_narrow" })
end

-- A heading: big, gold, with a short bar under it.
function ui.heading(text, y, size)
  ui.center(text, y, size or 38, ui.color.gold, { font = "bold" })
end

-- Text with no panel behind it: a dark outline (four copies a little off to the corners) keeps it readable over snow, sand and night alike.
local OUTLINE = { 8, 12, 26, 235 }
local faded = { 8, 12, 26, 235 }
-- (`opts.alpha`, 0 to 1, fades the text and its outline together: text sliding in or out)
function ui.otext(x, y, text, size, color, opts)
  opts = opts or {}
  local font = ui.font_for(text, opts.font or "rounded")
  local d = math.max(1.5, size / 14)
  local outline, fill = OUTLINE, color or ui.color.white
  if opts.alpha then
    faded[4] = math.floor(235 * opts.alpha)
    outline = faded
    fill = { fill[1], fill[2], fill[3], math.floor((fill[4] or 255) * opts.alpha) }
  end
  for _, o in ipairs({ { -d, -d }, { d, -d }, { -d, d }, { d, d }, { 0, d * 1.4 } }) do
    nova.ui.text(x + o[1], y + o[2], text, { size = size, color = outline, font = font, shadow = false })
  end
  nova.ui.text(x, y, text, { size = size, color = fill, font = font, shadow = false })
  return nova.ui.text_width(text, { size = size, font = font })
end
function ui.oright(text, rx, y, size, color, opts)
  local font = ui.font_for(text, (opts or {}).font or "rounded")
  return ui.otext(rx - nova.ui.text_width(text, { size = size, font = font }), y, text, size, color, opts)
end
function ui.ocenter(text, cx, y, size, color, opts)
  local font = ui.font_for(text, (opts or {}).font or "rounded")
  return ui.otext(cx - nova.ui.text_width(text, { size = size, font = font }) / 2, y, text, size, color, opts)
end
-- a small label (LAP, KM/H) in the outlined style
function ui.olabel(x, y, text, color) return ui.otext(x, y, text, 14, color or { 226, 232, 240 }, { font = "future_narrow" }) end

-- "1:23.45"
function ui.time(t)
  if not t then return "-:--.--" end
  local h = math.floor(t * 100 + 0.5)
  return string.format("%d:%02d.%02d", h // 6000, (h // 100) % 60, h % 100)
end

function ui.ordinal(n)
  local suffix = (n == 1 and "st") or (n == 2 and "nd") or (n == 3 and "rd") or "th"
  return n .. suffix
end

-- Time for the menus' own movement. Called from the scene's update.
ui.clock = 0
function ui.tick(dt) ui.clock = ui.clock + dt end

-- ---- the look --------------------------------------------------------------------------------------------------------
-- Every menu is a nova.ui.menu tree; this is how the game draws its buttons and its focus (the orange bar with a slanted end).
local C, F = ui.color, ui.font
local function with_alpha(c, a) return { c[1], c[2], c[3], math.floor((c[4] or 255) * a + 0.5) } end
local function mix(a, b, t) return { a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, 255 } end

-- a chevron pointing right (or left), as two strokes, `size` across, centred on x, y
function ui.chevron(x, y, size, colour, left)
  local h, w = size / 2, size / 4
  local s = left and -1 or 1
  local t = math.max(1.5, size / 8)
  nova.ui.line(x - w * s, y - h, x + w * s, y, t, colour)
  nova.ui.line(x + w * s, y, x - w * s, y + h, t, colour)
end

-- one line of text: font, size, colour, and the options of nova.ui.text
function ui.say(x, y, text, font, size, colour, opts)
  local o = { font = font, size = size, color = colour, shadow = false }
  if opts then for k, v in pairs(opts) do o[k] = v end end
  return nova.ui.text(x, y, text, o)
end

ui.cards = {} -- the garage's cards as last drawn: index -> rectangle (see the "car" look)

-- the rows of every menu (n.look picks how): a label (and a value on the right); the focused one is drawn by the focus below
local function draw_button(r, n, ctx)
  local a, near = ctx.alpha, ctx.near
  local label = ctx.text or ""
  local look = n.look
  if look == "tab" then
    nova.ui.rect(r.x, r.y, r.w, r.h, with_alpha(n.on and C.orange or C.panel2, a))
    ui.say(r.x + 6, r.y + r.h / 2, label, n.on and F.heavy or F.bold, 19.5, with_alpha(n.on and C.ink or C.white, a),
      { width = r.w - 12, align = "center", valign = "middle", fit = "shrink", spacing = 0.06 })
    return
  end
  if look == "car" then
    -- a card of the garage's grid: a thin frame (the car itself is a 3D model drawn behind it, lib/menu_bg.lua), the name on a band along the
    -- bottom, and the price or OWNED in the top corner. Each card says where it was drawn, for the model.
    ui.cards[n.index] = { x = r.x, y = r.y, w = r.w, h = r.h }
    local on = near > 0.5
    nova.ui.rect(r.x, r.y, r.w, 1.5, with_alpha(C.divider, a)); nova.ui.rect(r.x, r.y + r.h - 1.5, r.w, 1.5, with_alpha(C.divider, a))
    nova.ui.rect(r.x, r.y, 1.5, r.h, with_alpha(C.divider, a)); nova.ui.rect(r.x + r.w - 1.5, r.y, 1.5, r.h, with_alpha(C.divider, a))
    nova.ui.rect(r.x, r.y + r.h - 24, r.w, 24, with_alpha(on and C.orange or C.panel, a * (on and 1 or 0.92)))
    ui.say(r.x + 8, r.y + r.h - 12, label, on and F.heavy or F.bold, 16.5, with_alpha(on and C.ink or (n.owned and C.white or C.dim), a),
      { valign = "middle", width = r.w - 16, fit = "shrink", spacing = 0.03 })
    if n.value then
      local o = { font = F.bold, size = 13.5, color = with_alpha(n.owned and C.green or C.gold, a), shadow = false, spacing = 0.06 }
      local tw = nova.ui.text_width(n.value, o)
      nova.ui.rect(r.x + 4, r.y + 4, tw + 10, 18, with_alpha(C.ground, a * 0.85))
      ui.say(r.x + 9, r.y + 13, n.value, o.font, o.size, o.color, { valign = "middle", spacing = 0.06 })
    end
    return
  end
  if look == "dot" then
    local s = 12
    nova.ui.rect(r.x + (r.w - s) / 2, r.y + (r.h - s) / 2, s, s, with_alpha(ctx.focused and C.orange or C.divider, a))
    return
  end
  if look == "row" then
    -- a list row: its number, its name, and on the right its best (or a lock)
    local on = near > 0.5
    if near < 0.98 then nova.ui.rect(r.x, r.y, r.w, r.h, with_alpha(n.locked and C.panel or C.panel2, a)) end
    local ink = mix(n.locked and C.dim or C.white, C.ink, near)
    local num = mix(n.done and C.green or C.dim, C.ink, near)
    ui.say(r.x + 16, r.y + r.h / 2, tostring(n.number or ""), F.heavy, on and 28.5 or 25.5, with_alpha(num, a), { valign = "middle" })
    local right = r.x + r.w - 16 - (on and 10 or 0)
    local vw = 0
    if n.locked then
      ui.lock(right - 18, r.y + r.h / 2 - 9, 18, with_alpha(ink, a))
      vw = 22
    elseif n.value then
      local o = { font = on and F.semi or F.medium, size = 16.5, color = with_alpha(on and C.ink or C.dim, a), align = "right", width = 130, fit = "shrink", valign = "middle", shadow = false }
      nova.ui.text(right - 130, r.y + r.h / 2, n.value, o)
      vw = math.min(130, nova.ui.text_width(n.value, { font = o.font, size = 16.5 })) + 12
    end
    ui.say(r.x + 52, r.y + r.h / 2, label, on and F.heavy or F.bold, on and 25.5 or 22.5, with_alpha(ink, a),
      { valign = "middle", width = right - vw - (r.x + 52), fit = "shrink", spacing = 0.03 })
    return
  end
  if look == "dark" then
    -- on an orange panel (the results): ink words over a thin ink line; the focus is an ink bar
    if near < 0.5 then nova.ui.rect(r.x, r.y + r.h - 1.5, r.w, 1.5, with_alpha({ 14, 19, 24, 90 }, a)) end
    ui.say(r.x + 16, r.y + r.h / 2, label, near > 0.5 and F.heavy or F.bold, 22.5, with_alpha(mix(C.ink, C.white, near), a),
      { valign = "middle", width = r.w - 40, fit = "shrink", spacing = 0.04 })
    return
  end
  -- a menu row: capitals in Barlow Condensed over a thin divider; the words turn ink as the orange bar arrives
  if n.divider ~= false and near < 0.5 then nova.ui.rect(r.x, r.y + r.h - 1.5, r.w, 1.5, with_alpha(C.divider, a)) end
  local colour = mix(n.danger and C.red or C.white, C.ink, near)
  local on = near > 0.5
  local room = r.w - 36
  if n.value then
    local vo = { font = on and F.semi or F.medium, size = 18, color = with_alpha(mix(C.dim, C.ink, near), a), align = "right", valign = "middle", fit = "shrink", shadow = false }
    local vw = math.min(room * 0.55, nova.ui.text_width(n.value, { font = vo.font, size = 18 }))
    vo.width = vw
    nova.ui.text(r.x + r.w - 30 - vw, r.y + r.h / 2, n.value, vo)
    room = room - vw - 20
  end
  ui.say(r.x + 18, r.y + r.h / 2, label, on and F.heavy or F.bold, n.size or (on and 25.5 or 24), with_alpha(colour, a),
    { valign = "middle", width = room, fit = "shrink", spacing = 0.04 })
end

local function draw_focus(r, n, ctx)
  local a = ctx.alpha
  if n.look == "tab" then
    local c = with_alpha(C.white, a)
    nova.ui.rect(r.x - 2, r.y - 2, r.w + 4, 2, c); nova.ui.rect(r.x - 2, r.y + r.h, r.w + 4, 2, c)
    nova.ui.rect(r.x - 2, r.y, 2, r.h, c); nova.ui.rect(r.x + r.w, r.y, 2, r.h, c)
    return
  end
  if n.look == "dot" then return end
  if n.look == "car" then
    local c = with_alpha(C.orange, a)
    nova.ui.rect(r.x - 2, r.y - 2, r.w + 4, 3, c); nova.ui.rect(r.x - 2, r.y + r.h - 1, r.w + 4, 3, c)
    nova.ui.rect(r.x - 2, r.y, 3, r.h, c); nova.ui.rect(r.x + r.w - 1, r.y, 3, r.h, c)
    return
  end
  if n.look == "dark" then
    nova.ui.slant(r.x, r.y, r.w, r.h, 15, with_alpha(C.ink, a))
    ui.chevron(r.x + r.w - 30, r.y + r.h / 2, 16, with_alpha(C.orange, a))
    return
  end
  if ctx.card then
    local c = with_alpha(C.orange, a)
    nova.ui.rect(r.x - 3, r.y - 3, r.w + 6, 3, c); nova.ui.rect(r.x - 3, r.y + r.h, r.w + 6, 3, c)
    nova.ui.rect(r.x - 3, r.y, 3, r.h, c); nova.ui.rect(r.x + r.w, r.y, 3, r.h, c)
    return
  end
  local grow = n.look == "row" and 3 or 0
  nova.ui.slant(r.x, r.y - grow, r.w, r.h + grow * 2, 15, with_alpha(C.orange, a))
  if n.look ~= "row" and n.chevron ~= false and not n.value then ui.chevron(r.x + r.w - 40, r.y + r.h / 2, 18, with_alpha(C.ink, a)) end
end

local GLYPHS = {}
for _, name in ipairs({ "pad_a", "pad_b", "pad_x", "pad_y", "pad_l", "pad_r", "pad_zl", "pad_zr", "pad_dpad", "pad_plus", "pad_minus", "pad_start", "pad_select", "pad_stick_l", "pad_stick_r" }) do
  GLYPHS[name] = "ui/" .. name
end

nova.ui.theme {
  font = F.body, size = 16.5, color = C.white, dim = C.dim, accent = C.orange, ink = C.ink,
  gap = 4.5, margin = 36,
  styles = {
    title = { size = 54, font = F.title, color = "color", align = "left" },                         -- the big italic name of a page
    kicker = { size = 16.5, font = F.bold, color = "accent", spacing = 0.2 },       -- the orange line over it
    heading = { size = 30, font = F.heavy },
    label = { size = 18, font = F.bold, color = "dim", spacing = 0.16 },            -- "RUN SO FAR", "STANDINGS"
    body = { size = 16.5, font = F.body },
    muted = { size = 16.5, font = F.body, color = "dim" },
    small = { size = 15, font = F.body, color = "dim" },
    value = { size = 27, font = F.heavy },
  },
  shadow = false,
  panel = { color = C.panel, pad = 18, border = false },
  button = { h = 48, size = 24, font = F.bold, pad = { 18, 0 } },
  focus = { slide = 20, color = C.orange, text = C.ink },
  enter = { dx = -40, time = 0.25, stagger = 0.04 },
  glyphs = GLYPHS,
  prompt = { size = 18, font = F.medium, color = C.white, glyph = 30 },
  -- (moving and going back sound here; a screen plays its own sound for A, which may be a refusal)
  sounds = function(kind) if kind ~= "accept" then audio.sfx(kind == "move" and "menu_move" or "menu_back") end end,
  actions = { accept = { "a", "start" }, back = { "b", "menu_back" } }, -- (Android's Back key arrives as Escape: menu_back)
  draw = { button = draw_button, focus = draw_focus },
}

-- a small padlock, `size` across, top left at x, y
function ui.lock(x, y, size, colour)
  local t = math.max(1.5, size / 9)
  nova.ui.rect(x + size * 0.1, y + size * 0.45, size * 0.8, size * 0.55, colour)
  nova.ui.line(x + size * 0.28, y + size * 0.47, x + size * 0.28, y + size * 0.22, t, colour)
  nova.ui.line(x + size * 0.72, y + size * 0.47, x + size * 0.72, y + size * 0.22, t, colour)
  nova.ui.line(x + size * 0.28, y + size * 0.22, x + size * 0.5, y + size * 0.05, t, colour)
  nova.ui.line(x + size * 0.5, y + size * 0.05, x + size * 0.72, y + size * 0.22, t, colour)
end

-- The bar of button hints along the bottom of every screen: items are { "pad_a", "Select" } pairs, right to left as given.
-- (an item with no words, such as L before "R  Class", sits right next to the one after it)
function ui.hints(items)
  local row = { "row", gap = 0 }
  for i, it in ipairs(items) do
    row[#row + 1] = { "image", "ui/" .. it[1], w = 30, h = 30 }
    if it[2] ~= "" then
      row[#row + 1] = { "space", w = 9 }
      row[#row + 1] = { "text", it[2], font = F.medium, size = 18 }
      if i < #items then row[#row + 1] = { "space", w = 30 } end
    else
      row[#row + 1] = { "space", w = 6 }
    end
  end
  nova.ui.layout {
    kind = "row", id = "footer", anchor = "bottom", margin = 0, w = "100%", h = 54, justify = "end", pad = { 36, 0 },
    panel = { color = C.footer }, row,
  }
end

-- One line of words in the footer's place (a note such as "That one does not fit here").
function ui.hint(text)
  nova.ui.layout {
    kind = "row", id = "footer_note", anchor = "bottom", margin = 0, w = "100%", h = 54, justify = "end", pad = { 36, 0 },
    panel = { color = C.footer, border = false },
    { "text", text, font = F.medium, size = 18, color = C.gold },
  }
end

-- The header of a page: the orange line (kicker) and the big italic title under it, top left.
function ui.header(kicker, title, size)
  return { "column", gap = 0,
    kicker and { "text", string.upper(kicker), style = "kicker" } or { "space", h = 0 },
    { "text", string.upper(title), style = "title", size = size } }
end

-- the big dark panel down the left of a screen, its right edge leaning in at the bottom
function ui.side_panel(w, alpha, colour)
  nova.ui.slant(0, 0, w, 486, 67, with_alpha(colour or C.ground, alpha or 0.98))
end

-- ---- pace-note icons (the mockup's set, drawn as strokes on a 24-unit grid) ----------------------------------------------
-- Each is a list of strokes; a stroke is a list of points. Arcs of the original drawings are given as a few points.
local ARC = function(cx, cy, r, a0, a1, steps)
  local pts = {}
  for i = 0, steps do
    local t = a0 + (a1 - a0) * i / steps
    pts[#pts + 1] = { cx + math.cos(t) * r, cy + math.sin(t) * r }
  end
  return pts
end
local function join(...)
  local out = {}
  for _, part in ipairs({ ... }) do for _, p in ipairs(part) do out[#out + 1] = p end end
  return out
end
local PI = math.pi
ui.icons = {
  -- M18 20 V12 a4 4 0 0 0 -4 -4 H6, and the arrow head M10 4 L6 8 l4 4
  left = { join({ { 18, 20 }, { 18, 12 } }, ARC(14, 12, 4, 0, -PI / 2, 4), { { 6, 8 } }), { { 10, 4 }, { 6, 8 }, { 10, 12 } } },
  right = { join({ { 6, 20 }, { 6, 12 } }, ARC(10, 12, 4, PI, PI * 1.5, 4), { { 18, 8 } }), { { 14, 4 }, { 18, 8 }, { 14, 12 } } },
  -- M17 20 V9 a4 4 0 0 0 -8 0 v6, and the head M6 12 l3 3 3 -3
  hairpin = { join({ { 17, 20 }, { 17, 9 } }, ARC(13, 9, 4, 0, -PI, 6), { { 9, 15 } }), { { 6, 12 }, { 9, 15 }, { 12, 12 } } },
  hairpin_right = { join({ { 7, 20 }, { 7, 9 } }, ARC(11, 9, 4, PI, 2 * PI, 6), { { 15, 15 } }), { { 12, 12 }, { 15, 15 }, { 18, 12 } } },
  crest = { ARC(12, 22, 11, -PI * 0.95, -PI * 0.05, 8) },
  caution = { { { 12, 4 }, { 21, 20 }, { 3, 20 }, { 12, 4 } }, { { 12, 10 }, { 12, 14 } }, { { 12, 17.2 }, { 12, 17.4 } } },
}

-- Draws icon `name` `size` units across with its top left at x, y. `outline`: a dark band under it, so it reads on snow.
function ui.icon(name, x, y, size, colour, outline)
  local strokes = ui.icons[name]
  if not strokes then return end
  local k = size / 24
  local function pass(c, width)
    for _, s in ipairs(strokes) do
      for i = 1, #s - 1 do
        local a, b = s[i], s[i + 1]
        nova.ui.line(x + a[1] * k, y + a[2] * k, x + b[1] * k, y + b[2] * k, width, c)
      end
      -- round-ish joins: a small square at every point
      for _, p in ipairs(s) do nova.ui.rect(x + p[1] * k - width / 2, y + p[2] * k - width / 2, width, width, c) end
    end
  end
  if outline then pass(outline, 2.4 * k + 3) end
  pass(colour, 2.4 * k)
end

-- A dark band across the top and bottom, for title cards.
function ui.letterbox()
  local w = nova.view()
  nova.ui.rect(0, 0, w, 54, { 0, 0, 0, 120 })
  nova.ui.rect(0, 486, w, 54, { 0, 0, 0, 120 })
end

return ui

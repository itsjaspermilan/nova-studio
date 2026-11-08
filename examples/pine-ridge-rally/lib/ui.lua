-- Drawing and input helpers shared by the menus and the race HUD.
local audio = require("lib.audio")

local ui = {}

ui.color = {
  white = { 248, 250, 252 }, dim = { 160, 174, 192 }, gold = { 252, 211, 77 }, red = { 239, 68, 68 },
  green = { 74, 222, 128 }, ink = { 15, 23, 42 }, sky = { 56, 189, 248 },
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

-- The line of help at the bottom of a screen, on its own dark strip so that it reads over any picture.
function ui.hint(text)
  local w = nova.view()
  local o = { size = 15, color = ui.color.white, font = "future_narrow" }
  local tw = nova.ui.text_width(text, o)
  nova.ui.panel("ui/panel_dark", w / 2 - tw / 2 - 22, 490, tw + 44, 36, { slice = 18, scale = 0.6, color = { 255, 255, 255, 235 } })
  nova.ui.text(w / 2 - tw / 2, 497, text, o)
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

-- Time for the menus' own movement (the arrow on the chosen row bobs). Called from the scene's update.
ui.clock = 0
function ui.tick(dt) ui.clock = ui.clock + dt end

-- ---- the menus' look --------------------------------------------------------------------------------------------------
-- Every menu is a nova.ui.menu tree (rows, columns, grids, buttons): the engine lays it out, moves the focus with the d-pad or the
-- stick, scrolls and remembers it. This is the game's look for all of them: Kenney's dark panels, the gold bar that slides to the
-- chosen row (with a small arrow, the row pushed out a little) and cream words that turn ink as the bar arrives.
local function tint(a, alpha) return { 255, 255, 255, math.floor(a * alpha) } end

-- a row of a menu (and the class tabs on the car page)
local function draw_button(r, n, ctx)
  local a = ctx.alpha
  if n.look == "tab" then
    nova.ui.panel(n.on and "ui/btn_yellow" or "ui/btn_grey", r.x, r.y, r.w, r.h, { slice = { 14, 14, 14, 22 }, scale = 0.75, color = tint(255, a) })
    local o = { size = 18, color = { 15, 23, 42, math.floor(255 * a) }, font = "rounded", shadow = false, align = "center", width = r.w - 18, fit = "shrink", valign = "middle" }
    nova.ui.text(r.x + 9, r.y + r.h / 2 - 2, ctx.text or "", o)
    return
  end
  local off = ctx.near
  local x = r.x + 10 * off
  nova.ui.panel("ui/panel_dark", x, r.y, r.w, r.h, { slice = 18, scale = 0.55, color = tint(215, a) })
  local ink, cream = ui.color.ink, { 238, 242, 248 }
  local c = { math.floor(cream[1] + (ink[1] - cream[1]) * off), math.floor(cream[2] + (ink[2] - cream[2]) * off), math.floor(cream[3] + (ink[3] - cream[3]) * off), math.floor(255 * a) }
  local o = { size = 22, color = c, font = "rounded", shadow = false, valign = "middle", fit = "shrink" }
  local room = r.w - 34 - 12 * off
  if n.value then
    local vo = { size = 22, font = "rounded" }
    local vw = math.min(nova.ui.text_width(n.value, vo), room * 0.6)
    nova.ui.text(x + r.w - 16 - vw, r.y + r.h / 2 - 1, n.value, { size = 22, color = c, font = "rounded", shadow = false, valign = "middle", fit = "shrink", width = vw, align = "right" })
    room = room - vw - 16
  end
  o.width = room
  nova.ui.text(x + 22 + 12 * off, r.y + r.h / 2 - 1, ctx.text or "", o)
end

-- the focus: on a row, the gold bar (with its arrow); on a card, a gold frame behind it; on a class tab, a frame round it
local function draw_focus(r, n, ctx)
  local a = ctx.alpha
  if n.look == "tab" then
    nova.ui.panel("ui/panel_frame", r.x - 3, r.y - 3, r.w + 6, r.h + 6, { slice = 18, scale = 0.5, color = tint(255, a) })
    return
  end
  if ctx.card then
    nova.ui.panel("ui/btn_yellow", r.x - 5, r.y - 5, r.w + 10, r.h + 10, { slice = { 14, 14, 14, 22 }, scale = 0.75, color = tint(255, a) })
    return
  end
  local gx = r.x + 10
  nova.ui.panel("ui/btn_yellow", gx, r.y - 2, r.w, r.h + 4, { slice = { 14, 14, 14, 22 }, scale = 0.75, color = tint(255, a) })
  local ay = r.y + r.h / 2 - 1
  local bob = math.sin(ui.clock * 7) * 2
  for k = 0, 5 do nova.ui.rect(gx + 12 + bob + k, ay - 6 + k, 1, 12 - k * 2, { 15, 23, 42, math.floor(255 * a) }) end
end

local GLYPHS = {}
for _, name in ipairs({ "pad_a", "pad_b", "pad_x", "pad_y", "pad_l", "pad_r", "pad_zl", "pad_zr", "pad_dpad", "pad_plus", "pad_minus", "pad_stick_l", "pad_stick_r" }) do
  GLYPHS[name] = "ui/" .. name
end

nova.ui.theme {
  font = "rounded", size = 18, color = ui.color.white, dim = ui.color.dim, accent = ui.color.gold, ink = ui.color.ink,
  gap = 6, margin = 24,
  styles = {
    title = { size = 36, font = "bold", color = "accent", align = "left", fallback = "future" },
    heading = { size = 42, font = "bold", color = "accent", align = "center", fallback = "future" },
    body = { size = 15 },
    sub = { size = 18, align = "center" },
    label = { size = 13, font = "future_narrow", color = "dim", shadow = false },
    mono = { size = 18, font = "mono", color = "accent" },
  },
  panel = { sprite = "ui/panel_dark", slice = 18, scale = 0.7, tint = { 255, 255, 255, 235 }, pad = 14 },
  button = { h = 38, size = 22 },
  focus = { slide = 18 },
  enter = { dx = -60, time = 0.28, stagger = 0.045 },
  glyphs = GLYPHS,
  prompt = { size = 15, font = "future_narrow", color = ui.color.white, glyph = 30 },
  -- (moving and going back sound here; a screen plays its own sound for A, which may be a refusal)
  sounds = function(kind) if kind ~= "accept" then audio.sfx(kind == "move" and "menu_move" or "menu_back") end end,
  actions = { accept = { "a", "start" }, back = { "b", "menu_back" } }, -- (Android's Back key arrives as Escape: menu_back)
  draw = { button = draw_button, focus = draw_focus },
}

-- The line of help at the bottom right, with the handheld's buttons drawn: items are { "pad_a", "select" } pairs.
function ui.hints(items)
  local list = {}
  for i, it in ipairs(items) do list[i] = { it[1], it[2] } end
  nova.ui.layout {
    kind = "row", id = "hints", anchor = "bottomright", margin = 14,
    panel = { scale = 0.6 }, pad = { 14, 5 },
    { "hints", gap = 22, items = list },
  }
end

-- A dark band across the top and bottom, for title cards.
function ui.letterbox()
  local w = nova.view()
  nova.ui.rect(0, 0, w, 54, { 0, 0, 0, 120 })
  nova.ui.rect(0, 486, w, 54, { 0, 0, 0, 120 })
end

return ui

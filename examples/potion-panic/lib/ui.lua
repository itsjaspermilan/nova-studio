-- Drawing and input helpers: parchment, indigo and leather panels (scripts/potion/hd-ui.mjs) and one typeface, the built-in Fredoka. Sizes are real sizes, in the game's 540-high units: the game is made for a 5.5 inch screen, so nothing is set smaller than SMALL (about 3 mm tall on the handheld) and
-- body text is MEDIUM. `ui.ox`, `ui.oy` and `ui.alpha` move and fade everything drawn through these functions, which is how a screen settles into place.
local audio = require("lib.audio")

local ui = {}

ui.SMALL, ui.MEDIUM, ui.LARGE, ui.NUMBER, ui.HEAD, ui.TITLE = 19, 23, 28, 38, 48, 66

ui.color = {
  ink = { 52, 38, 46 }, cream = { 252, 244, 224 }, gold = { 244, 190, 70 }, wine = { 170, 48, 78 }, leaf = { 72, 128, 70 }, sky = { 70, 120, 170 }, shadow = { 20, 14, 36 },
  paper = { 232, 214, 168 }, dim = { 120, 104, 116 }, white = { 255, 252, 244 }, lilac = { 200, 206, 244 },
}
ui.ox, ui.oy, ui.alpha = 0, 0, 1

local function tint(c, a) return { c[1], c[2], c[3], math.floor((c[4] or 255) * (a or 1) * ui.alpha) } end
ui.tint = tint

-- One typeface, Fredoka (the built-in "rounded"): round and friendly. From MEDIUM up it is drawn bold (the engine thickens each letter), and
-- `opts.shadow` puts a dark outline round it (white-on-dark lettering, readable over any picture), in one piece with the letters.
local HEAD, BODY = "rounded", "rounded"

-- `opts.valign` = "middle" puts the middle of the capitals at y (what centres a label in a box); `opts.thin` keeps a big text light.
function ui.text(x, y, text, size, color, opts)
  opts = opts or {}
  local font = opts.font or BODY
  if font == "display" or font == "serif" then font = BODY end
  local o = { size = size, color = tint(color or ui.color.ink), font = font, shadow = false, align = opts.align, width = opts.width, valign = opts.valign }
  if size >= ui.MEDIUM and not opts.thin then o.bold = size >= ui.HEAD and 1.1 or 0.8 end
  if opts.shadow then o.outline = { color = tint(ui.color.shadow, 0.95), width = math.max(1.6, size / 12) } end
  return nova.ui.text(x + ui.ox, y + ui.oy, text, o)
end

function ui.width(text, size, font)
  if font == "display" or font == "serif" then font = nil end
  return nova.ui.text_width(text, { size = size, font = font or BODY })
end

function ui.heading(text, x, y, size, color, opts)
  opts = opts or {}
  opts.font = HEAD
  return ui.text(x, y, text, size, color or ui.color.cream, opts)
end

-- text centred across the screen (or about opts.cx), its top at y
function ui.center(text, y, size, color, opts)
  opts = opts or {}
  local w = nova.view()
  local tw = ui.width(text, size, opts.font)
  return ui.text((opts.cx or w / 2) - tw / 2, y, text, size, color, opts)
end

function ui.right(text, rx, y, size, color, opts)
  opts = opts or {}
  return ui.text(rx - ui.width(text, size, opts.font), y, text, size, color, opts)
end

-- a text centred in a box (x, y, w, h)
function ui.in_box(text, x, y, w, h, size, color, opts)
  opts = opts or {}
  local font = opts.font or BODY
  local tw = ui.width(text, size, font)
  local o = {}
  for key, v in pairs(opts) do o[key] = v end
  o.valign = "middle"
  return ui.text(x + (w - tw) / 2, y + h / 2, text, size, color, o)
end

-- the largest size, up to `size`, at which `text` is no wider than `width`
function ui.fit(text, size, width, font)
  local w = ui.width(text, size, font)
  if w <= width then return size end
  return math.max(ui.SMALL, math.floor(size * width / w))
end

-- panels: "ink" (dark indigo), "page" (parchment), "light" (pale paper), "inset" (a darker mat), "leather" (the book's cover). The pictures are drawn at twice
-- their shown size with smooth edges (scripts/potion/hd-ui.mjs), so they stay sharp on the handheld's 1080-line screen.
local PANEL = { ink = "ui/hd_ink", page = "ui/hd_page", light = "ui/hd_light", inset = "ui/hd_inset", leather = "ui/hd_leather", brown = "ui/hd_ink", beige = "ui/hd_page", blue = "ui/hd_ink" }
function ui.panel(x, y, w, h, kind, alpha, tint_color)
  local sprite = PANEL[kind or "page"]
  local c = tint_color or { 255, 255, 255 }
  nova.ui.panel(sprite, x + ui.ox, y + ui.oy, w, h, { slice = 32, scale = 0.5, color = tint({ c[1], c[2], c[3], alpha or 255 }) })
end

-- a button face of any colour (a white picture, tinted)
function ui.button(x, y, w, h, color, alpha)
  nova.ui.panel("ui/hd_button", x + ui.ox, y + ui.oy, w, h, { slice = 30, scale = 0.5, color = tint({ color[1], color[2], color[3], alpha or 255 }) })
end

-- a ribbon of a colour with white outlined lettering centred on it
function ui.ribbon(x, y, w, h, color, text, size)
  ui.button(x, y, w, h, color)
  if text then ui.in_box(text, x, y, w, h - 4, size or ui.LARGE, ui.color.white, { shadow = true }) end
end

-- a round badge: a coloured disc with a number or letter on it
function ui.badge(cx, cy, d, color, text, size)
  nova.ui.sprite("ui/disc", cx + ui.ox, cy + ui.oy, { w = d, h = d, color = tint({ color[1], color[2], color[3], 255 }) })
  if text then ui.in_box(text, cx - d / 2, cy - d / 2, d, d, size or ui.LARGE, ui.color.white, { shadow = true }) end
end

function ui.pad(name, x, y, size)
  nova.ui.sprite("ui/" .. name, x + ui.ox, y + ui.oy, { anchor = "topleft", w = size or 34, h = size or 34, color = tint({ 255, 255, 255, 255 }) })
end

function ui.icon(sprite, x, y, size, color)
  nova.ui.sprite(sprite, x + ui.ox, y + ui.oy, { anchor = "topleft", w = size, h = size, color = tint(color or { 255, 255, 255, 255 }) })
end

-- a star (gold when earned, a dark shape when not)
function ui.star(x, y, size, on)
  nova.ui.sprite("ui/star", x + ui.ox, y + ui.oy, { w = size, h = size, color = on and tint({ 255, 255, 255, 255 }) or tint({ 70, 50, 70, 150 }) })
end

-- a flask of a potion's colour (size: about the width of its body): the liquid, tinted, under the glass
function ui.flask(x, y, size, color)
  local w = size * 1.25
  local h = w * 1.25
  local fx, fy = x + (size - w) / 2 + ui.ox, y - size * 0.12 + ui.oy
  nova.ui.sprite("ui/flask_fill", fx, fy, { anchor = "topleft", w = w, h = h, color = tint({ color[1], color[2], color[3], 255 }) })
  nova.ui.sprite("ui/flask_glass", fx, fy, { anchor = "topleft", w = w, h = h, color = tint({ 255, 255, 255, 255 }) })
end

-- a bar: color is "green", "yellow" or "red"
local BAR = { green = { 120, 214, 92 }, yellow = { 250, 202, 64 }, red = { 236, 88, 72 }, blue = { 96, 160, 255 } }
function ui.bar(x, y, w, frac, color)
  local h = 16
  nova.ui.panel("ui/hd_bar_back", x + ui.ox, y + ui.oy, w, h, { slice = { 16, 0, 16, 0 }, scale = 0.5, color = tint({ 255, 255, 255, 255 }) })
  frac = math.max(0, math.min(1, frac))
  if frac > 0.02 then
    local c = BAR[color] or BAR.green
    nova.ui.panel("ui/hd_bar_fill", x + ui.ox, y + ui.oy, math.max(h, w * frac), h, { slice = { 16, 0, 16, 0 }, scale = 0.5, color = tint({ c[1], c[2], c[3], 255 }) })
  end
end

-- the buttons of the handheld and what they do, in the bottom right corner on an indigo strap that fits them snugly
function ui.hints(items)
  local w = nova.view()
  local size, glyph, gap, pad, strap = ui.SMALL, 30, 18, 12, 42
  local total = 0
  for i, it in ipairs(items) do total = total + glyph + 7 + ui.width(it[2], size) + (i < #items and gap or 0) end
  local pw = total + pad * 2
  local x0, y0 = w - 12 - pw, 540 - 12 - strap
  ui.panel(x0, y0, pw, strap, "ink")
  local x = x0 + pad
  for _, it in ipairs(items) do
    local tw = ui.width(it[2], size)
    ui.pad(it[1], x, y0 + (strap - glyph) / 2, glyph)
    ui.in_box(it[2], x + glyph + 7, y0, tw, strap, size, ui.color.cream)
    x = x + glyph + 7 + tw + gap
  end
end

-- ---- the menu list ----------------------------------------------------------------------------------------------------------------

local hl = {}
local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end

-- Rows of indigo buttons; the chosen one turns to parchment, swells a little and a gauntlet points at its label from inside the button (which bobs). Rows drop in one after another
-- when a screen opens (`opts.enter`, the seconds since it did). Items are strings or { label, value }.
function ui.menu(items, selected, y, opts)
  opts = opts or {}
  local w = nova.view()
  local width, row = opts.width or 400, opts.row or 66
  local x = (opts.cx or w / 2) - width / 2
  local id = opts.id or "menu"
  local st = hl[id]
  if not st then st = { last = nova.time(), swell = {} }; hl[id] = st end
  local now = nova.time()
  local dt = math.max(0, math.min(0.1, now - st.last))
  if dt == 0 then dt = 1 / 60 end
  st.last = now
  for i = 1, #items do
    local s = st.swell[i] or (i == selected and 1 or 0)
    st.swell[i] = s + ((i == selected and 1 or 0) - s) * math.min(1, dt * 16)
  end
  local enter = opts.enter or 99
  local size = opts.size or ui.LARGE
  for i, item in ipairs(items) do
    local e = ease_out((enter - (i - 1) * 0.06) / 0.3)
    local s = st.swell[i]
    local bh = row - 10 + 6 * s
    local bw = width + 10 * s
    local bx, by = x - 5 * s, y + (i - 1) * row - 3 * s - (1 - e) * 26
    local a = e
    local on = s > 0.5
    ui.button(bx, by, bw, bh, on and { 255, 244, 220 } or { 92, 90, 196 }, 255 * a)
    local c = on and ui.color.ink or ui.color.cream
    local label = type(item) == "table" and item[1] or item
    nova.ui.text(bx + 26 + 40 * s + ui.ox, by + bh / 2 + ui.oy, label, { size = size, color = tint(c, a), font = HEAD, shadow = false, bold = 0.9, valign = "middle" })
    if type(item) == "table" and item[2] then
      local vs = opts.value_size or ui.MEDIUM
      nova.ui.text(bx + bw - 22 - ui.width(item[2], vs) + ui.ox, by + bh / 2 + ui.oy, item[2], { size = vs, color = tint(c, a), font = BODY, shadow = false, valign = "middle" })
    end
    if i == selected then
      local bob = math.sin(now * 6) * 3
      nova.ui.sprite("ui/pointer", bx + 30 + bob + ui.ox, by + bh / 2 + ui.oy, { w = 34, h = 34, color = tint({ 255, 255, 255, 255 * a }) })
    end
  end
end

function ui.navigate(selected, count)
  local moved = nil
  if nova.input.pressed("up") then selected = (selected - 2) % count + 1; audio.sfx("menu_move") end
  if nova.input.pressed("down") then selected = selected % count + 1; audio.sfx("menu_move") end
  if nova.input.pressed("a") or nova.input.pressed("start") then moved = "accept"
  elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then moved = "back"
  elseif nova.input.pressed("left") then moved = "left"
  elseif nova.input.pressed("right") then moved = "right" end
  return selected, moved
end

function ui.time(t)
  t = math.max(0, math.ceil(t))
  return string.format("%d:%02d", t // 60, t % 60)
end

return ui

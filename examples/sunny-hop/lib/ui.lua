-- Drawing and input helpers for the menus and the HUD: white panels and buttons with the pack's dark outline (made by scripts/sunny/art.mjs at twice
-- their shown size), one round typeface (the built-in Fredoka, "rounded") drawn bold and outlined. Sizes are real sizes in the game's 540-high units:
-- the game is made for a 5.5 inch screen, so nothing is smaller than SMALL (about 3 mm tall on the handheld). `ui.ox`, `ui.oy` and `ui.alpha` move and
-- fade everything drawn through these functions, which is how a panel slides in.
local audio = require("lib.audio")

local ui = {}

ui.SMALL, ui.MEDIUM, ui.LARGE, ui.NUMBER, ui.HEAD, ui.TITLE = 20, 24, 30, 38, 50, 84

ui.color = {
  ink = { 53, 53, 65 }, white = { 255, 255, 255 }, cream = { 255, 248, 230 }, sun = { 255, 200, 50 }, gold = { 255, 214, 80 }, sky = { 74, 164, 255 },
  grass = { 70, 200, 110 }, berry = { 238, 84, 120 }, dim = { 140, 140, 160 }, shadow = { 30, 26, 52 }, orange = { 255, 150, 60 }, violet = { 150, 110, 230 },
}
ui.ox, ui.oy, ui.alpha = 0, 0, 1

local function tint(c, a) return { c[1], c[2], c[3], math.floor((c[4] or 255) * (a or 1) * ui.alpha) } end
ui.tint = tint

local FONT = "rounded"

-- `opts.outline` (default on from MEDIUM up) puts the dark outline round white lettering; `opts.valign` "middle" centres the capitals on y.
function ui.text(x, y, text, size, color, opts)
  opts = opts or {}
  local o = { size = size, color = tint(color or ui.color.white), font = FONT, align = opts.align, width = opts.width, valign = opts.valign }
  if size >= ui.MEDIUM and not opts.thin then o.bold = size >= ui.HEAD and 1.2 or 0.8 end
  local outline = opts.outline
  if outline == nil then outline = (color == nil or color == ui.color.white or color == ui.color.cream or color == ui.color.gold or color == ui.color.sun) end
  if outline then o.outline = { color = tint(ui.color.ink, 0.95), width = math.max(2, size / 10) } end
  return nova.ui.text(x + ui.ox, y + ui.oy, text, o)
end

function ui.width(text, size) return nova.ui.text_width(text, { size = size, font = FONT, bold = size >= ui.MEDIUM and (size >= ui.HEAD and 1.2 or 0.8) or nil }) end

function ui.center(text, y, size, color, opts)
  opts = opts or {}
  local w = nova.view()
  return ui.text((opts.cx or w / 2) - ui.width(text, size) / 2, y, text, size, color, opts)
end

function ui.right(text, rx, y, size, color, opts) return ui.text(rx - ui.width(text, size), y, text, size, color, opts) end

function ui.in_box(text, x, y, w, h, size, color, opts)
  local o = {}
  for k, v in pairs(opts or {}) do o[k] = v end
  o.valign = "middle"
  return ui.text(x + (w - ui.width(text, size)) / 2, y + h / 2, text, size, color, o)
end

function ui.fit(text, size, width)
  local w = ui.width(text, size)
  if w <= width then return size end
  return math.max(ui.SMALL, math.floor(size * width / w))
end

-- a white panel with the dark outline, tinted by `color`
function ui.panel(x, y, w, h, color, alpha)
  local c = color or ui.color.white
  nova.ui.panel("ui/panel", x + ui.ox, y + ui.oy, w, h, { slice = 40, scale = 0.45, color = tint({ c[1], c[2], c[3], alpha or 255 }) })
end

-- a soft dark plate (no outline) behind text over the game
function ui.shade(x, y, w, h, alpha, color)
  local c = color or ui.color.shadow
  nova.ui.panel("ui/shade", x + ui.ox, y + ui.oy, w, h, { slice = 40, scale = 0.4, color = tint({ c[1], c[2], c[3], alpha or 170 }) })
end

function ui.button(x, y, w, h, color, alpha)
  nova.ui.panel("ui/button", x + ui.ox, y + ui.oy, w, h, { slice = 40, scale = 0.45, color = tint({ color[1], color[2], color[3], alpha or 255 }) })
end

function ui.icon(sprite, cx, cy, size, color, opts)
  opts = opts or {}
  local c = color or { 255, 255, 255, 255 }
  nova.ui.sprite(sprite, cx + ui.ox, cy + ui.oy, { w = size * (opts.sx or 1), h = size * (opts.sy or 1), rotation = opts.rotation, color = tint({ c[1], c[2], c[3], c[4] or 255 }) })
end

function ui.pad(name, cx, cy, size) ui.icon("ui/" .. name, cx, cy, size or 34) end

function ui.star(cx, cy, size, on, opts)
  ui.icon(on and "ui/star" or "ui/star_empty", cx, cy, size, on and nil or { 255, 255, 255, 200 }, opts)
end

-- the buttons and what they do, in the bottom right corner on a dark strap
function ui.hints(items)
  local w = nova.view()
  local size, glyph, gap, pad, strap = ui.SMALL, 32, 20, 14, 46
  local total = 0
  for i, it in ipairs(items) do total = total + glyph + 8 + ui.width(it[2], size) + (i < #items and gap or 0) end
  local pw = total + pad * 2
  local x0, y0 = w - 14 - pw, 540 - 14 - strap
  ui.shade(x0, y0, pw, strap, 190)
  local x = x0 + pad
  for _, it in ipairs(items) do
    local tw = ui.width(it[2], size)
    ui.pad(it[1], x + glyph / 2, y0 + strap / 2, glyph)
    ui.in_box(it[2], x + glyph + 8, y0, tw, strap, size, ui.color.white, { outline = false })
    x = x + glyph + 8 + tw + gap
  end
end

local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end
ui.ease_out = ease_out
function ui.ease_back(x)
  x = math.max(0, math.min(1, x))
  local c1, c3 = 1.70158, 2.70158
  return 1 + c3 * (x - 1) ^ 3 + c1 * (x - 1) ^ 2
end

-- ---- the menu list ----------------------------------------------------------------------------------------------------------------
-- Rows of buttons; the chosen one is sunny yellow, swells and bobs, with a pointer beside it. Rows pop in one after another when a screen opens
-- (`opts.enter`: the seconds since it did). Items are strings or { label, value }.
local hl = {}
function ui.menu(items, selected, y, opts)
  opts = opts or {}
  local w = nova.view()
  local width, row = opts.width or 400, opts.row or 64
  local x = (opts.cx or w / 2) - width / 2
  local id = opts.id or "menu"
  local st = hl[id]
  if not st then st = { last = nova.time(), swell = {} }; hl[id] = st end
  local now = nova.time()
  local dt = math.max(1 / 60, math.min(0.1, now - st.last))
  st.last = now
  for i = 1, #items do
    local s = st.swell[i] or (i == selected and 1 or 0)
    st.swell[i] = s + ((i == selected and 1 or 0) - s) * math.min(1, dt * 14)
  end
  local enter = opts.enter or 99
  for i, item in ipairs(items) do
    local e = ui.ease_back((enter - (i - 1) * 0.06) / 0.35)
    local a = math.max(0, math.min(1, (enter - (i - 1) * 0.06) / 0.2))
    local s = st.swell[i]
    local bh = row - 12 + 6 * s
    local bw = width + 14 * s
    local bx, by = x - 7 * s, y + (i - 1) * row - 3 * s + (1 - e) * 30
    local on = i == selected
    ui.button(bx, by, bw, bh, on and ui.color.sun or { 255, 255, 255 }, 255 * a)
    local label = type(item) == "table" and item[1] or item
    local old = ui.alpha
    ui.alpha = old * a
    ui.text(bx + 30 + 26 * s, by + bh / 2 - 2, label, opts.size or ui.LARGE, ui.color.ink, { valign = "middle", outline = false })
    if type(item) == "table" and item[2] then
      local vs = opts.value_size or ui.MEDIUM
      ui.text(bx + bw - 26 - ui.width(item[2], vs), by + bh / 2 - 2, item[2], vs, ui.color.ink, { valign = "middle", outline = false })
    end
    if on then
      local bob = math.sin(now * 7) * 4
      ui.icon("ui/pointer", bx + 26 + bob, by + bh / 2 - 2, 30)
    end
    ui.alpha = old
  end
end

-- Buttons side by side (left and right choose), centred, popping in like the menu.
function ui.button_row(items, selected, y, opts)
  opts = opts or {}
  local w = nova.view()
  local size, gap, h = opts.size or ui.MEDIUM, 18, opts.h or 58
  local widths, total = {}, 0
  for i, label in ipairs(items) do widths[i] = ui.width(label, size) + 64; total = total + widths[i] + (i > 1 and gap or 0) end
  local x = w / 2 - total / 2
  local enter = opts.enter or 99
  local now = nova.time()
  for i, label in ipairs(items) do
    local e = ui.ease_back((enter - (i - 1) * 0.07) / 0.35)
    local a = math.max(0, math.min(1, (enter - (i - 1) * 0.07) / 0.2))
    local on = i == selected
    local s = on and 1 + math.sin(now * 6) * 0.03 or 1
    local bw, bh = widths[i] * s, h * s
    local bx, by = x + widths[i] / 2 - bw / 2, y + h / 2 - bh / 2 + (1 - e) * 30
    ui.button(bx, by, bw, bh, on and ui.color.sun or { 255, 255, 255 }, 255 * a)
    local old = ui.alpha
    ui.alpha = old * a
    ui.in_box(label, bx, by - 3, bw, bh, size, ui.color.ink, { outline = false })
    if on then ui.icon("ui/pointer", bx + 4 + math.sin(now * 7) * 3, by + bh / 2 - 2, 26) end
    ui.alpha = old
    x = x + widths[i] + gap
  end
end

-- d-pad or stick up/down moves; returns the new choice and "accept", "back", "left" or "right" when one was pressed
function ui.navigate(selected, count)
  local moved = nil
  if nova.input.pressed("up") then selected = (selected - 2) % count + 1; audio.sfx("move") end
  if nova.input.pressed("down") then selected = selected % count + 1; audio.sfx("move") end
  if nova.input.pressed("a") then moved = "accept"
  elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then moved = "back"
  elseif nova.input.pressed("left") then moved = "left"
  elseif nova.input.pressed("right") then moved = "right" end
  return selected, moved
end

-- a time as 0:42.37 (or 42.37 under a minute, when `short`)
function ui.time(t, short)
  if not t then return "--:--" end
  t = math.max(0, t)
  local m = math.floor(t / 60)
  local s = t - m * 60
  if short and m == 0 then return string.format("%.2f", s) end
  return string.format("%d:%05.2f", m, s)
end

return ui

-- Drawing and input helpers in the parchment skin: Kenney's UI Adventure Pack (wood, parchment, leather straps), the built-in Cinzel capitals for headings
-- and Lora for the rest. `ui.oy` and `ui.alpha` drop and fade everything drawn through these functions, which is how a screen settles in and out.
local audio = require("lib.audio")

local ui = {}

ui.color = {
  ink = { 62, 40, 28 }, cream = { 250, 238, 208 }, gold = { 232, 176, 60 }, wine = { 156, 50, 62 }, leaf = { 72, 128, 70 }, sky = { 70, 120, 170 }, shadow = { 30, 18, 12 },
  paper = { 232, 214, 168 }, dim = { 150, 126, 96 }, white = { 255, 252, 244 },
}
ui.ox, ui.oy, ui.alpha = 0, 0, 1

local function tint(c, a) return { c[1], c[2], c[3], math.floor((c[4] or 255) * (a or 1) * ui.alpha) } end

local HEAD, BODY = "display", "serif"

function ui.text(x, y, text, size, color, opts)
  opts = opts or {}
  local font = opts.font or BODY
  return nova.ui.text(x + ui.ox, y + ui.oy, text, { size = size, color = tint(color or ui.color.ink), font = font, shadow = opts.shadow and tint(ui.color.shadow, 0.6) or false, align = opts.align, width = opts.width })
end

function ui.width(text, size, font) return nova.ui.text_width(text, { size = size, font = font or BODY }) end

function ui.heading(text, x, y, size, color, opts)
  opts = opts or {}
  opts.font = HEAD
  return ui.text(x, y, text, size, color or ui.color.cream, opts)
end

function ui.center(text, y, size, color, opts)
  opts = opts or {}
  local w = nova.view()
  local tw = ui.width(text, size, opts.font)
  return ui.text((opts.cx or w / 2) - tw / 2, y, text, size, color, opts)
end

function ui.fit(text, size, width, font)
  local w = ui.width(text, size, font)
  if w <= width then return size end
  return math.floor(size * width / w)
end

-- wood and parchment panels: kind is "brown" (dark wood), "beige" (parchment) or "light" (pale paper)
function ui.panel(x, y, w, h, kind, alpha)
  local sprite = ({ brown = "ui/panel_brown", beige = "ui/panel_beige", light = "ui/panel_beigeLight", inset = "ui/panelInset_beige", blue = "ui/panel_blue" })[kind or "beige"]
  nova.ui.panel(sprite, x + ui.ox, y + ui.oy, w, h, { slice = 22, scale = 0.7, color = tint({ 255, 255, 255, alpha or 255 }) })
end

function ui.pad(name, x, y, size)
  nova.ui.sprite("ui/" .. name, x + ui.ox, y + ui.oy, { anchor = "topleft", w = size or 26, h = size or 26, color = tint({ 255, 255, 255, 255 }) })
end

function ui.icon(sprite, x, y, size, color)
  nova.ui.sprite(sprite, x + ui.ox, y + ui.oy, { anchor = "topleft", w = size, h = size, color = tint(color or { 255, 255, 255, 255 }) })
end

-- a star (gold when earned, dark when not)
function ui.star(x, y, size, on)
  nova.ui.sprite("ui/star", x + ui.ox, y + ui.oy, { w = size, h = size, color = on and tint({ 255, 255, 255, 255 }) or tint({ 70, 50, 36, 190 }) })
end

-- a flask of a potion's colour, drawn from rectangles (size: the width of its body)
function ui.flask(x, y, size, color)
  local s = size / 18
  local function r(rx, ry, rw, rh, c) nova.ui.rect(x + ui.ox + rx * s, y + ui.oy + ry * s, rw * s, rh * s, tint(c)) end
  local dark = { color[1] * 0.7, color[2] * 0.7, color[3] * 0.7 }
  r(5, 0, 8, 3, { 176, 122, 70 }) -- the cork
  r(6, 3, 6, 5, { 230, 232, 240, 230 }) -- the neck
  r(2, 9, 14, 9, color)
  r(3, 8, 12, 1, color)
  r(4, 18, 10, 1, dark)
  r(3, 11, 3, 5, { 255, 255, 255, 110 })
  r(1, 9, 1, 8, { 90, 70, 60, 150 })
  r(16, 9, 1, 8, { 90, 70, 60, 150 })
end

-- a bar (horizontal) from Kenney's bars: color is "green", "yellow" or "red"
function ui.bar(x, y, w, frac, color)
  local h = 14
  nova.ui.panel("ui/barBack_horizontalMid", x + ui.ox, y + ui.oy, w, h, { slice = { 6, 0, 6, 0 }, scale = 1, color = tint({ 255, 255, 255, 255 }) })
  frac = math.max(0, math.min(1, frac))
  if frac > 0.02 then
    nova.ui.panel("ui/bar" .. color:sub(1, 1):upper() .. color:sub(2) .. "_horizontalMid", x + ui.ox, y + ui.oy, math.max(8, w * frac), h, { slice = { 6, 0, 6, 0 }, scale = 1, color = tint({ 255, 255, 255, 255 }) })
  end
end

-- the buttons of the handheld and what they do, in the bottom right corner on a leather strap
function ui.hints(items)
  local w = nova.view()
  local size = 13
  local total = 0
  for _, it in ipairs(items) do total = total + 26 + 8 + ui.width(it[2], size) + 18 end
  total = total - 18
  local pw = total + 32
  local x0 = w - 14 - pw
  ui.panel(x0, 494, pw, 38, "brown")
  local x = x0 + 16
  for _, it in ipairs(items) do
    ui.pad(it[1], x, 500, 26)
    ui.text(x + 34, 507, it[2], size, ui.color.cream)
    x = x + 34 + ui.width(it[2], size) + 18
  end
end

-- ---- the menu list ----------------------------------------------------------------------------------------------------------------

local hl = {}
local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end

-- Rows of wooden buttons; the chosen one turns to parchment, swells a little and gets a gauntlet pointing at it (which bobs). Rows drop in one after
-- another when a screen opens (`opts.enter`, the seconds since it did). Items are strings or { label, value }.
function ui.menu(items, selected, y, opts)
  opts = opts or {}
  local w = nova.view()
  local width, row = opts.width or 340, opts.row or 52
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
  local size = opts.size or 17
  for i, item in ipairs(items) do
    local e = ease_out((enter - (i - 1) * 0.06) / 0.3)
    local s = st.swell[i]
    local bw, bh = width + 22 * s, row - 8 + 8 * s
    local bx, by = x - 11 * s, y + (i - 1) * row - 4 * s - (1 - e) * 26
    local a = e
    nova.ui.panel(s > 0.5 and "ui/buttonLong_beige" or "ui/buttonLong_brown", bx + ui.ox, by + ui.oy, bw, bh, { slice = { 14, 14, 14, 14 }, scale = 0.9, color = tint({ 255, 255, 255, 255 * a }) })
    local c = s > 0.5 and ui.color.ink or ui.color.cream
    local label = type(item) == "table" and item[1] or item
    local ty = by + (bh - size) / 2 - 3
    nova.ui.text(bx + 22 + ui.ox, ty + ui.oy, label, { size = size, color = tint(c, a), font = HEAD, shadow = false })
    if type(item) == "table" and item[2] then
      nova.ui.text(bx + bw - 22 - ui.width(item[2], size) + ui.ox, ty + ui.oy, item[2], { size = size, color = tint(c, a), font = BODY, shadow = false })
    end
    if i == selected then
      local bob = math.sin(now * 6) * 3
      nova.ui.sprite("ui/cursorGauntlet_bronze", bx - 22 + bob + ui.ox, by + bh / 2 + ui.oy, { w = 30, h = 30, rotation = 0.0, color = tint({ 255, 255, 255, 255 * a }) })
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

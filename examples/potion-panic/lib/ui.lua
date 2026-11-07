-- Drawing and input helpers in the parchment-and-ink skin: Kenney's UI Adventure Pack (parchment, leather, indigo), the built-in Cinzel capitals for headings and Lora for the
-- rest. Sizes are real sizes, in the game's 540-high units: the game is made for a 5.5 inch screen, so nothing is set smaller than SMALL (about 3 mm tall on the handheld) and
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

local HEAD, BODY = "display", "serif"
-- (where the letters sit in the line the engine gives them: a text is nudged this much of its size down to look centred in a bar)
local DY = { display = -0.02, serif = -0.1 }

function ui.text(x, y, text, size, color, opts)
  opts = opts or {}
  local font = opts.font or BODY
  return nova.ui.text(x + ui.ox, y + ui.oy, text, { size = size, color = tint(color or ui.color.ink), font = font, shadow = opts.shadow and tint(ui.color.shadow, 0.7) or false, align = opts.align, width = opts.width })
end

function ui.width(text, size, font) return nova.ui.text_width(text, { size = size, font = font or BODY }) end

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
  return ui.text(x + (w - tw) / 2, y + (h - size) / 2 + size * (DY[font] or 0), text, size, color, opts)
end

-- the largest size, up to `size`, at which `text` is no wider than `width`
function ui.fit(text, size, width, font)
  local w = ui.width(text, size, font)
  if w <= width then return size end
  return math.max(ui.SMALL, math.floor(size * width / w))
end

-- panels: "ink" (dark indigo), "page" (parchment), "light" (pale paper), "inset" (a darker mat for a picture)
local PANEL = { ink = "ui/panel_blue", page = "ui/panel_beige", light = "ui/panel_beigeLight", inset = "ui/panelInset_brown", leather = "ui/panel_brown", brown = "ui/panel_blue", beige = "ui/panel_beige", blue = "ui/panel_blue" }
function ui.panel(x, y, w, h, kind, alpha)
  local sprite = PANEL[kind or "page"]
  local c = { 255, 255, 255 }
  if kind == "ink" or kind == "brown" or kind == "blue" then c = { 150, 160, 255 } end -- (the blue is a grey-lilac: pushed towards indigo)
  if kind == "leather" then c = { 150, 100, 86 } end
  nova.ui.panel(sprite, x + ui.ox, y + ui.oy, w, h, { slice = 22, scale = 0.7, color = tint({ c[1], c[2], c[3], alpha or 255 }) })
end

function ui.pad(name, x, y, size)
  nova.ui.sprite("ui/" .. name, x + ui.ox, y + ui.oy, { anchor = "topleft", w = size or 34, h = size or 34, color = tint({ 255, 255, 255, 255 }) })
end

function ui.icon(sprite, x, y, size, color)
  nova.ui.sprite(sprite, x + ui.ox, y + ui.oy, { anchor = "topleft", w = size, h = size, color = tint(color or { 255, 255, 255, 255 }) })
end

-- a star (gold when earned, dark when not)
function ui.star(x, y, size, on)
  nova.ui.sprite("ui/star", x + ui.ox, y + ui.oy, { w = size, h = size, color = on and tint({ 255, 255, 255, 255 }) or tint({ 70, 50, 70, 170 }) })
end

-- a flask of a potion's colour, drawn from rectangles (size: the width of its body)
function ui.flask(x, y, size, color)
  local s = size / 18
  local function r(rx, ry, rw, rh, c) nova.ui.rect(x + ui.ox + rx * s, y + ui.oy + ry * s, rw * s, rh * s, tint(c)) end
  local dark = { color[1] * 0.7, color[2] * 0.7, color[3] * 0.7 }
  r(5, 0, 8, 3, { 176, 122, 70 })
  r(6, 3, 6, 5, { 230, 232, 240, 230 })
  r(2, 9, 14, 9, color)
  r(3, 8, 12, 1, color)
  r(4, 18, 10, 1, dark)
  r(3, 11, 3, 5, { 255, 255, 255, 110 })
  r(1, 9, 1, 8, { 90, 70, 60, 150 })
  r(16, 9, 1, 8, { 90, 70, 60, 150 })
end

-- a bar from Kenney's bars: color is "green", "yellow" or "red"
function ui.bar(x, y, w, frac, color)
  local h = 16
  nova.ui.panel("ui/barBack_horizontalMid", x + ui.ox, y + ui.oy, w, h, { slice = { 6, 0, 6, 0 }, scale = 1, color = tint({ 255, 255, 255, 255 }) })
  frac = math.max(0, math.min(1, frac))
  if frac > 0.02 then
    nova.ui.panel("ui/bar" .. color:sub(1, 1):upper() .. color:sub(2) .. "_horizontalMid", x + ui.ox, y + ui.oy, math.max(8, w * frac), h, { slice = { 6, 0, 6, 0 }, scale = 1, color = tint({ 255, 255, 255, 255 }) })
  end
end

-- the buttons of the handheld and what they do, in the bottom right corner on an indigo strap
function ui.hints(items)
  local w = nova.view()
  local total = 0
  for _, it in ipairs(items) do total = total + 34 + 8 + ui.width(it[2], ui.SMALL) + 22 end
  total = total - 22
  local pw = total + 36
  local x0 = w - 10 - pw
  ui.panel(x0, 484, pw, 50, "ink")
  local x = x0 + 18
  for _, it in ipairs(items) do
    ui.pad(it[1], x, 492, 34)
    ui.text(x + 42, 495, it[2], ui.SMALL, ui.color.cream)
    x = x + 42 + ui.width(it[2], ui.SMALL) + 22
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
    nova.ui.panel(on and "ui/buttonLong_beige" or "ui/buttonLong_blue", bx + ui.ox, by + ui.oy, bw, bh, { slice = { 14, 14, 14, 14 }, scale = 1.0, color = tint(on and { 255, 255, 255, 255 * a } or { 160, 170, 255, 255 * a }) })
    local c = on and ui.color.ink or ui.color.cream
    local label = type(item) == "table" and item[1] or item
    local ty = by + (bh - size) / 2 + size * (DY[HEAD] or 0) - 1
    nova.ui.text(bx + 26 + 40 * s + ui.ox, ty + ui.oy, label, { size = size, color = tint(c, a), font = HEAD, shadow = false })
    if type(item) == "table" and item[2] then
      local vs = opts.value_size or ui.MEDIUM
      nova.ui.text(bx + bw - 22 - ui.width(item[2], vs) + ui.ox, by + (bh - vs) / 2 + vs * DY[BODY] - 1 + ui.oy, item[2], { size = vs, color = tint(c, a), font = BODY, shadow = false })
    end
    if i == selected then
      local bob = math.sin(now * 6) * 3
      nova.ui.sprite("ui/cursorGauntlet_bronze", bx + 30 + bob + ui.ox, by + bh / 2 + ui.oy, { w = 38, h = 38, color = tint({ 255, 255, 255, 255 * a }) })
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

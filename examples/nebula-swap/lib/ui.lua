-- Drawing and input helpers for the menus and the HUD, in the sci-fi skin: Kenney's glass panels and gloss bars, Kenney Future type.
-- `ui.ox` and `ui.alpha` move and fade everything drawn through these functions, which is how a screen slides in and out.
local audio = require("lib.audio")

local ui = {}

ui.color = {
  white = { 240, 246, 255 }, dim = { 150, 170, 205 }, cyan = { 96, 220, 255 }, gold = { 255, 214, 90 }, red = { 255, 96, 110 }, green = { 100, 235, 150 },
  ink = { 14, 22, 48 }, violet = { 170, 120, 255 },
}
ui.ox, ui.oy, ui.alpha = 0, 0, 1

local function tint(c, a)
  return { c[1], c[2], c[3], math.floor((c[4] or 255) * (a or 1) * ui.alpha) }
end

local FONT = "future"
function ui.text(x, y, text, size, color, opts)
  opts = opts or {}
  return nova.ui.text(x + ui.ox, y + ui.oy, text, { size = size, color = tint(color or ui.color.white), shadow = opts.shadow ~= false and tint({ 4, 8, 30, 200 }) or false, font = opts.font or FONT, align = opts.align, width = opts.width })
end

function ui.width(text, size, font) return nova.ui.text_width(text, { size = size, font = font or FONT }) end

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

-- the largest size, up to `size`, at which `text` is no wider than `width`
function ui.fit(text, size, width, font)
  local w = ui.width(text, size, font)
  if w <= width then return size end
  return math.floor(size * width / w)
end

-- a glass panel (dark navy tint over Kenney's glass), any size
function ui.panel(x, y, w, h, alpha, color)
  local c = color or { 22, 36, 84 }
  -- (a dark navy under the glass, so that text on it reads over a planet)
  nova.ui.rect(x + 4 + ui.ox, y + 4 + ui.oy, w - 8, h - 8, tint({ 10, 16, 48, math.floor((alpha or 215) * 0.72) }))
  nova.ui.panel("ui/glass", x + ui.ox, y + ui.oy, w, h, { slice = 12, scale = 0.7, color = tint({ c[1], c[2], c[3], alpha or 215 }) })
end

function ui.pad(name, x, y, size)
  nova.ui.sprite("ui/" .. name, x + ui.ox, y + ui.oy, { anchor = "topleft", w = size or 26, h = size or 26, color = tint({ 255, 255, 255, 255 }) })
end

-- a small dim label
function ui.label(x, y, text, color) return ui.text(x, y, text, 11, color or ui.color.dim) end

function ui.heading(text, y, size, color)
  ui.center(text, y, ui.fit(text, size or 34, 700), color or ui.color.cyan)
end

-- the buttons of the handheld and what they do, in the bottom right corner: items are { "pad_a", "Accept" } pairs
function ui.hints(items)
  local w = nova.view()
  local size = 12
  local total = 0
  for _, it in ipairs(items) do total = total + 28 + 8 + ui.width(it[2], size) + 20 end
  total = total - 20
  local pw = total + 28
  local x0 = w - 16 - pw
  ui.panel(x0, 498, pw, 34, 225)
  local x = x0 + 14
  for _, it in ipairs(items) do
    ui.pad(it[1], x, 502, 26)
    ui.text(x + 34, 509, it[2], size, ui.color.white)
    x = x + 34 + ui.width(it[2], size) + 20
  end
end

function ui.time(t)
  local s = math.floor(t)
  return string.format("%d:%02d", s // 60, s % 60)
end

-- ---- the menu list ----------------------------------------------------------------------------------------------------------

local hl = {}
local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end

-- Rows of blue gloss bars; the chosen one is a yellow bar that slides to its row, pushed out a little, and each row slides out when it is chosen and back
-- when it is left. Items are strings or { label, value }. `opts.enter` is the seconds since the screen opened (the rows slide in one after another).
function ui.menu(items, selected, y, opts)
  opts = opts or {}
  local w = nova.view()
  local width, row = opts.width or 360, opts.row or 46
  local x = (opts.cx or w / 2) - width / 2 + ui.ox
  local id = opts.id or "menu"
  local st = hl[id]
  if not st then st = { at = selected, last = nova.time(), off = {} }; hl[id] = st end
  local now = nova.time()
  local dt = math.max(0, math.min(0.1, now - st.last))
  if dt == 0 then dt = 1 / 60 end
  st.last = now
  st.at = st.at + (selected - st.at) * math.min(1, dt * 18)
  for i = 1, #items do
    local o = st.off[i] or (i == selected and 1 or 0)
    st.off[i] = o + ((i == selected and 1 or 0) - o) * math.min(1, dt * 14)
  end
  local enter = opts.enter or 99
  local function slide(i) return ease_out((enter - (i - 1) * 0.05) / 0.3) end
  local h = row - 8
  local function bar(sprite, bx, by, bw, bh, a, c)
    nova.ui.panel(sprite, bx, by, bw, bh, { slice = { 6, 6, 6, 6 }, scale = bh / 24 * 1.0, color = tint({ c and c[1] or 255, c and c[2] or 255, c and c[3] or 255, 255 * a }) })
  end
  for i = 1, #items do
    local e = slide(i)
    local rx, ry = x - (1 - e) * 70 + 10 * st.off[i], y + (i - 1) * row + ui.oy
    bar("ui/btn_blue", rx, ry, width, h, e, { 150, 170, 230 })
  end
  local e = slide(selected)
  local gy = y + (st.at - 1) * row + ui.oy
  bar("ui/btn_yellow", x - (1 - e) * 70 + 10, gy - 2, width, h + 4, e)
  -- an arrow before the label
  local bob = math.sin(nova.time() * 7) * 2
  local ay = gy + h / 2
  for k = 0, 6 do nova.ui.rect(x + 22 + bob + k, ay - 7 + k, 1, 14 - k * 2, tint({ 14, 22, 48, 255 * e })) end
  for i, item in ipairs(items) do
    local ei = slide(i)
    local near = math.max(0, 1 - math.abs(i - st.at))
    local rx, ry = x - (1 - ei) * 70 + 10 * st.off[i], y + (i - 1) * row + ui.oy
    local ink, cream = ui.color.ink, ui.color.white
    local c = { math.floor(cream[1] + (ink[1] - cream[1]) * near), math.floor(cream[2] + (ink[2] - cream[2]) * near), math.floor(cream[3] + (ink[3] - cream[3]) * near), math.floor(255 * ei) }
    local label = type(item) == "table" and item[1] or item
    local size = opts.size or 17
    local ty = ry + math.floor((h - size) / 2) - 1
    nova.ui.text(rx + 26 + 14 * st.off[i], ty, label, { size = size, color = tint(c), font = FONT, shadow = false })
    if type(item) == "table" and item[2] then
      nova.ui.text(rx + width - 18 - ui.width(item[2], size), ty, item[2], { size = size, color = tint(c), font = FONT, shadow = false })
    end
  end
end

-- the menu keys. Returns the new selection and what happened: "accept", "back", "left", "right" or nil
function ui.navigate(selected, count)
  local moved = nil
  if nova.input.pressed("up") then selected = (selected - 2) % count + 1; audio.sfx("menu_move") end
  if nova.input.pressed("down") then selected = selected % count + 1; audio.sfx("menu_move") end
  if nova.input.pressed("a") or nova.input.pressed("start") or nova.input.pressed("swap") then moved = "accept"
  elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then moved = "back"
  elseif nova.input.pressed("left") then moved = "left"
  elseif nova.input.pressed("right") then moved = "right" end
  return selected, moved
end

return ui

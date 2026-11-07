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

-- The line of help at the bottom, with the handheld's buttons drawn: items are { "pad_a", "select" } pairs (or a plain string).
function ui.hints(items)
  local w = nova.view()
  local o = { size = 15, font = "future_narrow", color = ui.color.white }
  local total = 0
  for _, it in ipairs(items) do total = total + 30 + nova.ui.text_width(it[2], o) + 22 end
  local x = w - 24 - total -- (in the bottom right corner)
  nova.ui.panel("ui/panel_dark", x - 14, 486, total + 22, 40, { slice = 18, scale = 0.6, color = { 255, 255, 255, 235 } })
  for _, it in ipairs(items) do
    ui.pad(it[1], x, 491, 30)
    nova.ui.text(x + 36, 497, it[2], o)
    x = x + 30 + nova.ui.text_width(it[2], o) + 22
  end
end

-- Text with no panel behind it: a dark outline (four copies a little off to the corners) keeps it readable over snow, sand and night alike.
local OUTLINE = { 8, 12, 26, 235 }
function ui.otext(x, y, text, size, color, opts)
  opts = opts or {}
  local font = ui.font_for(text, opts.font or "rounded")
  local d = math.max(1.5, size / 14)
  for _, o in ipairs({ { -d, -d }, { d, -d }, { -d, d }, { d, d }, { 0, d * 1.4 } }) do
    nova.ui.text(x + o[1], y + o[2], text, { size = size, color = OUTLINE, font = font, shadow = false })
  end
  nova.ui.text(x, y, text, { size = size, color = color or ui.color.white, font = font, shadow = false })
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

-- Time for the menus' own movement (the highlight slides between rows; rows slide in when a screen opens). Called from the scene's update.
ui.clock = 0
local hl = {}
function ui.tick(dt)
  ui.clock = ui.clock + dt
  for id, v in pairs(hl) do v.dt = dt end
end
local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end

-- A vertical list of choices. Each item is a string or { label, value } (value shows on the right). Every row is a dark rounded bar; the chosen
-- one is a gold bar that slides to its row (with a small arrow, and pushed out a little), and the dark rows' words are cream. `opts.enter` is the
-- seconds since the screen opened: the rows slide in from the left one after another. `opts.id` keeps the highlight between frames.
function ui.menu(items, selected, y, opts)
  opts = opts or {}
  local w = nova.view()
  local width, row = opts.width or 360, opts.row or 44
  local x = (opts.cx or w / 2) - width / 2
  local id = opts.id or "menu"
  local st = hl[id]
  if not st then st = { at = selected, last = nova.time(), off = {} }; hl[id] = st end
  -- (real time, so that the pause menu moves too while the game is frozen)
  local now = nova.time()
  local dt = math.max(0, math.min(0.1, now - st.last))
  if dt == 0 then dt = 1 / 60 end
  st.last = now
  st.at = st.at + (selected - st.at) * math.min(1, dt * 18)
  -- each row's own slide to the right: out while it is the chosen one, back again when it is not
  for i = 1, #items do
    local o = st.off[i] or (i == selected and 1 or 0)
    st.off[i] = o + ((i == selected and 1 or 0) - o) * math.min(1, dt * 14)
  end
  local enter = opts.enter or 99
  local function slide(i) return ease_out((enter - (i - 1) * 0.045) / 0.28) end
  local h = row - 6
  -- the dark bars
  for i, item in ipairs(items) do
    local e = slide(i)
    local rx, ry = x - (1 - e) * 60, y + (i - 1) * row
    rx = rx + 10 * st.off[i]
    nova.ui.panel("ui/panel_dark", rx, ry, width, h, { slice = 18, scale = 0.55, color = { 255, 255, 255, math.floor(215 * e) } })
  end
  -- the gold bar, sliding
  local e = slide(selected)
  local gy = y + (st.at - 1) * row
  local gx = x - (1 - e) * 60 + 10
  nova.ui.panel("ui/btn_yellow", gx, gy - 2, width, h + 4, { slice = { 14, 14, 14, 22 }, scale = 0.75, color = { 255, 255, 255, math.floor(255 * e) } })
  -- a small arrow before the label
  local ay = gy + h / 2 - 1
  local bob = math.sin(ui.clock * 7) * 2
  for k = 0, 5 do nova.ui.rect(gx + 12 + bob + k, ay - 6 + k, 1 + 0, 12 - k * 2, { 15, 23, 42, math.floor(255 * e) }) end
  -- the words
  for i, item in ipairs(items) do
    local ei = slide(i)
    local near = math.max(0, 1 - math.abs(i - st.at))
    local rx, ry = x - (1 - ei) * 60 + 10 * st.off[i], y + (i - 1) * row
    local ink, cream = ui.color.ink, { 238, 242, 248 }
    local c = { math.floor(cream[1] + (ink[1] - cream[1]) * near), math.floor(cream[2] + (ink[2] - cream[2]) * near), math.floor(cream[3] + (ink[3] - cream[3]) * near), math.floor(255 * ei) }
    local label = type(item) == "table" and item[1] or item
    local ty = ry + math.floor((h - 22) / 2) - 3
    nova.ui.text(rx + 22 + 12 * st.off[i], ty, label, { size = 22, color = c, font = "rounded", shadow = false })
    if type(item) == "table" and item[2] then
      local o = { size = 22, color = c, font = "rounded", shadow = false }
      nova.ui.text(rx + width - 16 - nova.ui.text_width(item[2], o), ty, item[2], o)
    end
  end
end

-- Reads the menu keys. Returns the new selection and what happened: "accept", "back", "left", "right" or nil.
function ui.navigate(selected, count)
  local moved = nil
  if nova.input.pressed("up") then selected = (selected - 2) % count + 1; audio.sfx("menu_move") end
  if nova.input.pressed("down") then selected = selected % count + 1; audio.sfx("menu_move") end
  if nova.input.pressed("a") or nova.input.pressed("start") then moved = "accept"
  elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then moved = "back" -- (Android's Back key arrives as Escape)
  elseif nova.input.pressed("left") then moved = "left"
  elseif nova.input.pressed("right") then moved = "right" end
  return selected, moved
end

-- A dark band across the top and bottom, for title cards.
function ui.letterbox()
  local w = nova.view()
  nova.ui.rect(0, 0, w, 54, { 0, 0, 0, 120 })
  nova.ui.rect(0, 486, w, 54, { 0, 0, 0, 120 })
end

return ui

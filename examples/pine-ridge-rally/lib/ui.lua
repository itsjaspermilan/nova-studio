-- Drawing and input helpers shared by the menus and the race HUD.
local audio = require("lib.audio")

local ui = {}

ui.color = {
  white = { 248, 250, 252 }, dim = { 160, 174, 192 }, gold = { 252, 211, 77 }, red = { 239, 68, 68 },
  green = { 74, 222, 128 }, ink = { 15, 23, 42 }, sky = { 56, 189, 248 },
}

function ui.view() return nova.view() end

-- Text centred on the screen (or on `cx`).
function ui.center(text, y, size, color, opts)
  opts = opts or {}
  local w = nova.view()
  local o = { size = size, color = color or ui.color.white, shadow = true, font = opts.font or "rounded" }
  local tw = nova.ui.text_width(text, o)
  nova.ui.text((opts.cx or w / 2) - tw / 2, y, text, o)
end

function ui.text(x, y, text, size, color, opts)
  opts = opts or {}
  return nova.ui.text(x, y, text, { size = size, color = color or ui.color.white, shadow = opts.shadow ~= false, font = opts.font or "rounded", align = opts.align, width = opts.width })
end

function ui.right(text, rx, y, size, color, opts)
  opts = opts or {}
  local o = { size = size, color = color or ui.color.white, shadow = true, font = opts.font or "rounded" }
  local tw = nova.ui.text_width(text, o)
  nova.ui.text(rx - tw, y, text, o)
end

-- A panel: Kenney's dark grey adventure panel (a nine-slice, so any size) with an accent line inside along the top (`accent` is a colour,
-- gold by default).
function ui.panel(x, y, w, h, alpha, accent)
  nova.ui.panel("ui/panel_dark", x, y, w, h, { slice = 18, scale = 0.7, color = { 255, 255, 255, math.min(255, (alpha or 205) + 30) } })
  local a = accent or ui.color.gold
  nova.ui.rect(x + 12, y + 7, w - 24, 2, { a[1], a[2], a[3], 235 })
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
  nova.ui.text(w / 2 - tw / 2, 500, text, o)
end

-- The line of help at the bottom, with the handheld's buttons drawn: items are { "pad_a", "select" } pairs (or a plain string).
function ui.hints(items)
  local w = nova.view()
  local o = { size = 15, font = "future_narrow", color = ui.color.white }
  local total = 0
  for _, it in ipairs(items) do total = total + 30 + nova.ui.text_width(it[2], o) + 22 end
  local x = w / 2 - total / 2
  nova.ui.panel("ui/panel_dark", x - 14, 486, total + 22, 40, { slice = 18, scale = 0.6, color = { 255, 255, 255, 235 } })
  for _, it in ipairs(items) do
    ui.pad(it[1], x, 491, 30)
    nova.ui.text(x + 36, 501, it[2], o)
    x = x + 30 + nova.ui.text_width(it[2], o) + 22
  end
end

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

-- A vertical list of choices. Each item is a string or { label, value } (value shows on the right).
function ui.menu(items, selected, y, opts)
  opts = opts or {}
  local w = nova.view()
  local width, row = opts.width or 360, opts.row or 44
  local x = (opts.cx or w / 2) - width / 2
  for i, item in ipairs(items) do
    local ry = y + (i - 1) * row
    local on = i == selected
    -- Kenney's buttons: yellow for the chosen one, grey for the rest (nine-slices: the corners and the depth at the bottom stay as drawn)
    nova.ui.panel(on and "ui/btn_yellow" or "ui/btn_grey", x, ry, width, row - 2, { slice = { 14, 14, 14, 22 }, scale = 0.75 })
    local label = type(item) == "table" and item[1] or item
    local color = ui.color.ink
    nova.ui.text(x + 22, ry + 7, label, { size = 22, color = color, font = "rounded", shadow = false })
    if type(item) == "table" and item[2] then
      local o = { size = 22, color = color, font = "rounded" }
      nova.ui.text(x + width - 16 - nova.ui.text_width(item[2], o), ry + 7, item[2], o)
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

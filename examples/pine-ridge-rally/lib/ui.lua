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

-- A panel: a soft shadow, a dark body, a thin light edge and an accent line along the top (`accent` is a colour, gold by default).
function ui.panel(x, y, w, h, alpha, accent)
  nova.ui.rect(x + 3, y + 4, w, h, { 0, 0, 0, 70 })
  nova.ui.rect(x, y, w, h, { 10, 16, 32, alpha or 205 })
  nova.ui.rect(x, y, w, 1, { 255, 255, 255, 36 })
  nova.ui.rect(x, y + h - 1, w, 1, { 255, 255, 255, 18 })
  nova.ui.rect(x, y, 1, h, { 255, 255, 255, 24 })
  nova.ui.rect(x + w - 1, y, 1, h, { 255, 255, 255, 24 })
  local a = accent or ui.color.gold
  nova.ui.rect(x, y, w, 3, { a[1], a[2], a[3], 235 })
end

-- A small dim label above or beside a value ("LAP", "TIME").
function ui.label(x, y, text, color)
  nova.ui.text(x, y, text, { size = 12, color = color or ui.color.dim, font = "sans" })
end

-- A heading: big, gold, with a short bar under it.
function ui.heading(text, y, size)
  ui.center(text, y, size or 46, ui.color.gold, { font = "comic" })
end

-- The line of help at the bottom of a screen, on its own dark strip so that it reads over any picture.
function ui.hint(text)
  local w = nova.view()
  local o = { size = 14, color = ui.color.white, font = "sans" }
  local tw = nova.ui.text_width(text, o)
  nova.ui.rect(w / 2 - tw / 2 - 18, 496, tw + 36, 28, { 8, 12, 24, 200 })
  nova.ui.text(w / 2 - tw / 2, 502, text, o)
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
    if on then
      nova.ui.rect(x + 3, ry + 4, width, row - 6, { 0, 0, 0, 80 })
      nova.ui.rect(x, ry, width, row - 6, { 250, 190, 40, 245 })
      nova.ui.rect(x, ry, 6, row - 6, { 255, 255, 255, 230 })
    else
      nova.ui.rect(x, ry, width, row - 6, { 10, 16, 32, 205 })
      nova.ui.rect(x, ry, 3, row - 6, { 255, 255, 255, 30 })
    end
    local label = type(item) == "table" and item[1] or item
    local color = on and ui.color.ink or ui.color.white
    nova.ui.text(x + 22, ry + 7, label, { size = 22, color = color, font = "rounded", shadow = not on })
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

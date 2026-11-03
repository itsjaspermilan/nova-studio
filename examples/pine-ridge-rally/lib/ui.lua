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

function ui.panel(x, y, w, h, alpha)
  nova.ui.rect(x, y, w, h, { 8, 14, 28, alpha or 190 })
  nova.ui.rect(x, y, w, 2, { 255, 255, 255, 40 })
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
  local x = w / 2 - width / 2
  for i, item in ipairs(items) do
    local ry = y + (i - 1) * row
    local on = i == selected
    if on then
      nova.ui.rect(x, ry, width, row - 6, { 245, 158, 11, 235 })
      nova.ui.sprite("cursor", x + 14, ry + (row - 6) / 2, { scale = 2 })
    else
      nova.ui.rect(x, ry, width, row - 6, { 8, 14, 28, 170 })
    end
    local label = type(item) == "table" and item[1] or item
    local color = on and ui.color.ink or ui.color.white
    nova.ui.text(x + 36, ry + 7, label, { size = 22, color = color, font = "rounded", shadow = not on })
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
  elseif nova.input.pressed("b") then moved = "back"
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

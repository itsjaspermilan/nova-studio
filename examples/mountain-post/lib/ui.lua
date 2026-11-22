-- The slice's look on the screen: warm paper panels, ink, a postal blue; the button glyphs as engraved on the Retroid (A south,
-- B east, X west, Y north, each in its own colour like a Nintendo-style pad); the hints; the parcel card in the corner; the minimap.
local world = require("lib.world")
local words = require("lib.words")

local ui = {}

ui.C = {
  paper = { 243, 232, 207 }, paper2 = { 229, 214, 180 }, ink = { 58, 44, 34 }, faint = { 120, 100, 80 }, edge = { 138, 110, 74 },
  blue = { 47, 95, 166 }, red = { 185, 55, 43 }, cream = { 255, 248, 232 }, shade = { 20, 14, 10, 150 },
}
local C = ui.C

-- A paper panel: a soft shadow, a warm gradient, an inked edge.
function ui.paper(x, y, w, h, opts)
  opts = opts or {}
  nova.ui.rect(x + 4, y + 6, w, h, { 20, 12, 6, 70 }, { radius = 14 })
  nova.ui.rect(x, y, w, h, C.paper, { radius = 12, gradient = { opts.top or { 247, 238, 216 }, opts.bottom or { 232, 217, 184 } }, outline = { color = C.edge, width = 2 } })
end

-- A button glyph: a round cap with its letter, in the pad's colours.
local GLYPH = { A = { 196, 64, 52 }, B = { 222, 170, 50 }, X = { 54, 104, 186 }, Y = { 62, 140, 86 } }
function ui.glyph(x, y, letter, size)
  size = size or 26
  local col = GLYPH[letter] or { 90, 90, 90 }
  nova.ui.rect(x - size / 2, y - size / 2 + 2, size, size, { 0, 0, 0, 90 }, { radius = size / 2 })
  nova.ui.rect(x - size / 2, y - size / 2, size, size, col, { radius = size / 2, outline = { color = { 255, 250, 240 }, width = 2 } })
  nova.ui.text(x, y - size * 0.36, letter, { font = "rounded", size = size * 0.66, align = "center", color = { 255, 252, 246 } })
end

-- A shoulder button (L1, R1): a rounded tab in the same style as the face buttons, a soft grey with its name.
function ui.shoulder(x, y, name, size)
  size = size or 26
  local w = size * 1.7
  nova.ui.rect(x - w / 2, y - size / 2 + 2, w, size, { 0, 0, 0, 90 }, { radius = size * 0.4 })
  nova.ui.rect(x - w / 2, y - size / 2, w, size, { 92, 88, 96 }, { radius = size * 0.4, outline = { color = { 255, 250, 240 }, width = 2 } })
  nova.ui.text(x, y - size * 0.34, name, { font = "rounded", size = size * 0.6, align = "center", color = { 255, 252, 246 } })
end

-- Hints at the bottom right: { { "A", "Take" }, { "B", "Get in" } } (a hint with no button, { nil, "words" }, is words alone).
function ui.hints(list, w, h)
  if not list or #list == 0 then return end
  local x = w - 28
  for i = #list, 1, -1 do
    local item = list[i]
    local tw = nova.ui.text_width(item[2], { font = "rounded", size = 20 })
    local pad = item[1] and 52 or 32
    local bw = tw + pad
    x = x - bw
    nova.ui.rect(x, h - 58, bw, 38, { 30, 24, 18, 150 }, { radius = 19 })
    if item[1] then ui.glyph(x + 20, h - 39, item[1], 26) end
    nova.ui.text(x + pad - 14, h - 50, item[2], { font = "rounded", size = 20, color = C.cream })
    x = x - 10
  end
end

-- The parcel cards in the corner: what you carry, then each parcel in the van (name and street; "in the van" under it).
function ui.parcel_cards(carrying, van_load, w)
  local y = 22
  if carrying then ui.parcel_card(carrying, "hands", w, y); y = y + 92 end
  for _, which in ipairs(van_load or {}) do ui.parcel_card(which, "van", w, y); y = y + 92 end
end

-- One parcel card: name and street.
function ui.parcel_card(which, where, w, y)
  if not which then return end
  local label = words.labels[which]
  local name, street = label:match("^(.-), (.*)$")
  local x = 24
  y = y or 22
  ui.paper(x, y, 300, 82)
  nova.ui.sprite("ui/parcel_icon", x + 40, y + 41, { w = 54, h = 45 })
  nova.ui.text(x + 76, y + 12, name, { font = "serif", size = 22, color = C.ink })
  nova.ui.text(x + 76, y + 42, street, { font = "serif", size = 19, color = C.faint })
  if where == "van" then nova.ui.text(x + 296, y + 62, "in the van", { font = "rounded", size = 14, color = C.faint, align = "right" }) end
end

-- The panel at the van's open back: the parcels in the van shown one at a time (the label: name and street), "2 of 2", and the
-- buttons: L1 and R1 go through them (only when there is more than one), A takes the one shown.
function ui.picker(list, i, w, h)
  if not list or #list == 0 then return end
  local which = list[i] or list[1]
  local name, street = words.labels[which]:match("^(.-), (.*)$")
  local cw, ch = 430, 166
  local x, y = (w - cw) / 2, h - ch - 22
  ui.paper(x, y, cw, ch)
  nova.ui.text(x + 24, y + 12, words.picker.title, { font = "rounded", size = 16, color = C.faint })
  if #list > 1 then nova.ui.text(x + cw - 24, y + 12, i .. " of " .. #list, { font = "rounded", size = 16, color = C.faint, align = "right" }) end
  -- the label: a white slip with a red edge, the parcel's icon beside it
  nova.ui.rect(x + 20, y + 40, cw - 40, 82, { 252, 249, 240 }, { radius = 6, outline = { color = C.red, width = 3 } })
  nova.ui.sprite("ui/parcel_icon", x + 62, y + 81, { w = 56, h = 47 })
  nova.ui.text(x + 102, y + 48, name, { font = "serif", size = 27, color = C.ink })
  nova.ui.text(x + 102, y + 86, street, { font = "serif", size = 20, color = C.faint })
  if #list > 1 then
    ui.shoulder(x + 2, y + 81, "L1", 26)
    ui.shoulder(x + cw - 2, y + 81, "R1", 26)
  end
  ui.glyph(x + cw / 2 - 30, y + ch - 22, "A", 24)
  nova.ui.text(x + cw / 2 - 10, y + ch - 33, words.hint.take, { font = "rounded", size = 19, color = C.ink })
end

-- The minimap: a small disc in the bottom-left corner with the roads right round you (about 90 m each way) and you in the middle,
-- north up, like the paper map. Nothing else: no houses, no numbers, nowhere to go.
local MM = { r = 74, scale = 74 / 85 }
function ui.minimap(px, pz, heading, w, h)
  local cx, cy = 24 + MM.r + 4, h - 24 - MM.r - 4
  nova.ui.sprite("ui/minimap_disc", cx, cy, { w = (MM.r + 8) * 2, h = (MM.r + 8) * 2 })
  local r, k = MM.r - 4, MM.scale
  -- (screen x is east = -x; screen y is south = -z)
  local function to(x, z) return cx + (px - x) * k, cy + (pz - z) * k end
  for _, road in ipairs(world.roads) do
    local pts = road.points
    local lw = road.surface == "road" and 6 or 4.5
    local col = road.surface == "road" and { 255, 251, 240 } or { 244, 230, 196 }
    for i = 1, #pts - 1 do
      local ax, ay = to(pts[i][1], pts[i][2])
      local bx, by = to(pts[i + 1][1], pts[i + 1][2])
      -- clip the segment to the disc
      local dx, dy = bx - ax, by - ay
      local fx, fy = ax - cx, ay - cy
      local a = dx * dx + dy * dy
      if a > 1e-6 then
        local b, c = 2 * (fx * dx + fy * dy), fx * fx + fy * fy - r * r
        local disc = b * b - 4 * a * c
        if disc > 0 then
          local s = math.sqrt(disc)
          local t0, t1 = math.max(0, (-b - s) / (2 * a)), math.min(1, (-b + s) / (2 * a))
          if t1 > t0 then
            nova.ui.line(ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1, lw + 3, { 70, 58, 44, 200 })
            nova.ui.line(ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1, lw, col)
          end
        end
      end
    end
  end
  -- you: pointing the way you face (heading 0 faces north; a heading towards +x, the west, turns it left)
  nova.ui.sprite("ui/you", cx, cy, { w = 24, h = 24, rotation = -heading })
end
ui.MINIMAP = MM

-- A fade over everything (scene changes, getting in and out): 0 clear to 1 dark.
function ui.fade(a, w, h)
  if a > 0.003 then nova.ui.rect(0, 0, w, h, { 26, 20, 16, math.floor(255 * math.min(1, a)) }, { layer = "top" }) end
end

return ui

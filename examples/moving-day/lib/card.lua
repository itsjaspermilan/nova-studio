-- The client's wish card: their face and name, then one row a wish, in pictures: the piece, a sign for the wish (an eye for "faces", a heart for
-- "next to", a pin for "in or on a place", an arrow for "back to the wall") and what it is wished towards (another piece, a window, a wall, the rug, a
-- room). A row ticks when its wish holds, with a stamp that pops; it shakes when a wish is undone.
local ui = require("lib.ui")

local Card = {}
Card.__index = Card

local ROOM_NAME = { living = "Living room", bedroom = "Bedroom", kitchen = "Kitchen", bathroom = "Bathroom" }
local GLYPH = { faces = "ui/glyph_faces", next = "ui/glyph_next", wall = "ui/glyph_back", window = "ui/glyph_place", rug = "ui/glyph_place", room = "ui/glyph_place" }
-- what the wish is towards, as a picture (and a word under rooms, which look alike)
local function target_icon(w)
  if w.wish == "faces" or w.wish == "next" then return "ui/icon_" .. w.target end
  if w.wish == "wall" then return "ui/icon_wall" end
  if w.wish == "window" then return "ui/icon_window" end
  if w.wish == "rug" then return "ui/icon_rug" end
  if w.wish == "room" then return "ui/icon_room_" .. w.target, ROOM_NAME[w.target] end
end
Card.target_icon = target_icon

-- the words a wish says (for the tutorial's help line and the pause screen)
local NAMES = { tv = "TV", desk_chair = "desk chair", side_table = "side table", coffee_table = "coffee table" }
local function noun(kind) return NAMES[kind] or kind end
function Card.words(w)
  local a = "the " .. noun(w.piece)
  if w.wish == "faces" then return a .. " facing the " .. noun(w.target) end
  if w.wish == "next" then return a .. " next to the " .. noun(w.target) end
  if w.wish == "wall" then return a .. " with its back to a wall" end
  if w.wish == "window" then return a .. " by a window" end
  if w.wish == "rug" then return a .. " on the rug" end
  if w.wish == "room" then return a .. " in the " .. (ROOM_NAME[w.target] or w.target):lower() end
  return a
end

function Card.new(L)
  local c = setmetatable({ L = L, rows = {}, t = 0, enter = 0 }, Card)
  for k = 1, #L.props.wishes do c.rows[k] = { on = 0, target = 0, pop = 9, shake = 9 } end
  return c
end

-- what holds now; `quiet` sets it without the pop (the start, an undo)
function Card:set(granted, quiet)
  for k, row in ipairs(self.rows) do
    local now = granted[k] and 1 or 0
    if now ~= row.target then
      row.target = now
      if quiet then row.on = now
      elseif now == 1 then row.pop = 0
      else row.shake = 0 end
    end
  end
end

function Card:update(dt)
  self.t = self.t + dt
  self.enter = self.enter + dt
  for _, row in ipairs(self.rows) do
    row.on = row.on + (row.target - row.on) * math.min(1, dt * 12)
    row.pop = row.pop + dt
    row.shake = row.shake + dt
  end
end

-- a row's height: 74, less when there are many wishes, so that the card always fits the screen
function Card.row(n) return math.min(74, math.floor((540 - 28 - 120) / math.max(1, n))) end
function Card.height(n) return 112 + n * Card.row(n) + 8 end

-- the card at (x, y), `w` wide
function Card:draw(x, y, w)
  local L = self.L
  local n = #self.rows
  local h = Card.height(n)
  local slide = 1 - (1 - math.min(1, self.enter / 0.45)) ^ 3
  local ox = (1 - slide) * -(w + 30)
  x = x + ox
  ui.panel(x, y, w, h, "card")
  -- the tape that holds it, and the client
  nova.ui.sprite("ui/tape", x + w / 2 + ui.ox, y + 2 + ui.oy, { w = 120, h = 34, color = ui.tint({ 255, 255, 255, 230 }) })
  local who = L.props.client or "character-female-a"
  local face = 74
  ui.badge(x + 18 + face / 2, y + 22 + face / 2, face + 8, { 255, 236, 206 })
  ui.icon("ui/face_" .. who, x + 18, y + 22, face)
  ui.text(x + 104, y + 30, "Wish card", ui.SMALL, ui.color.dim)
  local title = L.props.name or ""
  ui.text(x + 104, y + 54, title, ui.fit(title, ui.LARGE, w - 118), ui.color.ink)
  -- the rows
  local ry = y + 112
  local step = Card.row(n)
  local k8 = (step - 8) / 66 -- (everything in a row shrinks with it)
  for k, wish in ipairs(L.props.wishes) do
    local row = self.rows[k]
    local rx = x + 12
    local shake = row.shake < 0.4 and math.sin(row.shake * 40) * (0.4 - row.shake) * 18 or 0
    rx = rx + shake
    local rw = w - 24
    local mint = { 214 + (196 - 214) * row.on, 206 + (236 - 206) * row.on, 190 + (206 - 190) * row.on }
    local rh = 66 * k8
    nova.ui.panel("ui/hd_row", rx + ui.ox, ry + ui.oy, rw, rh, { slice = 24, scale = 0.5, color = ui.tint({ mint[1], mint[2], mint[3], 255 }) })
    local icon = 56 * k8
    ui.icon("ui/icon_" .. wish.piece, rx + 8, ry + 5 * k8, icon)
    ui.icon(GLYPH[wish.wish] or "ui/glyph_place", rx + 8 + icon + 4, ry + rh / 2 - 16 * k8, 32 * k8)
    local tgt, label = target_icon(wish)
    local tx = rx + 8 + icon + 40 * k8
    if label then
      -- a room: its floor, and its name beside it (the rooms look alike)
      ui.icon(tgt, tx, ry + 5 * k8, icon)
      ui.text(tx + icon + 6, ry + rh / 2, label, ui.SMALL, ui.color.ink, { valign = "middle" })
    else
      ui.icon(tgt, tx, ry + 5 * k8, icon)
    end
    -- the tick: an empty ring, or a green stamp that pops in
    local cx, cy = rx + rw - 30, ry + rh / 2
    if row.on > 0.5 then
      local p = math.min(1, row.pop / 0.35)
      local s = 1 + math.sin(p * math.pi) * 0.45
      nova.ui.sprite("ui/check", cx + ui.ox, cy + ui.oy, { w = 44 * s * k8, h = 44 * s * k8, color = ui.tint({ 255, 255, 255, 255 }) })
    else
      nova.ui.sprite("ui/ring", cx + ui.ox, cy + ui.oy, { w = 38 * k8, h = 38 * k8, color = ui.tint({ 160, 140, 130, 200 }) })
    end
    ry = ry + step
  end
  return h
end

return Card

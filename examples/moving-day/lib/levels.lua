-- The levels, read from their scene files: scenes/levels/1.scene.json, 2, 3 ... (until one is missing), and the streets they belong to. A level is
-- a flat placed on the grid in the studio's 3D view and a "level" object whose props are the client's wish card; nothing about a level is in code.
local Rules = require("lib.rules")

local levels = {}

-- the streets of the level select: five levels each, the last six (a house of two rooms each gets one more)
levels.STREETS = {
  { name = "Studio Street", sub = "One small room", color = { 238, 128, 112 }, first = 1, last = 5, music = "morning" },
  { name = "Cottage Lane", sub = "Bigger rooms, beds and rugs", color = { 110, 176, 140 }, first = 6, last = 10, music = "morning" },
  { name = "Townhouse Row", sub = "Two rooms and a doorway", color = { 108, 150, 214 }, first = 11, last = 16, music = "afternoon" },
  { name = "Canal Lofts", sub = "Three rooms", color = { 196, 130, 200 }, first = 17, last = 21, music = "afternoon" },
  { name = "Penthouse Heights", sub = "Whole flats", color = { 232, 170, 72 }, first = 22, last = 26, music = "evening" },
}

local cache
function levels.all()
  if cache then return cache end
  cache = {}
  local i = 1
  while true do
    local L = Rules.read("levels." .. i)
    if not L then break end
    L.index = i
    cache[i] = L
    i = i + 1
  end
  for s, street in ipairs(levels.STREETS) do
    for i2 = street.first, math.min(street.last, #cache) do cache[i2].street = s end
  end
  return cache
end

function levels.get(i) return levels.all()[i] end
function levels.count() return #levels.all() end
function levels.street_of(i) return levels.STREETS[levels.get(i).street or 1] end

return levels

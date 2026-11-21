-- Applies data/look.lua: the light, the weather and the glow of a room, and the "Effects" quality switch of the pause screen.
local D = require("data.look")
local L = {}

L.quality = D.quality

-- the quality the save remembers (set by the pause screen; read at the start of every room)
function L.init()
  local q = nova.save and nova.save.get and nova.save.get("look_quality")
  if q == "high" or q == "low" or q == "off" then L.quality = q end
end

function L.set_quality(q)
  L.quality = q
  if nova.save and nova.save.set then nova.save.set("look_quality", q) end
  nova.effects(q)
end

function L.cycle_quality()
  local nextq = ({ high = "low", low = "off", off = "high" })[L.quality] or "high"
  L.set_quality(nextq)
  return nextq
end

-- Turns on the look of a kind of room ("outdoors", "yard", "indoors").
function L.enter(kind)
  local r = D.rooms[kind] or D.rooms.outdoors
  nova.effects(L.quality)
  nova.ambient2d(r.ambient)
  nova.reflections(r.reflections)
  if r.rain then nova.weather(r.rain) else nova.weather() end
  nova.look(r.look)
end

function L.leave()
  nova.ambient2d(nil)
  nova.reflections(nil)
  nova.weather()
  nova.look()
end

-- A soft additive glow at a world point (a halo, a flash): never darkened by the ambient light.
function L.halo(wx, wy, r, color, alpha, ry)
  local x, y = nova.cam.to_screen(wx, wy)
  nova.circle(x, y, r, { color[1], color[2], color[3], alpha }, { soft = true, blend = "add", lit = false, ry = ry or r * 0.8 })
end

return L

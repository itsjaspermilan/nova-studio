-- A moving platform: stood on from above, it carries what stands on it. Props: width (tiles, default 3), dx, dy (tiles to the far end, default
-- 4 and 0), period (seconds for a round trip, default 5), phase (0 to 1: where it is at the start), style (a ground style: grass, dirt, sand,
-- snow, stone, purple; or logs or plank). Place it by its left end's top.
local world = require("lib.world")
local fx = require("lib.fx")
local Platform = nova.entity { sprite = "items/plat_grass_m", sx = 0.5, sy = 0.5, depth = 15, width = 3, dx = 4, dy = 0, period = 5, phase = 0, style = "grass" }
function Platform:create()
  self.home_x, self.home_y = self.x, self.y
  local w = self.width * 48
  local x0, y0 = self:where(0)
  self.box = world.add_box({ x0 = x0, y0 = y0, x1 = x0 + w, y1 = y0 + 20, oneway = true, owner = self, dx = 0, dy = 0,
    path = function(t) return self:where(t) end })
end
function Platform:where(t)
  local a = (1 - math.cos((t / self.period + self.phase) * math.pi * 2)) * 0.5
  return self.home_x + self.dx * 48 * a, self.home_y + self.dy * 48 * a
end
function Platform:draw()
  local x0, y0 = self.box.x0, self.box.y0
  local plain = self.style == "logs" or self.style == "plank"
  for i = 0, self.width - 1 do
    local piece = plain and "m" or (i == 0 and "l" or (i == self.width - 1 and "r" or "m"))
    if self.width == 1 and not plain then piece = "m" end
    fx.draw("items/plat_" .. self.style .. "_" .. piece, x0 + i * 48 + 24, y0 + 24)
  end
end
function Platform:on_destroy() world.remove_box(self.box) end
return Platform

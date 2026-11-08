-- A fireball that leaps out of lava and falls back, like a fish of fire. It cannot be stomped. Place it at the lava's surface. Props:
-- height (tiles, default 4), period (seconds, default 2.4), delay.
local Fish = require("entities.fish")
local Ember = nova.entity(Fish, { sprite = "items/fireball", bw = 30, bh = 30, stompable = false, period = 2.4 })
function Ember:draw()
  if not self.up then return end
  local fx = require("lib.fx")
  fx.draw("items/fireball", self.x, self.y - 15, { rotation = (self.vy_now or 0) > 0 and math.pi or 0, sx = 0.55, sy = 0.55 })
end
return Ember

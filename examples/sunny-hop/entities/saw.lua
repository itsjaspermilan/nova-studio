-- A saw blade: spins along a line and back, and cannot be stomped. Props: dx, dy (tiles to the far end, default 4 and 0), period (seconds
-- for a round trip, default 4). Place it where it starts.
local Enemy = require("entities.enemy")
local Saw = nova.entity(Enemy, { sprite = "enemies/saw", bw = 40, bh = 40, walker = false, stompable = false, dx = 4, dy = 0, period = 4, depth = 6 })

function Saw:where(t)
  local a = (1 - math.cos((t / self.period) * math.pi * 2)) * 0.5
  return self.home_x + self.dx * 48 * a, self.home_y + self.dy * 48 * a
end
function Saw:init() self.t = 0 end
function Saw:act(dt) self.x, self.y = self:where(self.t) end
function Saw:predict(dt) return self:where(self.t + dt) end
function Saw:draw()
  local fx = require("lib.fx")
  fx.draw("enemies/saw", self.x, self.y - 24, { frame = 0, rotation = self.t * 9 })
end
return Saw

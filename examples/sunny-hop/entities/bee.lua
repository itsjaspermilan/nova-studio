-- A bee: flies back and forth along a line, bobbing. Props: range (tiles each way, default 3), vertical (true: up and down instead), period
-- (seconds for a round trip, default 4).
local Enemy = require("entities.enemy")
local Bee = nova.entity(Enemy, { sprite = "enemies/bee", bw = 40, bh = 34, walker = false, range = 3, vertical = false, period = 4, anim_rate = 14 })

function Bee:where(t)
  local a = math.sin((t / self.period) * math.pi * 2)
  local r = self.range * 48
  if self.vertical then return self.home_x + math.sin(t * 3) * 6, self.home_y + a * r end
  return self.home_x + a * r, self.home_y + math.sin(t * 4) * 8
end

function Bee:init() self.t = 0 end
function Bee:act(dt)
  local x = self.x
  self.x, self.y = self:where(self.t)
  if not self.vertical and math.abs(self.x - x) > 0.01 then self.dir = self.x > x and 1 or -1 end
end
function Bee:predict(dt)
  if self.dead then return nil end
  return self:where(self.t + dt)
end
function Bee:frame_now()
  if self.dead then return 0 end
  return 1 + math.floor(self.t * self.anim_rate) % 2
end
return Bee

-- A fish: leaps out of the water every few seconds and dives back. Place it at the water's surface. Props: height (tiles, default 4), period
-- (seconds between leaps, default 2.6), delay (seconds before the first).
local Enemy = require("entities.enemy")
local Fish = nova.entity(Enemy, { sprite = "enemies/fish", bw = 40, bh = 36, walker = false, height = 4, period = 2.6, delay = 0, anim_rate = 8, depth = 8 })

local G = 2000
function Fish:init() self.t = -self.delay end
function Fish:where(t)
  local v = math.sqrt(2 * G * self.height * 48)
  local air = 2 * v / G
  local k = t % self.period
  if t < 0 or k > air then return self.home_x, self.home_y + 60, false end
  return self.home_x, self.home_y - (v * k - 0.5 * G * k * k) + 20, true, v - G * k
end
function Fish:act(dt)
  local x, y, up, vy = self:where(self.t)
  self.x, self.y, self.up, self.vy_now = x, y, up, vy
  self.visible = up
end
function Fish:predict(dt)
  if self.dead then return nil end
  local x, y, up = self:where(self.t + dt)
  if not up then return nil end
  return x, y
end
function Fish:frame_now()
  if self.dead then return 3 end
  return (self.vy_now or 0) > 0 and 3 or 1 + math.floor(self.t * self.anim_rate) % 2
end
function Fish:box()
  if not self.up then return -1e9, -1e9, -1e9, -1e9 end
  return self.x - self.bw / 2, self.y - self.bh, self.x + self.bw / 2, self.y
end
return Fish

-- A block slime: hops straight up and down where it stands. Props: hop (seconds between hops, default 1.4), height (tiles, default 2).
local world = require("lib.world")
local Enemy = require("entities.enemy")
local Hopper = nova.entity(Enemy, { sprite = "enemies/blockslime", bw = 40, bh = 40, walker = false, hop = 1.4, height = 2 })

function Hopper:where(t)
  local v = math.sqrt(2 * 2200 * self.height * 48)
  local air = 2 * v / 2200
  local k = t % self.hop
  if k > air then return self.home_x, self.home_y, true end
  return self.home_x, self.home_y - (v * k - 1100 * k * k), false
end
function Hopper:init() self.t = (self.x % 5) / 5 * self.hop end
function Hopper:act(dt)
  local was = self.on
  self.x, self.y, self.on = self:where(self.t)
  if self.on and not was then self.squash_x, self.squash_y = 1.25, 0.8 end
end
function Hopper:predict(dt) if self.dead then return nil end return self:where(self.t + dt) end
function Hopper:frame_now()
  if self.dead then return 3 end
  return self.on and 0 or 3
end
return Hopper

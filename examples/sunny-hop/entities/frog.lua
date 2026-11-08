-- A frog: sits, then hops towards the hero (or the way it faces when the hero is far). Props: hop (seconds between hops, default 1.6).
local world = require("lib.world")
local Enemy = require("entities.enemy")
local Frog = nova.entity(Enemy, { sprite = "enemies/frog", bw = 42, bh = 38, walker = false, hop = 1.6, wait = 0 })

function Frog:init() self.wait = self.hop * (0.5 + (self.x % 7) / 14) end
function Frog:act(dt)
  local b = self.b
  b.vy = math.min(900, b.vy + 2200 * dt)
  world.move(b, b.vx * dt, b.vy * dt, false, true, false)
  if b.hit_x then b.vx = -b.vx; self.dir = -self.dir end
  if b.ground then
    b.vy, b.vx = 0, 0
    self.wait = self.wait - dt
    if self.wait <= 0 then
      local hero = nova.first("hero")
      if hero and math.abs(hero.x - self.x) < 480 then self.dir = hero.x > self.x and 1 or -1 end
      b.vx, b.vy = self.dir * 130, -620
      self.wait = self.hop
      self.squash_x, self.squash_y = 0.8, 1.25
    end
  end
  self.x, self.y = b.x, b.y
  if self.y > world.height + 200 then self:destroy() end
end
function Frog:predict(dt)
  if self.dead then return nil end
  local b = self.b
  if b.ground then return self.x, self.y end
  return self.x + b.vx * dt, self.y + b.vy * dt + 1100 * dt * dt
end
function Frog:frame_now()
  if self.dead then return 0 end
  return self.b.ground and 1 or 2
end
return Frog

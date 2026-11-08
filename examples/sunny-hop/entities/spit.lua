-- A fireball spat by the Fire King: it arcs, bounces once on the ground and burns out.
local world = require("lib.world")
local fx = require("lib.fx")
local Spit = nova.entity { sprite = "items/fireball", sx = 0.5, sy = 0.5, tags = { "enemy", "spit" }, depth = 3, velocity = false, stompable = false, bw = 26, bh = 26, life = 3.2, bounced = 0, dead = false, dir = 1, launched = false }
-- (the boss sets vx, vy right after spawning it; they become the body's speed on the first step)
function Spit:create() self.b = { x = self.x, y = self.y, w = self.bw, h = self.bh, vx = 0, vy = 0 }; self.t = 0 end
function Spit:update(dt)
  self.t = self.t + dt
  self.life = self.life - dt
  local b = self.b
  if not self.launched then b.vx, b.vy, self.launched = self.vx or 0, self.vy or 0, true end
  b.vy = math.min(900, b.vy + 1700 * dt)
  world.move(b, b.vx * dt, b.vy * dt, false, true, false)
  if b.hit_x then b.vx = -b.vx end
  if b.ground then
    self.bounced = self.bounced + 1
    b.vy = -360
    fx.dust(b.x, b.y, 3, { 255, 160, 60, 220 })
    if self.bounced > 2 then self.life = 0 end
  end
  self.x, self.y = b.x, b.y
  if self.life <= 0 or self.y > world.height + 100 then self:destroy() end
end
function Spit:box() return self.x - 13, self.y - 26, self.x + 13, self.y end
function Spit:predict(dt) return self.x + self.b.vx * dt, self.y + self.b.vy * dt + 850 * dt * dt end
function Spit:knock() self:destroy() end
function Spit:stomp() return false end
function Spit:draw() fx.draw("items/fireball", self.x, self.y - 13, { rotation = self.t * 8, sx = 0.55, sy = 0.55 }) end
return Spit

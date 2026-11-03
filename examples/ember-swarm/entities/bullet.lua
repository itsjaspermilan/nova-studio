local state = require("lib.state")

-- A shot: flies straight and hits the first enemy it touches.
local Bullet = nova.entity { model = "bullet", tags = { "bullet" }, hitbox = { r = 0.35 } }

function Bullet:create()
  self.life = 1.4
  self.speed = 26
  self.dir = self.dir or 0
  self.ry = self.dir
  self.hit_radius = 0.7
end

function Bullet:update(dt)
  self.life = self.life - dt
  if self.life <= 0 then self:destroy() return end
  self.x = self.x + math.sin(self.dir) * self.speed * dt
  self.z = self.z + math.cos(self.dir) * self.speed * dt
end

-- Touching an enemy (the engine's collisions, on the ground plane).
function Bullet:on_collide_enemy(e)
  if self.spent then return end
  self.spent = true
  e:hurt(state.damage)
  self:destroy()
end

return Bullet

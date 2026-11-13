-- A shot from an enemy: flies straight, stops at walls, hurts the player (how much is its `damage`).
local phys = require("lib.phys")
local rect = require("lib.view").rect
local EBullet = nova.entity { tags = { "ebullet" }, velocity = false, depth = -20, speed = 220, life = 3.5, dx = -1, dy = 0, damage = 15 }

function EBullet:update(dt)
  self.life = self.life - dt
  if self.life <= 0 then return self:destroy() end
  self.x, self.y = self.x + self.dx * self.speed * dt, self.y + self.dy * self.speed * dt
  if phys.in_wall(self.x, self.y) then return self:destroy() end
  local p = nova.first("player")
  if p and not p.dead and self.x > p.x - p.w / 2 - 2 and self.x < p.x + p.w / 2 + 2 and self.y > p.y - p.h and self.y < p.y then
    p:hurt(self.damage, self.x - self.dx * 30)
    self:destroy()
  end
end

function EBullet:draw()
  rect(self.x - 3, self.y - 3, 7, 7, { 255, 90, 90 })
  rect(self.x - 1, self.y - 1, 3, 3, { 255, 230, 200 })
end

return EBullet

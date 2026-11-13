-- A shot from the player: flies straight, stops at walls, hurts what it hits.
local phys = require("lib.phys")
local rect = require("lib.view").rect
local Bullet = nova.entity { tags = { "bullet" }, velocity = false, depth = -20, speed = 880, life = 0.7, dx = 1, dy = 0, damage = 1, pellet = false, reflected = false }

function Bullet:update(dt)
  self.life = self.life - dt
  if self.life <= 0 then return self:destroy() end
  -- in two half steps so that a fast shot does not skip through a thin thing
  for _ = 1, 2 do
    self.x, self.y = self.x + self.dx * self.speed * dt / 2, self.y + self.dy * self.speed * dt / 2
    if phys.in_wall(self.x, self.y) then
      for _ = 1, (self.pellet and 1 or 3) do nova.spawn("spark", self.x, self.y, { size = 2, speed = 90 }) end
      return self:destroy()
    end
    for _, e in ipairs(nova.all("enemy")) do
      if not e.down and self.x > e.x - e.w / 2 and self.x < e.x + e.w / 2 and self.y > e.y - e.h and self.y < e.y then
        e:hurt(self.damage)
        for _ = 1, (self.pellet and 1 or 3) do nova.spawn("spark", self.x, self.y, { size = 3, speed = 120, color = { 255, 120, 90 } }) end
        return self:destroy()
      end
    end
  end
end

function Bullet:draw()
  if self.reflected then
    rect(self.x - 4, self.y - 3, 8, 6, { 120, 230, 255 })
  elseif self.pellet then
    rect(self.x - 2, self.y - 1, 4, 3, { 255, 200, 110 })
  else
    rect(self.x - 3, self.y - 2, 6, 4, { 255, 240, 140 })
  end
end

return Bullet

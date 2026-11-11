-- A shot: flies straight, stops at a wall and throws sparks.
local Bullet = nova.entity { tags = { "bullet" }, velocity = false, speed = 38, life = 1.2, dx = 0, dz = 1 }

function Bullet:update(dt)
  self.life = self.life - dt
  if self.life <= 0 then return self:destroy() end
  local step = self.speed * dt
  local dist, nx, nz = nova.walls.raycast(self.x, self.z, self.dx, self.dz, step + 0.1, self.y)
  if dist then
    local px, pz = self.x + self.dx * dist, self.z + self.dz * dist
    for _ = 1, 7 do
      nova.spawn("spark", px, self.y, { z = pz, nx = nx or 0, nz = nz or 0 })
    end
    return self:destroy()
  end
  self.x, self.z = self.x + self.dx * step, self.z + self.dz * step
end

function Bullet:draw()
  nova.cuboid_at(self.x, self.y, self.z, 0.07, 0.07, 0.6, { ry = math.atan(self.dx, self.dz), color = { 255, 235, 140 }, glow = true })
end

return Bullet

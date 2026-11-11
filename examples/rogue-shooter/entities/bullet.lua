-- A shot: flies straight (up and down too), stops at a wall or the floor and throws sparks.
local sqrt = math.sqrt
local Bullet = nova.entity { tags = { "bullet" }, velocity = false, speed = 38, life = 1.2, damage = 1, dx = 0, dy = 0, dz = 1 }

-- The first enemy along this step: how far along the ground (metres), and which. The step is a line over the ground; an enemy is
-- a standing circle, so we look for the nearest point of the line to its middle and check the height there.
local function enemy_hit(self, hx, hz, len, h)
  local best, who
  for _, e in ipairs(nova.all("enemy")) do
    local ex, ez = e.x - self.x, e.z - self.z
    local along = ex * hx + ez * hz
    local side2 = ex * ex + ez * ez - along * along
    local r = e.radius
    if side2 < r * r then
      local t = along - sqrt(r * r - side2) -- where the line enters the circle
      if t < 0 then t = 0 end
      if t <= len and along > -r then
        local y = self.y + self.dy / h * t
        if y >= e.y and y <= e.y + e.height and (not best or t < best) then best, who = t, e end
      end
    end
  end
  return best, who
end

function Bullet:update(dt)
  self.life = self.life - dt
  if self.life <= 0 then return self:destroy() end
  local step = self.speed * dt
  local h = sqrt(self.dx * self.dx + self.dz * self.dz)
  local hx, hz = self.dx / h, self.dz / h
  local dist, nx, nz = nova.walls.raycast(self.x, self.z, hx, hz, step * h + 0.1, self.y, self.dy / h)
  local ehit, enemy = enemy_hit(self, hx, hz, step * h, h)
  if ehit and (not dist or ehit < dist) then
    local px, pz = self.x + hx * ehit, self.z + hz * ehit
    local py = self.y + self.dy / h * ehit
    for _ = 1, 4 do nova.spawn("spark", px, py, { z = pz, nx = -hx, nz = -hz, color = { 220, 70, 60 } }) end
    enemy:hurt(self.damage, hx, hz)
    return self:destroy()
  end
  local floor_at = self.dy < 0 and self.y / -self.dy or nil -- how far along (in steps of 1) it reaches the floor
  if floor_at and floor_at <= step and (not dist or floor_at * h < dist) then
    local px, pz = self.x + self.dx * floor_at, self.z + self.dz * floor_at
    for _ = 1, 6 do nova.spawn("spark", px, 0.03, { z = pz, nx = 0, nz = 0 }) end
    return self:destroy()
  end
  if dist then
    local px, pz = self.x + hx * dist, self.z + hz * dist
    for _ = 1, 7 do nova.spawn("spark", px, self.y + self.dy / h * dist, { z = pz, nx = nx or 0, nz = nz or 0 }) end
    return self:destroy()
  end
  self.x, self.y, self.z = self.x + self.dx * step, self.y + self.dy * step, self.z + self.dz * step
end

function Bullet:draw()
  nova.cuboid_at(self.x, self.y, self.z, 0.07, 0.07, 0.6, { ry = math.atan(self.dx, self.dz), rx = -math.asin(self.dy), color = { 255, 235, 140 }, glow = true })
end

return Bullet

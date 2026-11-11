-- A spark thrown off where a shot hits a wall: flies out of the wall, falls and goes out.
local Spark = nova.entity { tags = { "spark" }, velocity = false, nx = 0, nz = 0 }

function Spark:create()
  self.t, self.life = 0, 0.25 + math.random() * 0.2
  local s = 1.5 + math.random() * 3
  self.sx = (self.nx + (math.random() - 0.5) * 1.2) * s
  self.sz = (self.nz + (math.random() - 0.5) * 1.2) * s
  self.sy = 1 + math.random() * 2
end

function Spark:update(dt)
  self.t = self.t + dt
  if self.t >= self.life then return self:destroy() end
  self.sy = self.sy - 9 * dt
  self.x, self.y, self.z = self.x + self.sx * dt, math.max(0.02, self.y + self.sy * dt), self.z + self.sz * dt
end

function Spark:draw()
  local k = 0.06 * (1 - self.t / self.life) + 0.015
  nova.cuboid_at(self.x, self.y, self.z, k, k, k, { color = { 255, 190, 80 }, glow = true })
end

return Spark

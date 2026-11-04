local state = require("lib.state")

-- A little patroller: walks between two points on its island. Landing on it from above beats it.
local Walker = nova.entity { tags = { "walker" }, velocity = false }

function Walker:create() self.dir, self.age = 1, math.random() * 4 end

function Walker:update(dt)
  self.age = self.age + dt
  local nx, nz = self.x + self.ax * self.dir * dt * 1.8, self.z + self.az * self.dir * dt * 1.8
  local d = (nx - self.x0) * self.ax + (nz - self.z0) * self.az
  if math.abs(d) > self.range then self.dir = -self.dir else self.x, self.z = nx, nz end
end

function Walker:draw()
  local x, y, z = self.x, self.y, self.z
  nova.cuboid_at(x, y + 0.45, z, 0.9, 0.7, 0.9, { color = { 210, 70, 70 } })
  nova.cuboid_at(x, y + 0.9, z, 0.6, 0.25, 0.6, { color = { 240, 200, 80 } })
end

return Walker

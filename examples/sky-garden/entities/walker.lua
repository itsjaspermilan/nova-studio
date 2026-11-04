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
  self.clip_t = (self.clip_t or 0) + 1 / 60
  nova.model("character-oodi", self.x, self.y, self.z, { scale = 1.1, ry = (self.dir > 0 and 0 or math.pi) + 0, tint = { 255, 120, 120 }, clip = "walk", time = self.clip_t })
end

return Walker

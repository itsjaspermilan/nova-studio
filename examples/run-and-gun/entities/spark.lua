-- A little spark: flies out, falls and goes out.
local rect = require("lib.view").rect
local Spark = nova.entity { tags = { "spark" }, velocity = false, depth = -50, size = 3, color = { 255, 210, 90 }, speed = 160 }

function Spark:create()
  self.t, self.life = 0, 0.25 + math.random() * 0.25
  local a = math.random() * math.pi * 2
  local s = self.speed * (0.3 + math.random() * 0.9)
  self.sx, self.sy = math.cos(a) * s, math.sin(a) * s - 40
end

function Spark:update(dt)
  self.t = self.t + dt
  if self.t >= self.life then return self:destroy() end
  self.sy = self.sy + 500 * dt
  self.x, self.y = self.x + self.sx * dt, self.y + self.sy * dt
end

function Spark:draw()
  local k = self.size * (1 - self.t / self.life) + 1
  rect(self.x - k / 2, self.y - k / 2, k, k, self.color)
end

return Spark

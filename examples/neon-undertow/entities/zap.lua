-- A flash of lightning between two points (Live Wire, Shock Wake): a jagged bolt with a glow, a white core and two forks that re-jags
-- every frame, a flash at both ends and sparks where it lands. It fades in a few frames. Props: x2, y2, color.
local V = require("lib.vfx")

local Zap = nova.entity { tags = { "zap" }, velocity = false, t = 0 }
local LIFE = 0.24

function Zap:create()
  self.depth = -self.y - 60
  self.seed = math.random() * 100
  local c = self.color or { 6, 240, 255 }
  local m = c[1] > 200
  V.sparks(self.x2, self.y2, 5, { z = 28, speed = 260, up = 150, life = 0.4, colors = m and { "spark_white", "spark_red" } or { "spark_white", "spark_cyan", "spark_cyan" } })
end

function Zap:update(dt)
  self.t = self.t + dt
  if self.t > LIFE then self:destroy() end
end

function Zap:draw()
  local k = 1 - self.t / LIFE
  -- (the bolt is drawn in the world, its two ends lifted to the chest: y - 0)
  V.bolt(self.x, self.y, self.x2, self.y2, k, self.color or { 6, 240, 255 }, self.seed + math.floor(self.t * 60) * 1.7, 0, 30)
end

return Zap

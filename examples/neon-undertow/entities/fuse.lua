-- A lit fuse on the ground: a ring the size of the blast flashes for `time` seconds, then the blast. Props: time, spec (the blast's
-- numbers: radius, runner, enemy, prop). A Volatile elite leaves one where it died.
local D = require("lib.draw")
local J = require("lib.juice")
local Blast = require("lib.blast")

local Fuse = nova.entity { tags = { "fuse" }, velocity = false, t = 0, time = 1.0 }

function Fuse:create() self.depth = 94 end

function Fuse:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  if self.t >= self.time then
    Blast.at(self.x, self.y, self.spec)
    self:destroy()
  end
end

function Fuse:draw()
  local k = self.t / self.time
  local on = math.floor(self.t * 12) % 2 == 0
  local r = self.spec.radius
  D.disc(self.x, self.y, r, { 255, 138, 43, on and 70 or 30 })
  D.ring(self.x, self.y, r, { 255, 138, 43, on and 255 or 160 }, 5, 40)
  D.ring(self.x, self.y, r * k, { 255, 228, 94, 220 }, 4, 28)
end

return Fuse

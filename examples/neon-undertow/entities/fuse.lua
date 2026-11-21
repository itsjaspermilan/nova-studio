-- A lit fuse on the ground: a ring the size of the blast flashes for `time` seconds, then the blast. Props: time, spec (the blast's
-- numbers: radius, runner, enemy, prop). A Volatile elite leaves one where it died.
local T = require("lib.tell")
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
  T.disc(self.x, self.y, self.spec.radius, self.t / self.time, self.t, T.orange)
end

return Fuse

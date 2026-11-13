-- A flying weapon capsule: touch it for the shotgun (a load of pellets in a cone: strong up close). You lose it when you die.
local floor, sin = math.floor, math.sin
local rect = require("lib.view").rect

local Capsule = nova.entity { tags = { "capsule" }, velocity = false, depth = -5 }

function Capsule:create()
  self.t, self.y0 = math.random() * 6, self.y
end

function Capsule:update(dt)
  self.t = self.t + dt
  self.y = self.y0 + sin(self.t * 3) * 6
  local p = nova.first("player")
  if p and not p.dead and math.abs(p.x - self.x) < 20 and p.y > self.y - 4 and p.y - p.h < self.y + 10 then
    p.gun = "shotgun"
    p.score = p.score + 200
    for _ = 1, 10 do nova.spawn("spark", self.x, self.y, { color = { 120, 220, 255 }, size = 4, speed = 160 }) end
    self:destroy()
  end
end

function Capsule:draw()
  local x, y = floor(self.x), floor(self.y)
  rect(x - 10, y - 6, 20, 12, { 200, 60, 60 })
  rect(x - 8, y - 8, 16, 16, { 230, 230, 240 })
  rect(x - 4, y - 5, 8, 2, { 200, 60, 60 }) -- an S
  rect(x - 4, y - 5, 2, 5, { 200, 60, 60 })
  rect(x - 4, y - 1, 8, 2, { 200, 60, 60 })
  rect(x + 2, y, 2, 4, { 200, 60, 60 })
  rect(x - 4, y + 2, 8, 2, { 200, 60, 60 })
end

return Capsule

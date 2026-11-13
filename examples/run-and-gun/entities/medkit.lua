local rect = require("lib.view").rect
-- A health pack: touch it to heal. It floats a little. (It was the weapon capsule: both guns are with you from the start now.)
local floor, sin = math.floor, math.sin

local Medkit = nova.entity {
  tags = { "medkit" },
  velocity = false,
  depth = -5,
  settings = { heal = { 40, min = 5, max = 200, step = 5, help = "How much health it gives back" } },
}

function Medkit:create()
  self.t, self.y0 = math.random() * 6, self.y
end

function Medkit:update(dt)
  self.t = self.t + dt
  self.y = self.y0 + sin(self.t * 3) * 5
  local p = nova.first("player")
  if p and not p.dead and p.hp < p.hp_max and math.abs(p.x - self.x) < 20 and p.y > self.y - 4 and p.y - p.h < self.y + 10 then
    p.hp = math.min(p.hp_max, p.hp + self.heal)
    p.score = p.score + 100
    for _ = 1, 10 do nova.spawn("spark", self.x, self.y, { color = { 110, 230, 130 }, size = 4, speed = 150 }) end
    self:destroy()
  end
end

function Medkit:draw()
  local x, y = floor(self.x), floor(self.y)
  rect(x - 9, y - 8, 18, 16, { 235, 235, 240 })
  rect(x - 9, y - 8, 18, 2, { 190, 190, 200 })
  rect(x - 2, y - 6, 4, 12, { 215, 55, 55 })
  rect(x - 6, y - 2, 12, 4, { 215, 55, 55 })
end

return Medkit

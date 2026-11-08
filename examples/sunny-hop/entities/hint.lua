-- A sign with a tip: when the hero comes near, a bubble with the text pops up over it (and goes when the hero walks on). Props: text, and
-- button (a pad picture shown before the text, such as "pad_a" or "pad_dpad").
local fx = require("lib.fx")
local Hint = nova.entity { sprite = "items/sign", sx = 0.5, sy = 0.5, pivot = { 0.5, 1 }, tags = { "hint_sign" }, depth = 40, text = "", button = "", near = 0, t = 0 }
function Hint:update(dt)
  self.t = self.t + dt
  local hero = nova.first("hero")
  local close = hero and math.abs(hero.x - self.x) < 150 and math.abs(hero.y - self.y) < 160
  self.near = math.max(0, math.min(1, self.near + (close and dt * 5 or -dt * 4)))
end
function Hint:draw() fx.draw("items/sign", self.x, self.y - 24) end
return Hint

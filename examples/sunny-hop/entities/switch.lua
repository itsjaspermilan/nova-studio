-- A floor switch: step on it and every gate and door of its colour opens. Prop: color.
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local Switch = nova.entity { sprite = "items/switch_blue", sx = 0.5, sy = 0.5, pivot = { 0.5, 1 }, tags = { "touch", "switch" }, depth = 20, color = "blue", pressed = false, squash = 1 }
function Switch:update(dt) self.squash = self.squash + (1 - self.squash) * math.min(1, dt * 10) end
function Switch:draw()
  local img = "items/switch_" .. self.color .. (self.pressed and "_pressed" or "")
  fx.draw(img, self.x, self.y - 24, { sx = 0.5 / self.squash, sy = 0.5 * self.squash })
end
function Switch:zone() return self.x - 30, self.y - 22, self.x + 30, self.y end
function Switch:touch(hero)
  if self.pressed or hero.b.vy < -10 then return end
  self.pressed, self.squash = true, 0.7
  run.press(self.color)
  audio.sfx("switch")
  fx.dust(self.x, self.y - 10, 6)
  fx.float(self.x, self.y - 70, "Click!", { 255, 255, 255 }, 26)
end
return Switch

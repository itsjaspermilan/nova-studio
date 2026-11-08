-- A heart: one back, up to three.
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local Heart = nova.entity { sprite = "items/heart", sx = 0.5, sy = 0.5, tags = { "pickup" }, depth = 10, r = 20 }
function Heart:create() self.t = 0 end
function Heart:update(dt) self.t = self.t + dt end
function Heart:draw()
  local s = 0.5 * (1 + math.max(0, math.sin(self.t * 6)) * 0.12)
  fx.draw("items/heart", self.x, self.y + math.sin(self.t * 2) * 3, { sx = s, sy = s })
end
function Heart:collect(hero)
  if not run.heal() then return end
  audio.sfx("heart")
  fx.sparkle(self.x, self.y, 10, { 255, 120, 140, 255 })
  self:destroy()
end
return Heart

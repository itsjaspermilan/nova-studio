-- A checkpoint flag: touched, it turns green, and a fall or a lost heart brings the hero back here. Place it by its foot.
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local Checkpoint = nova.entity { sprite = "items/flag_off", sx = 0.5, sy = 0.5, pivot = { 0.5, 1 }, tags = { "touch" }, depth = 25, on = false, t = 0, pop = 1 }
function Checkpoint:update(dt)
  self.t = self.t + dt
  self.pop = self.pop + (1 - self.pop) * math.min(1, dt * 8)
end
function Checkpoint:draw()
  if self.on then
    local f = math.floor(self.t * 6) % 2 == 0 and "a" or "b"
    fx.draw("items/flag_green_" .. f, self.x + 14, self.y - 24, { sx = 0.5 * self.pop, sy = 0.5 * self.pop })
  else
    fx.draw("items/flag_off", self.x, self.y - 24)
  end
end
function Checkpoint:zone() return self.x - 22, self.y - 100, self.x + 30, self.y end
function Checkpoint:touch(hero)
  if self.on or run.mode == "trial" then return end
  self.on, self.pop = true, 1.5
  run.checkpoint = { x = self.x, y = self.y }
  audio.sfx("checkpoint")
  fx.sparkle(self.x + 10, self.y - 60, 14, { 120, 255, 140, 255 })
  fx.float(self.x, self.y - 100, "Checkpoint!", { 140, 255, 150 }, 28)
end
return Checkpoint

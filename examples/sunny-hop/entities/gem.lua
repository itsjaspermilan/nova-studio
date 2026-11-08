-- One of the level's three hidden gems. Prop: n (1, 2 or 3). A gem found on an earlier visit shows as a ghost, and still counts again.
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local state = require("lib.state")

local COLORS = { "blue", "green", "red" }
local TINT = { { 90, 170, 255 }, { 90, 230, 130 }, { 255, 90, 110 } }
local Gem = nova.entity { sprite = "items/gem_blue", sx = 0.5, sy = 0.5, tags = { "pickup", "gem" }, depth = 10, n = 1, r = 24 }

function Gem:create()
  self.n = math.max(1, math.min(3, math.floor(self.n)))
  self.image = "items/gem_" .. COLORS[self.n]
  self.t = self.n
  self.ghost = run.level and state.record(run.level.id).gems[self.n] or false
end
function Gem:update(dt)
  self.t = self.t + dt
  if not nova.first("hero") then return end
  if math.floor(self.t * 4) ~= math.floor((self.t - dt) * 4) and not fx.calm then
    nova.burst(self.x + math.random(-16, 16), self.y + math.random(-16, 16), { count = 1, image = "fx/sparkle", size = { 6, 12 }, size_end = 0, life = 0.5, speed = 10, color = { 255, 255, 255, 220 }, color_end = { 255, 255, 255, 0 }, depth = 9 })
  end
end
function Gem:draw()
  local s = 0.55 + math.sin(self.t * 4) * 0.03
  fx.draw("fx/glow", self.x, self.y, { sx = 1.4, sy = 1.4, color = { TINT[self.n][1], TINT[self.n][2], TINT[self.n][3], self.ghost and 60 or 120 } })
  fx.draw(self.image, self.x, self.y + math.sin(self.t * 2.5) * 4, { sx = s, sy = s, alpha = self.ghost and 0.45 or 1 })
end
function Gem:collect(hero)
  run.found_gem(self.n)
  audio.sfx("gem")
  fx.sparkle(self.x, self.y, 16, { TINT[self.n][1], TINT[self.n][2], TINT[self.n][3], 255 })
  fx.ring(self.x, self.y, { TINT[self.n][1], TINT[self.n][2], TINT[self.n][3], 230 })
  fx.float(self.x, self.y - 30, "Gem " .. self.n .. "!", TINT[self.n], 30)
  run.emit("gem", self.n)
  self:destroy()
end
return Gem

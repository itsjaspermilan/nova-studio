-- The goal: a big flag; touch it to finish the level. Prop: after_boss (true: it appears when the level's boss is beaten). Place it by its foot.
local fx = require("lib.fx")
local run = require("lib.run")
local Goal = nova.entity { sprite = "items/goal_a", sx = 0.5, sy = 0.5, pivot = { 0.5, 1 }, tags = { "touch", "goal" }, depth = 25, after_boss = false, t = 0, shown = 1 }
function Goal:create()
  if self.after_boss then self.shown = 0 end
  run.on(function(what)
    if what == "boss_down" and self:is_alive() then
      self.appear = 0
      fx.sparkle(self.x, self.y - 60, 24)
    end
  end)
end
function Goal:update(dt)
  self.t = self.t + dt
  if self.appear then
    self.appear = self.appear + dt
    self.shown = math.min(1, self.appear / 0.6)
  end
end
function Goal:ready() return self.shown >= 1 end
function Goal:draw()
  if self.shown <= 0 then return end
  local f = math.floor(self.t * 5) % 2 == 0 and "a" or "b"
  local s = 0.5 * (self.shown < 1 and (1.6 - 0.6 * self.shown) or 1)
  fx.draw("fx/glow", self.x, self.y - 60, { sx = 3, sy = 3, color = { 255, 230, 120, math.floor(70 + math.sin(self.t * 3) * 30) } })
  fx.draw("items/goal_" .. f, self.x + 20, self.y - 48, { sx = s, sy = s, alpha = self.shown })
end
function Goal:zone() return self.x - 30, self.y - 160, self.x + 50, self.y end
function Goal:touch(hero)
  if self.shown < 1 or run.finished then return end
  run.emit("goal", self)
end
return Goal

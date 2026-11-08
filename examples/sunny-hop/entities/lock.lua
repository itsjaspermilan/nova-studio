-- A lock block: solid until the hero touches it holding a key of its colour. Prop: color.
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local Lock = nova.entity { sprite = "items/lock_yellow", sx = 0.5, sy = 0.5, tags = { "touch", "lock" }, depth = 20, color = "yellow", opening = -1 }
function Lock:create()
  self.solid = world.add_box({ x0 = self.x - 24, y0 = self.y - 24, x1 = self.x + 24, y1 = self.y + 24, owner = self })
end
function Lock:update(dt)
  if self.opening >= 0 then
    self.opening = self.opening + dt
    if self.opening > 0.35 then self:destroy() end
  end
end
function Lock:draw()
  local o = math.max(0, self.opening)
  local s = 0.5 * (1 + o * 0.8)
  fx.draw("items/lock_" .. self.color, self.x, self.y, { sx = s, sy = s, alpha = 1 - o / 0.35 })
end
-- the hero is next to it (the play scene asks with a box a little bigger than the hero's)
function Lock:touch(hero)
  if self.opening >= 0 or not run.keys[self.color] then return end
  run.use_key(self.color)
  self.opening = 0
  world.remove_box(self.solid)
  audio.sfx("unlock")
  fx.sparkle(self.x, self.y, 14)
end
function Lock:on_destroy() world.remove_box(self.solid) end
return Lock

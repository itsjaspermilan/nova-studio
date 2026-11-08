-- A lock block: solid until the hero touches it holding a key of its colour; the key opens the whole wall of locks it belongs to (the
-- same colour, touching) and is used up. Prop: color.
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local Lock = nova.entity { sprite = "items/lock_yellow", sx = 0.5, sy = 0.5, tags = { "touch", "lock" }, depth = 20, settings = { color = { "yellow", choices = { "blue", "green", "red", "yellow" }, help = "Opens (or is opened by) everything of this colour" } }, opening = -1, waiting = false }
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
  audio.sfx("unlock")
  self:open(0)
end
function Lock:open(delay)
  if self.opening >= 0 or self.waiting then return end
  self.waiting = true
  self:after(delay, function()
    self.opening = 0
    world.remove_box(self.solid)
    fx.sparkle(self.x, self.y, 10)
  end)
  world.remove_box(self.solid)
  for _, other in ipairs(nova.all("lock")) do
    if other ~= self and other.color == self.color and math.abs(other.x - self.x) + math.abs(other.y - self.y) < 60 then other:open(delay + 0.08) end
  end
end
function Lock:on_destroy() world.remove_box(self.solid) end
return Lock

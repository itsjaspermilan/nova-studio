-- A coloured block, solid until a switch of its colour is pressed; then only its outline is left. Prop: color.
local world = require("lib.world")
local fx = require("lib.fx")
local run = require("lib.run")
local Gate = nova.entity { sprite = "items/block_blue", sx = 0.5, sy = 0.5, depth = 20, settings = { color = { "blue", choices = { "blue", "green", "red", "yellow" }, help = "Opens (or is opened by) everything of this colour" } }, open = false, fade = 0 }
function Gate:create()
  self.solid = world.add_box({ x0 = self.x - 24, y0 = self.y - 24, x1 = self.x + 24, y1 = self.y + 24, owner = self })
  run.on(function(what, color)
    if what == "switch" and color == self.color and self:is_alive() and not self.open then
      self.open = true
      self.solid.off = true
      self:after(math.abs(self.x - (run.hero and run.hero.x or self.x)) / 900, function() fx.sparkle(self.x, self.y, 5) end)
    end
  end)
end
function Gate:update(dt) if self.open then self.fade = math.min(1, self.fade + dt * 3) end end
function Gate:draw()
  fx.draw("items/block_" .. self.color, self.x, self.y, { alpha = 1 - self.fade * 0.78, sx = 0.5 * (1 - self.fade * 0.1), sy = 0.5 * (1 - self.fade * 0.1) })
end
return Gate

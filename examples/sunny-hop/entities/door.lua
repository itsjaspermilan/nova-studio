-- A door, two tiles tall: shut (and solid) until a switch of its colour is pressed. Prop: color. Place it by its foot.
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local Door = nova.entity { sprite = "items/door_closed", sx = 0.5, sy = 0.5, pivot = { 0.5, 1 }, depth = 30, color = "blue", open = false }
function Door:create()
  self.solid = world.add_box({ x0 = self.x - 24, y0 = self.y - 96, x1 = self.x + 24, y1 = self.y, owner = self })
  run.on(function(what, color)
    if what == "switch" and color == self.color and self:is_alive() and not self.open then
      self.open = true
      self.solid.off = true
      audio.sfx("unlock", { pitch = 0.8 })
      fx.dust(self.x, self.y - 10, 8)
    end
  end)
end
function Door:draw()
  fx.draw(self.open and "items/door_open" or "items/door_closed", self.x, self.y - 48)
  -- a coloured lamp over the door says which switch opens it
  fx.draw("fx/glow", self.x, self.y - 108, { sx = 0.5, sy = 0.5, color = self.color == "blue" and { 90, 170, 255 } or self.color == "red" and { 255, 90, 100 } or self.color == "green" and { 90, 230, 120 } or { 255, 220, 80 } })
end
return Door

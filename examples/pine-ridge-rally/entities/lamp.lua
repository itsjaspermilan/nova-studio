-- A street lamp: a fixed piece of scenery like the rest (see prop.lua) that also gives the world a light to switch on
-- when a car is near. The arm of the model points along its +z, and the lamp head hangs about 1.7 m out.
local world = require("lib.world")

local Lamp = nova.entity { visible = false }

function Lamp:create()
  local ry, size = self.ry or 0, self.sx or 1
  world.add("lamp", self.x, self.y, self.z, ry, size)
  world.add_lamp(self.x + math.sin(ry) * 1.7, 5.6 * size, self.z + math.cos(ry) * 1.7)
  self:destroy()
end

return Lamp

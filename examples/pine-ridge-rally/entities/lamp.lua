-- A street lamp: scenery like the rest (see prop.lua), but it also gives the night circuit a light to switch on when a car is
-- near, so it is not `static`. The arm of the model points along its +z, and the lamp head hangs about 1.7 m out.
local lamps = require("lib.lamps")

local Lamp = nova.entity { visible = false }

function Lamp:create()
  local ry, size = self.ry or 0, self.sx or 1
  nova.scenery.add("lamp", self.x, self.y, self.z, { ry = ry, scale = size })
  lamps.add(self.x + math.sin(ry) * 1.7, 5.6 * size, self.z + math.cos(ry) * 1.7)
  self:destroy()
end

return Lamp

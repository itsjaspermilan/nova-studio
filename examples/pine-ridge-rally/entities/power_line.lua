-- A power line in free roam: its `pts` property lists its poles' places in order ([x, z] metres). lib/powerlines.lua turns the poles
-- along the line and strings the wires between them; scenes/roam.lua draws them near the camera.
local powerlines = require("lib.powerlines")

local PowerLine = nova.entity { visible = false }

function PowerLine:create()
  powerlines.add(self.pts or {})
  self:destroy()
end

return PowerLine

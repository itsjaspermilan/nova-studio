-- A fixed piece of scenery placed by a scene file (a tree, a road piece, a barrier...). It hands itself to the world,
-- which draws it only when it is near the camera, and then goes away: a circuit has thousands of these.
-- A scene object can set `ry` (turn, radians) and `sx` (size) in its properties.
local world = require("lib.world")

local Prop = nova.entity { visible = false }

function Prop:create()
  local model = getmetatable(self).__model
  world.add(model, self.x, self.y, self.z, self.ry or 0, self.sx or 1)
  self:destroy()
end

return Prop

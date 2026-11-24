-- A driveway's middle line and its yard from the scene file (tools/scene.mjs writes them from tools/layout.mjs DRIVES): the surface
-- under a wheel (gravel), where the ground lies a little under the road, and which road it joins (the autopilot follows that). Nothing is
-- drawn: the drive itself is part of the road network's model (models/road_valley.glb) that valley_ground draws.
local world = require("lib.world")

local Driveway = nova.entity { tags = { "driveway" } }

function Driveway:create()
  local y = self.yard
  world.add_drive({ id = self.key, label = self.label, surface = self.surface or "gravel", width = self.width or 3.4, joins = self.joins,
    points = self.points or {}, drive = true, yard = y and { x = y.at[1], z = y.at[2], r = y.radius } or nil })
  self:destroy()
end

return Driveway

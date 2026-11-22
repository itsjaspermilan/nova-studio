-- A road's middle line from the scene file (tools/scene.mjs writes its points): the map, the minimap, the van's surface and the
-- limits read it through lib/world.lua. Nothing is drawn; the road itself is the ribbon valley_ground draws.
local world = require("lib.world")

local Roadline = nova.entity { tags = { "roadline" } }

function Roadline:create()
  world.add_road({ id = self.key, label = self.label, surface = self.surface or "road", width = self.width or 5, points = self.points or {} })
  self:destroy()
end

return Roadline

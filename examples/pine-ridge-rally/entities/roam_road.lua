-- One road of free roam, all its points together (scenes/roam.scene.json): `route` its name, `road` its kind (road_asphalt, road_gravel...),
-- `grip` how much the tyres hold on it, `loop` whether it is a loop (a circuit), and `pts` its points in order, each [x, z, k] (k: how
-- sharply it turns there), with [.., w, road] where the half width or the kind of road differs from the road's own. lib/roads.lua keeps them.
local roads = require("lib.roads")

local RoamRoad = nova.entity { visible = false }

function RoamRoad:create()
  for i, p in ipairs(self.pts or {}) do
    local w = p[4] ~= 0 and p[4] or nil
    roads.add(self.route, i, p[1], p[2], p[3], w, p[5] or self.road, self.loop, self.grip)
  end
  self:destroy()
end

return RoamRoad

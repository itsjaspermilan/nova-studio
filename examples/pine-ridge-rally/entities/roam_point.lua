-- One point of a road in free roam (scenes/roam.scene.json): `route` is the road it belongs to, `i` its order along it, `k` how sharply
-- the road turns there, `loop` whether the road is a loop (a circuit), `road` its surface kind (road_asphalt, road_gravel...) and `grip`
-- how much the tyres hold on it (1 is dry tarmac; the course's own grip on a course).
-- lib/roads.lua joins them into roads.
local roads = require("lib.roads")

local RoamPoint = nova.entity { visible = false, i = 0, k = 0 }

function RoamPoint:create()
  roads.add(self.route, self.i, self.x, self.z, self.k, self.w, self.road, self.loop, self.grip)
  self:destroy()
end

return RoamPoint

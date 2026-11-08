-- One point of the racing line, placed along the circuit by the scene file. `i` is its order, `k` how sharply the road
-- turns there (so the other drivers know when to slow down); where a zone of the track changes the road, `w` is half its width in
-- metres (6 elsewhere) and `road` its kind (road_asphalt, road_gravel...: the course's own elsewhere).
local track = require("lib.track")

local Waypoint = nova.entity { visible = false, i = 0, k = 0 }

function Waypoint:create()
  track.add(self.i, self.x, self.z, self.k, self.w, self.road)
  self:destroy()
end

return Waypoint

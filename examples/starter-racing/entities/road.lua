-- The road: models/road_ring.glb (road_make), one ribbon through the checkpoint markers. It lies on the ground and casts no shadow.
local Road = nova.entity { model = "road_ring", static = true }

function Road:draw()
  nova.model("road_ring", 0, 0, 0, { shadow = false })
end

return Road

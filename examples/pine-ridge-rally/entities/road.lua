-- A course's road as a placed object: `model` names the road model (models/road_<course>.glb, the ribbon the track generator makes).
-- It is drawn every frame as it is (a road is one long model, so it is not scenery, which is drawn by the distance to its middle) and
-- casts no shadow. The track generator places one in each course's scene; the scene view shows it, lifted by the hills like the game.
local Road = nova.entity { tags = { "road" }, settings = {
  model = { "road_pine_ridge", type = "text", help = "The road model: models/road_<course>.glb, made by the track generator" },
} }

local opts = { shadow = false }
function Road:draw() nova.model(self.model, self.x, 0, self.z, opts) end

return Road

-- A course's road as a placed object: `model` names the road model (models/road_<course>.glb, the ribbon the track generator makes).
-- It is drawn every frame as it is (a road is one long model, so it is not scenery, which is drawn by the distance to its middle) and
-- casts no shadow. On a night course it is darkened (2026-11-08: under the moon it stayed a light grey all the way to the horizon,
-- brighter than the grass); the headlights and the street lamps still light it where they shine. The track generator places one in
-- each course's scene; the scene view shows it, lifted by the hills like the game.
local course = require("lib.course")

local Road = nova.entity { tags = { "road" }, settings = {
  model = { "road_pine_ridge", type = "text", help = "The road model: models/road_<course>.glb, made by the track generator" },
} }

local NIGHT = { 88, 94, 116 }
local opts = { shadow = false, tint = nil }
function Road:draw()
  if self.night == nil then
    local ok, c = pcall(course.current)
    self.night = ok and c.night and true or false
  end
  opts.tint = self.night and NIGHT or nil
  nova.model(self.model, self.x, 0, self.z, opts)
end

return Road

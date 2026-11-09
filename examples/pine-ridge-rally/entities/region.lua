-- A region of free roam (scenes/roam.scene.json): its town's middle, its `title` and its `look` (a course: its sky, sun, ground, weather).
local regions = require("lib.regions")

local Region = nova.entity { visible = false, settings = {
  title = { "Pine Ridge", help = "The region's name, shown at the top left as you drive into it" },
  look = { "pine_ridge", help = "The course whose sky, sun, ground and weather the region has" },
} }

function Region:create()
  regions.add({ x = self.x, z = self.z, title = self.title, look = self.look })
  self:destroy()
end

return Region

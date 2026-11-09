-- A square of water in free roam: `size` metres across, its surface at `level` metres (lib/water.lua draws it).
local water = require("lib.water")

local Water = nova.entity { visible = false, settings = {
  size = { 400, min = 10, help = "Metres across the square of water" },
  level = { 21, help = "The height of the water's surface, in metres" },
} }

function Water:create()
  water.add({ x = self.x, z = self.z, size = self.size, level = self.level })
  self:destroy()
end

return Water

-- A place on the starting grid. `slot` 1 is the front.
local grid = require("lib.grid")

local GridSlot = nova.entity { visible = false, slot = 1, ry = 0 }

function GridSlot:create()
  grid.add(self.slot, self.x, self.z, self.ry)
  self:destroy()
end

return GridSlot

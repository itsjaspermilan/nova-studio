-- A place on the starting grid, with its box painted on the road (models/grid_box). `slot` 1 is the front; a circuit has four, a stage one.
-- The scene editor shows the box where the car will stand (scripts/rally/grid.mjs lays them out behind the start line).
local grid = require("lib.grid")

local GridSlot = nova.entity { model = "grid_box", slot = 1, ry = 0 }

function GridSlot:create()
  grid.add(self.slot, self.x, self.z, self.ry)
  -- the painted box stays on the road as scenery (a hair above it, like the start line); the slot itself is only a place
  nova.scenery.add("grid_box", self.x, 0.035, self.z, { ry = self.ry })
  self:destroy()
end

return GridSlot

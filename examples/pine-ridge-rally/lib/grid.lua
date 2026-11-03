-- The starting grid, filled by `grid_slot` objects as a circuit is built.
local grid = { slots = {} }

function grid.clear() grid.slots = {} end
function grid.add(slot, x, z, heading) grid.slots[slot] = { x = x, z = z, heading = heading } end

return grid

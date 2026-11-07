-- The gates of a rally stage: each `section_gate` object in the stage's scene file gives its place here, and the race scene works out
-- from them how far along the stage each section ends.
local stage = {}

local gates = {}

function stage.clear() gates = {} end

function stage.add(order, x, z) gates[#gates + 1] = { order = order, x = x, z = z } end

-- The gates in order.
function stage.gates()
  table.sort(gates, function(a, b) return a.order < b.order end)
  return gates
end

return stage

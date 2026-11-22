-- The gates of a rally stage: each `section_gate` object in the stage's scene file gives its place here, and the race scene works out
-- from them how far along the stage each section ends.
local stage = {}

local gates = {}
local finish

function stage.clear() gates, finish = {}, nil end

-- A stage without gates (a made-up one, lib/generate.lua) says where its finish line is: the road runs on past it.
function stage.set_finish(x, z) finish = { x = x, z = z } end
function stage.finish() return finish end

function stage.add(order, x, z) gates[#gates + 1] = { order = order, x = x, z = z } end

-- The gates in order.
function stage.gates()
  table.sort(gates, function(a, b) return a.order < b.order end)
  return gates
end

return stage

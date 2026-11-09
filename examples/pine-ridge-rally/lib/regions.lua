-- The regions of free roam: each `region` object of the scene is a town with a name (`title`) and a look (`look`: the course whose sky,
-- sun, ground, weather and picture the region has). The region you are in is the one whose town is nearest.
local regions = {}

local list = {}
function regions.clear() list = {} end
function regions.add(r) list[#list + 1] = r end
function regions.all() return list end

function regions.at(x, z)
  local best, bd = nil, math.huge
  for _, r in ipairs(list) do
    local d = (r.x - x) ^ 2 + (r.z - z) ^ 2
    if d < bd then best, bd = r, d end
  end
  return best
end

return regions

-- The woods of free roam: each `woods` object of the scene is a patch of trees (`kinds`: the models; `trees`: for each tree [dx, dz,
-- which kind, turn in hundredths of a radian, size in hundredths], metres from the object). There are too many trees to make each an
-- object of its own (the scene would take too long to build), so the patches are kept here and planted as scenery a few at a time,
-- nearest the car first, by woods.plant_some() each frame. They are solid, like the courses' trees.
local woods = {}

local patches, next_patch = {}, 1
local opts = { ry = 0, scale = 1 }

function woods.clear() patches, next_patch = {}, 1 end
function woods.add(p) patches[#patches + 1] = p end

-- Puts the patches in order of distance from (x, z), nearest first.
function woods.start(x, z)
  table.sort(patches, function(a, b) return (a.x - x) ^ 2 + (a.z - z) ^ 2 < (b.x - x) ^ 2 + (b.z - z) ^ 2 end)
  next_patch = 1
end

function woods.plant_some()
  if next_patch > #patches then return end
  local t0 = nova.clock()
  local planted = 0
  while next_patch <= #patches do
    local p = patches[next_patch]
    for _, t in ipairs(p.trees) do
      opts.ry, opts.scale = (t[4] or 0) / 100, (t[5] or 100) / 100
      nova.scenery.add(p.kinds[(t[3] or 0) + 1], p.x + t[1], 0, p.z + t[2], opts)
      planted = planted + 1
    end
    next_patch = next_patch + 1
    if nova.clock() - t0 > 0.004 then return end
  end
  nova.log("roam: planted the woods")
end

return woods

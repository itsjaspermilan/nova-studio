-- Grass and flowers along the road, planted when a race starts: kept in Rust by nova.scenery.add, drawn only near the camera, and
-- bent by the wind (`nova.wind`). Planted a little each frame (a script that runs too long in one frame is stopped), so the verges
-- fill in over the first moments of the countdown. None of it is solid.
local track = require("lib.track")

local foliage = {}

local CELL = 16
local bins -- waypoints by 16 m square, to find the distance to the road cheaply
local plan, planted, next_point

local function key(cx, cz) return cx * 100003 + cz end

local function build_bins()
  bins = {}
  for i = 1, track.count() do
    local p = track.point(i)
    local k = key(math.floor(p.x / CELL), math.floor(p.z / CELL))
    local list = bins[k]
    if not list then list = {}; bins[k] = list end
    list[#list + 1] = p
  end
end

-- The distance from (x, z) to the nearest waypoint within about 16 m, or 99.
local function road_distance(x, z)
  local cx, cz = math.floor(x / CELL), math.floor(z / CELL)
  local best = 99 * 99
  for gx = cx - 1, cx + 1 do
    for gz = cz - 1, cz + 1 do
      local list = bins[key(gx, gz)]
      if list then
        for i = 1, #list do
          local p = list[i]
          local d = (p.x - x) ^ 2 + (p.z - z) ^ 2
          if d < best then best = d end
        end
      end
    end
  end
  return math.sqrt(best)
end

-- `look.foliage` is a list of { model, count, sway, tint, tint, ... }; `density` (0 to 1) scales the counts.
function foliage.start(look, density)
  plan, planted, next_point = nil, 0, 1
  if not look.foliage or density <= 0 then return end
  build_bins()
  plan = {}
  local n = track.count()
  for _, spec in ipairs(look.foliage) do
    local tints = {}
    for i = 4, #spec do tints[#tints + 1] = spec[i] end
    plan[#plan + 1] = { model = spec[1], per = spec[2] * density / n, sway = spec[3] or 0.5, tints = tints, carry = 0, opts = { ry = 0, scale = 1, sway = spec[3] or 0.5, max_distance = 55, shadow = false } }
  end
end

-- Call each frame: plants the verges beside a few more waypoints, stopping after a few milliseconds.
function foliage.plant_some()
  if not plan then return end
  local t0 = nova.clock()
  local n = track.count()
  while next_point <= n do
    local p = track.point(next_point)
    local nx, nz = p.tz, -p.tx
    for _, f in ipairs(plan) do
      f.carry = f.carry + f.per
      local o = f.opts
      while f.carry >= 1 do
        f.carry = f.carry - 1
        local side = math.random() < 0.5 and -1 or 1
        local off = side * (7.6 + math.random() ^ 1.6 * 22)
        local along = (math.random() - 0.5) * 9
        local x, z = p.x + nx * off + p.tx * along, p.z + nz * off + p.tz * along
        if road_distance(x, z) > 7.2 then
          o.ry, o.scale = math.random() * 6.28, 0.8 + math.random() * 0.7
          local tints = f.tints
          o.tint = #tints > 0 and tints[math.random(#tints)] or nil
          nova.scenery.add(f.model, x, 0, z, o)
          planted = planted + 1
        end
      end
    end
    next_point = next_point + 1
    if nova.clock() - t0 > 0.02 then return end
  end
  if next_point > n then
    nova.log("rally: planted " .. planted .. " tufts")
    plan = nil
  end
end

function foliage.clear() plan, bins = nil, nil end

return foliage

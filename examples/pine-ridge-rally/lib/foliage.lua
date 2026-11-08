-- Grass and flowers along the road, planted when a race starts: kept in Rust by nova.scenery.add, drawn only near the camera, and
-- bent by the wind (`nova.wind`). Planted a little each frame (a script that runs too long in one frame is stopped), so the verges
-- fill in over the first moments of the countdown. None of it is solid. What is planted, and how much, is the `plants` of the course
-- scene's `foliage` object (entities/foliage.lua); the spots are random, a scatter along the verges.
local track = require("lib.track")

local foliage = {}

local CELL = 16
local bins -- waypoints by 16 m square, to find the distance to the road cheaply
local plan, planted, next_point
local plants -- from the scene's foliage object

function foliage.set(list) plants = list end

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

-- Starts planting the scene's plants; `density` (0 to 1) scales the counts.
function foliage.start(density)
  plan, planted, next_point = nil, 0, 1
  if not plants or density <= 0 then return end
  build_bins()
  plan = {}
  local n = track.count()
  for _, spec in ipairs(plants) do
    local sway = spec.sway or 0.5
    plan[#plan + 1] = { model = spec.model, per = (spec.count or 0) * density / n, tints = spec.tints or {}, carry = 0, opts = { ry = 0, scale = 1, sway = sway, max_distance = 55, shadow = false } }
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

function foliage.clear() plan, bins, plants = nil, nil, nil end

return foliage

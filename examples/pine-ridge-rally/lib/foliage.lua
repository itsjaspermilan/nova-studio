-- Grass and flowers along the road, planted when a race starts: kept in Rust by nova.scenery.add, drawn only near the camera, and
-- bent by the wind (`nova.wind`). Planted a little each frame (a script that runs too long in one frame is stopped), so the verges
-- fill in over the first moments of the countdown. None of it is solid. What is planted, and how much, is the `plants` of the course
-- scene's `foliage` object (entities/foliage.lua); the spots are random, a scatter along the verges.
local track = require("lib.track")

local foliage = {}

local CELL = 16
local bins -- waypoints by 16 m square, to find the distance to the road cheaply
local plan, planted, next_point -- (`plan`: true while there is planting left to do)
local plants -- from the scene's foliage object
-- the road points the grass is planted beside: the race's route, or (free roam) every road's points (`foliage.start`'s `source`)
local src = { count = function() return track.count() end, point = function(i) return track.point(i) end }

function foliage.set(list) plants = list end

local function key(cx, cz) return cx * 100003 + cz end

local function build_bins()
  bins = {}
  for i = 1, src.count() do
    local p = src.point(i)
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

-- What is being planted: a list of jobs, each a list of road points (x, z, tx, tz) and the plan of what to put beside them.
local jobs, job

local function plan_of(list, density, n)
  local out = {}
  for _, spec in ipairs(list or {}) do
    out[#out + 1] = { model = spec.model, per = (spec.count or 0) * density / math.max(1, n), tints = spec.tints or {}, carry = 0,
                      opts = { ry = 0, scale = 1, sway = spec.sway or 0.5, max_distance = 55, shadow = false } }
  end
  return out
end

-- Starts planting the scene's plants beside the race's route (or `source`); `density` (0 to 1) scales the counts.
-- (`source`: { count = function, point = function(i) } giving points with x, z, tx, tz)
function foliage.start(density, source)
  src = source or { count = function() return track.count() end, point = function(i) return track.point(i) end }
  planted, jobs, job, plan = 0, {}, 1, nil
  if not plants or density <= 0 then return end
  local pts = {}
  for i = 1, src.count() do pts[i] = src.point(i) end
  foliage.start_sets(density, { { points = pts, plants = plants } })
end

-- Several sets at once (free roam: each course's roads with that course's own grass): `sets` is a list of { points, plants }, where
-- each plant's `count` is spread over that set's points.
function foliage.start_sets(density, sets)
  planted, jobs, job, next_point = 0, {}, 1, 1
  if density <= 0 then return end
  local all = {}
  for _, set in ipairs(sets) do
    for _, p in ipairs(set.points) do all[#all + 1] = p end
    jobs[#jobs + 1] = { pts = set.points, plan = plan_of(set.plants, density, #set.points) }
  end
  src = { count = function() return #all end, point = function(i) return all[i] end }
  build_bins()
  plan = true
end

-- Call each frame: plants the verges beside a few more road points, stopping after a few milliseconds.
function foliage.plant_some()
  if not plan then return end
  local t0 = nova.clock()
  while job <= #jobs do
    local j = jobs[job]
    while next_point <= #j.pts do
      local p = j.pts[next_point]
      local nx, nz = p.tz, -p.tx
      for _, f in ipairs(j.plan) do
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
    job, next_point = job + 1, 1
  end
  nova.log("rally: planted " .. planted .. " tufts")
  plan = nil
end

function foliage.clear() plan, bins, plants, jobs = nil, nil, nil, nil end

return foliage

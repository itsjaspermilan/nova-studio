-- How to drive a course fast: its racing line, and for a car the speed it can carry along that line. Worked out once per course
-- (the line) and once per car (its speeds), from the road's middle line and width (the scene's waypoints, lib/track.lua) and the car's
-- own numbers (lib/state.lua): the drivers of lib/race.lua follow them, and `racing.ideal_time` gives a course's ideal lap or stage
-- time for a car or a class (par times).
--
-- The line: the shape through the road that bends least (each point is pulled to halfway between its neighbours, again and again,
-- inside the road less a margin), so it swings out before a bend, clips the inside and runs out to the edge after it; a few versions
-- (a tighter or a looser pull, the apex a little later) are tried and the fastest kept.
-- The speeds: in a bend, what the tyres can hold (v² x bend = the car's grip, which grows a little with speed as it does in
-- entities/car.lua), then a pass forwards (what the engine can add from the bend before, gear by gear) and one backwards (what the
-- brakes can take off before the next bend), with the hills' pull on the way.
local state = require("lib.state")

local racing = {}

local SURFACE_LATERAL = { road = 24, dirt = 18, rough = 13 }   -- the sideways bite of each surface (entities/car.lua's SURFACE)
local SURFACE_HOLD = { road = 8.5, dirt = 5.2, rough = 3.6 }    -- how fast a sideways slide dies away on it (the same table's `grip`)
local MARGIN = 1.35          -- metres between the line (the car's middle) and the road's edge
local UPSHIFT = 0.94         -- (as entities/car.lua: a gear runs to this share of its top before the next)
-- The share of the car's corner grip and of its brakes the speed profile counts on at its best: the rest is room to steer and to
-- correct (a driver right at the limit slides, and a slide costs more than it gains). A weaker driver uses less (lib/race.lua).
racing.lateral, racing.braking = 0.86, 0.92

-- the road kind of a waypoint: asphalt is a road, the rest is loose (the same rule as lib/race.lua)
local function surface_of(road, course_surface)
  if road == nil then return course_surface or "road" end
  return road == "road_asphalt" and "road" or "dirt"
end

-- ---- the line ---------------------------------------------------------------------------------------------------------------------

-- `pts`: the road's middle, in order, each { x, z, w (half the width), road }; `open`: a stage (from the first point to the last).
-- `pull` (0 to 1) is how hard each point goes to its neighbours' middle, `late` how many points the apex is moved on.
local function make_line(pts, open, pull, late, rounds)
  local n = #pts
  local L = { n = n, open = open, x = {}, z = {}, o = {}, nx = {}, nz = {}, cx = {}, cz = {}, w = {}, lim = {} }
  for i = 1, n do
    local a = pts[open and math.max(1, i - 1) or ((i - 2) % n + 1)]
    local b = pts[open and math.min(n, i + 1) or (i % n + 1)]
    local tx, tz = b.x - a.x, b.z - a.z
    local len = math.max(1e-6, math.sqrt(tx * tx + tz * tz))
    tx, tz = tx / len, tz / len
    L.cx[i], L.cz[i] = pts[i].x, pts[i].z
    L.nx[i], L.nz[i] = tz, -tx                 -- the road's left (+x when it runs along +z), as lib/track.lua's `left`
    L.w[i] = pts[i].w or 6
    L.lim[i] = math.max(0, L.w[i] - MARGIN)
    L.o[i] = 0
  end
  local o, cx, cz, nx, nz, lim = L.o, L.cx, L.cz, L.nx, L.nz, L.lim
  for _ = 1, rounds do
    for i = 1, n do
      if not (open and (i == 1 or i == n)) then
        local a = open and i - 1 or ((i - 2) % n + 1)
        local b = open and i + 1 or (i % n + 1)
        local mx = (cx[a] + nx[a] * o[a] + cx[b] + nx[b] * o[b]) * 0.5
        local mz = (cz[a] + nz[a] * o[a] + cz[b] + nz[b] * o[b]) * 0.5
        local want = (mx - cx[i]) * nx[i] + (mz - cz[i]) * nz[i]
        local v = o[i] + (want - o[i]) * pull
        if v > lim[i] then v = lim[i] elseif v < -lim[i] then v = -lim[i] end
        o[i] = v
      end
    end
  end
  if late > 0 then
    -- the apex a little later: the line's shape moved on along the road (and kept inside it)
    local moved = {}
    for i = 1, n do
      local j = open and math.max(1, i - late) or ((i - 1 - late) % n + 1)
      local v = o[j]
      if v > lim[i] then v = lim[i] elseif v < -lim[i] then v = -lim[i] end
      moved[i] = v
    end
    L.o = moved
    o = moved
  end
  -- the line's points, its length to each, its heading and how sharply it bends (1 / radius; positive to the left)
  L.s, L.seg, L.k, L.heading = {}, {}, {}, {}
  for i = 1, n do L.x[i], L.z[i] = cx[i] + nx[i] * o[i], cz[i] + nz[i] * o[i] end
  local total = 0
  for i = 1, n do
    local b = open and math.min(n, i + 1) or (i % n + 1)
    local dx, dz = L.x[b] - L.x[i], L.z[b] - L.z[i]
    L.s[i] = total
    L.seg[i] = (open and i == n) and 0 or math.sqrt(dx * dx + dz * dz)
    total = total + L.seg[i]
  end
  L.length = total
  local raw = {}
  for i = 1, n do
    local a = open and math.max(1, i - 1) or ((i - 2) % n + 1)
    local b = open and math.min(n, i + 1) or (i % n + 1)
    local ax, az, bx, bz = L.x[i] - L.x[a], L.z[i] - L.z[a], L.x[b] - L.x[i], L.z[b] - L.z[i]
    local la, lb = math.sqrt(ax * ax + az * az), math.sqrt(bx * bx + bz * bz)
    local cx2, cz2 = L.x[b] - L.x[a], L.z[b] - L.z[a]
    local lc = math.sqrt(cx2 * cx2 + cz2 * cz2)
    local cross = az * bx - ax * bz   -- (positive when the line turns towards +x from +z: to the left)
    raw[i] = (la > 1e-3 and lb > 1e-3 and lc > 1e-3) and 2 * cross / (la * lb * lc) or 0
    L.heading[i] = math.atan(cx2, cz2)
  end
  -- (smoothed over its neighbours: the waypoints are ten metres apart and a little uneven)
  for i = 1, n do
    local a = open and math.max(1, i - 1) or ((i - 2) % n + 1)
    local b = open and math.min(n, i + 1) or (i % n + 1)
    L.k[i] = 0.25 * raw[a] + 0.5 * raw[i] + 0.25 * raw[b]
  end
  return L
end

-- ---- the car ----------------------------------------------------------------------------------------------------------------------

-- What the speed profile needs of a car: its entry of lib/state.lua (or a car entity's own numbers).
local function machine_of(c)
  return {
    power = c.power or 8, top = c.top or 44, gears = c.gears, grip = c.grip or c.grip_stat or 1, brake = (c.brake_power and c.brake_power / 30) or c.brake or 1,
    turn = c.turn or 1, loose = c.loose_stat or (type(c.loose) == "table" and c.loose) or { dirt = 1, rough_top = 0.5, rough_drag = 1, rough_grip = 1 },
  }
end

-- the engine's pull at speed `v` (m/s squared), in the gear the gearbox would be in, less what the air and the tyres take
local function pull_at(m, v)
  local gears = m.gears
  local push
  if gears then
    local g = #gears
    for j = 1, #gears do if v < gears[j].top * UPSHIFT then g = j; break end end
    local share = math.max(0, v) / gears[g].top
    push = share >= 1 and 0 or m.power * gears[g].pull * math.max(0, 1 - 0.6 * share * share)
  else
    push = m.power * math.max(0, 1 - (v / m.top) ^ 2)
  end
  push = push * 0.96 -- (the moments with the clutch in)
  local a = push - (1.1 + 0.055 * v)
  if v > m.top then a = math.min(a, -(v - m.top) * 1.5) end
  return a
end

-- The speeds of car `c` (an entry of lib/state.lua or a car entity) along line `L`: { v = { ... } } at each point, and the time to drive
-- it. `opts`: `grip` (the course's grip), `surface` (the course's own), `surfaces` (each point's), `slope` (each point's slope along
-- the line: the hills), `lateral` (the share of the tyres' grip used in a bend: 1 is all of it), `braking` (the share of the brakes),
-- `standing` (a stage: from a standstill at the first point).
function racing.speeds(L, c, opts)
  opts = opts or {}
  local m = machine_of(c)
  local n = L.n
  local lat_share, brake_share = opts.lateral or racing.lateral, opts.braking or racing.braking
  local course_grip = opts.grip or 1
  local v, hold = {}, {}
  for i = 1, n do
    local surf = (opts.surfaces and opts.surfaces[i]) or opts.surface or "road"
    local loose = surf == "dirt" and m.loose.dirt or (surf == "rough" and m.loose.rough_grip or 1)
    local base = (SURFACE_LATERAL[surf] or 24) * m.grip * course_grip * loose * m.turn * lat_share
    hold[i] = (SURFACE_HOLD[surf] or 8.5) * m.grip * course_grip * loose
    local k = math.abs(L.k[i])
    local vmax = m.top * 1.02
    if k > 1e-4 then
      -- v² k = base x (1 + v / 70, at most 1.6): solved by trying (the grip grows with speed)
      local s = math.sqrt(base / k)
      for _ = 1, 4 do s = math.sqrt(base * (1 + math.min(0.6, s / 70)) / k) end
      -- and the steering's own limit: a turn rate of at most 2.5 (per second, scaled by `turn`)
      s = math.min(s, 2.5 * m.turn * lat_share / k)
      vmax = math.min(vmax, s)
    end
    v[i] = math.max(4, vmax)
  end
  local slope = opts.slope
  local open = L.open
  local brake = 30 * m.brake * brake_share
  -- forwards: what the engine can add (round twice on a circuit, so the start line's speed is a flying lap's)
  local rounds = open and 1 or 2
  local fwd = {}
  for i = 1, n do fwd[i] = v[i] end
  if open and opts.standing then fwd[1] = 0 end
  for r = 1, rounds do
    for i = 1, n do
      local b = open and i + 1 or (i % n + 1)
      if not (open and i == n) then
        -- (a car turning slides a little sideways, and the slide costs speed: about (v² bend)² / (grip x v))
        local u = fwd[i]
        local a_lat = u * u * math.abs(L.k[i])
        local a = pull_at(m, u) - (slope and slope[i] or 0) * 7.5 - a_lat * a_lat / (hold[i] * (1 + math.min(0.6, u / 70)) * math.max(u, 5))
        local reach = math.sqrt(math.max(0, fwd[i] * fwd[i] + 2 * a * L.seg[i]))
        if reach < fwd[b] or (r == rounds and reach < v[b]) then fwd[b] = math.min(v[b], reach) end
      end
    end
  end
  -- backwards: what the brakes can take off before each slower point
  local out = {}
  for i = 1, n do out[i] = fwd[i] end
  for r = 1, rounds do
    for j = n, 1, -1 do
      local b = open and j + 1 or (j % n + 1)
      if not (open and j == n) then
        local d = brake + 1.1 + 0.055 * out[b] + (slope and slope[j] or 0) * 7.5
        local reach = math.sqrt(out[b] * out[b] + 2 * math.max(2, d) * L.seg[j])
        if reach < out[j] then out[j] = reach end
      end
    end
  end
  local t = 0
  for i = 1, n do
    if not (open and i == n) then
      local b = open and i + 1 or (i % n + 1)
      t = t + L.seg[i] / math.max(1, (out[i] + out[b]) / 2)
    end
  end
  return { v = out, time = t }
end

-- ---- a course ---------------------------------------------------------------------------------------------------------------------

-- The line of a course from its middle points, the fastest of a few for car `c`. Returns the line, and the speeds of `c` on it.
function racing.build(pts, open, c, opts)
  local best, best_speeds
  for _, try in ipairs({ { 0.5, 0, 60 }, { 0.5, 0, 220 }, { 0.5, 1, 220 }, { 0.35, 1, 120 } }) do
    local L = make_line(pts, open, try[1], try[2], try[3])
    local o = {}
    for k, val in pairs(opts or {}) do o[k] = val end
    if opts and opts.slope_of then o.slope = opts.slope_of(L) end
    local sp = racing.speeds(L, c, o)
    if not best or sp.time < best_speeds.time then best, best_speeds = L, sp end
  end
  return best, best_speeds
end

-- The line of the course being raced (lib/track.lua's waypoints), made once and kept until the course changes.
local current, current_key
function racing.line()
  local track = require("lib.track")
  local key = tostring(track.count()) .. ":" .. tostring(track.length) .. ":" .. tostring(track.open)
  if current and current_key == key then return current end
  local course = require("lib.course").current()
  local pts, surfaces = {}, {}
  for i = 1, track.count() do
    local p = track.point(i)
    pts[i] = { x = p.x, z = p.z, w = p.w, road = p.road }
    surfaces[i] = surface_of(p.road, course.surface)
  end
  local reference = state.current_car()
  local opts = racing.course_opts(course, surfaces, true)
  current = racing.build(pts, track.open, reference, opts)
  current.surfaces, current.opts = surfaces, opts
  current_key = key
  return current
end
function racing.clear() current, current_key = nil, nil end

-- The options of the speed profile for a course: its grip and surface, each point's surface and, when `hills`, the slope of the
-- hills along the line (only for the course whose hills are up: nova.terrain is the one being raced).
function racing.course_opts(course, surfaces, hills)
  local opts = { grip = course.grip or 1, surface = course.surface or "road", surfaces = surfaces }
  if hills then
    opts.slope_of = function(L)
      local slope = {}
      for i = 1, L.n do
        local gx, gz = nova.terrain_slope(L.x[i], L.z[i])
        slope[i] = gx * math.sin(L.heading[i]) + gz * math.cos(L.heading[i])
      end
      return slope
    end
  end
  return opts
end

-- The ideal time of a lap (a circuit, flying) or of a whole stage (from a standstill) of course `id` in a car: a car's id
-- ("car_gt"), a class ("sport", "everyday": the first car of that class in lib/state.lua) or an entry of state.cars. The driving it
-- assumes is at the limit of the speed profile (all of its corner grip that the drivers use, `lateral` 0.86, and the brakes at 0.92);
-- the hills count only when `id` is the course being raced (its hills are up). Reads the course's scene file, so it works from a menu.
-- For par times: a fair target is this times a margin (the drivers of lib/race.lua at their best finish within a few per cent of it).
function racing.ideal_time(id, car)
  local c = car
  if type(car) == "string" then
    c = nil
    for _, entry in ipairs(state.cars) do
      if entry.id == car or (not c and entry.class == car) then c = entry end
      if entry.id == car then break end
    end
    assert(c, "racing.ideal_time: no car or class " .. car)
  end
  local course = require("lib.course").of(id)
  local data = nova.scene_data(id)
  local pts = {}
  for _, o in ipairs(data.objects or {}) do
    if o.kind == "waypoint" then
      local p = o.props or {}
      pts[#pts + 1] = { order = p.i or 0, x = o.x, z = o.z, w = p.w or 6, road = p.road }
    end
  end
  table.sort(pts, function(a, b) return a.order < b.order end)
  assert(#pts > 10, "racing.ideal_time: " .. id .. " has no waypoints")
  local surfaces = {}
  for i, p in ipairs(pts) do surfaces[i] = surface_of(p.road, course.surface) end
  local open = course.stage and true or false
  local live = false
  local ok, cur = pcall(function() return require("lib.course").current() end)
  if ok and cur and nova.scene_now() and nova.scene_now().stage ~= nil and require("lib.track").count() == #pts then live = true end
  local opts = racing.course_opts(course, surfaces, live)
  opts.standing = open
  local _, sp = racing.build(pts, open, c, opts)
  return sp.time
end

-- ---- where a car is on the line ---------------------------------------------------------------------------------------------------

-- The line's offset from the road's middle, its heading and its bend at distance `s` along the road (lib/track.lua's distance), blended
-- between the points either side; and the index of the point before it.
function racing.at(L, i, frac)
  local n = L.n
  local b = L.open and math.min(n, i + 1) or (i % n + 1)
  local f = math.max(0, math.min(1, frac))
  local dh = L.heading[b] - L.heading[i]
  if dh > math.pi then dh = dh - 2 * math.pi elseif dh < -math.pi then dh = dh + 2 * math.pi end
  return L.o[i] + (L.o[b] - L.o[i]) * f, L.heading[i] + dh * f, L.k[i] + (L.k[b] - L.k[i]) * f, b
end

return racing

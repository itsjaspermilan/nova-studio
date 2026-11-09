-- Traffic in free roam: everyday cars driving the highways and the ring road at an easy pace, both ways, each in its lane (on the right
-- of the road for its way). They are not driven by the car physics: each keeps a place along its road (`s`, metres) and a speed, slows
-- behind the car ahead in its lane and for the player in front of it, and stops a moment when hit. At the end of its road it comes back
-- on at the start of another road, out of sight of the player. The player's car bumps off them (they are heavy: they do not move).
local roads = require("lib.roads")

local traffic = {}

local MODELS = { "car_sedan", "car_taxi", "car_van", "car_pickup", "car_suv", "car_suvl" }
local PER_ROAD = 8                 -- cars on each highway and ring road, half each way
local LANE = 2.4                   -- metres from the middle of the road to the middle of a lane
local GAP = 16                     -- metres kept to the car ahead
local SPEED_MIN, SPEED_MAX = 14, 19 -- m/s (50 to 68 km/h)
local DRAW_FAR = 260
local OUT_OF_SIGHT = 320           -- metres from the player a car comes back on
local R = 0.95                     -- (each car touches as two circles, 1 m either side of its middle, as in a race)

local cars = {}
local road_list = {}
local seed = 11
local function rand() seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 end

-- the place, the way and the heading of a car at its `s`, keeping its point index current
local function place(c)
  local pts = c.road.pts
  local n = #pts
  while c.i < n - 1 and pts[c.i + 1].s <= c.s do c.i = c.i + 1 end
  while c.i > 1 and pts[c.i].s > c.s do c.i = c.i - 1 end
  local a, b = pts[c.i], pts[c.i + 1]
  local len = math.max(1e-3, b.s - a.s)
  local t = math.max(0, math.min(1, (c.s - a.s) / len))
  local tx, tz = (b.x - a.x) / len, (b.z - a.z) / len
  local d = c.dir
  -- the lane: right of the middle, for the way the car goes
  c.x = a.x + (b.x - a.x) * t + d * -tz * LANE
  c.z = a.z + (b.z - a.z) * t + d * tx * LANE
  c.heading = math.atan(tx * d, tz * d)
  c.tx, c.tz = tx * d, tz * d
end

local function put_on(c, road, s, dir)
  c.road, c.s, c.dir, c.i = road, s, dir, 1
  c.speed = c.cruise
  place(c)
end

function traffic.clear() cars, road_list = {}, {} end

--- Puts the traffic on the roads; `px, pz` where the player starts (no car starts within 60 m of it).
function traffic.start(px, pz)
  traffic.clear()
  for _, name in ipairs(roads.names()) do
    if name:match("^roam_hw_") or name:match("^roam_ring_") then
      local rt = roads.route(name)
      if rt and #rt.pts > 20 then road_list[#road_list + 1] = rt end
    end
  end
  for _, rt in ipairs(road_list) do
    for k = 1, PER_ROAD do
      local c = { model = MODELS[math.floor(rand() * #MODELS) + 1], cruise = SPEED_MIN + rand() * (SPEED_MAX - SPEED_MIN), wait = 0 }
      c.opts = { ry = 0 }
      local dir = (k % 2 == 0) and -1 or 1
      local s = (k - 1 + rand() * 0.6) / PER_ROAD * rt.length
      put_on(c, rt, math.max(20, math.min(rt.length - 20, s)), dir)
      if (c.x - px) ^ 2 + (c.z - pz) ^ 2 < 60 * 60 then put_on(c, rt, (s + rt.length / 2) % rt.length, dir) end
      cars[#cars + 1] = c
    end
  end
  traffic.logged = false
end

-- a car at the end of its road: back on at the start of another, far from the player
local function come_back(c, p)
  for _ = 1, 8 do
    local rt = road_list[math.floor(rand() * #road_list) + 1]
    local dir = rand() < 0.5 and 1 or -1
    local s = dir == 1 and 15 or rt.length - 15
    put_on(c, rt, s, dir)
    if (c.x - p.x) ^ 2 + (c.z - p.z) ^ 2 > OUT_OF_SIGHT * OUT_OF_SIGHT then return end
  end
end

--- Moves the traffic and bumps the player's car `p` off any it touches.
function traffic.update(p, dt)
  if not traffic.logged then
    traffic.logged = true
    nova.log(string.format("traffic: %d cars on %d roads", #cars, #road_list))
  end
  for _, c in ipairs(cars) do
    -- how fast it wants to go: its own pace, slower behind the car ahead (same road, same way) or the player in its lane ahead
    local want = c.cruise
    if c.wait > 0 then c.wait = c.wait - dt; want = 0 end
    for _, o in ipairs(cars) do
      if o ~= c and o.road == c.road and o.dir == c.dir then
        local ahead = (o.s - c.s) * c.dir
        if ahead > 0 and ahead < GAP * 2 then want = math.min(want, o.speed * math.max(0, (ahead - GAP) / GAP)) end
      end
    end
    local dx, dz = p.x - c.x, p.z - c.z
    local ahead = dx * c.tx + dz * c.tz
    local side = math.abs(dx * c.tz - dz * c.tx)
    if ahead > 0 and ahead < GAP * 2 and side < 2.5 then want = math.min(want, math.max(0, (ahead - 7) / GAP) * c.cruise) end
    c.speed = c.speed + math.max(-8 * dt, math.min(3 * dt, want - c.speed))
    c.s = c.s + c.speed * dt * c.dir
    if c.s < 2 or c.s > c.road.length - 2 then come_back(c, p) else place(c) end
    -- the player's car against this one
    if (p.x - c.x) ^ 2 + (p.z - c.z) ^ 2 < 36 then
      local ps, pc, cs, cc = math.sin(p.heading), math.cos(p.heading), c.tx, c.tz
      for ka = -1, 1, 2 do
        for kb = -1, 1, 2 do
          local ex, ez = (p.x + ps * ka) - (c.x + cs * kb), (p.z + pc * ka) - (c.z + cc * kb)
          local d2 = ex * ex + ez * ez
          if d2 < (2 * R) ^ 2 then
            local d = math.max(0.01, math.sqrt(d2))
            local nx, nz = ex / d, ez / d
            p.x, p.z = p.x + nx * (2 * R - d), p.z + nz * (2 * R - d)
            local rel = (p.velx - c.tx * c.speed) * nx + (p.velz - c.tz * c.speed) * nz
            if rel < 0 then
              p.velx, p.velz = p.velx - nx * rel * 1.3, p.velz - nz * rel * 1.3
              if rel < -1.5 and (c.wait <= 0.5) then
                p.hit = math.min(1, -rel / 8)
                c.wait = 2
                nova.log("traffic: bumped a " .. c.model)
              end
            end
          end
        end
      end
    end
  end
end

function traffic.draw(cx, cz)
  local far2 = DRAW_FAR * DRAW_FAR
  for _, c in ipairs(cars) do
    if (c.x - cx) ^ 2 + (c.z - cz) ^ 2 < far2 then
      c.opts.ry = c.heading
      nova.model(c.model, c.x, 0, c.z, c.opts)
    end
  end
end

function traffic.count() return #cars end
traffic.cars = function() return cars end

return traffic

-- How long a made-up course (lib/generate.lua) should take: its gold, silver and bronze times for a car. Each is the course's ideal time
-- for that car (lib/racing.lua: the car's speed profile along the racing line, with the hills) times a margin. The margins were measured,
-- not guessed: the game's own drivers (the computer at its best, and the three rivals on Normal) drove 36 made-up courses of every length,
-- complexity and surface, and their times were compared with the ideal (crates/nova-runtime/tests/rally.rs, `generated_course_times`;
-- the table and the reasoning are in docs/target-times.md). Gold is about the best rival's pace, silver a decent run, bronze a finish
-- without big mistakes.
local racing = require("lib.racing")

local targets = {}

-- the margins over the ideal: a base, plus a share for each hairpin-class bend a kilometre, plus a share on loose ground
targets.MARGIN = {
  gold = { base = 1.05, per_bend = 0.002, loose = 0.02 },
  silver = { base = 1.11, per_bend = 0.003, loose = 0.03 },
  bronze = { base = 1.22, per_bend = 0.004, loose = 0.04 },
}
-- a circuit is raced from a standing start: the first lap's start costs about this many seconds over a flying lap
targets.START = 2.5

local cache = {}

-- The ideal time of course `entry` (a menu entry with `generated` settings) in car `car` (an entry of state.cars): the whole stage from a
-- standstill, or all the laps of a circuit race. Also the ideal time of each section of a stage (the speeds along the line, summed to
-- each gate). Kept per course and car.
function targets.ideal(entry, car)
  local key = entry.code .. ":" .. car.id
  if cache[key] then return cache[key] end
  local generate = require("lib.generate")
  local course = generate.course(entry.generated)
  local lap, line, sp = racing.ideal_time(course, car)
  local out = { lap = lap }
  if course.open then
    out.total = lap
    -- each section: the time from the start line to its gate along the line (the gates are on the waypoints)
    local t, at = { [1] = 0 }, 1
    for i = 1, line.n - 1 do
      t[i + 1] = t[i] + line.seg[i] / math.max(1, (sp.v[i] + sp.v[i + 1]) / 2)
    end
    out.sections = {}
    local before = 0
    for k, g in ipairs(course.gates) do
      local best, bi = 1e18, 1
      for i, w in ipairs(course.route.wps) do
        local d = (w.x - g.x) * (w.x - g.x) + (w.z - g.z) * (w.z - g.z)
        if d < best then best, bi = d, i end
      end
      at = bi
      out.sections[k] = t[at] - before
      before = t[at]
    end
  else
    out.total = lap * course.laps + targets.START
  end
  cache[key] = out
  return out
end

-- How hard the course is for the margins: its tight bends a kilometre, and whether it is loose (gravel, sand, snow) for most of it.
local function hardness(entry)
  local course = require("lib.generate").course(entry.generated)
  local route = course.route
  local tight = 0
  for _, w in ipairs(route.wps) do if math.abs(w.k) > 0.03 then tight = tight + 1 end end
  local loose_wps = 0
  for _, w in ipairs(route.wps) do
    local road = w.road or course.road
    if road ~= "road_asphalt" then loose_wps = loose_wps + 1 end
  end
  return tight / 3 / math.max(0.5, route.length / 1000), loose_wps / math.max(1, #route.wps)
end

-- The three targets of course `entry` in car `car`: { ideal, gold, silver, bronze } in seconds (rounded to tenths).
function targets.of(entry, car)
  local ideal = targets.ideal(entry, car).total
  local bends, loose = hardness(entry)
  local out = { ideal = ideal }
  for _, medal in ipairs({ "gold", "silver", "bronze" }) do
    local m = targets.MARGIN[medal]
    out[medal] = math.floor(ideal * (m.base + m.per_bend * bends + m.loose * loose) * 10 + 0.5) / 10
  end
  return out
end

-- 3 for gold, 2 silver, 1 bronze, 0 none
function targets.medal(time, t)
  if not time then return 0 end
  if time <= t.gold then return 3 elseif time <= t.silver then return 2 elseif time <= t.bronze then return 1 end
  return 0
end
targets.NAMES = { [0] = "No medal", "Bronze", "Silver", "Gold" }
targets.COLORS = { [0] = { 169, 180, 191 }, { 205, 127, 50 }, { 200, 208, 216 }, { 255, 210, 63 } }

return targets

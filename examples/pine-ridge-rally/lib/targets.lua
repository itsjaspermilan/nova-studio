-- How long a made-up course (lib/generate.lua) should take: its gold, silver and bronze times for a car. Each is the course's ideal time
-- for that car (lib/racing.lua: the car's speed profile along the racing line, with the hills) times a margin. The margins were measured,
-- not guessed: the game's own drivers (the computer at its best, and the three rivals on Normal) drove 36 made-up courses of every length,
-- complexity and surface, and their times were compared with the ideal (crates/nova-runtime/tests/rally.rs, `generated_course_times`;
-- the table and the reasoning are in docs/target-times.md). Gold is about the best rival's pace (Mika's mean), silver a decent run
-- (Dax's mean), bronze a finish without big mistakes (the slowest rival on a bad day, plus 3%). The ideal already grows with the length,
-- the bends, the hills and the grip, so the margins depend only on what the data said they depend on: a stage or a circuit (a circuit's
-- laps are raced from a standing start, with more time lost at each of its corners) and the class of car (a 4x4 drives nearer its
-- ideal than a road car). The number of tight bends a kilometre and the surface made no difference worth a term.
local racing = require("lib.racing")

local targets = {}

-- the margins over the ideal, by the kind of course and the car's class
targets.MARGIN = {
  stage = { sport = { gold = 1.045, silver = 1.065, bronze = 1.13 }, everyday = { gold = 1.015, silver = 1.03, bronze = 1.10 } },
  circuit = { sport = { gold = 1.07, silver = 1.09, bronze = 1.16 }, everyday = { gold = 1.055, silver = 1.08, bronze = 1.165 } },
}
-- a circuit is raced from a standing start: the first lap's start costs about this many seconds over a flying lap
targets.START = 2.5

local cache = {}

-- The ideal time of course `entry` (a menu entry with `generated` settings) in car `car` (an entry of state.cars): the whole stage from a
-- standstill, or all the laps of a circuit race. Kept per course and car. (A stage's sections and their targets are lib/sections.lua's,
-- worked out in the race.)
function targets.ideal(entry, car)
  local key = entry.code .. ":" .. car.id
  if cache[key] then return cache[key] end
  local generate = require("lib.generate")
  local course = generate.course(entry.generated)
  local lap = racing.ideal_time(course, car)
  local out = { lap = lap, stage = course.open }
  out.total = course.open and lap or (lap * course.laps + targets.START)
  cache[key] = out
  return out
end

-- The three targets of course `entry` in car `car`: { ideal, gold, silver, bronze } in seconds (rounded to tenths).
-- (`laps`: a circuit raced over other laps than its own)
function targets.of(entry, car, laps)
  local i = targets.ideal(entry, car)
  local ideal = (laps and not i.stage) and (i.lap * laps + targets.START) or i.total
  local m = targets.MARGIN[i.stage and "stage" or "circuit"][car.class] or targets.MARGIN.stage.sport
  local out = { ideal = ideal }
  for _, medal in ipairs({ "gold", "silver", "bronze" }) do out[medal] = math.floor(ideal * m[medal] * 10 + 0.5) / 10 end
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

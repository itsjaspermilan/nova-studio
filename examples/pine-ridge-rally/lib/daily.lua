-- The Daily Race: one course a day, the same for everyone, made from the date in Ontario (Toronto's clock, with its summer time), and
-- the results of each day the player drove (saved). The date is worked out here from the device's UTC clock (nova.utc): Canada's rule
-- is daylight time from the second Sunday of March at 2:00 to the first Sunday of November at 2:00 (UTC -4), standard time otherwise
-- (UTC -5). A device whose clock is wrong simply gets that date's race.
local generate = require("lib.generate")
local state = require("lib.state")

local daily = {}

daily.FIRST = { 2026, 11, 21 } -- the first Daily Race (the day it shipped): Daily #1
daily.fake_now = nil           -- (tests, and the pictures: a UTC time to use instead of the clock)

function daily.now() return daily.fake_now or nova.utc() end

-- days since 1970-01-01 of a date, and the date of such a day (Howard Hinnant's sums, integers only)
function daily.days(y, m, d)
  y = m <= 2 and y - 1 or y
  local era = (y >= 0 and y or y - 399) // 400
  local yoe = y - era * 400
  local doy = (153 * (m > 2 and m - 3 or m + 9) + 2) // 5 + d - 1
  local doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
  return era * 146097 + doe - 719468
end
function daily.date(z)
  z = z + 719468
  local era = (z >= 0 and z or z - 146096) // 146097
  local doe = z - era * 146097
  local yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
  local doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
  local mp = (5 * doy + 2) // 153
  local d = doy - (153 * mp + 2) // 5 + 1
  local m = mp < 10 and mp + 3 or mp - 9
  local y = yoe + era * 400
  return m <= 2 and y + 1 or y, m, d
end
-- 0 is Sunday (1970-01-01 was a Thursday)
function daily.weekday(z) return (z + 4) % 7 end
local function nth_sunday(y, m, nth)
  local first = daily.days(y, m, 1)
  return first + (7 - daily.weekday(first)) % 7 + 7 * (nth - 1)
end

-- Toronto's offset from UTC (seconds) at the UTC moment `t`
function daily.offset(t)
  local y = daily.date(t // 86400)
  local from = nth_sunday(y, 3, 2) * 86400 + 7 * 3600 -- 2:00 EST is 7:00 UTC
  local to = nth_sunday(y, 11, 1) * 86400 + 6 * 3600  -- 2:00 EDT is 6:00 UTC
  if t >= from and t < to then return -4 * 3600 end
  return -5 * 3600
end

-- The day in Toronto at UTC moment `t` (now when left out): its number of days since 1970 and its date.
function daily.day_at(t)
  t = t or daily.now()
  local z = (t + daily.offset(t)) // 86400
  return z, daily.date(z)
end
-- "2026-11-21"
function daily.key(z) local y, m, d = daily.date(z) return string.format("%04d-%02d-%02d", y, m, d) end
function daily.first_day() return daily.days(daily.FIRST[1], daily.FIRST[2], daily.FIRST[3]) end
-- Daily #1 is the first day
function daily.number(z) return z - daily.first_day() + 1 end

-- Seconds from UTC moment `t` to the next midnight in Toronto (when the next race appears).
function daily.until_next(t)
  t = t or daily.now()
  local off = daily.offset(t)
  local midnight_local = ((t + off) // 86400 + 1) * 86400
  -- (the offset at that midnight: the clocks change at 2:00, never at midnight, so the one in force an hour before it)
  local at = daily.offset(midnight_local - off - 3600)
  return midnight_local - at - t
end

local WEEKDAYS = { "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" }
local MONTHS = { "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" }
daily.WEEKDAYS, daily.MONTHS = WEEKDAYS, MONTHS
-- "Saturday 21 November 2026"
function daily.long_date(z)
  local y, m, d = daily.date(z)
  return string.format("%s %d %s %d", WEEKDAYS[daily.weekday(z) + 1], d, MONTHS[m], y)
end
-- "5:03:09"
function daily.clock_text(seconds)
  seconds = math.max(0, math.floor(seconds))
  return string.format("%d:%02d:%02d", seconds // 3600, (seconds // 60) % 60, seconds % 60)
end

-- The day's course: every setting and the seed from a hash of the date, so that days differ in kind; and the day's car (one car for
-- everyone, so that times compare). Returns the settings and the car's entry in state.cars.
local function weighted(r, weights)
  local total = 0
  for _, w in ipairs(weights) do total = total + w end
  local x = r() * total
  for i, w in ipairs(weights) do
    x = x - w
    if x < 0 then return i end
  end
  return #weights
end
function daily.settings(z)
  local r = generate.rng(generate.hash("pine-ridge-daily:" .. daily.key(z)))
  local s = generate.settings_default()
  s.location = r:int(#generate.LOCATIONS)
  s.type = r() < 0.65 and 1 or 2
  s.length = weighted(r, { 30, 40, 22, 8 })
  s.complexity = r:int(3)
  s.hills = weighted(r, { 25, 45, 30 })
  s.surface = weighted(r, { 60, 20, 20 })
  s.time = weighted(r, { 60, 25, 15 })
  s.weather = r() < 0.5 and 2 or 1
  s.seed = r:int(generate.SEEDS) - 1
  generate.normalise(s)
  -- the car: a road car on most days, a 4x4 on a third of them (more often on loose and snowy roads), the same for everyone
  local loose = s.surface ~= 2 and generate.LOCATIONS[s.location].road ~= "road_asphalt"
  local class = r() < (loose and 0.45 or 0.25) and "everyday" or "sport"
  local pool = {}
  for _, c in ipairs(state.cars) do if c.class == class then pool[#pool + 1] = c end end
  local car = pool[r:int(#pool)]
  return s, car
end

-- The menus' entry for day `z`'s race (state.custom while it is driven).
function daily.entry(z)
  local s, car = daily.settings(z)
  local e = generate.entry(s, { daily = daily.key(z), day = z, car = car.id })
  e.id = "daily_" .. daily.key(z):gsub("-", "")
  e.name = "Daily #" .. daily.number(z)
  return e
end

-- ---- results (saved: "daily" = { ["2026-11-21"] = { time = seconds, medal = 0..3, runs = n } }) ----------------------------------------
function daily.result(z) return (nova.save.get("daily", {}))[daily.key(z)] end
-- Records a finished run of day `z`: its time and medal (3 gold, 2 silver, 1 bronze, 0 none). Returns true for a new best.
function daily.record(z, time, medal)
  local all = nova.save.get("daily", {})
  local key = daily.key(z)
  local old = all[key]
  local best = not old or not old.time or time < old.time
  all[key] = { time = best and time or old.time, medal = math.max(medal, old and old.medal or 0), runs = (old and old.runs or 0) + 1 }
  nova.save.set("daily", all)
  return best
end

return daily

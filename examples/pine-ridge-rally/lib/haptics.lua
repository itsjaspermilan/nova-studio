-- What the car feels through the controller: the road under the tyres, bumps, knocks, the start lights and the finish.
-- Everything goes through here, so that the strengths are in one place and Options' VIBRATION turns all of it off.
--
-- The handheld's motor takes one buzz at a time (a new one replaces the one before), so a steady feeling, such as
-- gravel, is a train of short pulses that overlap a little; a knock or a signal wins over it while it lasts.
local state = require("lib.state")

local haptics = {}

local PULSE = 0.07          -- seconds between the pulses of a steady rumble
local PULSE_LONG = 0.10     -- how long each pulse lasts (a little longer than the gap, so that they join up)
-- how strongly each surface shakes at full speed (a little of it even when slow), and how much it varies pulse to pulse
-- (a whole race on a dirt course is spent on "dirt", so it is a gentle texture, not a buzz)
local SURFACE = {
  loose = { 0.05, 0.12, 0.04 },  -- a gravel, sand or snow road
  dirt = { 0.06, 0.14, 0.05 },   -- a dirt road
  rough = { 0.25, 0.40, 0.15 },  -- off the track: grass, stones, ruts
}
local SLIDE = 0.10          -- added while the tyres are sliding
local THUMP_GAP = 0.4       -- seconds between two thumps (a car that weaves along the edge does not drum)

local clock, next_pulse, busy_until, last_thump = 0, 0, 0, -1
local last_surface = nil
local queue = {}            -- signals waiting for their moment: { at, strong, weak, seconds }

local function buzz(strong, weak, seconds)
  nova.input.rumble { strong = math.min(1, strong), weak = math.min(1, weak), seconds = seconds }
end

-- A signal that wins over the road's rumble for as long as it lasts.
local function signal(strong, weak, seconds)
  buzz(strong, weak, seconds)
  busy_until = clock + seconds
end

-- A new race: nothing waiting, nothing remembered from the last one.
function haptics.reset()
  clock, next_pulse, busy_until, last_thump = 0, 0, 0, -1
  last_surface, queue = nil, {}
end

-- One of the race's moments: "light" (a start light), "go", "finish", or "hit" with how hard (0 to 1).
function haptics.event(kind, amount)
  if not state.vibration then return end
  if kind == "light" then
    signal(0.30, 0.20, 0.08)
  elseif kind == "go" then
    signal(0.75, 0.50, 0.22)
  elseif kind == "finish" then
    -- two beats, like a flag waved twice
    signal(0.80, 0.55, 0.16)
    queue[#queue + 1] = { at = clock + 0.32, strong = 0.65, weak = 0.45, seconds = 0.28 }
  elseif kind == "hit" then
    local hit = amount or 0.5
    signal(hit * 1.2, hit, 0.12 + 0.2 * hit)
  end
end

-- Every frame, for the player's car: `live` is false before GO!, after the finish and while paused (the road goes still).
function haptics.drive(car, dt, live)
  clock = clock + dt
  for i = #queue, 1, -1 do
    local q = queue[i]
    if clock >= q.at then
      table.remove(queue, i)
      if state.vibration then signal(q.strong, q.weak, q.seconds) end
    end
  end
  if not (state.vibration and live and car) then
    last_surface = nil
    return
  end
  local speed = math.abs(car.speed or 0)

  -- a thump where the wheels leave the road for the rough ground (and a lighter one getting back on)
  local off = car.surface == "rough"
  if last_surface ~= nil and off ~= last_surface and speed > 8 and clock - last_thump > THUMP_GAP and clock >= busy_until then
    local k = math.min(1, (speed - 8) / 25)
    if off then signal(0.40 + 0.35 * k, 0.30 + 0.25 * k, 0.09 + 0.05 * k) else signal(0.25 + 0.2 * k, 0.2 + 0.15 * k, 0.07) end
    last_thump = clock
  end
  last_surface = off

  -- the road under the tyres, as a steady rumble
  if clock < busy_until or clock < next_pulse then return end
  next_pulse = clock + PULSE
  if speed < 3 then return end
  local s = math.min(1, speed / 35)
  local kind = car.surface == "rough" and SURFACE.rough or car.surface == "dirt" and SURFACE.dirt
    or car.loose and SURFACE.loose or nil
  local strength = 0
  if kind then strength = kind[1] + (kind[2] - kind[1]) * s + kind[3] * (math.random() * 2 - 1) end
  if car.skidding or ((car.slip or 0) > 0.5 and speed > 6) then strength = strength + SLIDE end
  if strength > 0.02 then buzz(strength, strength * 0.7, PULSE_LONG) end
end

return haptics

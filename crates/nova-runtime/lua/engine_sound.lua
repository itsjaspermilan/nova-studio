-- nova.engine_sound: plays a car's engine from the loops engine_make writes (sounds/eng_<name>_<band>.wav and eng_<name>_off_<band>.wav),
-- and the driving sounds driving_sounds_make writes (tyres by surface, the squeal, wind, a turbo, a gearbox's whine, scrapes, knocks, gear
-- changes, the blow-off, pops). First written for Pine Ridge Rally (its lib/audio.lua); opt in with
--
--   local engine_sound = require("nova.engine_sound")
--   self.engine = engine_sound.new(require("engines.car"))          -- the profile engine_make wrote (engines/car.lua)
--   self.engine:update(dt, { rpm = rpm, throttle = t, speed = v })  -- every step
--
-- How it plays. An engine has loops at fixed revs (`cycles`: a loop of 65536 samples holding that many engine cycles is at cycles x 80.75 rpm;
-- the files of the higher bands are half as long and hold half as many, the same revs), each in two layers, throttle down and lifted, with
-- the same firings at the same instants. The two bands either side of the revs are heard, crossfaded, each played at the pitch that makes it
-- the engine's note, and the two layers are crossfaded by how hard the engine pulls. Only the loops that are heard play: a band starts when
-- the revs reach it and stops a moment after they leave it. A rival plays the throttle-down layer alone, placed where its car is (so it pans
-- and fades with distance) and bent a little by its speed towards or away from the listener. Everything is changed every step with
-- nova.sound.set.
--
-- A profile (engine_make writes one; every field may be changed):
--   sound                 the loops' name (eng_<sound>_<band>.wav)
--   idle, max, cycles     the engine's range (rpm) and its bands
--   rise, fall            how fast the heard revs follow the engine's, up and down (1/s): a heavy engine trails
--   load_rise, load_fall  how fast the note changes between pulling and coasting
--   gain, quiet, off      how loud it is beside others; idle beside the limit; off the throttle beside on it
--   wander                how much the idle hunts
--   limiter               "cut" (the spark cut on and off, a stutter), "soft" (the fuel eased away), "governor" (a diesel's, eased over a tenth)
--   shift, shift_cut, shift_volume   the gear change's sound ("quick", "stick" or "clunk": shift_<kind>), how long it stops pulling, how loud
--   turbo                 { level, lo, hi (its breath's pitch with no boost and all of it), from, full (the revs it starts to blow at, blows fully at) }
--   bov, pops, whine      the blow-off when lifting under boost, the exhaust's pops on the overrun (0 to 1), an old gearbox's hum

local M = {}

local LOOP_RPM = 120 * 44100 / 65536
M.LOOP_RPM = LOOP_RPM

-- What the tyres roll on: the loop, how loud it is at speed (beside the engine), its pitch from a crawl to flat out, and how much louder it
-- gets when the car slides (loose ground sprays; tarmac squeals instead, with its own loop). A game may change these.
M.SURFACES = {
  road = { sound = "tyre_road", gain = 0.55, lo = 0.7, hi = 1.35, slide = 0.15 },
  gravel = { sound = "tyre_gravel", gain = 0.9, lo = 0.75, hi = 1.3, slide = 0.6 },
  dirt = { sound = "tyre_dirt", gain = 0.8, lo = 0.75, hi = 1.3, slide = 0.5 },
  snow = { sound = "tyre_snow", gain = 0.75, lo = 0.8, hi = 1.25, slide = 0.5 },
  sand = { sound = "tyre_sand", gain = 0.75, lo = 0.8, hi = 1.25, slide = 0.6 },
  rough = { sound = "tyre_rough", gain = 1.0, lo = 0.75, hi = 1.3, slide = 0.3 },
}
M.HEAR = 90 -- metres at which a rival's engine has faded to nothing
M.RIVAL_VOLUME = 0.55

local function clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end
local function smoothstep(v, a, b) local t = clamp((v - a) / (b - a), 0, 1) return t * t * (3 - 2 * t) end

-- (two tables used again and again, so that steering twenty sounds a step makes no garbage)
local SET, PLACED = {}, { at = { 0, 0, 0 }, range = M.HEAR, falloff = "natural" }
local function set(id, volume, pitch, place)
  if place then
    PLACED.volume, PLACED.pitch = volume, pitch
    PLACED.at[1], PLACED.at[2], PLACED.at[3] = place.x, place.y or 0, place.z
    nova.sound.set(id, PLACED)
  else
    SET.volume, SET.pitch = volume, pitch
    nova.sound.set(id, SET)
  end
end
local function sfx(name, opts) return nova.sound.play(name, opts) end

local Engine = {}
Engine.__index = Engine

--- A new engine from its profile. `opts`: volume (1), rival (true: heard from where its car is, throttle-down layer only), surface (what
--- the tyres roll on when update is not told: "road").
function M.new(profile, opts)
  assert(type(profile) == "table" and profile.cycles and profile.idle and profile.max, "nova.engine_sound.new: give it a profile (engine_make writes engines/<name>.lua)")
  opts = opts or {}
  return setmetatable({
    volume = opts.volume or 1, profile = profile, sound = profile.sound, rival = opts.rival and true or false, surface_default = opts.surface or "road",
    bands = {}, loops = {}, rpm = profile.idle, load = 0, boost = 0, cut = 0, high = 0, pops = {}, t = math.random() * 10,
  }, Engine)
end

-- band k's loops, started if they are not playing
local function band(self, k)
  local v = self.bands[k]
  if not v then
    v = { on = nova.sound.play("eng_" .. self.sound .. "_" .. k, { loop = true, volume = 0 }) }
    if not self.rival then v.off = nova.sound.play("eng_" .. self.sound .. "_off_" .. k, { loop = true, volume = 0 }) end
    self.bands[k] = v
  end
  v.used, v.unused = true, 0
  return v
end
-- one of the other loops (tyres, wind...), started if it is not playing
local function loop(self, key, name)
  local id = self.loops[key]
  if not id then
    id = nova.sound.play(name, { loop = true, volume = 0 })
    self.loops[key] = id
  end
  return id
end

--- A gear change, "up" or "down": the engine stops pulling for a moment, and (not a rival) plays its gearbox's sound.
function Engine:shift(direction)
  local p = self.profile
  local up = direction ~= "down"
  self.cut = (p.shift_cut or 0.15) * (up and 1 or 0.6)
  if self.rival then return nil end
  -- (a car that pops, changing up hard near the top of its revs: now and then a pop from the exhaust as the spark is cut)
  if p.pops and up and self.load > 0.5 and self.rpm > 0.6 * p.max and math.random() < 0.4 * p.pops then self.pops[#self.pops + 1] = 0.05 end
  return sfx("shift_" .. (p.shift or "stick"), { volume = (p.shift_volume or 0.5) * (up and 1 or 0.7), pitch = up and 1 or 1.12 })
end

--- One step. `s`: rpm (or rev, 0 at idle to 1 at the limit), throttle (0 to 1), speed (metres a second), slip (0 to 1, how much the tyres
--- slide), surface (a key of SURFACES), lift (the body's height, for bumps), scrape (0 to 1, touching a barrier), x, y, z (a rival's place).
function Engine:update(dt, s)
  local p = self.profile
  s = s or {}
  dt = dt or 1 / 60
  self.t = self.t + dt
  -- the revs: where the engine is between idle and its limit, heard a little late (a heavy engine later)
  local u
  if s.rpm then u = clamp((s.rpm - p.idle) / (p.max - p.idle), 0, 1.02)
  else u = clamp(s.rev or 0, 0, 1.02) end
  local want = p.idle + u * (p.max - p.idle)
  self.rpm = self.rpm + (want - self.rpm) * math.min(1, dt * (want > self.rpm and (p.rise or 20) or (p.fall or 14)))
  local rpm = self.rpm
  local x = clamp((rpm - p.idle) / (p.max - p.idle), 0, 1)

  -- how hard it pulls: the throttle, less a gear change, less the limiter
  local raw = clamp(s.throttle or 0, 0, 1)
  local pull, stutter = raw, false
  if self.cut > 0 then
    self.cut = self.cut - dt
    pull = 0
  end
  if p.limiter == "cut" then
    if u >= 0.985 and raw > 0.5 then
      self.limit_steps = (self.limit_steps or 0) + 1
      stutter = true
      if self.limit_steps % 4 >= 2 then pull = 0.05 end
    else
      self.limit_steps = 0
    end
  else
    pull = pull * (1 - 0.55 * smoothstep(u, p.limiter == "governor" and 0.9 or 0.96, 1))
  end
  if stutter then self.load = pull
  else self.load = self.load + (pull - self.load) * math.min(1, dt * (pull > self.load and (p.load_rise or 24) or (p.load_fall or 18))) end

  -- the two bands either side of the revs, blended by where between them the revs are (in ratio)
  local cycles = p.cycles
  local n = #cycles
  local lo, hi = 1, 1
  if rpm >= cycles[n] * LOOP_RPM then lo, hi = n, n
  else
    for i = 1, n - 1 do if rpm >= cycles[i] * LOOP_RPM then lo, hi = i, i + 1 end end
  end
  local f = 0
  if hi ~= lo then f = clamp(math.log(rpm / (cycles[lo] * LOOP_RPM)) / math.log(cycles[hi] / cycles[lo]), 0, 1) end
  local wander = 1 + (p.wander or 0.003) * (math.sin(self.t * 3.1) + 0.7 * math.sin(self.t * 8.3 + 1.3)) * (1 - 0.7 * x)
  local quiet = p.quiet or 0.45
  local gain = self.volume * (p.gain or 1) * (quiet + (1 - quiet) * x)
  local on_gain, off_gain
  if self.rival then
    on_gain, off_gain = gain * (0.45 + 0.55 * self.load), 0
  else
    local off = p.off or 0.5
    on_gain = gain * math.sqrt(self.load)
    off_gain = gain * math.sqrt(1 - self.load) * (off + (1 - off) * (1 - x) ^ 4)
  end
  local place = self.rival and s.x and s or nil
  local bend = wander * (s.doppler or 1)
  for _, v in pairs(self.bands) do v.used = false end
  for k = lo, hi do
    local weight = (lo == hi) and 1 or (k == lo and math.cos(f * math.pi / 2) or math.sin(f * math.pi / 2))
    local v = band(self, k)
    local pitch = rpm / (cycles[k] * LOOP_RPM) * bend
    set(v.on, on_gain * weight, pitch, place)
    if v.off then set(v.off, off_gain * weight, pitch) end
  end
  for k, v in pairs(self.bands) do
    if not v.used then
      v.unused = v.unused + dt
      if v.unused > 0.12 then
        nova.sound.stop(v.on, 0.05)
        if v.off then nova.sound.stop(v.off, 0.05) end
        self.bands[k] = nil
      else
        set(v.on, 0)
        if v.off then set(v.off, 0) end
      end
    end
  end
  if self.rival then return end

  -- ---- the rest is the driven car ----
  local m = self.volume
  local speed = math.abs(s.speed or 0)
  local sliding = clamp(s.slip or 0, 0, 1)
  local kind = s.surface or self.surface_default
  local sf = M.SURFACES[kind] or M.SURFACES.road
  if self.surface ~= kind then
    if self.loops.surface then nova.sound.stop(self.loops.surface, 0.3) end
    self.loops.surface = nil
    -- (on and off the rough at speed: the wheels drop over the edge)
    if self.surface and (kind == "rough" or self.surface == "rough") and speed > 5 then sfx("thump", { volume = clamp(speed / 30, 0.3, 1) }) end
    self.surface = kind
  end
  local roll = clamp((speed - 0.5) / 40, 0, 1) ^ 0.8
  set(loop(self, "surface", sf.sound), m * sf.gain * roll * (1 + sf.slide * sliding), sf.lo + (sf.hi - sf.lo) * clamp(speed / 45, 0, 1) + 0.12 * sliding)
  -- tarmac squeals when the tyres slide, higher the more they slide
  local squeal = kind == "road" and clamp((sliding - 0.3) / 0.6, 0, 1) * clamp(speed / 6, 0, 1) or 0
  if squeal > 0 or self.loops.squeal then set(loop(self, "squeal", "tyre_squeal"), m * 0.9 * squeal ^ 0.8, 0.85 + 0.35 * sliding) end
  -- the wind, with the square of the speed
  local air = clamp(speed / 50, 0, 1)
  set(loop(self, "wind", "wind_loop"), m * 0.55 * air * air, 0.75 + 0.5 * air)

  -- lifting off: `high` remembers for a third of a second that the throttle was down
  self.high = math.max(raw, self.high - dt * 3)
  local lifted = false
  if raw > 0.3 then self.lifted = false
  elseif raw < 0.15 and self.high > 0.6 and not self.lifted then
    self.lifted, lifted = true, true
  end
  local turbo = p.turbo
  if turbo then
    local target = raw * smoothstep(rpm, turbo.from, turbo.full)
    self.boost = self.boost + (target - self.boost) * math.min(1, dt * (target > self.boost and 3 or 9))
    set(loop(self, "turbo", "turbo_loop"), m * 0.14 * turbo.level * self.boost ^ 1.5, turbo.lo + (turbo.hi - turbo.lo) * self.boost)
    self.bov_wait = math.max(0, (self.bov_wait or 0) - dt)
    if p.bov and lifted and self.boost > 0.4 and self.bov_wait <= 0 then
      sfx("bov", { volume = p.bov * (0.4 + 0.5 * self.boost), pitch = 0.6 + 0.4 * turbo.hi })
      self.bov_wait = 0.8
    end
  end
  if p.pops then
    if lifted and x > 0.5 and math.random() < 0.4 + 0.6 * p.pops then
      for _ = 1, 1 + math.floor(math.random() * 2 * x * p.pops) do self.pops[#self.pops + 1] = 0.08 + math.random() * 0.5 end
    end
    for i = #self.pops, 1, -1 do
      self.pops[i] = self.pops[i] - dt
      if self.pops[i] <= 0 then
        table.remove(self.pops, i)
        sfx("pop", { volume = (0.4 + 0.4 * math.random()) * (0.6 + 0.4 * p.pops) })
      end
    end
  end
  if p.whine then
    set(loop(self, "whine", "whine_loop"), m * p.whine * clamp(speed / 10, 0, 1) * (0.45 + 0.55 * self.load), clamp(0.6 + 0.9 * speed / 40, 0.6, 1.5))
  end
  -- the suspension taking a bump: the body rising or falling fast
  if s.lift then
    local rate = math.abs(s.lift - (self.last_lift or s.lift)) / math.max(dt, 0.001)
    self.last_lift = s.lift
    self.thump_wait = math.max(0, (self.thump_wait or 0) - dt)
    if rate > 0.135 and self.thump_wait <= 0 and speed > 3 then
      sfx("thump", { volume = clamp(0.2 + (rate - 0.135) * 2, 0.2, 1) })
      self.thump_wait = 0.3
    end
  end
  -- the body dragging along a barrier
  local scrape = s.scrape or 0
  if scrape > 0.02 or self.loops.scrape then set(loop(self, "scrape", "scrape_loop"), m * 0.9 * clamp(scrape, 0, 1), 0.8 + 0.4 * clamp(speed / 30, 0, 1)) end
end

--- The heard revs (rpm) and how hard the engine pulls (0 to 1), as this step left them.
function Engine:state() return self.rpm, self.load end

local function stop_all(self, fade)
  for k, v in pairs(self.bands) do
    nova.sound.stop(v.on, fade)
    if v.off then nova.sound.stop(v.off, fade) end
    self.bands[k] = nil
  end
  for k, id in pairs(self.loops) do
    nova.sound.stop(id, fade)
    self.loops[k] = nil
  end
  self.surface = nil
end

--- Quiet until the next update (the game paused, or a rival too far away to hear): its loops stop and give their voices back.
function Engine:silence() stop_all(self, 0.08) end
--- Stops everything it plays.
function Engine:stop() stop_all(self, 0.15) end

--- Every car's sound for this step: `cars` is a list of tables with `engine` (from new; a rival's made with rival = true), x, z, velx, velz,
--- and what update takes (rpm, throttle, speed...); `player` the driven one (the listener). A rival is heard from where it is, its note bent
--- by how fast it closes or pulls away; it goes by with a rush of air (whoosh) when it passes close and fast. A car's `shifted` ("up" or
--- "down") is played and cleared.
function M.cars(cars, player, dt)
  for _, car in ipairs(cars) do
    local e = car.engine
    if e then
      if car.shifted then
        e:shift(car.shifted)
        car.shifted = nil
      end
      if car == player then
        e:update(dt, car)
      else
        local dx, dz = car.x - player.x, car.z - player.z
        local d = math.sqrt(dx * dx + dz * dz)
        if d < M.HEAR then
          local rvx, rvz = (car.velx or 0) - (player.velx or 0), (car.velz or 0) - (player.velz or 0)
          local apart = d > 1 and (rvx * dx + rvz * dz) / d or 0
          car.doppler = clamp(1 - apart / 340, 0.9, 1.1)
          e.volume = M.RIVAL_VOLUME
          e:update(dt, car)
          e.whoosh_wait = math.max(0, (e.whoosh_wait or 0) - dt)
          local passing = math.sqrt(rvx * rvx + rvz * rvz)
          if d < 5 and passing > 8 and e.whoosh_wait <= 0 then
            sfx("whoosh", { volume = clamp(passing / 20, 0.3, 1), at = { car.x, car.y or 0, car.z }, range = 30 })
            e.whoosh_wait = 1.5
          end
        else
          e:silence()
        end
      end
    end
  end
end

return M

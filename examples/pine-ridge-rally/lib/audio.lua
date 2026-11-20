-- Sound for the game: menu sounds, music, and everything a car makes (its engine, its gearbox, its tyres on each surface, the wind,
-- bumps, knocks and scrapes). The files are made by scripts/rally/engines.mjs and scripts/rally/audio.mjs.
local audio = {}

-- One room for the sound effects (nova.sound.room): how much of each is sent to it, by name. Menu sounds stay dry.
nova.sound.room { size = 0.5, damping = 0.5, mix = 0.9 }
local REVERB = {
  lap = 0.3, best_lap = 0.4, finish = 0.45, checkpoint = 0.2, go = 0.2, beep = 0.1,
  impact = 0.25, thump = 0.12, shift_car_gt = 0.1, shift_car_offroad = 0.08, pop_car_gt = 0.3, bov_car_gt = 0.2, whoosh = 0.2,
}

-- The balance (found by measuring each file's loudness: cargo test -p nova-runtime --test loudness -- --ignored --nocapture): each effect's own gain, so that
-- the beeps, the finish and the menu clicks sit just above the music and the engine, not over it. The effects were up to 12 dB louder than the music.
local SFX_GAIN = {
  beep = 0.7, go = 0.6, finish = 0.6, lap = 1.0, best_lap = 1.0, checkpoint = 1.0, menu_accept = 0.7, menu_move = 1.0, menu_back = 1.0, pause = 0.8,
  -- (the knocks are all made with their peak at -2 dBFS, scripts/rally/audio.mjs; a hit is the loudest thing a car does)
  impact = 1.0, thump = 0.8, shift_car_gt = 0.7, shift_car_offroad = 0.8, pop_car_gt = 0.6, bov_car_gt = 0.55, whoosh = 0.6,
}
-- A name the race asks for that is played as something else: a "bump" (a hit on a barrier or another car) is one of the three
-- takes of "impact". ("shift" is the gear change of the car the player drives: audio.sfx below.)
local ALIAS = { bump = "impact" }
-- and each song's gain, to bring them to about the same loudness (-16 dB RMS before the volume setting)
local MUSIC_GAIN = {
  kenney_desert = 0.9, kenney_forest = 1.0, kenney_menu = 1.0, kenney_night = 0.85, kenney_results = 0.85, kenney_snow = 1.0,
  menu = 0.9, race_desert = 0.85, race_forest = 0.7, race_night = 0.85, race_snow = 0.7, results = 1.0,
}

function audio.sfx(name, opts)
  opts = opts or {}
  if name == "shift" then
    -- (the race asks for "shift" at the player's gear change, up at pitch 1 and down at 1.3; audio.cars does without it)
    local e = audio.player_engine
    if e then return e:shift((opts.pitch or 1) > 1.15 and "down" or "up") end
    return 0
  end
  name = ALIAS[name] or name
  if SFX_GAIN[name] then opts.volume = (opts.volume or 1) * SFX_GAIN[name] end
  local send = REVERB[name]
  if send and not (opts and opts.reverb) then
    opts = opts or {}
    opts.reverb = send
  end
  return nova.sound.play(name, opts)
end

local state = require("lib.state")

-- The music has two styles (Options > Music style): Kenney's loops, or the songs made with the music editor (music/*.song.json).
-- (the menu always plays its own smooth techno song, in either style)
-- A scene asks for a song by its studio name; in the Kenney style it is played as the loop that stands in for it.
local KENNEY = {
  results = "kenney_results", race_forest = "kenney_forest", race_desert = "kenney_desert",
  race_snow = "kenney_snow", race_night = "kenney_night",
}
local current_music, current_opts = nil, nil
local function play(name, opts)
  local file = state.music_style == "kenney" and KENNEY[name] or name
  opts = opts or { volume = 0.55, fade = 0.6 }
  local o = {}
  for k, v in pairs(opts) do o[k] = v end
  o.volume = (o.volume or 1) * (MUSIC_GAIN[file] or 1)
  nova.music.play(file, o)
end
function audio.music(name, opts)
  if current_music == name then return end
  current_music, current_opts = name, opts
  play(name, opts)
end
-- After the style has been changed: the song that is playing starts again in the new style.
function audio.restyle()
  if current_music then play(current_music, current_opts) end
end
function audio.stop_music(fade)
  current_music = nil
  nova.music.stop(fade or 0.5)
end

-- ---- the cars ----------------------------------------------------------------------------------------------------------------
-- Two cars, two engines, and nothing about one is like the other (scripts/rally/engines.mjs makes the loops from a model of each):
--   car_gt       a turbocharged petrol six: smooth, quick to rev, a howl that rises to 7000; a whistle from the turbo that lags the
--                foot and is let go with a rush when the foot lifts; gear changes in a blink with a beat of the exhaust; pops on the
--                overrun; a hard stutter at the limiter
--   car_offroad  a big diesel six: heavy and slow to rev (the heard revs trail the real ones), knocking at idle, loud off the
--                throttle too, a whine from the gearbox that follows the road speed; a long clunking gear change; no limiter
--                stutter, the governor just eases the fuel away at 4200
-- Each engine has loops at fixed revs (a loop of 65536 samples holding `cycles` engine cycles is at cycles x 80.75 rpm), each in
-- two layers, throttle down and throttle lifted, with the same firings at the same instants. The two bands either side of the
-- revs are heard, crossfaded, each played at the pitch that makes it the engine's note (a loop is bent by a fifth of its pitch at
-- most), and the two layers are crossfaded by how hard the engine is pulling. Only the loops that are heard are playing (the mixer has 32
-- voices): a band is started when the revs reach it and stopped a moment after they leave it. A rival plays the throttle-down layer
-- alone, placed where its car is (so it pans and fades with distance) and bent a little by its speed towards or away from you.
-- Everything is changed every step with nova.sound.set.
local LOOP_RPM = 120 * 44100 / 65536
local PROFILES = {
  car_gt = {
    idle = 750, max = 7000, cycles = { 9, 13, 20, 28, 41, 60, 87 },
    rise = 26, fall = 18,            -- how fast the heard revs follow the engine's, up and down (1/s)
    load_rise = 30, load_fall = 22,  -- and how fast the note changes between pulling and coasting
    quiet = 0.4,                     -- how loud idle is beside the limit
    off = 0.5,                       -- how loud the engine is off the throttle beside on it (away from idle)
    wander = 0.002,                  -- how much the idle hunts
    limiter = "cut", shift_cut = 0.07, shift_volume = 0.5,
    turbo = true, pops = true,
  },
  car_offroad = {
    idle = 650, max = 4200, cycles = { 8, 12, 17, 25, 36, 52 },
    rise = 7, fall = 5,
    load_rise = 9, load_fall = 7,
    quiet = 0.6,
    off = 0.7,
    wander = 0.006,
    limiter = "governor", shift_cut = 0.34, shift_volume = 0.6,
    whine = true,
  },
}
local IDLE_REV = 0.16    -- a car's `rev` at idle (entities/car.lua); 1 is the limit
local HEAR = 90          -- metres at which a rival's engine has faded to nothing
local RIVAL_VOLUME = 0.55

-- What the tyres roll on: the loop, how loud it is at speed (beside the engine), its pitch from a crawl to flat out, and how much
-- louder it gets when the car slides (loose ground sprays; tarmac squeals instead, with its own loop).
local SURFACES = {
  road = { sound = "tyre_road", gain = 0.55, lo = 0.7, hi = 1.35, slide = 0.15 },
  gravel = { sound = "tyre_gravel", gain = 0.9, lo = 0.75, hi = 1.3, slide = 0.6 },
  dirt = { sound = "tyre_dirt", gain = 0.8, lo = 0.75, hi = 1.3, slide = 0.5 },
  snow = { sound = "tyre_snow", gain = 0.75, lo = 0.8, hi = 1.25, slide = 0.5 },
  sand = { sound = "tyre_sand", gain = 0.75, lo = 0.8, hi = 1.25, slide = 0.6 },
  rough = { sound = "tyre_rough", gain = 1.0, lo = 0.75, hi = 1.3, slide = 0.3 },
}
-- a stretch of road with a kind of its own (a waypoint's `road`; race.lua keeps the player's in car.road_kind)
local ROAD_KINDS = { road_asphalt = "road", road_gravel = "gravel", road_dirt = "dirt", road_snow = "snow", road_sand = "sand" }

local function clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end
local function smoothstep(v, a, b) local t = clamp((v - a) / (b - a), 0, 1) return t * t * (3 - 2 * t) end

-- What the course itself is made of, from its settings (the scene's race object): tarmac, snow, sand, gravel or packed dirt.
local function course_kind()
  local ok, c = pcall(function() return require("lib.course").current() end)
  if not ok or type(c) ~= "table" or c.surface ~= "dirt" then return "road" end
  if c.weather and c.weather.kind == "snow" then return "snow" end
  local d = c.dust
  if d and d[1] >= 200 and d[3] <= 130 then return "sand" end -- (the desert courses' dust)
  return c.loose and "gravel" or "dirt"
end

-- (two tables used again and again, so that steering twenty sounds a step makes no garbage)
local SET, PLACED = {}, { at = { 0, 0, 0 }, range = HEAR, falloff = "natural" }
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

local Engine = {}
Engine.__index = Engine

-- `volume` is the engine's loudness, `car_id` the car (state.cars), `rival` true for a car the player does not drive.
function audio.engine(volume, car_id, rival)
  local info = state.car_of and state.car_of(car_id)
  if not info then for _, c in ipairs(state.cars) do if c.id == car_id then info = c end end end
  info = info or state.cars[1]
  -- (a car with no engine of its own borrows the one nearer its revs)
  local sound = PROFILES[info.id] and info.id or ((info.max_rpm or 7000) < 5000 and "car_offroad" or "car_gt")
  local profile = PROFILES[sound]
  local e = setmetatable({
    volume = volume or 1, car = info, profile = profile, sound = sound, rival = rival and true or false,
    bands = {}, loops = {}, rpm = profile.idle, load = 0, boost = 0, cut = 0, high = 0, pops = {}, t = math.random() * 10,
  }, Engine)
  if not rival then audio.player_engine = e end
  return e
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
-- one of the car's other loops (tyres, wind...), started if it is not playing
local function loop(self, key, name)
  local id = self.loops[key]
  if not id then
    id = nova.sound.play(name, { loop = true, volume = 0 })
    self.loops[key] = id
  end
  return id
end

-- A gear change, "up" or "down": the engine stops pulling for a moment (a blink in the GT, a third of a second in the 4x4), and the
-- player's car makes its own sound of it.
function Engine:shift(direction)
  local p = self.profile
  local up = direction ~= "down"
  self.cut = p.shift_cut * (up and 1 or 0.6)
  if self.rival then return 0 end
  -- (the GT changing up hard near the top of its revs: now and then a pop from the exhaust as the spark is cut)
  if p.pops and up and self.load > 0.5 and self.rpm > 0.6 * p.max and math.random() < 0.4 then self.pops[#self.pops + 1] = 0.05 end
  return audio.sfx("shift_" .. self.sound, { volume = p.shift_volume * (up and 1 or 0.7), pitch = up and 1 or 1.12 })
end

-- `rev` is 0 to 1 (0.16 at idle), `load` 0 to 1 (how hard the throttle is down), `rough` true off the road, `slip` 0 to 1.
-- `car` (the car itself) is optional: with it the sounds follow its speed, its own stretch of road, its body's bumps and scrapes,
-- and a rival's engine is heard from where the car is.
function Engine:update(dt, rev, load, rough, slip, car)
  local p = self.profile
  dt = dt or 1 / 60
  self.t = self.t + dt
  -- the revs: where the engine is between its idle and its limit, heard a little late (a heavy engine later)
  local u
  if car and car.rpm then
    local idle, max = self.car.idle_rpm or p.idle, self.car.max_rpm or p.max
    u = clamp((car.rpm - idle) / (max - idle), 0, 1.02)
  else
    u = clamp(((rev or IDLE_REV) - IDLE_REV) / (1 - IDLE_REV), 0, 1.02)
  end
  local want = p.idle + u * (p.max - p.idle)
  self.rpm = self.rpm + (want - self.rpm) * math.min(1, dt * (want > self.rpm and p.rise or p.fall))
  local rpm = self.rpm
  local x = clamp((rpm - p.idle) / (p.max - p.idle), 0, 1)

  -- how hard it pulls: the throttle, less a gear change, less the limiter
  local raw = clamp(load or 0, 0, 1)
  local pull, stutter = raw, false
  if self.cut > 0 then
    self.cut = self.cut - dt
    pull = 0
  end
  if p.limiter == "cut" then
    -- the spark cut on and off, two steps each: a hard stutter
    if u >= 0.985 and raw > 0.5 then
      self.limit_steps = (self.limit_steps or 0) + 1
      stutter = true
      if self.limit_steps % 4 >= 2 then pull = 0.05 end
    else
      self.limit_steps = 0
    end
  else
    pull = pull * (1 - 0.55 * smoothstep(u, 0.9, 1)) -- the governor: the fuel eased away, no stutter
  end
  if stutter then self.load = pull
  else self.load = self.load + (pull - self.load) * math.min(1, dt * (pull > self.load and p.load_rise or p.load_fall)) end

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
  -- a little hunting at idle, so that nothing is perfectly still
  local wander = 1 + p.wander * (math.sin(self.t * 3.1) + 0.7 * math.sin(self.t * 8.3 + 1.3)) * (1 - 0.7 * x)
  local gain = self.volume * (p.quiet + (1 - p.quiet) * x)
  local on_gain, off_gain
  if self.rival then
    on_gain, off_gain = gain * (0.45 + 0.55 * self.load), 0
  else
    -- (off the throttle the engine is quieter, except at idle, where it is fed whatever the foot does)
    on_gain = gain * math.sqrt(self.load)
    off_gain = gain * math.sqrt(1 - self.load) * (p.off + (1 - p.off) * (1 - x) ^ 4)
  end
  local place = self.rival and car or nil
  local bend = wander * (self.doppler or 1)
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

  -- ---- the rest is the player's car ----
  local m = self.volume
  local speed = car and math.abs(car.speed or 0) or math.max(0, (rev or 0) - 0.2) * 45 -- (without the car: a guess from the revs)
  local sliding = clamp(slip or 0, 0, 1)

  -- the tyres on what is under them
  local kind
  if car then
    if not self.course_kind then self.course_kind = course_kind() end
    kind = car.surface == "rough" and "rough" or ROAD_KINDS[car.road_kind or ""] or self.course_kind
  else
    if not self.course_kind then self.course_kind = course_kind() end
    kind = rough and "rough" or self.course_kind
  end
  local s = SURFACES[kind]
  if self.surface ~= kind then
    if self.loops.surface then nova.sound.stop(self.loops.surface, 0.3) end
    self.loops.surface = nil
    -- (on and off the rough at speed: the wheels drop over the edge)
    if self.surface and (kind == "rough" or self.surface == "rough") and speed > 5 then audio.sfx("thump", { volume = clamp(speed / 30, 0.3, 1) }) end
    self.surface = kind
  end
  local roll = clamp((speed - 0.5) / 40, 0, 1) ^ 0.8
  set(loop(self, "surface", s.sound), m * s.gain * roll * (1 + s.slide * sliding), s.lo + (s.hi - s.lo) * clamp(speed / 45, 0, 1) + 0.12 * sliding)
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
  if p.turbo then
    -- the turbo spins up behind the throttle (a third of a second) and only once the engine is turning fast enough to drive it
    local target = raw * smoothstep(rpm, 1400, 3200)
    self.boost = self.boost + (target - self.boost) * math.min(1, dt * (target > self.boost and 3 or 9))
    set(loop(self, "turbo", "turbo_loop"), m * 0.45 * self.boost ^ 1.5, 0.6 + 0.95 * self.boost)
    self.bov_wait = math.max(0, (self.bov_wait or 0) - dt)
    if lifted and self.boost > 0.4 and self.bov_wait <= 0 then
      audio.sfx("bov_car_gt", { volume = 0.5 + 0.5 * self.boost })
      self.bov_wait = 0.8
    end
  end
  if p.pops then
    -- the exhaust pops on the overrun: one or two after lifting off high in the revs
    if lifted and x > 0.5 then
      for _ = 1, 1 + math.floor(math.random() * 2 * x) do self.pops[#self.pops + 1] = 0.08 + math.random() * 0.5 end
    end
    for i = #self.pops, 1, -1 do
      self.pops[i] = self.pops[i] - dt
      if self.pops[i] <= 0 then
        table.remove(self.pops, i)
        audio.sfx("pop_car_gt", { volume = 0.5 + 0.5 * math.random() })
      end
    end
  end
  if p.whine then
    -- the gearbox whines with the road speed, louder when it is driving the wheels
    set(loop(self, "whine", "whine_loop"), m * 0.3 * clamp(speed / 10, 0, 1) * (0.45 + 0.55 * self.load), clamp(0.6 + 1.1 * speed / 40, 0.6, 1.7))
  end

  if car then
    -- the suspension taking a bump: the body rising or falling fast
    if car.lift then
      local rate = math.abs(car.lift - (self.last_lift or car.lift)) / math.max(dt, 0.001)
      self.last_lift = car.lift
      self.thump_wait = math.max(0, (self.thump_wait or 0) - dt)
      -- (measured over a lap: tarmac never moves the body faster than 0.05 m/s, gravel up to 0.16, the rough more)
      if rate > 0.135 and self.thump_wait <= 0 and speed > 3 then
        audio.sfx("thump", { volume = clamp(0.2 + (rate - 0.135) * 2, 0.2, 1) })
        self.thump_wait = 0.3
      end
    end
    -- the body dragging along a barrier (car.scrape, 0 to 1, while it touches one)
    local scrape = car.scrape or 0
    if scrape > 0.02 or self.loops.scrape then set(loop(self, "scrape", "scrape_loop"), m * 0.9 * clamp(scrape, 0, 1), 0.8 + 0.4 * clamp(speed / 30, 0, 1)) end
  end
end

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

-- Quiet until the next update (the game paused, or a rival too far away to hear): its loops stop and give their voices back.
function Engine:silence()
  stop_all(self, 0.08)
end

function Engine:stop()
  stop_all(self, 0.15)
  if audio.player_engine == self then audio.player_engine = nil end
end

-- Every car's sound for this step, from the cars themselves: `cars` is the race's list, `player` the car being driven. A rival
-- is heard from where it is (the camera listens: it pans, and fades to nothing at 90 m), its note bent by how fast it is closing or
-- pulling away, and it goes by with a rush of air when it passes close and fast.
function audio.cars(cars, player, dt)
  for _, car in ipairs(cars) do
    local e = car.engine
    if e then
      if car.shifted then
        e:shift(car.shifted)
        car.shifted = nil
      end
      if car == player then
        e:update(dt, car.rev, car.ctl.throttle, car.surface == "rough", car.slip, car)
      else
        local dx, dz = car.x - player.x, car.z - player.z
        local d = math.sqrt(dx * dx + dz * dz)
        if d < HEAR then
          local rvx, rvz = (car.velx or 0) - (player.velx or 0), (car.velz or 0) - (player.velz or 0)
          local apart = d > 1 and (rvx * dx + rvz * dz) / d or 0 -- (metres a second the gap is growing)
          e.doppler = clamp(1 - apart / 340, 0.9, 1.1)
          e.volume = RIVAL_VOLUME
          e:update(dt, car.rev, car.ctl.throttle, false, 0, car)
          e.whoosh_wait = math.max(0, (e.whoosh_wait or 0) - dt)
          local passing = math.sqrt(rvx * rvx + rvz * rvz)
          if d < 5 and passing > 8 and e.whoosh_wait <= 0 then
            audio.sfx("whoosh", { volume = clamp(passing / 20, 0.3, 1), at = { car.x, car.y or 0, car.z }, range = 30 })
            e.whoosh_wait = 1.5
          end
        else
          e:silence()
        end
      end
    end
  end
end

return audio

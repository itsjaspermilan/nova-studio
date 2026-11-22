-- Sound for the game: menu sounds, music, and everything a car makes (its engine, its gearbox, its tyres on each surface, the wind,
-- bumps, knocks and scrapes). The files are made by scripts/rally/engines.mjs and scripts/rally/audio.mjs.
local audio = {}

-- One room for the sound effects (nova.sound.room): how much of each is sent to it, by name. Menu sounds stay dry.
nova.sound.room { size = 0.5, damping = 0.5, mix = 0.9 }
local REVERB = {
  lap = 0.3, best_lap = 0.4, finish = 0.45, checkpoint = 0.2, go = 0.2, beep = 0.1,
  impact = 0.25, thump = 0.12, shift_quick = 0.1, shift_stick = 0.08, shift_clunk = 0.08, pop = 0.3, bov = 0.2, whoosh = 0.2,
}

-- The balance (found by measuring each file's loudness: cargo test -p nova-runtime --test loudness -- --ignored --nocapture): each effect's own gain, so that
-- the beeps, the finish and the menu clicks sit just above the music and the engine, not over it. The effects were up to 12 dB louder than the music.
local SFX_GAIN = {
  beep = 0.7, go = 0.6, finish = 0.6, lap = 1.0, best_lap = 1.0, checkpoint = 1.0, menu_accept = 0.7, menu_move = 1.0, menu_back = 1.0, pause = 0.8,
  -- (the knocks are all made with their peak at -2 dBFS, scripts/rally/audio.mjs; a hit is the loudest thing a car does)
  impact = 1.0, thump = 0.8, shift_quick = 0.7, shift_stick = 0.75, shift_clunk = 0.8, pop = 0.6, bov = 0.4, whoosh = 0.6,
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
-- Every car has its own engine (scripts/rally/engines.mjs makes the loops from a model of each: its cylinders, the order and the
-- angles they fire at, its pipes) and its own profile here: how it revs, how loud it is, and which of the other sounds it makes.
-- Each engine has loops at fixed revs (`cycles`: a loop of 65536 samples holding that many engine cycles is at cycles x 80.75 rpm;
-- the files of the higher bands are half as long and hold half as many, which is the same revs), each in two layers, throttle down
-- and throttle lifted, with the same firings at the same instants. The two bands either side of the revs are heard, crossfaded,
-- each played at the pitch that makes it the engine's note (a loop is bent by a quarter of its pitch at most), and the two layers
-- are crossfaded by how hard the engine is pulling. Only the loops that are heard are playing (the mixer has 32 voices): a band is
-- started when the revs reach it and stopped a moment after they leave it. A rival plays the throttle-down layer alone, placed
-- where its car is (so it pans and fades with distance) and bent a little by its speed towards or away from you. Everything is
-- changed every step with nova.sound.set.
--
-- A profile (scripts/rally/sound-check.mjs checks `idle`, `max` and `cycles` against lib/state.lua and engines.mjs):
--   sound                 the engine whose loops it plays, when not its own (the Kaze plays the Kaze RS's 2.0 turbo four, softer)
--   idle, max, cycles     the engine's range (rpm) and its bands
--   rise, fall            how fast the heard revs follow the engine's, up and down (1/s): a heavy engine trails
--   load_rise, load_fall  how fast the note changes between pulling and coasting
--   gain                  how loud this engine is beside the others
--   quiet                 how loud idle is beside the limit
--   off                   how loud the engine is off the throttle beside on it (away from idle)
--   wander                how much the idle hunts
--   limiter               "cut": the spark cut on and off, a hard stutter; "soft": the fuel eased away over the last few per cent;
--                         "governor": a diesel's, eased away over the last tenth
--   shift, shift_cut, shift_volume   the gear change: "quick" (a twin-clutch, sequential or automatic box: a click and a beat of
--                         the exhaust), "stick" (a manual box: out, across, in) or "clunk" (an old or heavy box with a long lever);
--                         how long the engine stops pulling for; how loud
--   turbo                 only a turbocharged car has one: { level (how loud: all are far quieter than the engine), lo, hi (the
--                         pitch of its breath with no boost and with all of it), from, full (the revs it starts to blow at, and
--                         blows fully at) }. Heard only as the boost builds; nothing without boost.
--   bov                   a turbocharged petrol car's blow-off when the foot lifts under boost: how loud (a diesel has no throttle
--                         to shut, so no valve)
--   pops                  the exhaust popping on the overrun and at a hard gear change: how many and how loud (0 to 1)
--   whine                 the hum of an old gearbox's straight teeth, following the road speed: how loud
local LOOP_RPM = 120 * 44100 / 65536
local PROFILES = {
  -- 3.0 turbo straight-six petrol: smooth, quick to rev, a howl that rises to 7000; changes gear in a blink
  car_gt = { idle = 750, max = 7000, cycles = { 9, 13, 20, 28, 40, 58, 86 },
    rise = 26, fall = 18, load_rise = 30, load_fall = 22, gain = 1.0, quiet = 0.4, off = 0.5, wander = 0.002,
    limiter = "cut", shift = "quick", shift_cut = 0.07, shift_volume = 0.5,
    turbo = { level = 1.0, lo = 0.7, hi = 1.15, from = 1400, full = 3200 }, bov = 0.8, pops = 0.7 },
  -- 4.2 straight-six diesel, no turbo: heavy and slow to rev, knocking at idle, loud off the throttle too; a long clunking change
  car_offroad = { idle = 650, max = 4200, cycles = { 8, 11, 16, 24, 36, 52 },
    rise = 7, fall = 5, load_rise = 9, load_fall = 7, gain = 1.0, quiet = 0.6, off = 0.7, wander = 0.006,
    limiter = "governor", shift = "clunk", shift_cut = 0.34, shift_volume = 0.6, whine = 0.1 },
  -- 2.0 turbo four: eager; a small turbo that comes in late and is let go with a rush
  car_s15 = { idle = 850, max = 7200, cycles = { 10, 14, 20, 30, 42, 60, 88 },
    rise = 24, fall = 17, load_rise = 28, load_fall = 20, gain = 0.95, quiet = 0.4, off = 0.5, wander = 0.003,
    limiter = "cut", shift = "stick", shift_cut = 0.14, shift_volume = 0.55,
    turbo = { level = 1.0, lo = 0.8, hi = 1.25, from = 2200, full = 4000 }, bov = 1.0, pops = 0.3 },
  -- the same 2.0 turbo four in a softer car: quieter, slower to answer, less boost, no pops
  car_s14 = { sound = "car_s15", idle = 800, max = 6800, cycles = { 10, 14, 20, 30, 42, 60, 88 },
    rise = 17, fall = 12, load_rise = 20, load_fall = 15, gain = 0.8, quiet = 0.45, off = 0.45, wander = 0.003,
    limiter = "soft", shift = "stick", shift_cut = 0.18, shift_volume = 0.5,
    turbo = { level = 0.6, lo = 0.75, hi = 1.12, from = 2000, full = 3600 }, bov = 0.6 },
  -- 2.0 turbo four, hard-edged: pops on the overrun
  car_hatch_r = { idle = 800, max = 7000, cycles = { 10, 14, 20, 28, 42, 60, 86 },
    rise = 26, fall = 19, load_rise = 30, load_fall = 22, gain = 1.0, quiet = 0.4, off = 0.55, wander = 0.002,
    limiter = "cut", shift = "quick", shift_cut = 0.1, shift_volume = 0.5,
    turbo = { level = 0.8, lo = 0.75, hi = 1.2, from = 1600, full = 3200 }, bov = 0.7, pops = 1.0 },
  -- 2.0 four, no turbo: quiet and smooth
  car_hatch = { idle = 750, max = 6500, cycles = { 9, 14, 22, 34, 52, 80 },
    rise = 18, fall = 13, load_rise = 22, load_fall = 16, gain = 0.7, quiet = 0.35, off = 0.45, wander = 0.002,
    limiter = "soft", shift = "stick", shift_cut = 0.18, shift_volume = 0.45 },
  -- 0.8 three-cylinder: thrummy and small
  car_city = { idle = 900, max = 6200, cycles = { 11, 16, 24, 34, 52, 76 },
    rise = 20, fall = 14, load_rise = 24, load_fall = 18, gain = 0.7, quiet = 0.45, off = 0.5, wander = 0.004,
    limiter = "soft", shift = "stick", shift_cut = 0.22, shift_volume = 0.45 },
  -- 2.4 four on open carburettors: loud, a raspy intake bark, snaps up and down the revs; gurgles and pops off the throttle
  car_rally = { idle = 1000, max = 7600, cycles = { 12, 18, 28, 42, 62, 92 },
    rise = 30, fall = 22, load_rise = 34, load_fall = 24, gain = 1.1, quiet = 0.45, off = 0.6, wander = 0.004,
    limiter = "cut", shift = "stick", shift_cut = 0.13, shift_volume = 0.6, pops = 0.6 },
  -- 2.5 turbo five, racing exhaust: loud, a lumpy fast idle, a big turbo that comes in late, pops, a sequential box
  car_gt2 = { idle = 1100, max = 7200, cycles = { 13, 20, 28, 42, 60, 88 },
    rise = 32, fall = 24, load_rise = 34, load_fall = 26, gain = 1.1, quiet = 0.5, off = 0.6, wander = 0.005,
    limiter = "cut", shift = "quick", shift_cut = 0.05, shift_volume = 0.6,
    turbo = { level = 1.0, lo = 0.7, hi = 1.15, from = 2500, full = 4500 }, bov = 1.0, pops = 1.0 },
  -- 5.6 cross-plane V8: deep, a lumpy idle, slow to rev, no stutter at 5600; a heavy change
  car_muscle = { idle = 700, max = 5600, cycles = { 8, 13, 20, 30, 46, 68 },
    rise = 14, fall = 9, load_rise = 16, load_fall = 11, gain = 1.1, quiet = 0.55, off = 0.65, wander = 0.007,
    limiter = "soft", shift = "clunk", shift_cut = 0.26, shift_volume = 0.55 },
  -- 2.8 turbo diesel four: a modern diesel, its turbo only a faint breath, no whine
  car_suv = { idle = 700, max = 4400, cycles = { 8, 12, 18, 26, 38, 54 },
    rise = 10, fall = 7, load_rise = 12, load_fall = 9, gain = 0.85, quiet = 0.5, off = 0.65, wander = 0.004,
    limiter = "governor", shift = "stick", shift_cut = 0.2, shift_volume = 0.4,
    turbo = { level = 0.45, lo = 0.65, hi = 1.0, from = 1200, full = 2400 } },
  -- 7.2 turbo diesel six: very low and slow, governed at 2500; a big slow turbo, a gearbox that hums
  car_truck = { idle = 600, max = 2500, cycles = { 7, 10, 14, 20, 30 },
    rise = 5, fall = 3.5, load_rise = 7, load_fall = 5, gain = 1.05, quiet = 0.65, off = 0.75, wander = 0.006,
    limiter = "governor", shift = "clunk", shift_cut = 0.38, shift_volume = 0.7,
    turbo = { level = 0.5, lo = 0.55, hi = 0.9, from = 900, full = 1700 }, whine = 0.1 },
  -- 3.4 twin-turbo V6: smooth and deep, two small turbos, a ten-speed automatic
  car_pickup = { idle = 650, max = 5800, cycles = { 8, 11, 16, 24, 34, 50, 70 },
    rise = 16, fall = 11, load_rise = 20, load_fall = 14, gain = 0.95, quiet = 0.45, off = 0.55, wander = 0.003,
    limiter = "soft", shift = "quick", shift_cut = 0.1, shift_volume = 0.4,
    turbo = { level = 0.6, lo = 0.8, hi = 1.2, from = 1500, full = 3000 }, bov = 0.4 },
}
local IDLE_REV = 0.16    -- a car's `rev` at idle (entities/car.lua); 1 is the end of the gear
local FLARE = 0.06       -- what entities/car.lua adds to `rev` with the throttle down: only with it is the engine at its limit
local HEAR = 90          -- metres at which a rival's engine has faded to nothing
local RIVAL_VOLUME = 0.55

-- What the tyres roll on. Each surface has: the rolling loop, how loud it is at speed (beside the engine), its pitch from a crawl to flat
-- out, and what the loose ones add. Loose ground (gravel, dirt, snow, sand) has a sliding layer (the spray of a sideways slip: `spray` is
-- its loudness, `spray_pitch` its pitch) and some have stones thrown against the underside (`stones`: how many a second at full speed;
-- sparse, one-shots). Tarmac squeals when it slides instead, with its own loop. Every level here is smoothed over time (below), and a
-- change of surface crossfades, so nothing is switched on or off in a step.
local SURFACES = {
  road = { sound = "tyre_road", gain = 0.55, lo = 0.7, hi = 1.35, slide = 0.15, stones = 0 },
  gravel = { sound = "tyre_gravel", gain = 0.72, lo = 0.8, hi = 1.2, slide = 0.25, spray = 0.8, spray_pitch = 1.0, stones = 4 },
  dirt = { sound = "tyre_dirt", gain = 0.67, lo = 0.8, hi = 1.2, slide = 0.25, spray = 0.7, spray_pitch = 0.8, stones = 2 },
  snow = { sound = "tyre_snow", gain = 0.75, lo = 0.85, hi = 1.15, slide = 0.25, spray = 0.6, spray_pitch = 1.1, stones = 0 },
  sand = { sound = "tyre_sand", gain = 0.75, lo = 0.85, hi = 1.15, slide = 0.25, spray = 0.6, spray_pitch = 0.9, stones = 0 },
  rough = { sound = "tyre_rough", gain = 1.0, lo = 0.75, hi = 1.3, slide = 0.3, stones = 3 },
}
local STONE = "stone" -- (a group of takes: sounds/stone.group.json)
local SURFACE_FADE = { 5, 3 } -- how fast a surface comes in and goes out of the mix (1/s: a third of a second, a bit more)
-- a stretch of road with a kind of its own (a waypoint's `road`; race.lua keeps the player's in car.road_kind)
local ROAD_KINDS = { road_asphalt = "road", road_gravel = "gravel", road_dirt = "dirt", road_snow = "snow", road_sand = "sand" }

local function clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end
local function approach(cur, target, dt, up, down) return cur + (target - cur) * math.min(1, dt * (target > cur and up or down)) end
-- The player's engine is turned down to this share while the co-driver speaks (lib/codriver.lua sets it every step; 1 is not at all).
audio.duck_level = 1
function audio.duck(level) audio.duck_level = clamp(level or 1, 0, 1) end
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
  -- (every car of lib/state.lua has a profile; one that had none would sound like the first)
  local profile = PROFILES[info.id] or PROFILES[state.cars[1].id]
  local sound = profile.sound or (PROFILES[info.id] and info.id) or state.cars[1].id
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
-- player's car makes the sound of its kind of gearbox.
function Engine:shift(direction)
  local p = self.profile
  local up = direction ~= "down"
  self.cut = p.shift_cut * (up and 1 or 0.6)
  if self.rival then return 0 end
  -- (a car that pops, changing up hard near the top of its revs: now and then a pop from the exhaust as the spark is cut)
  if p.pops and up and self.load > 0.5 and self.rpm > 0.6 * p.max and math.random() < 0.4 * p.pops then self.pops[#self.pops + 1] = 0.05 end
  return audio.sfx("shift_" .. p.shift, { volume = p.shift_volume * (up and 1 or 0.7), pitch = up and 1 or 1.12 })
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
    -- (`rev` goes a little over 1 with the throttle down at the end of a gear: that, and not 1, is the limit. Counting 1 as the
    -- limit had every car on its limiter, at its highest note, from 94% of each gear and for good at its top speed.)
    u = clamp(((rev or IDLE_REV) - IDLE_REV) / (1 - IDLE_REV + FLARE), 0, 1.02)
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
    pull = pull * (1 - 0.55 * smoothstep(u, p.limiter == "soft" and 0.96 or 0.9, 1)) -- the fuel eased away, no stutter
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
  local gain = self.volume * (p.gain or 1) * (p.quiet + (1 - p.quiet) * x) * (self.rival and 1 or audio.duck_level)
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
  if self.surface ~= kind then
    -- (on and off the rough at speed: the wheels drop over the edge)
    if self.surface and (kind == "rough" or self.surface == "rough") and speed > 5 then audio.sfx("thump", { volume = clamp(speed / 30, 0.3, 1) }) end
    self.surface = kind
  end
  -- Speed and slip as the tyres feel them: smoothed, so a jumpy value never reaches the sounds as a switch (the mixer itself only
  -- glides over ten milliseconds). The rolling loops of every surface in the mix follow them; the old surface fades out as the new one fades in.
  self.speed_s = approach(self.speed_s or speed, speed, dt, 8, 8)
  self.slip_s = approach(self.slip_s or 0, sliding, dt, 8, 4)
  local roll = clamp((self.speed_s - 0.5) / 40, 0, 1) ^ 0.8
  local fast = clamp(self.speed_s / 45, 0, 1)
  local slip_s = self.slip_s
  local weights = self.weights
  if not weights then weights = {} self.weights = weights end
  for name, s in pairs(SURFACES) do
    local w = approach(weights[name] or 0, name == kind and 1 or 0, dt, SURFACE_FADE[1], SURFACE_FADE[2])
    weights[name] = w
    local key = "surf_" .. name
    if w > 0.004 then
      local fade = math.sqrt(w) -- (equal power: the two never add up louder than one)
      set(loop(self, key, s.sound), m * s.gain * roll * fade * (1 + s.slide * slip_s), s.lo + (s.hi - s.lo) * fast + 0.06 * slip_s)
      if s.spray then
        -- the sideways spray of loose ground, a layer of its own that comes in with the slip
        local spray = clamp((slip_s - 0.15) / 0.6, 0, 1) ^ 0.8 * clamp(self.speed_s / 6, 0, 1)
        local skey = "spray_" .. name
        if spray > 0.004 or self.loops[skey] then set(loop(self, skey, "tyre_slide"), m * s.spray * spray * fade, s.spray_pitch * (0.9 + 0.2 * fast)) end
      end
      if s.stones > 0 and self.speed_s > 8 then
        -- stones against the underside: sparse and random (a few a second at full speed, fewer slower)
        local rate = s.stones * clamp((self.speed_s - 8) / 32, 0, 1) ^ 1.5 * w
        if math.random() < rate * dt then
          nova.sound.play(STONE, { volume = m * (0.25 + 0.5 * math.random()) * clamp(self.speed_s / 40, 0.4, 1), vary = 0.08 })
        end
      end
    elseif self.loops[key] then
      nova.sound.stop(self.loops[key], 0.05)
      self.loops[key] = nil
      local skey = "spray_" .. name
      if self.loops[skey] then nova.sound.stop(self.loops[skey], 0.05) self.loops[skey] = nil end
    end
  end
  -- tarmac squeals when the tyres slide, higher the more they slide
  local squeal = kind == "road" and clamp((slip_s - 0.3) / 0.6, 0, 1) * clamp(self.speed_s / 6, 0, 1) or 0
  if squeal > 0.004 or self.loops.squeal then set(loop(self, "squeal", "tyre_squeal"), m * 0.9 * squeal ^ 0.8, 0.85 + 0.35 * slip_s) end
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
    -- the turbo spins up behind the throttle (a third of a second) and only once the engine is turning fast enough to drive it.
    -- What is heard is its breath, growing with the boost and far under the engine (it was a whistle three times as loud)
    local target = raw * smoothstep(rpm, turbo.from, turbo.full)
    self.boost = self.boost + (target - self.boost) * math.min(1, dt * (target > self.boost and 3 or 9))
    set(loop(self, "turbo", "turbo_loop"), m * 0.14 * turbo.level * self.boost ^ 1.5, turbo.lo + (turbo.hi - turbo.lo) * self.boost)
    self.bov_wait = math.max(0, (self.bov_wait or 0) - dt)
    if p.bov and lifted and self.boost > 0.4 and self.bov_wait <= 0 then
      -- the charge air let go when the foot lifts under boost
      audio.sfx("bov", { volume = p.bov * (0.4 + 0.5 * self.boost), pitch = 0.6 + 0.4 * turbo.hi })
      self.bov_wait = 0.8
    end
  end
  if p.pops then
    -- the exhaust pops on the overrun: one or two after lifting off high in the revs
    if lifted and x > 0.5 and math.random() < 0.4 + 0.6 * p.pops then
      for _ = 1, 1 + math.floor(math.random() * 2 * x * p.pops) do self.pops[#self.pops + 1] = 0.08 + math.random() * 0.5 end
    end
    for i = #self.pops, 1, -1 do
      self.pops[i] = self.pops[i] - dt
      if self.pops[i] <= 0 then
        table.remove(self.pops, i)
        audio.sfx("pop", { volume = (0.4 + 0.4 * math.random()) * (0.6 + 0.4 * p.pops) })
      end
    end
  end
  if p.whine then
    -- an old gearbox hums with the road speed, louder when it is driving the wheels
    set(loop(self, "whine", "whine_loop"), m * p.whine * clamp(speed / 10, 0, 1) * (0.45 + 0.55 * self.load), clamp(0.6 + 0.9 * speed / 40, 0.6, 1.5))
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
  self.surface, self.weights = nil, nil
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

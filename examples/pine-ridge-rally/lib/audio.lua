-- Sound for the game: menu sounds, music, and the engine (a run of short pulses, faster as the engine revs).
local audio = {}

-- One room for the sound effects (nova.sound.room): how much of each is sent to it, by name. Menu sounds stay dry.
nova.sound.room { size = 0.5, damping = 0.5, mix = 0.9 }
local REVERB = { bump = 0.25, lap = 0.3, best_lap = 0.4, finish = 0.45, checkpoint = 0.2, go = 0.2, beep = 0.1, shift = 0.1, whoosh = 0.2 }

-- The balance (found by measuring each file's loudness: cargo test -p nova-runtime --test loudness -- --ignored --nocapture): each effect's own gain, so that
-- the beeps, the finish and the menu clicks sit just above the music and the engine, not over it. The effects were up to 12 dB louder than the music.
local SFX_GAIN = { beep = 0.7, go = 0.6, finish = 0.6, lap = 1.0, best_lap = 1.0, bump = 1.0, checkpoint = 1.0, menu_accept = 0.7, menu_move = 1.0, menu_back = 1.0, pause = 0.8 }
-- and each song's gain, to bring them to about the same loudness (-16 dB RMS before the volume setting)
local MUSIC_GAIN = {
  kenney_desert = 0.9, kenney_forest = 1.0, kenney_menu = 1.0, kenney_night = 0.85, kenney_results = 0.85, kenney_snow = 1.0,
  menu = 0.9, race_desert = 0.85, race_forest = 0.7, race_night = 0.85, race_snow = 0.7, results = 1.0,
}

function audio.sfx(name, opts)
  opts = opts or {}
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

-- One engine per car that makes noise, and each car's engine has its own note (sounds/eng_<car>_1 to _5, made by
-- scripts/rally/engines.mjs: combustion pulses through exhaust resonators, from a ten-cylinder's scream to a three-cylinder's lumpy
-- buzz). Five loops per car at revs spaced evenly in ratio from idle to the limit; the two nearest the car's revs are heard,
-- crossfaded, each played at the pitch that makes it the engine's note at those revs (so a loop is bent by under a half either way).
-- A rival plays four of the five, to spare voices (the mixer has 32). The gravel and the tyre squeal are loops too. Everything is changed every step with
-- nova.sound.set.
local Engine = {}
Engine.__index = Engine

local LOOPS = 5

function audio.engine(volume, car_id, rival)
  local info
  for _, c in ipairs(state.cars) do if c.id == car_id then info = c end end
  info = info or state.cars[1]
  local which = rival and { 1, 2, 4, 5 } or { 1, 2, 3, 4, 5 }
  return setmetatable({ volume = volume or 1, ids = nil, car = info, which = which }, Engine)
end

local function start(self)
  self.ids = {
    gravel = nova.sound.play("gravel_loop", { loop = true, volume = 0 }),
    skid = nova.sound.play("skid_loop", { loop = true, volume = 0 }),
  }
  for _, k in ipairs(self.which) do
    self.ids["eng" .. k] = nova.sound.play("eng_" .. self.car.id .. "_" .. k, { loop = true, volume = 0 })
  end
end

-- the rpm of the engine at these revs (0 to 1 from idle, about 0.16, to the limiter), and of loop k
local function rpm_at(car, rev_norm) return car.idle_rpm * (car.max_rpm / car.idle_rpm) ^ rev_norm end
local function loop_rpm(car, k) return rpm_at(car, (k - 1) / (LOOPS - 1)) end

-- the pitch the loops are played at for these revs: the engine's rpm over the loop's own
function audio.engine_pitch(car, rev, k)
  local norm = math.max(0, math.min(1, (rev - 0.16) / 0.84))
  return rpm_at(car, norm) / loop_rpm(car, k)
end

-- `rev` is 0 to 1, `load` 0 to 1 (how hard the throttle is down), `rough` true on loose ground, `slip` 0 to 1.
function Engine:update(dt, rev, load, rough, slip)
  if not self.ids then start(self) end
  local v, car = self.volume, self.car
  local norm = math.max(0, math.min(1, (rev - 0.16) / 0.84))
  local target = rpm_at(car, norm)
  -- the two loops on either side of the revs (of those this car plays), blended by where between them the revs are (in ratio)
  local list = self.which
  local lo, hi = list[1], list[#list]
  for i = 1, #list - 1 do
    if target >= loop_rpm(car, list[i]) and target <= loop_rpm(car, list[i + 1]) then lo, hi = list[i], list[i + 1] end
  end
  local f = 0
  if hi ~= lo then f = math.max(0, math.min(1, math.log(target / loop_rpm(car, lo)) / math.log(loop_rpm(car, hi) / loop_rpm(car, lo)))) end
  -- a little wander in the pitch so that nothing is perfectly still
  self.t = (self.t or math.random() * 10) + dt
  local wander = 1 + 0.004 * math.sin(self.t * 3.1) + 0.003 * math.sin(self.t * 8.3 + 1.3)
  local level = v * (0.35 + 0.55 * load) * (0.75 + 0.25 * norm)
  for _, k in ipairs(list) do
    local weight = (k == lo and math.cos(f * math.pi / 2)) or (k == hi and math.sin(f * math.pi / 2)) or 0
    if hi == lo then weight = (k == lo) and 1 or 0 end
    nova.sound.set(self.ids["eng" .. k], { volume = level * weight, pitch = (target / loop_rpm(car, k)) * wander })
  end
  nova.sound.set(self.ids.gravel, { volume = rough and v * (0.15 + 0.5 * rev) or 0, pitch = 0.7 + rev })
  local squeal = (slip or 0) > 0.25 and math.min(1, slip) or 0
  nova.sound.set(self.ids.skid, { volume = v * squeal * 0.8, pitch = 0.9 + 0.3 * squeal })
end

function Engine:silence()
  if not self.ids then return end
  for _, id in pairs(self.ids) do nova.sound.set(id, { volume = 0 }) end
end

function Engine:stop()
  if not self.ids then return end
  for _, id in pairs(self.ids) do nova.sound.stop(id, 0.15) end
  self.ids = nil
end

return audio

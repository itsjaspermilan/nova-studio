-- Sound for the game: menu sounds, music, and the engine (a run of short pulses, faster as the engine revs).
local audio = {}

-- One room for the sound effects (nova.sound.room): how much of each is sent to it, by name. Menu sounds stay dry.
nova.sound.room { size = 0.5, damping = 0.5, mix = 0.9 }
local REVERB = { bump = 0.25, lap = 0.3, best_lap = 0.4, finish = 0.45, checkpoint = 0.2, go = 0.2, beep = 0.1, shift = 0.1, whoosh = 0.2 }

function audio.sfx(name, opts)
  local send = REVERB[name]
  if send and not (opts and opts.reverb) then
    opts = opts or {}
    opts.reverb = send
  end
  return nova.sound.play(name, opts)
end

local state = require("lib.state")

-- The music has two styles (Options > Music style): Kenney's loops, or the songs made with the music editor (music/*.song.json).
-- A scene asks for a song by its studio name; in the Kenney style it is played as the loop that stands in for it.
local KENNEY = {
  menu = "kenney_menu", results = "kenney_results", race_forest = "kenney_forest", race_desert = "kenney_desert",
  race_snow = "kenney_snow", race_night = "kenney_night",
}
local current_music, current_opts = nil, nil
local function play(name, opts)
  local file = state.music_style == "kenney" and KENNEY[name] or name
  nova.music.play(file, opts or { volume = 0.55, fade = 0.6 })
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

-- One engine per car that makes noise. The engine is two recorded loops (sounds/engine_2 and engine_5: a real car at low and at high
-- revs, CC0 by domasx2, made audible on a small speaker by scripts/rally/engine-loops.mjs; licenses/opengameart-engine-loops.txt),
-- both played at one pitch that follows the revs over a wide range (about five times from idle to the limiter, so that the engine
-- audibly climbs through each gear and drops at each change) while the low one fades into the high one. The gravel and the tyre
-- squeal are loops too. Everything is changed every step with nova.sound.set.
local Engine = {}
Engine.__index = Engine

local LOW, HIGH = "engine_2", "engine_5"

function audio.engine(volume)
  return setmetatable({ volume = volume or 1, ids = nil }, Engine)
end

local function start(self)
  self.ids = {
    low = nova.sound.play(LOW, { loop = true, volume = 0 }),
    high = nova.sound.play(HIGH, { loop = true, volume = 0 }),
    gravel = nova.sound.play("gravel_loop", { loop = true, volume = 0 }),
    skid = nova.sound.play("skid_loop", { loop = true, volume = 0 }),
  }
end

-- the playback pitch for these revs (0 to 1; idle is about 0.16): from about 1 at idle to 3.4 at the limiter
function audio.engine_pitch(rev) return 0.6 + 2.8 * rev end

-- `rev` is 0 to 1, `load` 0 to 1 (how hard the throttle is down), `rough` true on loose ground, `slip` 0 to 1.
function Engine:update(dt, rev, load, rough, slip)
  if not self.ids then start(self) end
  local v = self.volume
  -- the low loop gives way to the high one between 0.2 and 0.8 of the revs (equal power, so the loudness holds)
  local f = math.max(0, math.min(1, (rev - 0.2) / 0.6))
  local low, high = math.cos(f * math.pi / 2), math.sin(f * math.pi / 2)
  -- a little wander in the pitch so that nothing is perfectly still
  self.t = (self.t or math.random() * 10) + dt
  local wander = 1 + 0.006 * math.sin(self.t * 3.1) + 0.004 * math.sin(self.t * 8.3 + 1.3)
  local pitch = audio.engine_pitch(rev) * wander
  local level = v * (0.3 + 0.6 * load) * (0.7 + 0.3 * rev)
  nova.sound.set(self.ids.low, { volume = level * low, pitch = pitch })
  nova.sound.set(self.ids.high, { volume = level * high, pitch = pitch })
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

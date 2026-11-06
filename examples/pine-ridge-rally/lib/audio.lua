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

-- One engine per car that makes noise. The engine itself is recorded loops (sounds/engine_1 to engine_6: a real car held at six
-- revs, CC0 by domasx2, see licenses/opengameart-engine-loops.txt): they all play while the car is on the track, and the two nearest
-- the revs are heard, crossfaded, each pitched so that the mix rises smoothly between them. A rival hears three of the six (to spare
-- voices). The gravel and the tyre squeal are loops too. Everything is changed every step with nova.sound.set.
local Engine = {}
Engine.__index = Engine

-- the revs (0 to 1) each loop stands for, and what it sounds like (its pitch, in Hz, as measured)
local LOOP_REV = { 0.16, 0.32, 0.5, 0.68, 0.84, 1.0 }
local LOOP_HZ = { 43.2, 60.1, 65.2, 69.7, 72.7, 76.6 }

function audio.engine(volume, rival)
  return setmetatable({ volume = volume or 1, ids = nil, which = rival and { 1, 3, 6 } or { 1, 2, 3, 4, 5, 6 } }, Engine)
end

local function start(self)
  self.ids = {
    gravel = nova.sound.play("gravel_loop", { loop = true, volume = 0 }),
    skid = nova.sound.play("skid_loop", { loop = true, volume = 0 }),
  }
  self.loops = {}
  for _, i in ipairs(self.which) do
    self.loops[#self.loops + 1] = i
    self.ids["engine" .. i] = nova.sound.play("engine_" .. i, { loop = true, volume = 0 })
  end
end

-- the sound of the revs: where between the loops they are (the loops this car has, by their revs), and the pitch each plays at
local function crossfade(self, rev)
  local weights, pitches = {}, {}
  local list = self.loops
  -- the pitch the engine should have at these revs: between the loops' own pitches
  local target
  for k = 1, #list do
    local i = list[k]
    local j = list[k + 1]
    if not j or rev <= LOOP_REV[j] or k == #list then
      if not j then target = LOOP_HZ[i] * (1 + 0.25 * math.max(0, rev - LOOP_REV[i]))
      else
        local f = math.max(0, math.min(1, (rev - LOOP_REV[i]) / (LOOP_REV[j] - LOOP_REV[i])))
        target = LOOP_HZ[i] + (LOOP_HZ[j] - LOOP_HZ[i]) * f
        weights[i], weights[j] = math.cos(f * math.pi / 2), math.sin(f * math.pi / 2)
      end
      if rev < LOOP_REV[list[1]] then target = LOOP_HZ[list[1]] * (0.85 + 0.15 * rev / LOOP_REV[list[1]]) end
      if not j then weights[i] = 1 end
      break
    end
  end
  for _, i in ipairs(list) do pitches[i] = math.max(0.6, math.min(1.6, target / LOOP_HZ[i])) end
  return weights, pitches
end

-- `rev` is 0 to 1, `load` 0 to 1 (how hard the throttle is down), `rough` true on loose ground, `slip` 0 to 1.
function Engine:update(dt, rev, load, rough, slip)
  if not self.ids then start(self) end
  local v = self.volume
  local weights, pitches = crossfade(self, rev)
  -- louder as the engine works; a gentle wander in the pitch so that nothing is perfectly still
  self.t = (self.t or math.random() * 10) + dt
  local wander = 1 + 0.006 * math.sin(self.t * 3.1) + 0.004 * math.sin(self.t * 8.3 + 1.3)
  local level = v * (0.35 + 0.55 * load) * (0.75 + 0.25 * rev)
  for _, i in ipairs(self.loops) do
    nova.sound.set(self.ids["engine" .. i], { volume = level * (weights[i] or 0), pitch = pitches[i] * wander })
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

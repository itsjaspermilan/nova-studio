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

local current_music = nil
function audio.music(name, opts)
  if current_music == name then return end
  current_music = name
  nova.music.play(name, opts or { volume = 0.55, fade = 0.6 })
end
function audio.stop_music(fade)
  current_music = nil
  nova.music.stop(fade or 0.5)
end

-- One engine per car that makes noise: three loops that play all the time while the car is on the track, and whose
-- pitch and volume are changed every step with nova.sound.set: the engine follows the revs, the gravel follows the
-- loose ground under the wheels, the squeal follows how much the tyres slide.
local Engine = {}
Engine.__index = Engine

function audio.engine(volume)
  return setmetatable({ volume = volume or 1, ids = nil }, Engine)
end

local function start(self)
  self.ids = {
    engine = nova.sound.play("engine_loop", { loop = true, volume = 0, pitch = 0.8 }),
    body = nova.sound.play("engine_body", { loop = true, volume = 0, pitch = 0.8 }),
    gravel = nova.sound.play("gravel_loop", { loop = true, volume = 0 }),
    skid = nova.sound.play("skid_loop", { loop = true, volume = 0 }),
  }
end

-- `rev` is 0 to 1, `load` 0 to 1 (how hard the throttle is down), `rough` true on loose ground, `slip` 0 to 1.
function Engine:update(dt, rev, load, rough, slip)
  if not self.ids then start(self) end
  local v = self.volume
  -- a low rumble that rises gently with the revs, with a soft body above it that comes in as the engine works
  -- a steady loop drones: an engine's pitch and loudness are never quite still, so both wander a little (slowly) and pulse with the
  -- revs (the cylinders firing), more when the engine is working
  self.t = (self.t or math.random() * 10) + dt
  local t = self.t
  local wander = 1 + 0.012 * math.sin(t * 3.1) + 0.008 * math.sin(t * 7.9 + 1.3) + 0.005 * math.sin(t * 13.3)
  local pulse = 1 + (0.05 + 0.08 * load) * math.sin(t * (14 + 40 * rev)) + 0.04 * math.sin(t * 2.3)
  local pitch = (0.8 + 1.5 * rev) * wander
  nova.sound.set(self.ids.engine, { volume = v * (0.16 + 0.4 * load) * pulse, pitch = pitch })
  nova.sound.set(self.ids.body, { volume = v * (0.04 + 0.22 * load) * (0.4 + 0.6 * rev) * (2 - pulse), pitch = pitch * 1.003 })
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

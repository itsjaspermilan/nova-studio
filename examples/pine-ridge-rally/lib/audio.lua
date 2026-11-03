-- Sound for the game: menu sounds, music, and the engine (a run of short pulses, faster as the engine revs).
local audio = {}

function audio.sfx(name, opts) return nova.sound.play(name, opts) end

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
    engine = nova.sound.play("engine_loop", { loop = true, volume = 0, pitch = 0.6 }),
    gravel = nova.sound.play("gravel_loop", { loop = true, volume = 0 }),
    skid = nova.sound.play("skid_loop", { loop = true, volume = 0 }),
  }
end

-- `rev` is 0 to 1, `load` 0 to 1 (how hard the throttle is down), `rough` true on loose ground, `slip` 0 to 1.
function Engine:update(dt, rev, load, rough, slip)
  if not self.ids then start(self) end
  local v = self.volume
  nova.sound.set(self.ids.engine, { volume = v * (0.22 + 0.55 * load), pitch = 0.6 + 2.2 * rev })
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

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

-- One engine per car that makes noise. `rev` is 0 to 1, `load` 0 to 1 (throttle).
local Engine = {}
Engine.__index = Engine

function audio.engine(volume)
  return setmetatable({ acc = 0, volume = volume or 1, gravel = 0, skid = 0 }, Engine)
end

function Engine:update(dt, rev, load, surface_rough, slip)
  local rate = 11 + 40 * rev                       -- pulses per second
  self.acc = self.acc + dt * rate
  local n = 0
  while self.acc >= 1 and n < 3 do
    self.acc = self.acc - 1
    n = n + 1
    nova.sound.play("engine", { volume = self.volume * (0.28 + 0.5 * load), pitch = 0.75 + 1.1 * rev })
  end
  if self.acc >= 1 then self.acc = 0 end
  if surface_rough then
    self.gravel = self.gravel - dt
    if self.gravel <= 0 then
      self.gravel = 0.07
      nova.sound.play("gravel", { volume = self.volume * 0.6, pitch = 0.8 + math.random() * 0.5 })
    end
  end
  if slip and slip > 0.25 then
    self.skid = self.skid - dt
    if self.skid <= 0 then
      self.skid = 0.22
      nova.sound.play("skid", { volume = self.volume * math.min(1, slip), pitch = 0.9 + math.random() * 0.3 })
    end
  end
end

return audio

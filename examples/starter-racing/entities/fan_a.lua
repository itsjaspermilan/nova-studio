-- a spectator (man_a) at half life size (place it with "props": { "sx": 2 }), with clips static, idle, watch, cheer, clap and wave.
local Spectator = nova.entity { model = "fan_a", on_ground = true, velocity = false }

function Spectator:create()
  self:play_clip("idle", { time = (self.x * 0.37 + (self.z or 0) * 0.61) % 2 })
end

return Spectator

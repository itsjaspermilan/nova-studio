local state = require("lib.state")

local Checkpoint = nova.entity { tags = { "checkpoint" }, velocity = false }

function Checkpoint:update(dt)
  local p = nova.first("player")
  if not p then return end
  local dx, dz = p.x - self.x, p.z - self.z
  if dx * dx + dz * dz < 2.5 and math.abs(p.y - self.y) < 1.5 and not self.on then
    self.on = true
    state.respawn = { x = self.x, y = self.y + 0.01, z = self.z }
    state.say("checkpoint")
    nova.sound.play("gem", { volume = 0.5, pitch = 0.7 })
  end
end

function Checkpoint:draw()
  local c = self.on and { 90, 255, 120 } or { 255, 255, 255 }
  nova.cuboid_at(self.x, self.y + 0.9, self.z, 0.12, 1.8, 0.12, { color = { 200, 200, 210 } })
  nova.cuboid_at(self.x + 0.35, self.y + 1.6, self.z, 0.6, 0.35, 0.05, { color = c, glow = self.on })
end

return Checkpoint

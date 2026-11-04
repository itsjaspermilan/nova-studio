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
  nova.model("sign", self.x, self.y, self.z, { scale = 2.6, tint = self.on and { 120, 255, 140 } or { 255, 255, 255 } })
end

return Checkpoint

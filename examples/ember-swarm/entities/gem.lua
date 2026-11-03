local state = require("lib.state")

-- Experience: lies where the enemy died, and flies to the player when he is near.
local Gem = nova.entity { model = "gem", tags = { "gem" } }

function Gem:create() self.value = self.value or 1 end

function Gem:update(dt)
  local p = nova.first("player")
  if not p then return end
  local dx, dz = p.x - self.x, p.z - self.z
  local d2 = dx * dx + dz * dz
  self.ry = (self.ry or 0) + dt * 2
  self.y = 0.5 + math.sin(nova.time() * 4 + self.x) * 0.1
  if d2 < 0.8 then
    state.xp = state.xp + self.value
    nova.sound.play("gem", { volume = 0.3, pitch = 0.9 + math.random() * 0.4, limit = 6 })
    self:destroy()
  elseif d2 < state.magnet * state.magnet then
    local d = math.sqrt(d2)
    local pull = 14 * dt
    self.x, self.z = self.x + dx / d * pull, self.z + dz / d * pull
  end
end

return Gem

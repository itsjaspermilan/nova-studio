local state = require("lib.state")

local Gem = nova.entity { tags = { "gem" }, velocity = false }

function Gem:create() self.age = math.random() * 6 end

function Gem:update(dt)
  self.age = self.age + dt
  local p = nova.first("player")
  if not p then return end
  local dx, dy, dz = p.x - self.x, (p.y + 0.8) - self.gy, p.z - self.z
  if dx * dx + dy * dy + dz * dz < 1.1 then
    state.gems = state.gems + 1
    nova.sound.play("gem", { volume = 0.5, pitch = 0.9 + 0.03 * state.gems, limit = 3 })
    self:destroy()
  end
end

function Gem:draw()
  local y = self.gy + math.sin(self.age * 3) * 0.1
  nova.cuboid_at(self.x, y, self.z, 0.32, 0.32, 0.32, { ry = self.age * 2, rx = 0.6, color = { 90, 230, 255 }, glow = true })
end

return Gem

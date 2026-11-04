local state = require("lib.state")
local Level = require("lib.level")

local Flag = nova.entity { tags = { "flag" }, velocity = false }

function Flag:update(dt)
  self.age = (self.age or 0) + dt
  local p = nova.first("player")
  if not p or state.won then return end
  local dx, dz = p.x - self.x, p.z - self.z
  if dx * dx + dz * dz < 2 and math.abs(p.y - self.y) < 2 then
    if state.gems >= Level.GOAL_GEMS then
      state.won = true
      nova.sound.play("win", { volume = 0.6 })
    else
      state.say(string.format("%d more gems for the flag", Level.GOAL_GEMS - state.gems), 1)
    end
  end
end

function Flag:draw()
  local wave = math.sin((self.age or 0) * 5) * 0.08
  nova.cuboid_at(self.x, self.y + 1.5, self.z, 0.14, 3, 0.14, { color = { 220, 220, 230 } })
  nova.cuboid_at(self.x + 0.6, self.y + 2.6 + wave, self.z, 1.1, 0.7, 0.05, { color = { 255, 90, 120 }, glow = true })
end

return Flag

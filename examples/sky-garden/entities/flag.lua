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
    nova.model("flag", self.x, self.y, self.z, { scale = 3.4, ry = math.sin((self.age or 0) * 2) * 0.1 })
end

return Flag

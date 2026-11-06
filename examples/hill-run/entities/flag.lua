local state = require("lib.state")

local Flag = nova.entity { tags = { "flag" }, velocity = false }

function Flag:update(dt)
  self.age = (self.age or 0) + dt
  local p = nova.first("player")
  if not p or state.won then return end
  local dx, dz = p.x - self.x, p.z - self.z
  if dx * dx + dz * dz < 4 and math.abs(p.y - self.y) < 2.5 then
    if state.gems >= GOAL_GEMS then
      state.won = true
      nova.log(string.format("hill: flag reached with %d gems in %.1f s, %d hops, %d slide frames", state.gems, state.time, state.hops, state.slide_frames))
      nova.sound.play("win", { volume = 0.6 })
    else
      state.say(string.format("%d more gems for the flag", GOAL_GEMS - state.gems), 1)
    end
  end
end

function Flag:draw()
  nova.model("flag", self.x, self.y, self.z, { scale = 3.4, ry = math.sin((self.age or 0) * 2) * 0.1 })
end

return Flag

local state = require("lib.state")
local fx = require("lib.fx")

-- The way out: lit when the boss is dead.
local Exit = nova.entity { tags = { "exit" } }

function Exit:update(dt)
  local p = nova.first("player")
  if not p or not state.exit_open or state.won or state.dead then return end
  local dx, dz = p.x - self.x, p.z - self.z
  if dx * dx + dz * dz < 4 then
    state.won = true
    nova.input.grab_mouse(false)
    nova.sound.play("win", { volume = 0.9 })
  end
end

function Exit:draw()
  local on = state.exit_open
  local c = on and { 90, 255, 150 } or { 80, 40, 40 }
  nova.cuboid(self.x - 1.2, 0, self.z - 0.1, self.x + 1.2, 2.6, self.z + 0.1, { color = c, glow = on })
  if on then fx.want_light(self.x, 1.6, self.z, 12, { 0.4, 1, 0.6 }, -40) end
end

return Exit

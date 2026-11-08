-- The 2D toybox: everything in it is placed in stack.scene.json; this only drops crates and draws the words.
local hud = require("lib.hud")
local Stack = nova.scene {}

function Stack:enter() self.t = 0 end

function Stack:update(dt)
  self.t = self.t + dt
  hud.common(dt, "stack", "pile")
  local drop = nova.input.pressed("drop") or (hud.auto and self.t % 2.5 < dt)
  if drop then
    nova.spawn("crate2", 480 + math.random(-260, 360), -30, { angle = math.random() * 0.6 - 0.3 })
  end
  if hud.auto and self.t > 30 then nova.goto_scene("pile") end
end

function Stack:draw_ui()
  hud.title("Knock it down", "bodies: " .. nova.physics.count())
  hud.hints({ { "pad_dpad", "Aim" }, { "pad_a", "Fire" }, { "pad_y", "Drop a crate" }, { "pad_x", "Put back" }, { "pad_r", "3D yard" } })
end

return Stack

-- The 3D toybox: the yard, the crates, the barrels, the door and the walker are all in pile.scene.json.
local hud = require("lib.hud")
local Pile = nova.scene {}

function Pile:enter()
  self.t = 0
  nova.collision { plane = "xz", cell = 4 }
  nova.light { dir = { -0.4, -0.8, -0.3 }, color = { 255, 245, 225 }, ambient = { 95, 100, 120 } }
end

function Pile:update(dt)
  self.t = self.t + dt
  hud.common(dt, "pile", "stack")
  if hud.auto and self.t > 40 then nova.goto_scene("stack") end
end

function Pile:draw_ui()
  hud.title("The yard", "bodies: " .. nova.physics.count())
  hud.hints({ { "pad_stick_l", "Walk" }, { "pad_a", "Throw" }, { "pad_y", "Drop a crate" }, { "pad_x", "Put back" }, { "pad_l", "2D stack" } })
end

return Pile

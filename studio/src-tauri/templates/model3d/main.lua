-- A 3D starter: a crate (models/crate.glb, made in the Model workspace) that you turn with the arrow keys, A and D, or the stick.
-- Press Play, then change something here and save: the game reloads.

local turn = 0.6
local lean = 0.25

function update(dt)
  turn = turn + nova.input.axis("move_x") * 2.2 * dt
  lean = math.max(-0.3, math.min(1.2, lean + nova.input.axis("move_y") * 1.4 * dt))
end

function draw()
  nova.clear(40, 60, 90)
  nova.light { dir = { -0.4, -1, -0.6 }, ambient = { 70, 70, 85 } }
  nova.camera(0, 1.4, 3.6, 0, 0.5, 0, 50)
  nova.model("crate", 0, 0, 0, { ry = turn, rx = lean })
  nova.ui.text(24, 24, "Hello, 3D!", { size = 32 })
  nova.ui.text(24, 70, "Turn the crate with the arrow keys, A, D, W and S, or the stick. Open models/crate.model.json to change it.", { size = 16, color = { 190, 200, 220 } })
end

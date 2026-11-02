-- A blank Nova game. This file runs when the game starts; `update` and `draw` run every frame.
-- Press Run in the studio to play it, then change something here and save: the game reloads.

local x = 100

function update(dt)
  x = x + nova.input.axis("move_x") * 240 * dt
end

function draw()
  nova.clear(40, 60, 90)
  nova.rect(x - 20, 240, 40, 40, { 255, 200, 80 })
  nova.ui.text(24, 24, "Hello, Nova!", { size = 32 })
  nova.ui.text(24, 70, "Move with the arrow keys, A and D, or the gamepad.", { size = 16, color = { 190, 200, 220 } })
end

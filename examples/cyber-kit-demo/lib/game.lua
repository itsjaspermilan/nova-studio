-- What every scene does when it starts, and the HUD: cyber hearts and charge pips from items_make's city icons.
local game = { hearts = 5, charge = 2 } -- hearts in halves: 5 is two and a half

function game.enter(scene, x, y)
  local runner = scene.runner -- the scene file names the runner object "runner"
  if x then runner.x, runner.y = x, y end
  nova.cam.follow(runner, 0.15, true)
  nova.log("entered " .. nova.current_scene())
end

-- icons: frame 0 heart full, 1 half, 2 empty, 3 charge full, 4 charge empty
function game.draw_ui()
  for i = 1, 3 do
    local frame = game.hearts >= i * 2 and 0 or (game.hearts == i * 2 - 1 and 1 or 2)
    nova.ui.sprite("icons", 10 + i * 52, 36, { frame = frame, sx = 1.5, sy = 1.5 })
  end
  for i = 1, 3 do nova.ui.sprite("icons", 196 + i * 30, 36, { frame = i <= game.charge and 3 or 4, sx = 1.5, sy = 1.5 }) end
end

return game

-- What lasts from scene to scene (hearts, coins), what every scene does when it starts, and the HUD.
local game = { hearts = 6, coins = 0 } -- hearts are counted in halves: 6 is three whole hearts

-- `music` is the song for the place, `step` the footstep sound; x, y is where the door the hero came through puts him.
function game.enter(scene, x, y, music, step)
  local hero = scene.hero -- the scene file names the hero object "hero"
  if x then hero.x, hero.y = x, y end
  hero.step_sound = step
  nova.cam.follow(hero, 0.15, true)
  nova.music.play(music, { volume = 0.35, fade = 0.4 })
  nova.log("entered " .. nova.current_scene())
end

-- Hearts from the items sheet: frame 0 is full, 1 half, 2 empty. The coin is frame 4.
function game.draw_ui()
  for i = 1, 3 do
    local frame = game.hearts >= i * 2 and 0 or (game.hearts == i * 2 - 1 and 1 or 2)
    nova.ui.sprite("items", 10 + i * 52, 40, { frame = frame, sx = 3, sy = 3 })
  end
  nova.ui.sprite("items", 880, 40, { frame = 4, sx = 3, sy = 3 })
  nova.ui.text(906, 28, tostring(game.coins), { font = "pixel", size = 24, shadow = true })
end

return game

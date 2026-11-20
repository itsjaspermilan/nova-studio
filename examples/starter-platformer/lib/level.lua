-- What both scenes do: follow the hero with the camera, play the music, show the gems and the keys to press.
-- The layout itself (ground, planks, the slime, gems, doors) is in scenes/<name>.scene.json, painted with scene_write.
local level = { gems = 0 }

function level.enter(scene)
  scene.floor = nova.scene_data(nova.current_scene()).height or 540 -- below this the hero has fallen out
  nova.cam.follow(scene.hero, 0.12, true) -- smooth, but on him at once (`true`)
  nova.music.play("field", { volume = 0.35 })
  nova.log("entered " .. nova.current_scene())
end

function level.draw_ui(text)
  nova.ui.sprite("items", 40, 34, { frame = 8, sx = 3, sy = 3 })
  nova.ui.text(72, 22, tostring(level.gems), { font = "pixel", size = 24, shadow = true })
  nova.ui.text(16, 500, text, { font = "pixel", size = 16, shadow = true })
end

return level

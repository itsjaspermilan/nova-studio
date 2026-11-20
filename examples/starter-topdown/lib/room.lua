-- What both scenes do when they start: put the hero where the door he came through says, and point the camera at him.
-- The layout itself (tiles, the hero, rocks, doors) is in scenes/<name>.scene.json, made with the scene tools.
local room = {}

function room.enter(scene, x, y)
  local hero = scene.hero -- the scene file names the hero object "hero", so it is a field of the scene
  if x then hero.x, hero.y = x, y end
  -- Follow smoothly, but start on him at once (`true`), or the camera would glide across the room after a door.
  -- The scene file's width and height keep the view inside the room; a room smaller than the screen is centred.
  nova.cam.follow(hero, 0.15, true)
  nova.log("entered " .. nova.current_scene())
end

return room

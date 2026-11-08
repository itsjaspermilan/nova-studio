-- Where a world begins on the map. Props: id (its levels are scenes/levels/<id>-<n>.scene.json), name, music, sky. Not seen in the game.
return nova.entity {
  sprite = "ui/star", sx = 0.3, sy = 0.3, visible = false,
  settings = {
    id = { "", help = "Its levels are scenes/levels/<id>-<n>.scene.json" },
    name = { "", help = "The world's name, shown on the map" },
    music = { type = "music", help = "The song of its levels" },
    sky = { "grass", choices = { "grass", "sand", "snow", "castle", "meadow" }, help = "The backdrop of its levels" },
  },
}

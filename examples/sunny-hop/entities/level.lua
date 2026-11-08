-- The level's settings, as its props (read by lib/levels.lua and scenes/play.lua). Not seen in the game.
local SKIES = { "", "grass", "sand", "snow", "castle", "meadow" }
local BOSSES = { "", "king_slime", "sand_snail", "frost_block", "fire_king" }
return nova.entity {
  sprite = "ui/watch", sx = 0.5, sy = 0.5, visible = false,
  settings = {
    name = { "", help = "The level's name, shown on the map and when it starts" },
    target = { type = "number", min = 10, max = 600, step = 1, help = "Seconds to beat for the time star" },
    music = { type = "music", help = "The song (left empty: the world's)" },
    sky = { "", choices = SKIES, help = "The backdrop (left empty: the world's)" },
    slippery = { false, help = "Icy ground: the hero slides" },
    boss = { "", choices = BOSSES, help = "The level is a fight with this boss" },
  },
}

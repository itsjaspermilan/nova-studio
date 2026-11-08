-- A level's settings, kept in its scene file (scenes/levels/<n>.scene.json) as this object's props. lib/levels.lua reads them with the
-- kitchen's pieces (straight from the file, with nova.scene_data: so every level gives each of them); the object itself does nothing.
-- recipes (the potions ordered, such as { "heal", "night" }) and crates (the ingredients in crates 1 to 4) are lists of names.
local Level = nova.entity {
  settings = {
    id = { "", help = "A short id the save file keeps the stars under (m1, r2...): do not change it once people play" },
    name = { "", help = "The level's name, on its page of the potion book" },
    biome = { 1, choices = { 1, 2, 3, 4 }, help = "1 Greenhollow Meadow, 2 Frostpeak Hollow, 3 Emberdeep Caverns, 4 Gloomwater Mire" },
    time = { 180, min = 30, max = 3600, step = 10, help = "Seconds the level lasts" },
    interval = { 30, min = 5, max = 9999, step = 1, help = "Seconds between new orders" },
    patience = { 90, min = 10, max = 99999, step = 1, help = "Seconds a customer waits for an order" },
    stars = { { 100, 200, 300 }, min = 0, step = 5, help = "The scores for one, two and three stars" },
    tip = { "", help = "The tip shown before the level starts" },
    tutorial = { false, help = "The Primer: the tutorial level" },
  },
}

return Level

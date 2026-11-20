-- A tiny game made with ONLY the makers and ordinary Lua: no sprite was typed pixel by pixel, no map tile by tile.
--   tiles    tileset_make { name = "tiles", palette = "bright meadow" }
--   hero     character_make { name = "hero", outfit = "tunic", outfit_color = "green", item = "sword" }
--   enemies  creature_make { name = "slime", kind = "slime", color = "pink" }, { name = "bat", kind = "bat" }
--   icons    items_make { name = "items" }
--   sounds   sfx_write { name = "hit", purpose = "hit" } and eight more purposes
--   music    song_make { name = "village", mood = "calm village" }, { name = "cellar", mood = "dungeon", seed = 3 }
--   maps     scene_write with "paint": the two character maps are in tools/meadow.json and tools/room.json
-- Read entities/hero.lua first.
nova.start("meadow")

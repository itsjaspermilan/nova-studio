-- A kit demo made with ONLY the makers (all in "style": "detailed") and a little Lua (every call is in tools/make.json):
--   tiles    tileset_make { name = "market", palette = "gutter market" } and { name = "labs", palette = "bloom labs" }
--   people   character_make: the runner (long_coat, visor, baton) and a Scrapper (hoodie, mohawk, pipe)
--   enemies  creature_make: rat_drone, hover_drone, vending_mimic
--   icons    items_make { name = "icons", palette = "gutter market" }
--   rooms    scene_write with "paint": tools/street.json and tools/lab.json
nova.start("street")

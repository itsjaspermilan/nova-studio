-- Room A: the open market square. Everything is in lib/fightroom.lua; the map, doors and spawn points are in market_a.scene.json.
return nova.scene(require("lib.fightroom"), { room = "market_a", first = true })

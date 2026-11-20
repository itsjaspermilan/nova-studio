-- s3_tram: the room's shape, doors and spawn points are in s3_tram.scene.json; everything else is lib/fightroom.lua.
return nova.scene(require("lib.fightroom"), { room = "gutter.s3_tram" })

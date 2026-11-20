-- s3_flood: the room's shape, doors and spawn points are in s3_flood.scene.json; everything else is lib/fightroom.lua.
return nova.scene(require("lib.fightroom"), { room = "gutter.s3_flood" })

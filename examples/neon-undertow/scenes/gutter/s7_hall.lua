-- s7_hall: the room's shape, doors and spawn points are in s7_hall.scene.json; everything else is lib/fightroom.lua.
return nova.scene(require("lib.fightroom"), { room = "gutter.s7_hall" })

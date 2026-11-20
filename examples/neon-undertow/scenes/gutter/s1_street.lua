-- s1_street: the room's shape, doors and spawn points are in s1_street.scene.json; everything else is lib/fightroom.lua.
return nova.scene(require("lib.fightroom"), { room = "gutter.s1_street" })

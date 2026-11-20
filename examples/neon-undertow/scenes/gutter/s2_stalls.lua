-- s2_stalls: the room's shape, doors and spawn points are in s2_stalls.scene.json; everything else is lib/fightroom.lua.
return nova.scene(require("lib.fightroom"), { room = "gutter.s2_stalls" })

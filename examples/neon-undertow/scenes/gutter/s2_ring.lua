-- s2_ring: the room's shape, doors and spawn points are in s2_ring.scene.json; everything else is lib/fightroom.lua.
return nova.scene(require("lib.fightroom"), { room = "gutter.s2_ring" })

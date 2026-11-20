-- walk: the room's shape, doors and spawn points are in walk.scene.json; everything else is lib/quietroom.lua.
return nova.scene(require("lib.quietroom"), { room = "gutter.walk" })

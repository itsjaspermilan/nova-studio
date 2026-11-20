-- s2_maze: the room's shape, doors and spawn points are in s2_maze.scene.json; everything else is lib/fightroom.lua.
return nova.scene(require("lib.fightroom"), { room = "gutter.s2_maze" })

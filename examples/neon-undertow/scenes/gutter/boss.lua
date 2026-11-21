-- boss: the room's shape, doors and spawn points are in boss.scene.json; the fight is lib/bossroom.lua (Mother Coil: entities/mother_coil.lua).
return nova.scene(require("lib.bossroom"), { room = "gutter.boss", boss = "mother_coil" })

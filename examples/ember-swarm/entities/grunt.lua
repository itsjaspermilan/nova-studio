-- A grunt: see enemy.lua for what all of them do.
return nova.entity(require("entities.enemy"), { model = "grunt", hitbox = { r = 0.6 }, hp = 3, speed = 3.4, radius = 0.6, damage = 8, gem = 1, sx = 1 })

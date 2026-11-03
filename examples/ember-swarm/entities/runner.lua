-- A runner: see enemy.lua for what all of them do.
return nova.entity(require("entities.enemy"), { model = "runner", hitbox = { r = 0.5625, base = 0, height = 1.25 }, hp = 1, speed = 6.2, radius = 0.45, damage = 5, gem = 1, sx = 0.8 })

-- A mouse: scurries fast and runs off ledges.
return nova.entity(require("entities.enemy"), { sprite = "enemies/mouse", bw = 44, bh = 30, speed = 130, ledges = "fall", anim_rate = 10 })

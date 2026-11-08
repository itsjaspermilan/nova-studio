-- A fire slime (the castle's): quicker than a green one, and it does not turn at ledges.
return nova.entity(require("entities.enemy"), { sprite = "enemies/fireslime", bw = 38, bh = 30, speed = 80, ledges = "fall" })

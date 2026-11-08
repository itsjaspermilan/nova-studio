-- On the north side of its cell (ry turns it to the west, south or east side). Walls and windows stop the mover and the furniture; doorways do not.
return nova.entity(require("entities.piece"), { model = "wall" })

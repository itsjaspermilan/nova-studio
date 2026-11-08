-- A fly: like a bee, but its line goes up and down unless told otherwise (vertical = false).
local Bee = require("entities.bee")
return nova.entity(Bee, { sprite = "enemies/fly", bw = 36, bh = 36, vertical = true, range = 2, period = 3 })

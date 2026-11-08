-- Moving Day: a cosy push-and-turn furniture puzzle. You are the mover; each client has a wish card ("the sofa facing the TV", "the plant by the
-- window", "the bed against the wall") and the flat is solved when every wish holds. Levels are scene files (scenes/levels/<n>.scene.json).
local state = require("lib.state")

state.load()
nova.start("title")

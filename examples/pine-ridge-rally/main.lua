-- Pine Ridge Rally: two circuits, three rivals, a chase camera.
-- The game is scenes (scenes/), the things in them (entities/) and a few helpers (lib/).
local state = require("lib.state")

state.load()
require("lib.controls").load() -- the keys and buttons the player chose
nova.start("title")

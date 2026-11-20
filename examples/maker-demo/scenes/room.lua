-- Inside the house: a second painted map (floorboards, flagstones, brick walls), a chest, and the door back out.
local game = require("lib.game")
local Room = nova.scene {}

function Room:enter(x, y) game.enter(self, x, y, "cellar", "step_stone") end

function Room:draw_ui() game.draw_ui() end

return Room

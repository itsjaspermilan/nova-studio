-- Bloom Labs: a second painted room in the other district's palette (tanks, glass walls, servers, a vent that puffs).
local game = require("lib.game")
local Lab = nova.scene {}

function Lab:enter(x, y) game.enter(self, x, y) end

function Lab:draw_ui() game.draw_ui() end

return Lab

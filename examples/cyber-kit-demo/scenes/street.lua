-- The Gutter Market: one painted street (scenes/street.scene.json, from tools/street.json) with a Scrapper, a rat-drone,
-- a hover drone and a vending machine that is not one. The open shutter leads to the lab.
local game = require("lib.game")
local Street = nova.scene {}

function Street:enter(x, y) game.enter(self, x, y) end

function Street:draw_ui()
  game.draw_ui()
  nova.ui.text(16, 506, "Walk: stick or arrows   Baton: X or J   The open shutter leads to the lab", { font = "pixel", size = 16, shadow = true })
end

return Street

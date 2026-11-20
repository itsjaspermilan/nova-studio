-- Outside: one painted map (scenes/meadow.scene.json) with the hero, two slimes, two bats, coins and the house's door.
local game = require("lib.game")
local Meadow = nova.scene {}

function Meadow:enter(x, y) game.enter(self, x, y, "village", "step_grass") end

function Meadow:draw_ui()
  game.draw_ui()
  nova.ui.text(16, 506, "Walk: arrows or stick   Sword: Z or A   The house has a chest", { font = "pixel", size = 16, shadow = true })
end

return Meadow

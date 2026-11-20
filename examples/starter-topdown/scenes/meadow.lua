-- Outside: grass, a path, hedges, a pond, trees and the house. Two tile layers: "ground" behind everything, and
-- "crowns" (the tops of the trees) in front of everything, so the hero walks behind them.
local room = require("lib.room")
local Meadow = nova.scene {}

function Meadow:enter(x, y) room.enter(self, x, y) end

function Meadow:draw_ui()
  nova.ui.text(16, 12, "Walk into the house", { font = "pixel", size = 16, shadow = true })
end

return Meadow

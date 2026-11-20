-- Outside: a hillside to run and jump along, planks over a gap, a slime, three gems, and a door into the cave.
local level = require("lib.level")
local Hill = nova.scene {}

function Hill:enter() level.enter(self) end
function Hill:draw_ui() level.draw_ui("Run: arrows or stick   Jump: Z or A   Door: up") end

return Hill

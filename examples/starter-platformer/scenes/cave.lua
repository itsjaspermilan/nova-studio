-- Inside: a small cave with a climb of planks, a gem at the top, and the door back out.
local level = require("lib.level")
local Cave = nova.scene {}

function Cave:enter() level.enter(self) end
function Cave:draw_ui() level.draw_ui("Hold down to drop through a plank") end

return Cave

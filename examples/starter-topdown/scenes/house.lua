-- Inside the house: a room smaller than the screen (480 x 384 units), so the camera centres it.
local room = require("lib.room")
local House = nova.scene {}

function House:enter(x, y) room.enter(self, x, y) end

return House

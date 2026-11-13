local rect = require("lib.view").rect
-- A ladder. x is its middle and y its TOP; put the top level with the ledge or the ground it leads to. Up (or down at the top) grabs it, up and down climb,
-- jumping lets go. Its height is set in the scene editor.
local Ladder = nova.entity {
  tags = { "ladder" },
  velocity = false,
  depth = -3,
  w = 20,
  settings = {
    h = { 120, min = 20, max = 600, step = 4, help = "How tall it is" },
  },
}

function Ladder:draw()
  rect(self.x - 8, self.y, 3, self.h, { 150, 105, 60 })
  rect(self.x + 5, self.y, 3, self.h, { 150, 105, 60 })
  for y = 8, self.h - 4, 12 do rect(self.x - 8, self.y + y, 16, 3, { 190, 140, 80 }) end
end

return Ladder

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
  -- the ladder tile (an orange ladder, 70 by 70 in the picture) repeated down, 24 wide
  local view = require("lib.view")
  local size, ty = 24, self.y
  while ty < self.y + self.h do
    local height = math.min(size, self.y + self.h - ty)
    view.image("tiles/ladder", self.x - size / 2, ty, size, height, height < size and { x = 0, y = 0, w = 70, h = 70 * height / size } or nil)
    ty = ty + size
  end
end

return Ladder

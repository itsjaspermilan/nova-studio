-- The tram's rail laid across a room: two rows of rail pictures on the ground (the width the tram flattens), `span` units long along
-- `dir` ("h": along x from this x, "v": along y from this y). Only a picture, walkable. Props: dir, span. (The tram that runs on it
-- is entities/tram.lua, placed at the same spot; this x, y is the middle of the rail's start.)
local H = require("data.hazards")

local Rail = nova.entity { velocity = false, dir = "h", span = 1920, depth = 92 }

function Rail:draw()
  local n = math.ceil(self.span / H.tile)
  for i = 0, n - 1 do
    for _, side in ipairs({ -0.5, 0.5 }) do
      local wx = self.dir == "h" and (self.x + (i + 0.5) * H.tile) or (self.x + side * H.tile)
      local wy = self.dir == "v" and (self.y + (i + 0.5) * H.tile) or (self.y + side * H.tile)
      local x, y = nova.cam.to_screen(wx, wy)
      if x > -H.tile and x < 960 + H.tile and y > -H.tile and y < 540 + H.tile then
        nova.sprite("rail", x, y, { w = H.tile, h = H.tile, frame = self.dir == "h" and 0 or 1 })
      end
    end
  end
end

return Rail

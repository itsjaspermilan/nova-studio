-- The tram's rail laid across a room: two rows of rail pictures on the ground (the width the tram flattens), `span` units long along
-- `dir` ("h": along x from this x, "v": along y from this y). Only a picture, walkable. Props: dir, span. (The tram that runs on it
-- is entities/tram.lua, placed at the same spot; this x, y is the middle of the rail's start.)
local H = require("data.hazards")

local Rail = nova.entity { velocity = false, dir = "h", span = 1920, depth = 92 }

-- (the rails themselves are the map's: tram_rail tiles on the two rows of the band, painted by tools/gutter.mjs, so nothing is drawn here)
function Rail:draw() end

return Rail

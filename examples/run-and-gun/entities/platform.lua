-- Ground and ledges. Something solid to stand on; its size is set in the scene editor. A ledge (oneway) can be jumped up through, and dropped through with down and jump.
local rect = require("lib.view").rect
local Platform = nova.entity {
  tags = { "solid" },
  velocity = false,
  settings = {
    w = { 160, min = 8, max = 4000, step = 4, help = "How wide it is" },
    h = { 24, min = 4, max = 1000, step = 4, help = "How tall it is" },
    oneway = { false, help = "A ledge: jump up through it, stand on it, drop down through it" },
    kind = { "ground", choices = { "ground", "rock", "metal" }, help = "How it looks" },
  },
}

local tiles = require("lib.tiles")
local T = tiles.SIZE
local DEEP = { 150, 170, 172 } -- the ground below the tiles that show: plain, the same colour

-- The ground: a row of top tiles, three rows of rock under it, then plain rock (so that thick ground draws only a few tiles). A ledge (oneway) and a thin bar (under one tile high)
-- are the girder strip. A rock or metal block is tiles of panel.
function Platform:draw()
  local x, y, w, h = self.x, self.y, self.w, self.h
  if self.oneway or h < T then
    local thick = self.oneway and 12 or h
    local step = 210 * (thick / 30) -- one girder strip is 210 by 30 in the picture
    local tx = x
    while tx < x + w do
      local width = math.min(step, x + w - tx)
      require("lib.view").image("tiles/ledge", tx, y, width, thick, width < step and { x = 0, y = 0, w = 210 * width / step, h = 30 } or nil)
      tx = tx + step
    end
  elseif self.kind == "ground" then
    tiles.row("tiles/ground_top", x, y, w)
    for k = 1, 3 do
      if h > k * T then tiles.row("tiles/ground_fill", x, y + k * T, w, math.min(T, h - k * T)) end
    end
    if h > 4 * T then rect(x, y + 4 * T, w, h - 4 * T, DEEP) end
  else
    tiles.block(self.kind == "metal" and "tiles/panel_dark" or "tiles/panel", x, y, w, h)
  end
end

return Platform

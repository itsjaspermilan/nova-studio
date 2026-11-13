-- Drawing the level's pieces from picture tiles (sprites/tiles/): a row of one tile along a stretch, a block of tiles. Only the tiles that are on the screen are drawn.
local view = require("lib.view")
local tiles = { SIZE = 26 } -- a tile is 26 units across in the level (70 pixels in the picture: about 0.37 of its size, like the character pictures)
local T = tiles.SIZE

-- A row of `id` from x to x + w, its top at y, tiles T wide and `h` high (T by default); the last tile is cut short rather than squeezed.
function tiles.row(id, x, y, w, h)
  h = h or T
  local cx = nova.cam.position()
  local lo, hi = cx - view.half_w() - T, cx + view.half_w() + T
  local tx = x + math.floor(math.max(0, lo - x) / T) * T
  while tx < math.min(x + w, hi) do
    local width = math.min(T, x + w - tx)
    view.image(id, tx, y, width, h, width < T and { x = 0, y = 0, w = 70 * width / T, h = 70 } or nil)
    tx = tx + T
  end
end

-- A block of tiles: rows of `id` from y down for `h` (only as far as the bottom of the screen).
function tiles.block(id, x, y, w, h)
  local _, cy = nova.cam.position()
  local bottom = math.min(y + h, cy + view.half_h() + T)
  local ty = y + math.floor(math.max(0, cy - view.half_h() - T - y) / T) * T
  while ty < bottom do
    tiles.row(id, x, ty, w, math.min(T, y + h - ty))
    ty = ty + T
  end
end

return tiles

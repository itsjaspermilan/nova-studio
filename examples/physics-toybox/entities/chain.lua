-- A chain hanging from a point: `links` blocks, each joined to the one above it, the first to the world.
local Link = nova.entity { sprite = "items/block_green", sx = 0.16, sy = 0.36, body = "dynamic", density = 400, tags = { "thing" } }
local Chain = nova.entity { links = 6 }

function Chain:create()
  local L = 0.36 * 96 + 2
  local above = nil
  for i = 1, self.links do
    local link = nova.spawn(Link, self.x, self.y + (i - 0.5) * L)
    link:join(above, "ball", { x = self.x, y = self.y + (i - 1) * L })
    above = link
  end
end

return Chain

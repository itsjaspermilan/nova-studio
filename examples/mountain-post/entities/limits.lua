-- The map's edges (the scene file's `limits`): the van and the postmaster stay `edge` metres inside them, and south of the gorge.
-- The ground rises into thick wood there, so the edge is felt as hills and trees, never a wall.
local world = require("lib.world")

local Limits = nova.entity { tags = { "limits" } }

function Limits:create()
  local b = self.bounds or { -250, -265, 250, 300 }
  world.limits = { x0 = b[1], z0 = b[2], x1 = b[3], z1 = b[4], edge = self.edge or 25, gorge = self.gorge or 236 }
  self:destroy()
end

return Limits

-- The wooden bridge over Kettle Creek. Its deck is level with the road at both ends (`a` and `b` in the scene file are where the
-- road meets it), however deep the creek's cut is under its middle; it tells lib/world.lua where it is so that the van and the
-- postmaster stand on its deck and not in the water.
local world = require("lib.world")

local Bridge = nova.entity { tags = { "bridge" } }

function Bridge:create()
  self.opts = { ry = self.ry or 0, lift = "origin" }
  self:settle()
end

-- (the deck at each end is the ground there, which the road was laid on: the scene calls this again once its hills are set)
function Bridge:settle()
  local a, b = self.a or { self.x, self.z - 9 }, self.b or { self.x, self.z + 9 }
  local dx, dz = b[1] - a[1], b[2] - a[2]
  local len = math.sqrt(dx * dx + dz * dz)
  local ha, hb = nova.terrain_height(a[1], a[2]), nova.terrain_height(b[1], b[2])
  world.bridge = { ax = a[1], az = a[2], dx = dx / len, dz = dz / len, len = len, half = 2.2, ha = ha, hb = hb }
  self.deck = (ha + hb) / 2
  self.y = self.deck - nova.terrain_height(self.x, self.z)
end

function Bridge:draw()
  nova.model("bridge", self.x, self.y, self.z, self.opts)
end

return Bridge

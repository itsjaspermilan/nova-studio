-- A porch's floor or a step (the scene file's `deck`): what stands over it stands `h` above the ground (lib/world.lua). Nothing
-- is drawn; the house's own model has the boards. A deck with a `level` stands at that height whatever the ground under it (the jetty
-- over Reed Pond), and a `pier` is one over water: lib/world.lua keeps a walker on its boards.
local world = require("lib.world")

local Deck = nova.entity { tags = { "deck" } }

function Deck:create()
  local ry = self.ry or 0
  world.add_deck({ x = self.x, z = self.z, c = math.cos(ry), s = math.sin(ry), hw = self.hw or 1, hl = self.hl or 1, h = self.h or 0.4,
    level = self.level, pier = self.pier })
  self:destroy()
end

return Deck

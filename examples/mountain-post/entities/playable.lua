-- Where the player may go (the scene file's `playable`, made by tools/scene.mjs and tools/bounds.mjs): the land near the roads, the
-- yards and the places worth walking to. The van and the postmaster are kept inside it (lib/world.lua: world.move, world.push_out), the
-- van rolling slower over the last `rough` metres (12); its edge is always something you can see (forest, hedges, fences, walls, rocks,
-- water). `secrets` are the ways out to open in a later update (a fallen tree on the old track to Tarn Pond, the locked gates at
-- Post Road's south end), each with the land it would add: world.open_secret(id).
local world = require("lib.world")

local Playable = nova.entity { tags = { "playable" } }

function Playable:create()
  local secrets = {}
  for _, s in ipairs(self.secrets or {}) do
    secrets[#secrets + 1] = { id = s.id, kind = s.kind, at = s.at, from = s.from, closed = s.closed ~= false, area = s.area }
  end
  world.set_playable({ areas = self.areas or {}, secrets = secrets, rough = self.rough or 12 })
  self:destroy()
end

return Playable

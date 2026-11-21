-- Who an enemy goes for: the runner, or the nearest copy the roll left behind (a "decoy": Afterimage). Enemies call `Target.of(self)` where
-- they used to ask for the player; the decoy has the same x, y and `state` and shrugs off every hit, so the code is the same either way.
local T = {}

function T.of(e)
  local best, bd = nil, 1e9
  for _, d in ipairs(nova.all("decoy")) do
    local dist = (d.x - e.x) ^ 2 + (d.y - e.y) ^ 2
    if dist < bd then best, bd = d, dist end
  end
  e.target_kind = best and "decoy" or "player"
  return best or nova.first("player")
end

return T

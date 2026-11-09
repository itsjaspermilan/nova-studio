-- A drift zone in free roam (made by scripts/rally/roam.ts): on road `route` from `s` to `s2` metres along it; it starts at (x, z), the
-- road facing `ry`, and ends at (x2, z2), facing `ry2`. lib/challenges.lua scores the sliding between. Pink strips mark both ends.
local DriftZone = nova.entity { tags = { "drift_zone" }, route = "", s = 0, s2 = 0, ry = 0, x2 = 0, z2 = 0, ry2 = 0 }

local STRIP = { color = { 255, 92, 180, 200 }, width = 1.1 }
local HALF = 6

local function strip(x, z, ry)
  local lx, lz = math.cos(ry), -math.sin(ry)
  nova.line3(x - lx * HALF, 0.1, z - lz * HALF, x + lx * HALF, 0.1, z + lz * HALF, STRIP)
end

function DriftZone:draw()
  STRIP.color[4] = math.floor(150 + 60 * math.sin(nova.time() * 4))
  strip(self.x, self.z, self.ry)
  strip(self.x2, self.z2, self.ry2)
  for h = 1, 4 do nova.billboard("puff", self.x, h * 1.6, self.z, 2.2 - h * 0.25, { color = { 255, 110, 190, 55 - h * 8 } }) end
end

return DriftZone

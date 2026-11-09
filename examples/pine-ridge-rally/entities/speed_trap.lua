-- A speed trap in free roam (made by scripts/rally/roam.ts): on road `route`, `s` metres along it, the road facing `ry` there. Drive
-- through and lib/challenges.lua reads the speed. A blue strip across the road marks it, with a sign beside it.
local SpeedTrap = nova.entity { tags = { "speed_trap" }, route = "", s = 0, ry = 0 }

local STRIP = { color = { 64, 196, 255, 200 }, width = 1.1 }
local SIGN = { ry = 0, shadow = false, scale = 1 }
local HALF = 7 -- (metres either side of the middle of the road)

function SpeedTrap:draw()
  local fx, fz = math.sin(self.ry), math.cos(self.ry)
  local lx, lz = fz, -fx
  STRIP.color[4] = math.floor(150 + 60 * math.sin(nova.time() * 4))
  nova.line3(self.x - lx * HALF, 0.1, self.z - lz * HALF, self.x + lx * HALF, 0.1, self.z + lz * HALF, STRIP)
  SIGN.ry = self.ry + math.pi
  nova.model("ck_sign_highway", self.x + lx * (HALF + 3), 0, self.z + lz * (HALF + 3), SIGN)
end

return SpeedTrap

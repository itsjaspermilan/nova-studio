-- Water along a line (the creek, the river in the gorge): a ribbon mesh made when the scene starts, lying `depth` above the bed
-- the terrain recipe cut for it (the renderer lifts each of its points by the ground under it, so it follows the bed down the
-- valley). Light glints run along it; the creek is heard near it (lib/ambience.lua reads its points).
local world = require("lib.world")

local Water = nova.entity { tags = { "water" } }

local COLOURS = { creek = { { 92, 150, 160, 235 }, { 140, 196, 196, 235 } }, gorge = { { 56, 104, 128, 255 }, { 90, 140, 160, 255 } } }

function Water:create()
  local pts = self.points or {}
  world.add_water({ id = self.key, width = self.width or 4, points = pts })
  if #pts < 2 then return end
  local half = (self.width or 4) / 2
  local pos, idx, col = {}, {}, {}
  local c = COLOURS[self.key] or COLOURS.creek
  local n = #pts
  for i = 1, n do
    local a, b = pts[math.max(1, i - 1)], pts[math.min(n, i + 1)]
    local dx, dz = b[1] - a[1], b[2] - a[2]
    local l = math.sqrt(dx * dx + dz * dz)
    local nx, nz = -dz / l, dx / l
    local y = self.depth or 0.35
    -- three points across: the middle a little darker and deeper, the edges lighter where it is shallow
    for k = -1, 1 do
      local w = half * k
      pos[#pos + 1] = pts[i][1] + nx * w; pos[#pos + 1] = y; pos[#pos + 1] = pts[i][2] + nz * w
      local cc = k == 0 and c[1] or c[2]
      local ripple = ((i * 7 + k * 3) % 5) * 3
      col[#col + 1] = cc[1] + ripple; col[#col + 1] = cc[2] + ripple; col[#col + 1] = cc[3] + ripple; col[#col + 1] = cc[4]
    end
  end
  for i = 0, n - 2 do
    local a = i * 3 + 1
    for k = 0, 1 do
      local p, q, r, s = a + k, a + k + 1, a + k + 4, a + k + 3
      idx[#idx + 1] = p; idx[#idx + 1] = r; idx[#idx + 1] = q
      idx[#idx + 1] = p; idx[#idx + 1] = s; idx[#idx + 1] = r
    end
  end
  self.mesh = nova.mesh.make { positions = pos, indices = idx, colors = col }
end

function Water:draw()
  if self.mesh then nova.mesh.draw(self.mesh) end
end

function Water:on_destroy()
  if self.mesh then nova.mesh.free(self.mesh); self.mesh = nil end
end

return Water

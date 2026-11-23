-- Water along a line (the creek, the river in the gorge): a ribbon mesh made when the scene starts, lying `depth` above the bed
-- the terrain recipe cut for it (the renderer lifts each of its points by the ground under it, so it follows the bed down the
-- valley). Light glints run along it; the creek is heard near it (lib/ambience.lua reads its points).
local world = require("lib.world")

local Water = nova.entity { tags = { "water" } }

-- (metres the surface runs on past `width` / 2 under the banks: valley_ground lowers its squares that far round the water, so the
-- surface meets the ground in the bank instead of leaving a dry edge)
local EDGE = world.WATER_EDGE
local COLOURS = { creek = { { 92, 150, 160, 235 }, { 140, 196, 196, 235 } }, gorge = { { 56, 104, 128, 255 }, { 90, 140, 160, 255 } } }

function Water:create()
  self.built = false
  world.add_water({ id = self.key, width = self.width or 4, depth = self.depth or 0.35, points = self.points or {} })
end

-- (made at the first draw, once the scene has set its hills: the surface's level comes from the ground under it)
function Water:build()
  self.built = true
  local pts = self.points or {}
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
    -- (the surface is level across: `depth` over the bed at the middle, and out to the banks at the same height; the renderer lifts
    -- each point by the ground under it, so each is given its height over that ground)
    local level = nova.terrain_height(pts[i][1], pts[i][2]) + (self.depth or 0.35)
    -- three points across: the middle a little darker and deeper, the edges lighter where it is shallow
    for k = -1, 1 do
      local w = (half + EDGE) * k
      local x, z = pts[i][1] + nx * w, pts[i][2] + nz * w
      pos[#pos + 1] = x; pos[#pos + 1] = level - nova.terrain_height(x, z); pos[#pos + 1] = z
      local cc = k == 0 and c[1] or c[2]
      local ripple = ((i * 7 + k * 3) % 5) * 3
      col[#col + 1] = cc[1] + ripple; col[#col + 1] = cc[2] + ripple; col[#col + 1] = cc[3] + ripple; col[#col + 1] = cc[4]
    end
  end
  for i = 0, n - 2 do
    local a = i * 3 + 1
    for k = 0, 1 do
      local p, q, r, s = a + k, a + k + 1, a + k + 4, a + k + 3
      -- (counter-clockwise seen from above, or the surface is culled: its across points left of along, the ground's right)
      idx[#idx + 1] = p; idx[#idx + 1] = q; idx[#idx + 1] = r
      idx[#idx + 1] = p; idx[#idx + 1] = r; idx[#idx + 1] = s
    end
  end
  self.mesh = nova.mesh.make { positions = pos, indices = idx, colors = col }
end

function Water:draw()
  if not self.built then self:build() end
  if self.mesh then nova.mesh.draw(self.mesh) end
end

function Water:on_destroy()
  if self.mesh then nova.mesh.free(self.mesh); self.mesh = nil end
end

return Water

-- The lake on the far side of the gorge, where the lake bridge used to lead (a later map): a flat sheet of water from the far bank out
-- to the mountains, `level` above the flat bed the terrain recipe laid along the map's north edge (tools/layout.mjs LAKE). Seen from the
-- BRIDGE OUT barrier, never reached.
local Lake = nova.entity { tags = { "lake" } }

function Lake:create()
  local pos, col, idx = {}, {}, {}
  local xs, zs = {}, {}
  for x = -1400, 1400, 100 do xs[#xs + 1] = x end
  zs[1] = self.z0 or 285
  for z = 300, 1500, 100 do zs[#zs + 1] = z end
  for j, z in ipairs(zs) do
    for _, x in ipairs(xs) do
      pos[#pos + 1] = x; pos[#pos + 1] = self.level or 0.7; pos[#pos + 1] = z
      local k = math.min(1, (j - 1) / 6)
      col[#col + 1] = math.floor(96 + 70 * k); col[#col + 1] = math.floor(150 + 50 * k); col[#col + 1] = math.floor(176 + 40 * k); col[#col + 1] = 255
    end
  end
  local nx = #xs
  for j = 1, #zs - 1 do
    for i = 1, nx - 1 do
      local a = (j - 1) * nx + i
      local b, c, d = a + 1, a + nx + 1, a + nx
      idx[#idx + 1] = a; idx[#idx + 1] = c; idx[#idx + 1] = b
      idx[#idx + 1] = a; idx[#idx + 1] = d; idx[#idx + 1] = c
    end
  end
  self.mesh = nova.mesh.make { positions = pos, indices = idx, colors = col }
  self.opts = { shadow = false }
end

function Lake:draw() if self.mesh then nova.mesh.draw(self.mesh, self.opts) end end
function Lake:on_destroy() if self.mesh then nova.mesh.free(self.mesh); self.mesh = nil end end

return Lake

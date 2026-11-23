-- The ground and the roads. The ground is one mesh made when the valley starts: a grid of 4 m squares over the map and coarse ones
-- out to the far hills, each point coloured from a few flat warm greens by a slow pattern (meadow, a darker wood floor, a sunny
-- patch), browner along the roads' verges and by the creek, darker in hollows (lib/world.lua `ground_color`). It is painted as
-- ground (docs/project-format.md, "Painted surfaces"): the renderer lays soft patches of warmer and cooler green over those colours,
-- brush strokes near the camera that fade to the calm colour further off, and warms the slopes that face the sun. The hills
-- (nova.terrain) lift every point by the ground under it. The roads are road_make's ribbons over it. Along the water the squares are
-- left out: entities/water.lua lays a finer strip of the same ground there (its banks), so the waterline is not a row of steps.
local world = require("lib.world")

local ValleyGround = nova.entity { tags = { "ground" } }

local ROAD = {}
local WATER_EDGE = world.WATER_EDGE
local MESH = { shadow = false }

local function axis(lo, hi, step, far, far_step)
  local out = {}
  for v = lo - far, lo - far_step, far_step do out[#out + 1] = v end
  for v = lo, hi, step do out[#out + 1] = v end
  for v = hi + far_step, hi + far, far_step do out[#out + 1] = v end
  return out
end

function ValleyGround:create()
  self.built = false
end

function ValleyGround:build()
  local L = world.limits or { x0 = -250, z0 = -265, x1 = 250, z1 = 300 }
  local xs = axis(L.x0, L.x1, 4, 900, 60)
  local zs = axis(L.z0, L.z1, 4, 900, 60)
  local pos, col, idx = {}, {}, {}
  local banked = {} -- (points on a water's bank: a square with any such corner is left out, the bank's finer ground lies there)
  local nx = #xs
  for j, z in ipairs(zs) do
    for i, x in ipairs(xs) do
      -- (under a road or a junction the ground sits a little lower: its 4 m squares are flat between their corners while the road
      -- follows the hills every metre or two, so where the ground bends a corner beside the road would otherwise rise through it)
      local y = world.under_road(x, z) and -0.15 or 0
      -- (and round the water, under its level: the creek's channel is narrower than a square, so without this the squares would
      -- span it from bank to bank and hide the water; entities/water.lua runs its surface on into the banks to meet them)
      local ww, wd, wx, wz = world.nearest("water", x, z)
      if ww and wd < ww.width / 2 + WATER_EDGE + 0.5 then
        local level = nova.terrain_height(wx, wz) + (ww.depth or 0.35)
        y = math.min(y, level - 0.15 - nova.terrain_height(x, z))
      end
      banked[#banked + 1] = (ww and wd < world.bank_of(ww)) or false
      pos[#pos + 1] = x; pos[#pos + 1] = y; pos[#pos + 1] = z
      local r, g, b = world.ground_color(x, z, i, j)
      col[#col + 1] = math.floor(r); col[#col + 1] = math.floor(g); col[#col + 1] = math.floor(b); col[#col + 1] = 255
    end
  end
  for j = 1, #zs - 1 do
    for i = 1, nx - 1 do
      local a = (j - 1) * nx + i
      local b, c, d = a + 1, a + nx + 1, a + nx
      if not (banked[a] or banked[b] or banked[c] or banked[d]) then
        idx[#idx + 1] = a; idx[#idx + 1] = c; idx[#idx + 1] = b
        idx[#idx + 1] = a; idx[#idx + 1] = d; idx[#idx + 1] = c
      end
    end
  end
  self.mesh = nova.mesh.make { positions = pos, indices = idx, colors = col, paint = "ground" }
  self.built = true
end

function ValleyGround:draw()
  if not self.built then self:build() end
  if self.mesh then nova.mesh.draw(self.mesh, MESH) end
  for _, r in ipairs(self.roads or {}) do nova.model(r, 0, 0.02, 0, ROAD) end
end

function ValleyGround:on_destroy()
  if self.mesh then nova.mesh.free(self.mesh); self.mesh = nil end
end

return ValleyGround

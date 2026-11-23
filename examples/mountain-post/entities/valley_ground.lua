-- The ground and the roads. The ground is one mesh made when the valley starts: a grid of 4 m squares over the map and coarse ones
-- out to the far hills, each point coloured from a few flat warm greens by a slow pattern (meadow, a darker wood floor, a sunny
-- patch), browner along the roads' verges and by the creek, so it reads as a place, not as a texture: the clean, flat-coloured
-- look. The hills (nova.terrain) lift every point by the ground under it. The roads are road_make's ribbons over it.
local world = require("lib.world")

local ValleyGround = nova.entity { tags = { "ground" } }

local ROAD = {}
local MESH = { shadow = false }

-- the greens (r, g, b): meadow, wood floor, sunlit, and the worn earth beside a road
local MEADOW, WOOD, SUN, EARTH, BANK = { 128, 168, 82 }, { 92, 134, 70 }, { 152, 182, 90 }, { 150, 136, 98 }, { 112, 120, 84 }

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
  local nx = #xs
  for j, z in ipairs(zs) do
    for i, x in ipairs(xs) do
      -- (under a road or a junction the ground sits a little lower: its 4 m squares are flat between their corners while the road
      -- follows the hills every metre or two, so where the ground bends a corner beside the road would otherwise rise through it)
      local rr, rd = world.nearest("road", x, z)
      local under = (rr and rd < rr.width * 0.75 + 0.6) or world.junction_surface(x, z) ~= nil
      pos[#pos + 1] = x; pos[#pos + 1] = under and -0.15 or 0; pos[#pos + 1] = z
      -- a slow pattern: groves of darker wood floor, sunny meadows
      local n = nova.noise2(x * 0.018, z * 0.018, 3, 3, 0.5)
      local m = nova.noise2(x * 0.06 + 40, z * 0.06, 7, 2, 0.5)
      local t = math.max(0, math.min(1, (n + 0.15) * 2.5))
      local r = MEADOW[1] + (WOOD[1] - MEADOW[1]) * t
      local g = MEADOW[2] + (WOOD[2] - MEADOW[2]) * t
      local b = MEADOW[3] + (WOOD[3] - MEADOW[3]) * t
      if m > 0.35 then local k = math.min(1, (m - 0.35) * 2.5) * 0.6; r, g, b = r + (SUN[1] - r) * k, g + (SUN[2] - g) * k, b + (SUN[3] - b) * k end
      -- worn earth along the verges, damp greener-grey by the water
      local _, dr = world.nearest("road", x, z)
      if dr and dr < 7 then local k = (1 - math.max(0, dr - 3) / 4) * 0.55; r, g, b = r + (EARTH[1] - r) * k, g + (EARTH[2] - g) * k, b + (EARTH[3] - b) * k end
      local _, dw = world.nearest("water", x, z)
      if dw and dw < 9 then local k = (1 - math.max(0, dw - 2) / 7) * 0.7; r, g, b = r + (BANK[1] - r) * k, g + (BANK[2] - g) * k, b + (BANK[3] - b) * k end
      -- a little variation from point to point, so the flat colours are not a stencil
      local v = (nova.hash(i, j, 0, 3) - 0.5) * 8
      col[#col + 1] = math.floor(r + v); col[#col + 1] = math.floor(g + v); col[#col + 1] = math.floor(b + v * 0.5); col[#col + 1] = 255
    end
  end
  for j = 1, #zs - 1 do
    for i = 1, nx - 1 do
      local a = (j - 1) * nx + i
      local b, c, d = a + 1, a + nx + 1, a + nx
      idx[#idx + 1] = a; idx[#idx + 1] = c; idx[#idx + 1] = b
      idx[#idx + 1] = a; idx[#idx + 1] = d; idx[#idx + 1] = c
    end
  end
  self.mesh = nova.mesh.make { positions = pos, indices = idx, colors = col }
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

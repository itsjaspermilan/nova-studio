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
local GRASS_CELL = 0.5 -- (terrain/grass.png: a sample every half metre, tools/grass.mjs)

-- The meadow's flowers and small plants (the owner's eighth play: "Just like blobs on sticks ... don't some games use 2D assets for the
-- less important items?"): painted pictures among the blades (textures/flora.png, tools/flora.mjs: daisies, buttercups, lupines,
-- clover, dandelions), in patches of about 7 m over a third of the meadow, only where the grass is full (so never on a road, a path,
-- a porch or by the water), and thick round each `flowers` spot of the scene file (the gardens). The engine grows and fades them round
-- the camera like the blades (nova.grass's `flowers`).
local FLOWERS = { picture = "textures/flora.png", kinds = 5, density = 0.7, size = 0.5, distance = 28, patch = 7, cover = 0.34, spots = {} }
for _, o in ipairs(nova.scene_data("valley").objects) do
  if o.kind == "flowers" and #FLOWERS.spots < 16 then FLOWERS.spots[#FLOWERS.spots + 1] = { o.x, o.z, 1.8, 4 } end
end

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
  local pos, col, idx, grid = {}, {}, {}, {}
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
      -- (and round a pond: entities/pond.lua lays its own finer ground there)
      banked[#banked + 1] = (ww and wd < world.bank_of(ww)) or world.pond_zone(x, z) or false
      pos[#pos + 1] = x; pos[#pos + 1] = y; pos[#pos + 1] = z
      local r, g, b = world.ground_color(x, z, i, j)
      col[#col + 1] = math.floor(r); col[#col + 1] = math.floor(g); col[#col + 1] = math.floor(b); col[#col + 1] = 255
      if x >= L.x0 and x <= L.x1 and z >= L.z0 and z <= L.z1 then
        grid[#grid + 1] = math.floor(r); grid[#grid + 1] = math.floor(g); grid[#grid + 1] = math.floor(b)
      end
    end
  end
  local columns, rows = 0, 0
  for _, x in ipairs(xs) do if x >= L.x0 and x <= L.x1 then columns = columns + 1 end end
  for _, z in ipairs(zs) do if z >= L.z0 and z <= L.z1 then rows = rows + 1 end end
  -- the blades of grass (terrain/grass.png, made by tools/grass.mjs: none on the roads, the water, the porches or under a house),
  -- coloured from these same ground colours on the same 4 m grid, so a blade's root is the ground's own green
  nova.grass { map = "terrain/grass.png", x = L.x0, z = L.z0, cell = GRASS_CELL,
    colors = { x = L.x0, z = L.z0, cell = 4, columns = columns, rows = rows, data = grid },
    height = 0.3, width = 0.07, density = 10, distance = 32, sway = 1, flowers = FLOWERS }
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
  -- the grass bends away from the postmaster's feet and from the van's two axles as they pass
  self.walker = self.walker or nova.named("postmaster")
  self.van = self.van or nova.named("van")
  local p, v = self.walker, self.van
  if p and not p.seated and not p.indoors then nova.grass_bend(p.x, p.z, 0.75) end
  if v then
    local s, c = math.sin(v.heading or 0), math.cos(v.heading or 0)
    nova.grass_bend(v.x + s * 1.0, v.z + c * 1.0, 1.4)
    nova.grass_bend(v.x - s * 0.6, v.z - c * 0.6, 1.4)
  end
end

function ValleyGround:on_destroy()
  if self.mesh then nova.mesh.free(self.mesh); self.mesh = nil end
  nova.grass() -- (no grass in another scene)
end

return ValleyGround

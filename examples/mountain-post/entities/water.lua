-- Water along a line (the creek, the river in the gorge): a ribbon mesh made when the scene starts, lying `depth` above the bed
-- the terrain recipe cut for it (the renderer lifts each of its points by the ground under it, so it follows the bed down the
-- valley). The creek is heard near it (lib/ambience.lua reads its points).
--
-- It is painted as running water (docs/project-format.md, "Painted surfaces"): its UVs are metres across and metres downstream, so
-- the renderer runs stretched ripples down the flow and glints the sun on them; its colour's alpha says how deep it is at each point
-- (over the banks' smoothed ground), so the renderer tints the shallows lighter and lays foam along the waterline, and round the
-- bridge's trestle posts, which are made shallow. Under it and along both banks lies a strip of finer ground (`bank`, painted as
-- ground like the valley's, on the heightmap blurred over about 3 m: its 2 m cells cut the channel's sides into little steps that drew
-- a toothed waterline): the 4 m squares of entities/valley_ground.lua are left out under it, so the waterline is a smooth curve, and
-- the ground darkens where it is wet.
local world = require("lib.world")

local Water = nova.entity { tags = { "water" } }

-- (metres the surface runs on past `width` / 2 under the banks: valley_ground lowers its squares that far round the water, so the
-- surface meets the ground in the bank instead of leaving a dry edge)
local EDGE = world.WATER_EDGE
local COLOURS = { creek = { { 74, 128, 140 }, { 120, 178, 180 } }, gorge = { { 56, 104, 128 }, { 90, 140, 160 } } }
-- (the points across the surface, as fractions of half its width out to the edge under the banks: closer near the banks, where the
-- foam and the shallows are)
local ACROSS = { -1, -0.82, -0.62, -0.32, 0, 0.32, 0.62, 0.82, 1 }
local MESH = { shadow = false }

function Water:create()
  self.built = false
  world.add_water({ id = self.key, width = self.width or 4, depth = self.depth or 0.35, points = self.points or {} })
end

-- The line again with a point every `step` metres or less (closer where `fine(x, z)` says so), each with its direction.
local function resample(pts, step, fine)
  local out = {}
  for i = 1, #pts - 1 do
    local a, b = pts[i], pts[i + 1]
    local dx, dz = b[1] - a[1], b[2] - a[2]
    local l = math.sqrt(dx * dx + dz * dz)
    local s = fine and fine(a[1], a[2]) and step * 0.4 or step
    local n = math.max(1, math.ceil(l / s))
    for k = 0, n - 1 do
      local t = k / n
      out[#out + 1] = { a[1] + dx * t, a[2] + dz * t, dx / l, dz / l }
    end
  end
  local last, prev = pts[#pts], pts[#pts - 1]
  local dx, dz = last[1] - prev[1], last[2] - prev[2]
  local l = math.sqrt(dx * dx + dz * dz)
  out[#out + 1] = { last[1], last[2], dx / l, dz / l }
  -- (each point's direction: the mean of the segments either side, so the strip turns smoothly at a bend)
  for i = 2, #out - 1 do
    local ax, az = out[i + 1][1] - out[i - 1][1], out[i + 1][2] - out[i - 1][2]
    local al = math.sqrt(ax * ax + az * az)
    if al > 1e-6 then out[i][3], out[i][4] = ax / al, az / al end
  end
  return out
end

-- (the bridge's trestle posts, where the water froths a little: tools/models.mjs "bridge", two each side at z = +-3.6 m)
local function posts()
  local b = nova.named("bridge")
  if not b then return {} end
  local c, s = math.cos(b.ry or 0), math.sin(b.ry or 0)
  local out = {}
  for _, lz in ipairs({ -3.6, 3.6 }) do
    for _, lx in ipairs({ -1.6, 1.6 }) do out[#out + 1] = { b.x + lx * c + lz * s, b.z - lx * s + lz * c } end
  end
  return out
end

-- (made at the first draw, once the scene has set its hills: the surface's level comes from the ground under it)
function Water:build()
  self.built = true
  local raw = self.points or {}
  if #raw < 2 then return end
  local half = (self.width or 4) / 2
  local depth = self.depth or 0.35
  local c = COLOURS[self.key] or COLOURS.creek
  local piers = posts()
  local near_piers = function(x, z)
    for _, p in ipairs(piers) do if (p[1] - x) ^ 2 + (p[2] - z) ^ 2 < 144 then return true end end
    return false
  end
  local pts = resample(raw, half > 4 and 3 or 1.5, near_piers)
  -- which way it runs: downhill, from the higher end
  local downstream = nova.terrain_height(raw[1][1], raw[1][2]) >= nova.terrain_height(raw[#raw][1], raw[#raw][2])
  local n = #pts
  local zone, reach = world.bank_of({ width = self.width or 4 })
  -- The banks' ground, smoothed: the heightmap's 2 m cells cut the channel's sloping sides into a saw of little steps, which the
  -- water's level drew as a toothed waterline. Within the bank's zone the ground is the heightmap blurred along the stream (`tx`,
  -- `tz`, its direction there) over about 6 m: the steps run along the bank, while across it the channel's shape is kept, so the water
  -- stays as wide as it was cut. It blends back to the heightmap itself just past the zone (beyond it the ground is the valley's own
  -- slope, which the 2 m cells follow well).
  local function smooth_h(x, z, d, tx, tz)
    local t = nova.terrain_height
    local h = t(x, z)
    if d >= zone + 1 then return h end
    local b = h * 4
    for s = 1, 3 do
      b = b + (t(x + tx * s, z + tz * s) + t(x - tx * s, z - tz * s)) * (4 - s)
    end
    -- (and a little across, 0.8 m each way: the 2 m cells also give the channel a slightly different shape at each place)
    b = (b / 16) * 0.6 + (t(x - tz * 0.8, z + tx * 0.8) + t(x + tz * 0.8, z - tx * 0.8)) * 0.2
    local k = math.max(0, math.min(1, (d - (zone - 1)) / 2))
    k = k * k * (3 - 2 * k)
    return b + (h - b) * k
  end
  -- (the water's level along the line: the bed under the middle plus `depth`)
  local level = {}
  local bed = {}
  for i = 1, n do bed[i] = smooth_h(pts[i][1], pts[i][2], 0, pts[i][3], pts[i][4]) end
  -- (and the level itself smoothed along the line over about 8 m: the bed's own little steps would make it rise and fall)
  for i = 1, n do
    local s, w = 0, 0
    for j = math.max(1, i - 3), math.min(n, i + 3) do
      local k = 4 - math.abs(j - i)
      s, w = s + bed[j] * k, w + k
    end
    level[i] = s / w + depth
  end

  -- the surface
  local pos, idx, col, uv = {}, {}, {}, {}
  local along = 0
  local across = #ACROSS
  for i = 1, n do
    local p = pts[i]
    if i > 1 then along = along + math.sqrt((p[1] - pts[i - 1][1]) ^ 2 + (p[2] - pts[i - 1][2]) ^ 2) end
    local nx, nz = -p[4], p[3]
    for k = 1, across do
      local w = (half + EDGE) * ACROSS[k]
      local x, z = p[1] + nx * w, p[2] + nz * w
      pos[#pos + 1] = x; pos[#pos + 1] = level[i] - nova.terrain_height(x, z); pos[#pos + 1] = z
      -- deeper and darker in the middle, lighter towards the banks
      local m = math.min(1, math.abs(ACROSS[k]) * (half + EDGE) / half)
      -- how deep it is here, over the banks' smoothed ground (the renderer tints the shallows and lays foam where it meets the bank);
      -- round the bridge's trestle posts it is made shallow, so foam gathers there too
      local deep = level[i] - smooth_h(x, z, math.abs(w), p[3], p[4])
      for _, q in ipairs(piers) do
        local dq = math.sqrt((q[1] - x) ^ 2 + (q[2] - z) ^ 2)
        deep = math.min(deep, 0.02 + math.max(0, dq - 0.3) * 0.18)
      end
      col[#col + 1] = c[1][1] + (c[2][1] - c[1][1]) * m
      col[#col + 1] = c[1][2] + (c[2][2] - c[1][2]) * m
      col[#col + 1] = c[1][3] + (c[2][3] - c[1][3]) * m
      col[#col + 1] = math.floor(math.max(0, math.min(1, (deep + 0.2) / 0.8)) * 255 + 0.5)
      -- (metres across, metres downstream)
      uv[#uv + 1] = w; uv[#uv + 1] = downstream and along or -along
    end
  end
  for i = 0, n - 2 do
    local a = i * across + 1
    for k = 0, across - 2 do
      local p, q, r, s = a + k, a + k + 1, a + k + 1 + across, a + k + across
      -- (counter-clockwise seen from above, or the surface is culled: its across points left of along, the ground's right)
      idx[#idx + 1] = p; idx[#idx + 1] = q; idx[#idx + 1] = r
      idx[#idx + 1] = p; idx[#idx + 1] = r; idx[#idx + 1] = s
    end
  end
  self.mesh = nova.mesh.make { positions = pos, indices = idx, colors = col, uvs = uv, paint = "water" }

  -- the bank: finer ground from bank to bank, on the smoothed ground, coloured as the valley's ground is there, darker where wet
  -- (across: 0.5 m apart round the waterline and the wet band, 1.2 m on the bank's slope, 3 m out to its edge; along: every other
  -- point of the water's line, about 3 m)
  local bpos, bcol, bidx = {}, {}, {}
  local side = {}
  local d = 0
  while d < reach - 0.5 do
    side[#side + 1] = d
    d = d + ((d < half - 1.8 and 1.2) or (d < half + 2.2 and 0.5) or (d < zone and 1.2) or 3.0)
  end
  side[#side + 1] = reach
  local offs = {}
  for k = #side, 2, -1 do offs[#offs + 1] = -side[k] end
  for k = 1, #side do offs[#offs + 1] = side[k] end
  local cols = #offs - 1
  local rows = {}
  for i = 1, n, 2 do rows[#rows + 1] = i end
  if rows[#rows] ~= n then rows[#rows + 1] = n end
  -- (where the waterline crosses each row, metres from the middle line each side: for the tests, which check it runs smoothly)
  self.waterline = {}
  for row, i in ipairs(rows) do
    local p = pts[i]
    local nx, nz = -p[4], p[3]
    local line = {}
    local was_w, was_above
    for k = 0, cols do
      local w = offs[k + 1]
      local x, z = p[1] + nx * w, p[2] + nz * w
      local t0 = nova.terrain_height(x, z)
      local g = smooth_h(x, z, math.abs(w), p[3], p[4])
      if was_w and (g - level[i] >= 0) ~= (was_above >= 0) then
        line[#line + 1] = was_w + (w - was_w) * (0 - was_above) / ((g - level[i]) - was_above)
      end
      was_w, was_above = w, g - level[i]
      -- (a hair over the ground; under a road, under it, as the valley's ground is)
      bpos[#bpos + 1] = x; bpos[#bpos + 1] = (world.under_road(x, z) and -0.15 or 0.03) + g - t0; bpos[#bpos + 1] = z
      local r, gg, b = world.ground_color(x, z, math.floor(x), math.floor(z))
      -- wet: darker and a little cooler up to 0.45 m above the water, and the bed under it a muddy olive
      local above = g - level[i]
      if above < 0.45 then
        local k2 = 1 - math.max(0, above) / 0.45
        r, gg, b = r * (1 - 0.32 * k2), gg * (1 - 0.26 * k2), b * (1 - 0.12 * k2)
        if above < 0 then r, gg, b = r * 0.85 + 12, gg * 0.85 + 8, b * 0.85 end
      end
      bcol[#bcol + 1] = math.floor(r); bcol[#bcol + 1] = math.floor(gg); bcol[#bcol + 1] = math.floor(b); bcol[#bcol + 1] = 255
    end
    self.waterline[row] = line
    if row > 1 then
      local a = (row - 2) * (cols + 1) + 1
      for k = 0, cols - 1 do
        local p1, q, r, s = a + k, a + k + 1, a + k + 2 + cols, a + k + 1 + cols
        bidx[#bidx + 1] = p1; bidx[#bidx + 1] = q; bidx[#bidx + 1] = r
        bidx[#bidx + 1] = p1; bidx[#bidx + 1] = r; bidx[#bidx + 1] = s
      end
    end
  end
  self.bank = nova.mesh.make { positions = bpos, indices = bidx, colors = bcol, paint = "ground" }
end

function Water:draw()
  if not self.built then self:build() end
  if self.bank then nova.mesh.draw(self.bank, MESH) end
  if self.mesh then nova.mesh.draw(self.mesh, MESH) end
end

function Water:on_destroy()
  if self.mesh then nova.mesh.free(self.mesh); self.mesh = nil end
  if self.bank then nova.mesh.free(self.bank); self.bank = nil end
end

return Water

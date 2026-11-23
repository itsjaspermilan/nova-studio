-- What the valley's scene file says about its ground, gathered as its objects are made: the roads' middle lines (entities/roadline.lua),
-- the water (entities/water.lua), the bridge (entities/bridge.lua) and the map's edges (entities/limits.lua). Everything that asks
-- "where is the road", "is this the creek", "how high is the ground here" asks here.
--
-- Heights: the renderer lifts everything drawn near the ground by the hills (nova.terrain), so an entity's `y` is its height ABOVE
-- the ground under it. `world.lift(x, z)` is that height for a thing standing at x, z: 0 on the ground, the deck's height over the
-- creek on the bridge. `world.height(x, z)` is the real height (for the camera, which is placed by hand).
local world = {}

function world.clear()
  world.roads, world.water, world.bridge, world.limits, world.decks = {}, {}, nil, nil, {}
  world.bins = nil
end
world.clear()

local CELL = 20
-- (metres a water surface runs on past its width into the banks; the ground's squares are lowered that far round it)
world.WATER_EDGE = 1.0
-- The finer ground of a water's banks (entities/water.lua lays it, valley_ground leaves its 4 m squares out under it): `zone`, how far
-- from the middle line the bank's slope and its foot reach (the terrain recipe's channel rises 1 in 1.3 from the creek's edge), and
-- `reach`, how far the finer ground runs out each side. Every 4 m square with a corner inside the zone is left out, so the finer ground
-- must cover such a square whole: the zone plus a square's diagonal (5.7 m) and a little more.
function world.bank_of(w)
  local zone = w.width / 2 + (w.width > 10 and 4 or 5)
  return zone, zone + 6
end
local function key(cx, cz) return cx * 100003 + cz end

-- A road's line: points { x, z } every few metres, its name and surface.
function world.add_road(r)
  world.roads[#world.roads + 1] = r
  world.bins = nil
end
function world.add_water(w) world.water[#world.water + 1] = w; world.bins = nil end

-- (every segment of every line, filed by 20 m square, so that "the nearest road" is cheap)
local function build_bins()
  world.bins = { road = {}, water = {} }
  local function file(kind, owner, list)
    for i = 1, #list - 1 do
      local a, b = list[i], list[i + 1]
      local seg = { ax = a[1], az = a[2], bx = b[1], bz = b[2], owner = owner, i = i }
      local x0, x1 = math.floor(math.min(a[1], b[1]) / CELL) - 1, math.floor(math.max(a[1], b[1]) / CELL) + 1
      local z0, z1 = math.floor(math.min(a[2], b[2]) / CELL) - 1, math.floor(math.max(a[2], b[2]) / CELL) + 1
      for cx = x0, x1 do
        for cz = z0, z1 do
          local k = key(cx, cz)
          local bin = world.bins[kind][k]
          if not bin then bin = {}; world.bins[kind][k] = bin end
          bin[#bin + 1] = seg
        end
      end
    end
  end
  for _, r in ipairs(world.roads) do file("road", r, r.points) end
  for _, w in ipairs(world.water) do file("water", w, w.points) end
end

-- The nearest line of a kind ("road" or "water") within about 20 m: its owner, the distance, and the point on it (and its
-- direction), or nil.
function world.nearest(kind, x, z)
  if not world.bins then build_bins() end
  local bin = world.bins[kind][key(math.floor(x / CELL), math.floor(z / CELL))]
  if not bin then return nil end
  local best, bo, bx, bz, dx, dz = math.huge, nil, 0, 0, 0, 1
  for i = 1, #bin do
    local s = bin[i]
    local sx, sz = s.bx - s.ax, s.bz - s.az
    local l2 = sx * sx + sz * sz
    local t = l2 > 0 and math.max(0, math.min(1, ((x - s.ax) * sx + (z - s.az) * sz) / l2)) or 0
    local px, pz = s.ax + sx * t, s.az + sz * t
    local d = (x - px) ^ 2 + (z - pz) ^ 2
    if d < best then
      local l = math.sqrt(l2)
      best, bo, bx, bz, dx, dz = d, s.owner, px, pz, sx / math.max(l, 1e-6), sz / math.max(l, 1e-6)
    end
  end
  if not bo then return nil end
  return bo, math.sqrt(best), bx, bz, dx, dz
end

-- On the bridge's deck? (inside its length, and within its width of the line from one end to the other)
function world.on_bridge(x, z, margin)
  local b = world.bridge
  if not b then return false end
  local px, pz = x - b.ax, z - b.az
  local t = (px * b.dx + pz * b.dz) / b.len
  local side = math.abs(px * -b.dz + pz * b.dx)
  return t > -0.02 and t < 1.02 and side < b.half + (margin or 0), t
end

-- A porch, a step: a level floor `h` above the ground over a turned rectangle (entities/deck.lua).
function world.add_deck(d) world.decks[#world.decks + 1] = d end

-- The height above the ground under x, z where a thing stands (0, a porch's floor, or the bridge's deck over the creek).
function world.lift(x, z)
  local on, t = world.on_bridge(x, z)
  if on then
    local b = world.bridge
    local deck = b.ha + (b.hb - b.ha) * math.max(0, math.min(1, t))
    return math.max(0, deck - nova.terrain_height(x, z))
  end
  local h = 0
  for i = 1, #world.decks do
    local d = world.decks[i]
    local px, pz = x - d.x, z - d.z
    local u, v = px * d.c - pz * d.s, px * d.s + pz * d.c -- (in the deck's own frame: u across, v along its facing)
    if math.abs(u) < d.hw and math.abs(v) < d.hl and d.h > h then h = d.h end
  end
  return h
end
function world.height(x, z) return nova.terrain_height(x, z) + world.lift(x, z) end

-- The junctions (lib/road_junctions.lua, made with the roads by tools/terrain.mjs): where a lane joins Post Road the junction's tarmac
-- fills the corners and runs a few metres up the lane. On it: that surface's word ("road"), else nil.
local JUNCTIONS = require("lib.road_junctions")
local function inside(poly, x, z)
  local n, c = #poly // 2, false
  local j = n
  for i = 1, n do
    local xi, zi, xj, zj = poly[2 * i - 1], poly[2 * i], poly[2 * j - 1], poly[2 * j]
    if (zi > z) ~= (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi then c = not c end
    j = i
  end
  return c
end
function world.junction_surface(x, z)
  for _, j in ipairs(JUNCTIONS) do
    local dx, dz = x - j.at[1], z - j.at[2]
    if dx * dx + dz * dz < (j.paved + 14) ^ 2 then
      if inside(j.area, x, z) or (#j.apron > 0 and inside(j.apron, x, z)) then return j.surface end
    end
  end
  return nil
end

-- Under a road's ribbon or a junction's tarmac (with a margin): the ground there is drawn a little lower, so the road lies on it.
function world.under_road(x, z)
  local rr, rd = world.nearest("road", x, z)
  return (rr and rd < rr.width * 0.75 + 0.6) or world.junction_surface(x, z) ~= nil
end

-- The ground's colour at x, z (r, g, b, 0 to 255) before the renderer paints it (entities/valley_ground.lua's squares and the banks
-- of entities/water.lua, which must meet without a seam): a few flat warm greens by a slow pattern (meadow, a darker wood floor, a
-- sunny patch), worn earth along the roads' verges, a damp greener grey by the water, hollows a little darker and cooler and rises a
-- little lighter, and a little variation from point to point (by the grid's `i`, `j`) so the flat colours are not a stencil.
local MEADOW, WOOD, SUN, EARTH, DAMP = { 128, 168, 82 }, { 92, 134, 70 }, { 152, 182, 90 }, { 150, 136, 98 }, { 112, 120, 84 }
function world.ground_color(x, z, i, j)
  local n = nova.noise2(x * 0.018, z * 0.018, 3, 3, 0.5)
  local m = nova.noise2(x * 0.06 + 40, z * 0.06, 7, 2, 0.5)
  local t = math.max(0, math.min(1, (n + 0.15) * 2.5))
  local r = MEADOW[1] + (WOOD[1] - MEADOW[1]) * t
  local g = MEADOW[2] + (WOOD[2] - MEADOW[2]) * t
  local b = MEADOW[3] + (WOOD[3] - MEADOW[3]) * t
  if m > 0.35 then local k = math.min(1, (m - 0.35) * 2.5) * 0.6; r, g, b = r + (SUN[1] - r) * k, g + (SUN[2] - g) * k, b + (SUN[3] - b) * k end
  local _, dr = world.nearest("road", x, z)
  if dr and dr < 7 then local k = (1 - math.max(0, dr - 3) / 4) * 0.55; r, g, b = r + (EARTH[1] - r) * k, g + (EARTH[2] - g) * k, b + (EARTH[3] - b) * k end
  local _, dw = world.nearest("water", x, z)
  if dw and dw < 9 then local k = (1 - math.max(0, dw - 2) / 7) * 0.7; r, g, b = r + (DAMP[1] - r) * k, g + (DAMP[2] - g) * k, b + (DAMP[3] - b) * k end
  -- (the ground here against the ground 8 m round it)
  local h0 = nova.terrain_height(x, z)
  local around = (nova.terrain_height(x + 8, z) + nova.terrain_height(x - 8, z) + nova.terrain_height(x, z + 8) + nova.terrain_height(x, z - 8)) * 0.25
  local hollow = math.max(-1, math.min(1, (h0 - around) / 0.6))
  local k = hollow < 0 and 0.13 or 0.06
  r, g, b = r * (1 + hollow * k), g * (1 + hollow * k * 0.8), b * (1 + hollow * k * 0.4)
  local v = (nova.hash(i, j, 0, 3) - 0.5) * 8
  return r + v, g + v, b + v * 0.5
end

-- The surface under a wheel or a foot: "road" (tarmac), "gravel", "bridge" or "grass".
function world.surface(x, z)
  if world.on_bridge(x, z) then return "bridge" end
  local js = world.junction_surface(x, z)
  if js then return js end
  local r, d = world.nearest("road", x, z)
  if r and d < r.width / 2 + 0.3 then return r.surface end
  return "grass"
end

-- Where a body of radius `r` may not be: past the map's edges, in the water (except on the bridge), in the gorge. Returns
-- true and the direction out (a unit vector) when it may not.
function world.blocked(x, z, r)
  r = r or 0.5
  local L = world.limits
  if L then
    local e = L.edge + r
    if x < L.x0 + e then return true, 1, 0 end
    if x > L.x1 - e then return true, -1, 0 end
    if z < L.z0 + e then return true, 0, 1 end
    if z > L.gorge - r then return true, 0, -1 end
  end
  if world.on_bridge(x, z, -r * 0.5) then return false end
  local w, d, px, pz = world.nearest("water", x, z)
  if w and d < w.width / 2 + 1.2 + r then
    local ox, oz = x - px, z - pz
    local l = math.sqrt(ox * ox + oz * oz)
    if l < 1e-6 then return true, 1, 0 end
    return true, ox / l, oz / l
  end
  return false
end

-- A body of radius `r` at x, z put back where it may be: inside the map's edges, south of the gorge, out of the water onto its bank.
-- Returns the place and whether it had to move.
function world.push_out(x, z, r)
  local moved = false
  local L = world.limits
  if L then
    local e = L.edge + r
    local nx, nz = math.max(L.x0 + e, math.min(L.x1 - e, x)), math.max(L.z0 + e, math.min(L.gorge - r, z))
    if nx ~= x or nz ~= z then x, z, moved = nx, nz, true end
  end
  if not world.on_bridge(x, z, -r * 0.5) then
    local w, d, px, pz = world.nearest("water", x, z)
    local reach = w and (w.width / 2 + 1.2 + r)
    if w and d < reach then
      local ox, oz = x - px, z - pz
      local l = math.sqrt(ox * ox + oz * oz)
      if l < 1e-6 then ox, oz, l = 1, 0, 1 end
      x, z, moved = px + ox / l * reach, pz + oz / l * reach, true
    end
  end
  return x, z, moved
end

-- Moves a body from x, z by dx, dz, keeping it out of the water and inside the map (and out of every solid piece of scenery,
-- the buildings, walls, rocks, tree trunks: nova.scenery.push). Returns the new x, z and whether anything stopped it.
function world.move(x, z, dx, dz, r)
  local nx, nz = x + dx, z + dz
  local hit = false
  for _ = 1, 2 do
    local px, pz = nova.scenery.push(nx, nz, r)
    if not px then break end
    nx, nz = nx + px, nz + pz
    hit = true
  end
  local moved
  nx, nz, moved = world.push_out(nx, nz, r)
  return nx, nz, hit or moved
end

return world

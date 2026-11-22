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

-- The surface under a wheel or a foot: "road" (tarmac), "gravel", "bridge" or "grass".
function world.surface(x, z)
  if world.on_bridge(x, z) then return "bridge" end
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

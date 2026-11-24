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
  world.drives, world.yards, world.ponds, world.playable = {}, {}, {}, nil
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
-- A driveway (entities/driveway.lua): a short gravel road to a house's yard, kept apart from world.roads (the roads with names, which
-- the minimap draws and the ground cover lines), found by world.nearest("drive"); `joins` is the road it leaves, `yard` its
-- round gravel turning space ({ x, z, r }).
function world.add_drive(d)
  world.drives[#world.drives + 1] = d
  if d.yard then world.yards[#world.yards + 1] = d.yard end
  world.bins = nil
end

-- (every segment of every line, filed by 20 m square, so that "the nearest road" is cheap)
local function build_bins()
  world.bins = { road = {}, water = {}, drive = {} }
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
  for _, r in ipairs(world.drives) do file("drive", r, r.points) end
  for _, w in ipairs(world.water) do file("water", w, w.points) end
end

-- The nearest line of a kind ("road", "drive" or "water") within about 20 m: its owner, the distance, and the point on it (and its
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
    if math.abs(u) < d.hw and math.abs(v) < d.hl then
      -- (a deck at a level of its own, the jetty over a pond: its height over the ground under each point)
      local dh = d.level and (d.level - nova.terrain_height(x, z)) or d.h
      if dh > h then h = dh end
    end
  end
  return h
end
function world.height(x, z) return nova.terrain_height(x, z) + world.lift(x, z) end

-- The junctions (lib/road_junctions.lua, made with the roads by tools/terrain.mjs): where a lane joins Post Road the junction's surface
-- fills the corners (gravel, as every road since the owner's ninth notes; a tarmac junction would run a few metres up the lane). On it:
-- that surface's word ("gravel"; "road" for tarmac), else nil.
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

-- Under a road's ribbon or a junction's patch (with a margin): the ground there is drawn a little lower, so the road lies on it.
function world.under_road(x, z)
  local rr, rd = world.nearest("road", x, z)
  if rr and rd < rr.width * 0.75 + 0.6 then return true end
  local dr, dd = world.nearest("drive", x, z)
  return (dr and dd < dr.width * 0.75 + 0.6) or world.junction_surface(x, z) ~= nil or world.in_yard(x, z, 1.2)
end

-- How far x, z is outside the junctions' patches and the drives' yards (metres: 0 on one; math.huge far from them all). A tyre leaving
-- a road blends onto the meadow by this as well as by the roads' middle lines (entities/van.lua ground_kind): a junction's wide
-- corners and a yard reach further from any middle line than a road's width, and stepping off one onto the grass was a jolt (the
-- owner's ninth notes made every junction's corners gravel, 6 m round, and moved the yards).
local function seg_dist(x, z, ax, az, bx, bz)
  local sx, sz = bx - ax, bz - az
  local l2 = sx * sx + sz * sz
  local t = l2 > 0 and math.max(0, math.min(1, ((x - ax) * sx + (z - az) * sz) / l2)) or 0
  return math.sqrt((x - ax - sx * t) ^ 2 + (z - az - sz * t) ^ 2)
end
function world.off_patch(x, z)
  local best = math.huge
  for _, j in ipairs(JUNCTIONS) do
    local dx, dz = x - j.at[1], z - j.at[2]
    if dx * dx + dz * dz < (j.paved + 20) ^ 2 then
      if inside(j.area, x, z) then return 0 end
      local a, n = j.area, #j.area // 2
      for i = 1, n do
        local k = i % n + 1
        best = math.min(best, seg_dist(x, z, a[2 * i - 1], a[2 * i], a[2 * k - 1], a[2 * k]))
      end
    end
  end
  for i = 1, #world.yards do
    local y = world.yards[i]
    best = math.min(best, math.max(0, math.sqrt((x - y.x) ^ 2 + (z - y.z) ^ 2) - y.r - 0.3))
  end
  return best
end

-- In a driveway's yard (its gravel turning space, `margin` metres more round it)?
function world.in_yard(x, z, margin)
  for i = 1, #world.yards do
    local y = world.yards[i]
    if (x - y.x) ^ 2 + (z - y.z) ^ 2 < (y.r + (margin or 0)) ^ 2 then return true end
  end
  return false
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
  local _, dd = world.nearest("drive", x, z)
  if dd and (not dr or dd < dr) then dr = dd end
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

-- The surface under a wheel or a foot: "road" (tarmac: none in the valley since the owner's ninth notes), "gravel", "bridge" or "grass".
function world.surface(x, z)
  if world.on_bridge(x, z) then return "bridge" end
  local js = world.junction_surface(x, z)
  if js then return js end
  local r, d = world.nearest("road", x, z)
  if r and d < r.width / 2 + 0.3 then return r.surface end
  local dr, dd = world.nearest("drive", x, z)
  if (dr and dd < dr.width / 2 + 0.3) or world.in_yard(x, z, 0.3) then return "gravel" end
  return "grass"
end

-- ---- the ponds (entities/pond.lua): still water inside a shore line ----------------------------------------------------------------------
-- (a body stands no nearer the water than this past the shore: the bank's wet foot)
local POND_BANK = 0.4
-- (a polygon is a list of { x, z }; even-odd)
local function in_poly(poly, x, z)
  local c, n = false, #poly
  local j = n
  for i = 1, n do
    local a, b = poly[i], poly[j]
    if (a[2] > z) ~= (b[2] > z) and x < (b[1] - a[1]) * (z - a[2]) / (b[2] - a[2]) + a[1] then c = not c end
    j = i
  end
  return c
end
world.in_poly = in_poly
-- The nearest point of a closed line to x, z: its distance and the point.
local function nearest_on(poly, x, z)
  local best, bx, bz = math.huge, 0, 0
  local n = #poly
  for i = 1, n do
    local a, b = poly[i], poly[i % n + 1]
    local sx, sz = b[1] - a[1], b[2] - a[2]
    local l2 = sx * sx + sz * sz
    local t = l2 > 0 and math.max(0, math.min(1, ((x - a[1]) * sx + (z - a[2]) * sz) / l2)) or 0
    local px, pz = a[1] + sx * t, a[2] + sz * t
    local d = (x - px) ^ 2 + (z - pz) ^ 2
    if d < best then best, bx, bz = d, px, pz end
  end
  return math.sqrt(best), bx, bz
end

-- A pond: { id, level (the water's height), shore = { { x, z }, ... } }; its box is worked out here.
function world.add_pond(p)
  local x0, z0, x1, z1 = math.huge, math.huge, -math.huge, -math.huge
  for _, q in ipairs(p.shore) do x0, z0, x1, z1 = math.min(x0, q[1]), math.min(z0, q[2]), math.max(x1, q[1]), math.max(z1, q[2]) end
  p.box = { x0, z0, x1, z1 }
  world.ponds[#world.ponds + 1] = p
end
-- The pond at x, z or within `margin` metres of its shore: the pond, how far inside its shore the point is (negative outside), the shore's
-- nearest point, and the way out of the water onto the land there (a unit vector).
function world.pond_at(x, z, margin)
  margin = margin or 0
  for _, p in ipairs(world.ponds) do
    local b = p.box
    if x > b[1] - margin and x < b[3] + margin and z > b[2] - margin and z < b[4] + margin then
      local inside = in_poly(p.shore, x, z)
      local d, sx, sz = nearest_on(p.shore, x, z)
      if inside or d < margin then
        local ox, oz = x - sx, z - sz
        local l = math.sqrt(ox * ox + oz * oz)
        if l < 1e-6 then ox, oz, l = sx - p.x, sz - p.z, math.max(1e-6, math.sqrt((sx - p.x) ^ 2 + (sz - p.z) ^ 2)) end
        if inside then ox, oz = -ox, -oz end
        return p, inside and d or -d, sx, sz, ox / l, oz / l
      end
    end
  end
  return nil
end
-- Round a pond, the valley's 4 m squares are left out where a corner is within POND_ZONE metres of the shore (or in the water), and
-- the pond lays finer ground there (entities/pond.lua), so its waterline is smooth.
world.POND_ZONE = 3
function world.pond_zone(x, z) return world.pond_at(x, z, world.POND_ZONE) ~= nil end
-- On a pier (a deck with `pier`: the jetty), within `margin` of its sides? Returns the deck and the point in its frame (across, along).
function world.on_pier(x, z, margin)
  for _, d in ipairs(world.decks) do
    if d.pier then
      local px, pz = x - d.x, z - d.z
      local u, v = px * d.c - pz * d.s, px * d.s + pz * d.c
      if math.abs(u) < d.hw + (margin or 0) and math.abs(v) < d.hl + (margin or 0) then return d, u, v end
    end
  end
  return nil
end

-- ---- the playable area (entities/playable.lua; the scene's `playable`, made by tools/bounds.mjs) -------------------------------------------
-- Its outline's pieces filed by 10 m square (each square lists the pieces within REACH of it) and by 5 m band of z (for "inside"), so that
-- "how far inside the edge am I" costs a few dozen pieces. A secret way, once opened, adds the land beyond it.
local PCELL, REACH, BAND = 10, 14, 5
function world.set_playable(p)
  world.playable = p
  world.build_playable()
end
function world.build_playable()
  local P = world.playable
  if not P then return end
  local polys = {}
  for _, a in ipairs(P.areas or {}) do polys[#polys + 1] = a end
  for _, s in ipairs(P.secrets or {}) do if not s.closed and s.area then polys[#polys + 1] = s.area end end
  P.polys = polys
  local cells, bands = {}, {}
  for k, poly in ipairs(polys) do
    local n = #poly
    for i = 1, n do
      local a, b = poly[i], poly[i % n + 1]
      local sg = { a[1], a[2], b[1], b[2] }
      -- (a piece inside another of the shapes is no edge: an opened secret's land joins the rest)
      local mx, mz, inner = (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, false
      for k2, other in ipairs(polys) do if k2 ~= k and in_poly(other, mx, mz) then inner = true end end
      local x0, x1 = math.min(sg[1], sg[3]), math.max(sg[1], sg[3])
      local z0, z1 = math.min(sg[2], sg[4]), math.max(sg[2], sg[4])
      if not inner then
        for cx = math.floor((x0 - REACH) / PCELL), math.floor((x1 + REACH) / PCELL) do
          for cz = math.floor((z0 - REACH) / PCELL), math.floor((z1 + REACH) / PCELL) do
            local kk = key(cx, cz)
            cells[kk] = cells[kk] or {}
            table.insert(cells[kk], sg)
          end
        end
      end
      if #polys == 1 then
        for bz = math.floor(z0 / BAND), math.floor(z1 / BAND) do
          bands[bz] = bands[bz] or {}
          table.insert(bands[bz], sg)
        end
      end
    end
  end
  P.cells, P.bands = cells, bands
end
-- (inside the area: any of its shapes; with one shape, by the crossings of the pieces in this point's band of z)
local function play_inside(x, z)
  local P = world.playable
  if #P.polys ~= 1 then
    for _, poly in ipairs(P.polys) do if in_poly(poly, x, z) then return true end end
    return false
  end
  local band = P.bands[math.floor(z / BAND)]
  if not band then return false end
  local c = false
  for i = 1, #band do
    local s = band[i]
    if (s[2] > z) ~= (s[4] > z) and x < (s[3] - s[1]) * (z - s[2]) / (s[4] - s[2]) + s[1] then c = not c end
  end
  return c
end
world.play_inside = function(x, z) return world.playable == nil or play_inside(x, z) end
-- How far inside the playable area's edge x, z is (negative outside; REACH or more when no edge is near), and the way in (a unit vector),
-- or nil when the scene has none.
function world.play_edge(x, z)
  local P = world.playable
  if not P then return nil end
  local inside = play_inside(x, z)
  local list = P.cells[key(math.floor(x / PCELL), math.floor(z / PCELL))]
  if not list then return inside and REACH or -REACH, 0, 0 end
  local best, bx, bz = math.huge, x, z
  for i = 1, #list do
    local s = list[i]
    local sx, sz = s[3] - s[1], s[4] - s[2]
    local l2 = sx * sx + sz * sz
    local t = l2 > 0 and math.max(0, math.min(1, ((x - s[1]) * sx + (z - s[2]) * sz) / l2)) or 0
    local px, pz = s[1] + sx * t, s[2] + sz * t
    local d = (x - px) ^ 2 + (z - pz) ^ 2
    if d < best then best, bx, bz = d, px, pz end
  end
  local d = math.sqrt(best)
  local ox, oz = x - bx, z - bz
  local l = math.max(d, 1e-6)
  if inside then return math.min(d, REACH), ox / l, oz / l end
  return -math.min(d, REACH), -ox / l, -oz / l
end
-- How rough the ground is near the edge, 0 to 1: none more than `rough` metres in (the scene says: 12), all of it at the edge. The van
-- rolls slower over it (entities/van.lua), so it comes up to the edge gently and stops there without a knock.
function world.rough(x, z)
  local P = world.playable
  if not P then return 0 end
  local d = world.play_edge(x, z)
  return math.max(0, math.min(1, 1 - d / (P.rough or 12)))
end
-- Opens a secret way (the scene's `playable.secrets`, by id): the land beyond it joins the playable area. Says whether there was one.
function world.open_secret(id)
  local P = world.playable
  for _, s in ipairs(P and P.secrets or {}) do
    if s.id == id then s.closed = false; world.build_playable(); return true end
  end
  return false
end

-- Where a body of radius `r` may not be: past the map's edges, in the water (except on the bridge or a pier), in the gorge. Returns
-- true and the direction out (a unit vector) when it may not. (Not the playable area's edge: the ground cover grows past it; that is
-- world.push_out's.)
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
  if not world.on_pier(x, z) then
    local p, _, _, _, ox, oz = world.pond_at(x, z, r + POND_BANK)
    if p then return true, ox, oz end
  end
  return false
end

-- A body of radius `r` at x, z put back where it may be: inside the map's edges, south of the gorge, out of the water onto its bank, on a
-- pier's boards, inside the playable area. Returns the place, whether it had to move, and whether the playable area's edge alone held it.
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
  -- a pond: back onto its bank; on the jetty, kept on its boards instead
  local reach = r + POND_BANK
  local p, _, sx, sz, ox, oz = world.pond_at(x, z, reach)
  if p then
    local pier, u, v = world.on_pier(x, z, r)
    if pier then
      local hw = math.max(0, pier.hw - math.min(r, pier.hw * 0.8))
      local hl = pier.hl - 0.1 -- (a little in from the boards' ends and sides: on them, not on their edge)
      local cu, cv = math.max(-hw, math.min(hw, u)), math.max(-hl, math.min(hl, v))
      if cu ~= u or cv ~= v then
        x, z = pier.x + cu * pier.c + cv * pier.s, pier.z - cu * pier.s + cv * pier.c
        moved = true
      end
    else
      x, z, moved = sx + ox * reach, sz + oz * reach, true
    end
  end
  -- the playable area: back inside its edge by the body's radius
  local edge = false
  local d, ix, iz = world.play_edge(x, z)
  if d and d < r and (ix ~= 0 or iz ~= 0) then
    x, z = x + ix * (r - d), z + iz * (r - d)
    edge = not moved
    moved = true
  end
  return x, z, moved, edge
end

-- Moves a body from x, z by dx, dz, keeping it out of the water and inside the map and the playable area (and out of every solid piece
-- of scenery, the buildings, walls, rocks, tree trunks: nova.scenery.push). Near the playable area's edge a step outwards is eased (over
-- the last two metres, down to a third of it at the edge), so a walker slows to it rather than hitting it. Returns the new x, z, whether
-- anything stopped it, and whether that was the playable area's edge alone.
function world.move(x, z, dx, dz, r)
  local d, ix, iz = world.play_edge(x, z)
  if d and d < r + 2 and (ix ~= 0 or iz ~= 0) then
    local out = -(dx * ix + dz * iz)
    if out > 0 then
      local keep = math.min(1, math.max(0.33, (d - r) / 2))
      dx, dz = dx + ix * out * (1 - keep), dz + iz * out * (1 - keep)
    end
  end
  local nx, nz = x + dx, z + dz
  local hit = false
  for _ = 1, 2 do
    local px, pz = nova.scenery.push(nx, nz, r)
    if not px then break end
    nx, nz = nx + px, nz + pz
    hit = true
  end
  local moved, edge
  nx, nz, moved, edge = world.push_out(nx, nz, r)
  -- (where two rules meet, a pond's bank running out past the playable area's edge, one push can undo the other: once more, and if
  -- the place is still not one a body may be, it stays where it was)
  if moved and not world.fits(nx, nz, r) then
    nx, nz = world.push_out(nx, nz, r)
    if not world.fits(nx, nz, r) then return x, z, true, false end
  end
  return nx, nz, hit or moved, edge and not hit
end

-- May a body of radius `r` stand at x, z (out of the water, on a pier's boards or the bank, inside the playable area)?
function world.fits(x, z, r)
  if world.blocked(x, z, r - 0.05) then
    if not (world.on_pier(x, z) and not world.nearest_water_blocks(x, z, r)) then return false end
  end
  local d = world.play_edge(x, z)
  return d == nil or d >= r - 0.02
end
-- (the creek and the gorge block a pier too; only a pond gives way to its jetty)
function world.nearest_water_blocks(x, z, r)
  local w, d = world.nearest("water", x, z)
  return w ~= nil and d < w.width / 2 + 1.2 + r and not world.on_bridge(x, z, -r * 0.5)
end

return world

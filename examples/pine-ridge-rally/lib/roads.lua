-- The roads of free roam: several routes (a circuit, a stage, the roads between them), each a list of points about every ten
-- metres from the scene file's `roam_point` objects. `roads.nearest` finds the closest point of any road through a grid of 32 m squares,
-- so the car always knows the road under it (or how far it is off), wherever it is on the map.
local roads = {}

local CELL = 32
local routes = {}   -- by name: { pts = { {x, z, k, w, road, tx, tz, heading} }, loop = bool }
local order = {}    -- route names, in the order they were met
local grid          -- cell key -> list of { route, i } (the segments from point i to i + 1 that pass near the cell)
local ready = false

function roads.clear()
  routes, order, grid, ready = {}, {}, nil, false
end

function roads.add(route, i, x, z, k, w, road, loop, grip)
  route = route or "main"
  local r = routes[route]
  if not r then
    r = { name = route, pts = {}, loop = false }
    routes[route] = r
    order[#order + 1] = route
  end
  if loop then r.loop = true end
  r.pts[#r.pts + 1] = { i = i, x = x, z = z, k = k or 0, w = w or 6, road = road, grip = grip }
  ready = false
end

local function key(cx, cz) return cx * 100003 + cz end

local function finish()
  grid = {}
  for _, name in ipairs(order) do
    local r = routes[name]
    local pts = r.pts
    table.sort(pts, function(a, b) return a.i < b.i end)
    local n = #pts
    local s = 0
    for i, p in ipairs(pts) do
      local a = r.loop and pts[(i - 2) % n + 1] or pts[math.max(1, i - 1)]
      local b = r.loop and pts[i % n + 1] or pts[math.min(n, i + 1)]
      local dx, dz = b.x - a.x, b.z - a.z
      local len = math.max(math.sqrt(dx * dx + dz * dz), 1e-6)
      p.tx, p.tz, p.heading, p.s = dx / len, dz / len, math.atan(dx, dz), s
      local nx = r.loop and pts[i % n + 1] or pts[math.min(n, i + 1)]
      s = s + math.sqrt((nx.x - p.x) ^ 2 + (nx.z - p.z) ^ 2)
    end
    r.length = s
    -- each segment goes into the cells its two ends are in, and those around them (a segment is ten metres; a cell 32)
    local last = r.loop and n or n - 1
    for i = 1, last do
      local p, q = pts[i], pts[i % n + 1]
      local seen = {}
      for _, e in ipairs({ p, q }) do
        local cx, cz = math.floor(e.x / CELL), math.floor(e.z / CELL)
        for gx = cx - 1, cx + 1 do
          for gz = cz - 1, cz + 1 do
            local kk = key(gx, gz)
            if not seen[kk] then
              seen[kk] = true
              local list = grid[kk]
              if not list then list = {}; grid[kk] = list end
              list[#list + 1] = { r, i }
            end
          end
        end
      end
    end
  end
  ready = true
end

function roads.ensure() if not ready then finish() end end
function roads.route(name) roads.ensure(); return routes[name] end
function roads.names() return order end
function roads.count()
  local n = 0
  for _, name in ipairs(order) do n = n + #routes[name].pts end
  return n
end

-- The road nearest to (x, z): { route, i (the point before), t (0 to 1 towards the next), x, z (the nearest spot on the road), tx, tz
-- (the road's way there), heading, w (half the road's width), road (its kind), dist (metres from the middle of the road), left
-- (positive: left of the middle) }, or nil when no road is within about 50 metres.
local out = {}
function roads.nearest(x, z)
  roads.ensure()
  local list = grid[key(math.floor(x / CELL), math.floor(z / CELL))]
  if not list then return nil end
  local best, br, bi, bt = 1e18, nil, 0, 0
  for j = 1, #list do
    local r, i = list[j][1], list[j][2]
    local pts = r.pts
    local a, b = pts[i], pts[i % #pts + 1]
    local sx, sz = b.x - a.x, b.z - a.z
    local len2 = math.max(sx * sx + sz * sz, 1e-6)
    local t = ((x - a.x) * sx + (z - a.z) * sz) / len2
    if t < 0 then t = 0 elseif t > 1 then t = 1 end
    local qx, qz = a.x + sx * t - x, a.z + sz * t - z
    local d2 = qx * qx + qz * qz
    if d2 < best then best, br, bi, bt = d2, r, i, t end
  end
  if not br then return nil end
  local pts = br.pts
  local a, b = pts[bi], pts[bi % #pts + 1]
  out.route, out.i, out.t = br.name, bi, bt
  out.x, out.z = a.x + (b.x - a.x) * bt, a.z + (b.z - a.z) * bt
  out.tx, out.tz = a.tx + (b.tx - a.tx) * bt, a.tz + (b.tz - a.tz) * bt
  local l = math.max(math.sqrt(out.tx * out.tx + out.tz * out.tz), 1e-6)
  out.tx, out.tz = out.tx / l, out.tz / l
  out.heading = math.atan(out.tx, out.tz)
  out.w, out.road, out.grip = a.w, a.road, a.grip
  out.dist = math.sqrt(best)
  out.left = (x - out.x) * out.tz - (z - out.z) * out.tx
  return out
end

-- Every point of every road, one after another (for the grass beside the roads, and the map).
function roads.each(fn)
  roads.ensure()
  for _, name in ipairs(order) do
    for i, p in ipairs(routes[name].pts) do fn(p, routes[name], i) end
  end
end

return roads

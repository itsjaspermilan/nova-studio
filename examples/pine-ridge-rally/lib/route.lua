-- The way to a waypoint along the roads of free roam (lib/roads.lua). The roads' points (about ten metres apart) are the places; each is
-- joined to the next along its road, and to the points of other roads within JOIN metres (where roads meet: a junction, a town street
-- running into a highway). `route.find` is A* from the road nearest one place to the road nearest another, and gives the points between,
-- in order. `route.follow` keeps a found way up to date as the car drives it: the part behind the car is dropped, and when the car has
-- left the way (another turning) it is found again.
local roads = require("lib.roads")

local route = {}

local JOIN = 9            -- metres between two roads' points that count as joined
local END_JOIN = 60       -- metres from the end of an open road to another road that count as joined
local CELL = 16
local LEAVE = 45          -- metres off the way at which it is found again

local nodes, edges        -- nodes[n] = point; edges[n] = { m, metres, m, metres, ... }

local function build()
  nodes, edges = {}, {}
  local id = {}           -- point -> its number
  local grid = {}
  roads.each(function(p, rt, i)
    local n = #nodes + 1
    nodes[n] = p
    id[p] = n
    p.route_name = rt.name
    edges[n] = {}
    local k = math.floor(p.x / CELL) * 100003 + math.floor(p.z / CELL)
    local list = grid[k]
    if not list then list = {}; grid[k] = list end
    list[#list + 1] = n
  end)
  local function join(a, b)
    local pa, pb = nodes[a], nodes[b]
    local d = math.sqrt((pa.x - pb.x) ^ 2 + (pa.z - pb.z) ^ 2)
    local ea, eb = edges[a], edges[b]
    ea[#ea + 1] = b; ea[#ea + 1] = d
    eb[#eb + 1] = a; eb[#eb + 1] = d
  end
  -- along each road
  for _, name in ipairs(roads.names()) do
    local rt = roads.route(name)
    local pts = rt.pts
    for i = 1, #pts - 1 do join(id[pts[i]], id[pts[i + 1]]) end
    if rt.loop and #pts > 2 then join(id[pts[#pts]], id[pts[1]]) end
  end
  -- across roads, where they come close
  for n, p in ipairs(nodes) do
    local cx, cz = math.floor(p.x / CELL), math.floor(p.z / CELL)
    for gx = cx - 1, cx + 1 do
      for gz = cz - 1, cz + 1 do
        local list = grid[gx * 100003 + gz]
        if list then
          for _, m in ipairs(list) do
            local q = nodes[m]
            if m > n and q.route_name ~= p.route_name and (q.x - p.x) ^ 2 + (q.z - p.z) ^ 2 < JOIN * JOIN then join(n, m) end
          end
        end
      end
    end
  end
  -- the ends of open roads (a rally stage's start and finish) to the nearest other road within END_JOIN metres: the road that leads to a
  -- stage stops short of its start line
  for _, name in ipairs(roads.names()) do
    local rt = roads.route(name)
    if not rt.loop and #rt.pts > 1 then
      for _, p in ipairs({ rt.pts[1], rt.pts[#rt.pts] }) do
        local n = id[p]
        local best, bd = nil, END_JOIN * END_JOIN
        local cx, cz = math.floor(p.x / CELL), math.floor(p.z / CELL)
        local reach = math.ceil(END_JOIN / CELL)
        for gx = cx - reach, cx + reach do
          for gz = cz - reach, cz + reach do
            local list = grid[gx * 100003 + gz]
            if list then
              for _, m in ipairs(list) do
                local q = nodes[m]
                local d = (q.x - p.x) ^ 2 + (q.z - p.z) ^ 2
                if q.route_name ~= name and d < bd then best, bd = m, d end
              end
            end
          end
        end
        if best then join(n, best) end
      end
    end
  end
  route.node_of = id
  -- (how many separate road networks there are: one, if every road is joined to the others)
  local seen, parts = {}, {}
  for n = 1, #nodes do
    if not seen[n] then
      local stack, size, names = { n }, 0, {}
      seen[n] = true
      while #stack > 0 do
        local m = table.remove(stack)
        size = size + 1
        names[nodes[m].route_name] = true
        local e = edges[m]
        for j = 1, #e, 2 do if not seen[e[j]] then seen[e[j]] = true; stack[#stack + 1] = e[j] end end
      end
      local list = {}
      for k in pairs(names) do list[#list + 1] = k end
      table.sort(list)
      parts[#parts + 1] = { size = size, names = table.concat(list, ",") }
    end
  end
  table.sort(parts, function(a, b) return a.size > b.size end)
  nova.log(string.format("route: %d places, %d road networks", #nodes, #parts))
  for i = 2, math.min(#parts, 10) do nova.log("route: apart: " .. parts[i].names) end
end

function route.clear() nodes, edges = nil, nil end

local function node_near(x, z)
  local n = roads.nearest(x, z)
  if not n then return nil end
  local rt = roads.route(n.route)
  local a, b = rt.pts[n.i], rt.pts[n.i % #rt.pts + 1]
  return route.node_of[n.t < 0.5 and a or b]
end

-- the nearest road point to (x, z) anywhere on the map (the nearest-road grid only reaches about 50 m)
local function node_anywhere(x, z)
  local best, bd = nil, math.huge
  for n, p in ipairs(nodes) do
    local d = (p.x - x) ^ 2 + (p.z - z) ^ 2
    if d < bd then best, bd = n, d end
  end
  return best
end

-- a small binary heap of { node, score }
local function push(h, n, f)
  local i = #h + 1
  h[i] = { n, f }
  while i > 1 do
    local up = i // 2
    if h[up][2] <= h[i][2] then break end
    h[up], h[i] = h[i], h[up]
    i = up
  end
end
local function pop(h)
  local top = h[1]
  local last = table.remove(h)
  if #h > 0 then
    h[1] = last
    local i = 1
    while true do
      local l, r, s = i * 2, i * 2 + 1, i
      if h[l] and h[l][2] < h[s][2] then s = l end
      if h[r] and h[r][2] < h[s][2] then s = r end
      if s == i then break end
      h[s], h[i] = h[i], h[s]
      i = s
    end
  end
  return top[1]
end

--- The way along the roads from (x, z) to (tx, tz): a list of road points, or nil when there is none.
function route.find(x, z, tx, tz)
  if not nodes then build() end
  local from = node_near(x, z) or node_anywhere(x, z)
  local to = node_anywhere(tx, tz)
  if not from or not to then return nil end
  local goal = nodes[to]
  local g, came, closed = { [from] = 0 }, {}, {}
  local open = {}
  push(open, from, 0)
  while #open > 0 do
    local n = pop(open)
    if n == to then break end
    if not closed[n] then
      closed[n] = true
      local e = edges[n]
      local gn = g[n]
      for j = 1, #e, 2 do
        local m, d = e[j], e[j + 1]
        local gm = gn + d
        if not closed[m] and gm < (g[m] or math.huge) then
          g[m], came[m] = gm, n
          local q = nodes[m]
          push(open, m, gm + math.sqrt((q.x - goal.x) ^ 2 + (q.z - goal.z) ^ 2))
        end
      end
    end
  end
  if not g[to] then return nil end
  local back, n = {}, to
  while n do back[#back + 1] = nodes[n]; n = came[n] end
  local way = {}
  for i = #back, 1, -1 do way[#way + 1] = back[i] end
  return { pts = way, length = g[to], tx = goal.x, tz = goal.z }
end

--- Keeps a way (from `route.find`) up to date as the car at (x, z) drives it: drops the points it has passed, and finds the way again
--- when it is LEAVE metres off it. Gives the way (perhaps a new one), or nil when the car has arrived.
function route.follow(way, x, z)
  local pts = way.pts
  if (way.tx - x) ^ 2 + (way.tz - z) ^ 2 < 25 * 25 then return nil end
  -- the nearest point among the next few
  local best, bd = 1, math.huge
  for i = 1, math.min(#pts, 40) do
    local d = (pts[i].x - x) ^ 2 + (pts[i].z - z) ^ 2
    if d < bd then best, bd = i, d end
  end
  if bd > LEAVE * LEAVE then way = route.find(x, z, way.tx, way.tz) or way; pts = way.pts; best = 1 end
  -- (the way starts at the first point still ahead of the car along the way: not the nearest, which may be just behind it)
  local first = best
  while first < #pts and (pts[first].x - x) * (pts[first + 1].x - pts[first].x) + (pts[first].z - z) * (pts[first + 1].z - pts[first].z) <= 0 do first = first + 1 end
  if first > 1 then
    local keep = {}
    for i = first, #pts do keep[#keep + 1] = pts[i] end
    way.pts = keep
  end
  return way
end

return route

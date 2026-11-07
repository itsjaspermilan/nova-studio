-- The circuit as the cars see it: a loop of waypoints (the scene file's `waypoint` objects, about every ten metres).
local track = {}

local pts = {}
local ready = false
track.length = 0
-- A circuit is a loop (the points wrap round); a rally stage is open: it runs from the first point to the last.
track.open = false

function track.clear()
  pts, ready, track.length, track.open = {}, false, 0, false
end

-- Called by each waypoint as the scene is built.
function track.add(order, x, z, curvature)
  pts[#pts + 1] = { order = order, x = x, z = z, k = curvature or 0 }
  ready = false
end

local function finish()
  table.sort(pts, function(a, b) return a.order < b.order end)
  local n = #pts
  local total = 0
  local open = track.open
  for i, p in ipairs(pts) do
    local a = open and pts[math.max(i - 1, 1)] or pts[(i - 2) % n + 1]
    local b = open and pts[math.min(i + 1, n)] or pts[i % n + 1]
    local dx, dz = b.x - a.x, b.z - a.z
    local len = math.max(math.sqrt(dx * dx + dz * dz), 1e-6)
    p.tx, p.tz = dx / len, dz / len
    p.heading = math.atan(dx, dz)
    local nx = open and pts[math.min(i + 1, n)] or pts[i % n + 1]
    p.s = total
    p.seg = (open and i == n) and 0 or math.sqrt((nx.x - p.x) ^ 2 + (nx.z - p.z) ^ 2)
    total = total + p.seg
  end
  track.length = total
  ready = true
end

function track.count() return #pts end
function track.ensure() if not ready and #pts > 2 then finish() end end

function track.point(i)
  track.ensure()
  if track.open then return pts[math.max(1, math.min(#pts, i))] end
  return pts[(i - 1) % #pts + 1]
end

-- Where a car is on the circuit. `hint` is the waypoint it was last near (searching only around it keeps this cheap).
-- Returns the waypoint number, the distance along the circuit, how far to the left of the middle it is (negative: right),
-- and the distance from the middle.
function track.locate(x, z, hint)
  track.ensure()
  local n = #pts
  local best, bi, bt = 1e18, 1, 0
  local from, to = 1, n
  if hint then from, to = hint - 5, hint + 14 end
  local open = track.open
  if open then from, to = math.max(1, from), math.min(n - 1, to) end -- (no segment starts at the last point)
  for j = from, to do
    local i = (j - 1) % n + 1
    local a = pts[i]
    local dx, dz = x - a.x, z - a.z
    local t = (dx * a.tx + dz * a.tz)
    -- project on the segment to the next waypoint
    local nx = open and pts[math.min(i + 1, n)] or pts[i % n + 1]
    local sx, sz = nx.x - a.x, nx.z - a.z
    local len2 = math.max(sx * sx + sz * sz, 1e-6)
    t = (dx * sx + dz * sz) / len2
    if t < 0 then t = 0 elseif t > 1 then t = 1 end
    local qx, qz = a.x + sx * t - x, a.z + sz * t - z
    local d2 = qx * qx + qz * qz
    if d2 < best then best, bi, bt = d2, i, t end
  end
  local a = pts[bi]
  local nx = open and pts[math.min(bi + 1, n)] or pts[bi % n + 1]
  local px, pz = a.x + (nx.x - a.x) * bt, a.z + (nx.z - a.z) * bt
  local tx, tz = a.tx + (nx.tx - a.tx) * bt, a.tz + (nx.tz - a.tz) * bt
  local left = (x - px) * tz - (z - pz) * tx
  return bi, a.s + a.seg * bt, left, math.sqrt(best)
end

-- Turns an angle into -pi..pi.
function track.wrap(a)
  while a > math.pi do a = a - 2 * math.pi end
  while a < -math.pi do a = a + 2 * math.pi end
  return a
end

return track

-- Power lines in free roam: each `power_line` object of the scene gives its poles' places in order (`pts`, [x, z] metres). The poles
-- are turned along the line (half way between the ways to the pole before and the pole after, so the crossarms line up), and two
-- wires run from crossarm tip to crossarm tip, sagging a little in the middle of each span. Drawn near the camera only.
local powerlines = {}

local lines = {}
local POLE = "ck_electricity_pole"
local ARM, TOP, SAG, STEPS = 3.6, 6.9, 0.9, 5   -- the crossarm's tips: metres either side and up; the sag mid-span; segments a span
local WIRE = { color = { 40, 42, 48 }, width = 0.06 }
local opts = { ry = 0 }

function powerlines.clear() lines = {} end

function powerlines.add(pts)
  local poles = {}
  for i, p in ipairs(pts) do
    local a = pts[math.max(1, i - 1)]
    local b = pts[math.min(#pts, i + 1)]
    local dx, dz = b[1] - a[1], b[2] - a[2]
    local len = math.max(1e-6, math.sqrt(dx * dx + dz * dz))
    -- the crossarm lies across the line: its tips are either side of the pole, at right angles to the way the line runs
    local ax, az = dz / len * ARM, -dx / len * ARM
    poles[i] = { x = p[1], z = p[2], ry = math.atan(dx, dz), ax = ax, az = az }
  end
  lines[#lines + 1] = poles
end

local function wire(x1, z1, x2, z2)
  local h1, h2 = nova.terrain_height(x1, z1) + TOP, nova.terrain_height(x2, z2) + TOP
  local px, py, pz = x1, h1, z1
  for k = 1, STEPS do
    local t = k / STEPS
    local x, z = x1 + (x2 - x1) * t, z1 + (z2 - z1) * t
    local y = h1 + (h2 - h1) * t - SAG * 4 * t * (1 - t)
    nova.line3(px, py, pz, x, y, z, WIRE)
    px, py, pz = x, y, z
  end
end

-- Call from the scene's draw with the camera's place on the ground.
function powerlines.draw(cx, cz, range)
  local r2 = range * range
  for _, poles in ipairs(lines) do
    for i, p in ipairs(poles) do
      local d2 = (p.x - cx) ^ 2 + (p.z - cz) ^ 2
      if d2 < r2 then
        opts.ry = p.ry
        nova.model(POLE, p.x, 0, p.z, opts)
        local q = poles[i + 1]
        if q then
          wire(p.x + p.ax, p.z + p.az, q.x + q.ax, q.z + q.az)
          wire(p.x - p.ax, p.z - p.az, q.x - q.ax, q.z - q.az)
        end
      end
    end
  end
end

return powerlines

-- Power lines in free roam: each `power_line` object of the scene gives its poles' places in order (`pts`, [x, z] metres, about 40 m apart).
-- Each pole is Kenney's single pole (ck_electricity_pole_single: a crossarm with an insulator 1.15 m either side), turned so that its
-- wires leave along the line (half way between the ways to the pole before and the pole after), and two wires run from insulator to
-- insulator, sagging in the middle of each span. (2026-11-08: a chain of the kit's two-pole pieces put a pole every 7 m, far too many.)
-- Drawn near the camera only. (The lines are lifted by the hills like everything near the ground, so they are given heights above it.)
local powerlines = {}

local lines = {}
local POLE = "ck_electricity_pole_single"
local INS_X, INS_Y, INS_Z = -0.45, 7.12, 1.15 -- an insulator's place on the pole, in its own metres
local SAG, STEPS = 1.1, 6
local WIRE = { color = { 34, 36, 42 }, width = 0.05 }
local opts = { ry = 0 }

function powerlines.clear() lines = {} end

function powerlines.add(pts)
  local poles = {}
  for i, p in ipairs(pts) do
    local a, b = pts[math.max(1, i - 1)], pts[math.min(#pts, i + 1)]
    local ry = math.atan(-(b[2] - a[2]), b[1] - a[1]) -- (the pole's x axis along the line: turned by ry, x goes to (cos ry, -sin ry))
    local c, s = math.cos(ry), math.sin(ry)
    local function at(lx, lz) return p[1] + lx * c + lz * s, p[2] - lx * s + lz * c end
    local lx1, lz1 = at(INS_X, -INS_Z)
    local lx2, lz2 = at(INS_X, INS_Z)
    poles[i] = { x = p[1], z = p[2], ry = ry, ins = { { lx1, lz1 }, { lx2, lz2 } } }
  end
  lines[#lines + 1] = poles
end

local function wire(a, b)
  local px, py, pz = a[1], INS_Y, a[2]
  for k = 1, STEPS do
    local t = k / STEPS
    local x, z = a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t
    local y = INS_Y - SAG * 4 * t * (1 - t)
    nova.line3(px, py, pz, x, y, z, WIRE)
    px, py, pz = x, y, z
  end
end

-- Call from the scene's draw with the camera's place on the ground.
function powerlines.draw(cx, cz, range)
  local r2 = range * range
  for _, poles in ipairs(lines) do
    for i, p in ipairs(poles) do
      if (p.x - cx) ^ 2 + (p.z - cz) ^ 2 < r2 then
        opts.ry = p.ry
        nova.model(POLE, p.x, 0, p.z, opts)
        local q = poles[i + 1]
        if q then
          -- (insulator to insulator on the same side: a pole turned the other way round has its sides swapped)
          local same = (p.ins[1][1] - q.ins[1][1]) ^ 2 + (p.ins[1][2] - q.ins[1][2]) ^ 2 <= (p.ins[1][1] - q.ins[2][1]) ^ 2 + (p.ins[1][2] - q.ins[2][2]) ^ 2
          wire(p.ins[1], same and q.ins[1] or q.ins[2])
          wire(p.ins[2], same and q.ins[2] or q.ins[1])
        end
      end
    end
  end
end

return powerlines

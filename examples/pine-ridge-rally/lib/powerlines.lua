-- Power lines in free roam: each `power_line` object of the scene gives its poles' places in order (`pts`, [x, z] metres, 7 m apart).
-- Kenney's electricity-pole piece is two poles 7 m apart with the wire slung between them along its x axis, so a line is a chain of
-- those pieces, one from each pole to the next, turned so that the wire runs along the line (2026-11-08: they were turned across it, and
-- extra wires were drawn between them). Drawn near the camera only.
local powerlines = {}

local lines = {}
local PIECE = "ck_electricity_pole"
local opts = { ry = 0 }

function powerlines.clear() lines = {} end

function powerlines.add(pts)
  local pieces = {}
  for i = 1, #pts - 1 do
    local a, b = pts[i], pts[i + 1]
    local dx, dz = b[1] - a[1], b[2] - a[2]
    -- (the piece's x axis is along the wire: turned by ry, x goes to (cos ry, -sin ry))
    pieces[#pieces + 1] = { x = (a[1] + b[1]) / 2, z = (a[2] + b[2]) / 2, ry = math.atan(-dz, dx) }
  end
  lines[#lines + 1] = pieces
end

-- Call from the scene's draw with the camera's place on the ground.
function powerlines.draw(cx, cz, range)
  local r2 = range * range
  for _, pieces in ipairs(lines) do
    for _, p in ipairs(pieces) do
      if (p.x - cx) ^ 2 + (p.z - cz) ^ 2 < r2 then
        opts.ry = p.ry
        nova.model(PIECE, p.x, 0, p.z, opts)
      end
    end
  end
end

return powerlines

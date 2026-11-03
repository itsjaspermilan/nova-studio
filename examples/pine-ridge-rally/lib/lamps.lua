-- The street lamps of a night circuit: each lamp entity gives its position here, and each frame the few lamps nearest the
-- camera are switched on as point lights (the renderer has room for eight in all).
local lamps = {}

local CELL = 40
local lamp_bins = {}  -- by square of ground

local function key(cx, cz) return (cx + 2048) * 4096 + (cz + 2048) end
local function cell(v) return math.floor(v / CELL) end

function lamps.clear() lamp_bins = {} end

-- A lamp's light, at (x, y, z).
function lamps.add(x, y, z)
  local k = key(cell(x), cell(z))
  local list = lamp_bins[k]
  if not list then list = {}; lamp_bins[k] = list end
  list[#list + 1] = { x, y, z }
end

local near_lamps = {}

-- Switches on the `max` lamps nearest (cx, cz) that are within `radius` metres, as point lights.
function lamps.light(cx, cz, radius, max, opts)
  local n = 0
  for gx = cell(cx - radius), cell(cx + radius) do
    for gz = cell(cz - radius), cell(cz + radius) do
      local list = lamp_bins[key(gx, gz)]
      if list then
        for i = 1, #list do
          local l = list[i]
          local dx, dz = l[1] - cx, l[3] - cz
          local d2 = dx * dx + dz * dz
          if d2 < radius * radius then
            n = n + 1
            local e = near_lamps[n]
            if not e then e = {}; near_lamps[n] = e end
            e.l, e.d2 = l, d2
          end
        end
      end
    end
  end
  -- a few candidates at most, so a simple selection is enough
  for pick = 1, math.min(max, n) do
    local best = pick
    for j = pick + 1, n do
      if near_lamps[j].d2 < near_lamps[best].d2 then best = j end
    end
    near_lamps[pick], near_lamps[best] = near_lamps[best], near_lamps[pick]
    local l = near_lamps[pick].l
    nova.point_light(l[1], l[2], l[3], opts)
  end
end

return lamps

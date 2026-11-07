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

local faded = { color = { 255, 255, 255 }, radius = 10 }

-- Switches on the `max` lamps nearest (cx, cz) that are within `radius` metres, as point lights. A light does not switch on or off: it
-- fades in as its lamp comes into the nearest few (the farthest one that is lit is the dimmest, nothing at the distance of the next
-- lamp that is left out) and out as it leaves them.
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
  for pick = 1, math.min(max + 1, n) do
    local best = pick
    for j = pick + 1, n do
      if near_lamps[j].d2 < near_lamps[best].d2 then best = j end
    end
    near_lamps[pick], near_lamps[best] = near_lamps[best], near_lamps[pick]
  end
  -- (the lamps beyond the lit ones come in at the distance of the first that is left out, or at the edge of the radius)
  local cut = radius
  if n > max and max >= 0 then cut = math.min(radius, math.sqrt(near_lamps[max + 1].d2)) end
  faded.radius = opts.radius
  for pick = 1, math.min(max, n) do
    local e = near_lamps[pick]
    local l = e.l
    local fade = math.max(0, math.min(1, (cut - math.sqrt(e.d2)) / (cut * 0.35)))
    fade = fade * fade * (3 - 2 * fade)
    if fade > 0.01 then
      faded.color[1], faded.color[2], faded.color[3] = opts.color[1] * fade, opts.color[2] * fade, opts.color[3] * fade
      nova.point_light(l[1], l[2] + nova.terrain_height(l[1], l[3]), l[3], faded)
    end
  end
end

return lamps

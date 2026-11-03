-- The scenery of a circuit: thousands of fixed things (road pieces, trees, rocks, barriers) that the scene file places.
-- They are not kept as live entities (that would be slow on a handheld); each one hands itself to the world when it is
-- created. The world draws only what is near the camera and tells cars what they bump into.
local world = {}

local CELL = 40
local bins = {}       -- the things to draw, by square of ground
local solid_bins = {} -- the things that stop a car
local count = 0
local lamp_bins = {}  -- the street lamps, by square of ground: only the nearest few are switched on each frame

-- What can be driven into, by model: circles { sideways, forwards, radius } in metres, in the model's own frame.
local SOLID = {
  pine = { { 0, 0, 0.9 } }, pine_dark = { { 0, 0, 0.9 } }, autumn_tree = { { 0, 0, 0.9 } }, birch = { { 0, 0, 0.9 } },
  rock = { { 0, 0, 2.3 } }, rock_red = { { 0, 0, 2.3 } }, rock_ice = { { 0, 0, 2.3 } }, pine_snow = { { 0, 0, 0.9 } }, cactus = { { 0, 0, 0.7 } }, mesa = { { -3, 0, 5 }, { 3, 0, 5 } },
  tires = { { 0, 0, 1.5 } }, hay_bale = { { -0.8, 0, 1.2 }, { 0.8, 0, 1.2 } },
  guardrail = { { 0, -2.5, 1.1 }, { 0, 0, 1.1 }, { 0, 2.5, 1.1 } },
  tower = { { 0, 0, 3.3 } }, start_arch = { { -7.2, 0, 0.7 }, { 7.2, 0, 0.7 } },
}

local function key(cx, cz) return (cx + 2048) * 4096 + (cz + 2048) end
local function cell(v) return math.floor(v / CELL) end

function world.clear()
  bins, solid_bins, lamp_bins, count = {}, {}, {}, 0
end

function world.count() return count end

function world.add(model, x, y, z, ry, scale)
  local k = key(cell(x), cell(z))
  local list = bins[k]
  if not list then list = {}; bins[k] = list end
  list[#list + 1] = { model, x, y, z, { ry = ry, scale = scale } }
  count = count + 1
  local shape = SOLID[model]
  if shape then
    local s, c = math.sin(ry), math.cos(ry)
    for _, circle in ipairs(shape) do
      local ox, oz = circle[1] * scale, circle[2] * scale
      -- the model's +x is (cos, -sin) and its +z is (sin, cos) on the ground
      local wx, wz = x + ox * c + oz * s, z - ox * s + oz * c
      local sk = key(cell(wx), cell(wz))
      local sl = solid_bins[sk]
      if not sl then sl = {}; solid_bins[sk] = sl end
      sl[#sl + 1] = { wx, wz, circle[3] * scale }
    end
  end
end

-- A street lamp's light, at (x, y, z).
function world.add_lamp(x, y, z)
  local k = key(cell(x), cell(z))
  local list = lamp_bins[k]
  if not list then list = {}; lamp_bins[k] = list end
  list[#list + 1] = { x, y, z }
end

local near_lamps = {}

-- Switches on the `max` lamps nearest (cx, cz) that are within `radius` metres, as point lights.
function world.light_lamps(cx, cz, radius, max, opts)
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

-- Draws what lies within `radius` metres of the camera.
function world.draw(cx, cz, radius)
  local r2 = radius * radius
  for gx = cell(cx - radius), cell(cx + radius) do
    for gz = cell(cz - radius), cell(cz + radius) do
      local list = bins[key(gx, gz)]
      if list then
        for i = 1, #list do
          local e = list[i]
          local dx, dz = e[2] - cx, e[4] - cz
          if dx * dx + dz * dz < r2 then nova.model(e[1], e[2], e[3], e[4], e[5]) end
        end
      end
    end
  end
end

-- A circle of radius `r` at (x, z): the push that gets it out of whatever it overlaps, or nil.
function world.push(x, z, r)
  local px, pz, hit = 0, 0, false
  for gx = cell(x - 4), cell(x + 4) do
    for gz = cell(z - 4), cell(z + 4) do
      local list = solid_bins[key(gx, gz)]
      if list then
        for i = 1, #list do
          local s = list[i]
          local dx, dz = x - s[1], z - s[2]
          local d2, reach = dx * dx + dz * dz, r + s[3]
          if d2 < reach * reach then
            local d = math.sqrt(d2)
            if d < 0.001 then dx, dz, d = 1, 0, 1 end
            px, pz, hit = px + dx / d * (reach - d), pz + dz / d * (reach - d), true
          end
        end
      end
    end
  end
  if hit then return px, pz end
end

return world

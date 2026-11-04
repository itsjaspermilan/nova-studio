-- The islands. Solid boxes are { x0, z0, x1, z1, y0, y1, colour }; the moving platforms are entities.
local Level = {}

local GRASS, DIRT, STONE = { 90, 170, 70 }, { 120, 85, 55 }, { 150, 150, 160 }
Level.GOAL_GEMS = 12

local boxes = {}
local function box(x0, z0, x1, z1, y0, y1, color) boxes[#boxes + 1] = { x0, z0, x1, z1, y0, y1, color or GRASS } end

Level.scenery = {
  { "tree", -5, 0, -5, 2.4, 0.3 }, { "tree", -4.5, 0, 5, 2.0, 1.0 }, { "tree", 5, 0, 5, 2.2, 2.0 },
  { "rocks", 1, 0, 4.5, 2.0, 0.5 }, { "flowers", -2, 0, -3, 2.2, 0 }, { "flowers", 2.5, 0, 3, 2.2, 1 },
  { "crate", -1, 0, 5, 2.2, 0.4 }, { "tree", 15.5, 2, 2.2, 2.0, 0.7 }, { "rocks", 13, 2, -2.3, 2.0, 1.2 },
  { "tree", 36, 2, 3, 2.2, 0.2 }, { "flowers", 31.5, 2, 3, 2.2, 0.6 }, { "rocks", 49.5, 4, -3, 2.0, 0.9 },
  { "tree", 65.5, 8, -3, 2.4, 1.3 }, { "flowers", 62, 8, 3, 2.2, 0 },
}

function Level.build()
  boxes = {}
  Level.ramps = {}
  Level.gems = {}
  nova.walls.clear()
  box(-6, -6, 6, 6, -3, 0) -- the start island
  box(3, -3, 4, -2, 0, 6, STONE) -- a pillar (the camera has to deal with it)
  box(-5, 3, -3.5, 4.5, 0, 1.6, DIRT) -- a low wall to jump onto
  for i = 1, 5 do box(6 + (i - 1) * 1.2, -1.5, 6 + i * 1.2, 1.5, -3, 0.4 * i, i % 2 == 0 and STONE or GRASS) end -- stairs
  box(12, -3, 18, 3, -3, 2) -- island A
  box(30, -4, 38, 4, -4, 2) -- island 2
  Level.ramps[1] = { 38, -1.5, 44, 1.5, "x", 2, 4, -4 }
  box(44, -4, 52, 4, -4, 4) -- island 3
  box(59, -4, 67, 4, -4, 8) -- island 4, high up, with the flag
  for _, b in ipairs(boxes) do nova.walls.add(b[1], b[2], b[3], b[4], b[5], b[6]) end
  for _, r in ipairs(Level.ramps) do nova.walls.add_ramp(r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]) end
  -- gems, floating a little over the ground along the way
  local function gem(x, y, z) Level.gems[#Level.gems + 1] = { x, y, z } end
  gem(-2, 1, 0); gem(1, 1, -4); gem(-4.2, 2.6, 3.7) -- start island (the last on the low wall)
  for i = 1, 5 do gem(6.6 + (i - 1) * 1.2, 0.4 * i + 1, 0) end -- stairs
  gem(14, 3, 0); gem(16.5, 3, 0)
  gem(32, 3, -2); gem(34, 3, 0); gem(36, 3, 2)
  gem(40, 4.2, 0); gem(42, 5, 0)
  gem(46, 5, 0); gem(48, 5, 2); gem(50, 5, -2)
  gem(60.5, 9, 0); gem(63, 9, 2)
end

local function draw_ramp(r)
  local x0, z0, x1, z1, axis, y0, y1, base = table.unpack(r)
  local n = 12
  for i = 0, n - 1 do
    local a, b = i / n, (i + 1) / n
    if axis == "x" then
      local xa, xb = x0 + (x1 - x0) * a, x0 + (x1 - x0) * b
      nova.cuboid(xa, base, z0, xb, math.max(y0 + (y1 - y0) * b, y0 + (y1 - y0) * a), z1, { color = i % 2 == 0 and { 200, 170, 90 } or { 180, 150, 80 } })
    end
  end
end

function Level.draw()
  for _, b in ipairs(boxes) do
    local c = b[7]
    -- the rock under the grass
    local top = b[6]
    nova.cuboid(b[1], b[5], b[2], b[3], top - 0.35, b[4], { color = DIRT })
    nova.cuboid(b[1], top - 0.35, b[2], b[3], top, b[4], { color = c })
  end
  for _, r in ipairs(Level.ramps) do draw_ramp(r) end
  -- scenery from Kenney's kit (visual only, nothing here is solid)
  for _, d in ipairs(Level.scenery) do nova.model(d[1], d[2], d[3], d[4], { scale = d[5], ry = d[6] }) end
end

-- where a moving platform is at a time t: the centre x, the top height and z (the bot looks ahead with this too)
function Level.platform_at(kind, t)
  if kind == "slide" then return 24 - 3 * math.cos(t * math.pi * 2 / 6), 2, 0 end
  return 55.5, 6 - 2 * math.cos(t * math.pi * 2 / 8), 0
end

return Level

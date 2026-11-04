-- The islands, built from Kenney's Platformer Kit pieces (CC0) on a grid: a large block is 4 m square and 2 m tall once scaled by two,
-- so a jump (2 m high, 4.4 m across) is about one block up and one block's gap. Each solid piece is a box for the walls; the
-- slopes are ramps; the moving platforms are entities.
local Level = {}
Level.GOAL_GEMS = 10
local S = 2 -- the kit's metre is two of ours

local TOP_A, TOP_3, TOP_4 = 1.5, 3.0, 7.0 -- heights of the islands past the first ramp
local pieces = {} -- { model, x, y, z, ry } to draw

local function put(model, x, y, z, ry) pieces[#pieces + 1] = { model, x, y, z, ry or 0 } end

-- a 4 m square block whose top is at `top`
local function tile(cx, cz, top)
  put("block-grass-large", cx, top - 2, cz)
  nova.walls.add(cx - 2, cz - 2, cx + 2, cz + 2, top - 2, top)
end

-- a strip of tiles: x from x0 to x1 (4 m steps), z centres as listed
local function island(x0, x1, zs, top)
  for cx = x0 + 2, x1 - 2, 4 do for _, cz in ipairs(zs) do tile(cx, cz, top) end end
end

-- a slope up along +x from x0 (4 m long) from height y0 by `rise`, narrow (2 m) or wide (4 m)
local function slope(x0, cz, y0, rise, narrow)
  local half = narrow and 1.08 or 2
  put(narrow and "block-grass-large-slope-narrow" or "block-grass-large-slope", x0 + 2, y0, cz, -math.pi / 2)
  nova.walls.add_ramp(x0, cz - half, x0 + 4, cz + half, "x", y0, y0 + rise, y0 - 1)
end

Level.scenery = {
  { "tree", -5, 0, -5, 2.4, 0.3 }, { "tree", -4.5, 0, 5.2, 2.0, 1.0 }, { "tree", 5, 0, 5, 2.2, 2.0 },
  { "rocks", 1, 0, 4.5, 2.0, 0.5 }, { "flowers", -2, 0, -3, 2.2, 0 }, { "flowers", 2.5, 0, 3, 2.2, 1 },
  { "crate", -1, 0, 5, 2.2, 0.4 }, { "tree", 16.5, TOP_A, 3, 2.0, 0.7 }, { "rocks", 13, TOP_A, -3, 2.0, 1.2 },
  { "tree", 38, TOP_A, 3.2, 2.2, 0.2 }, { "flowers", 33.5, TOP_A, 3, 2.2, 0.6 }, { "rocks", 50, TOP_3, -3, 2.0, 0.9 },
  { "tree", 65.5, TOP_4, -3, 2.4, 1.3 }, { "flowers", 62, TOP_4, 3, 2.2, 0 },
}

function Level.build()
  pieces = {}
  Level.gems = {}
  nova.walls.clear()
  island(-6, 6, { -4, 0, 4 }, 0) -- the start island
  -- a pillar (the camera has to deal with it): three narrow blocks
  for i = 0, 2 do put("block-grass-narrow", 3.5, i * 2, -2.5) end
  nova.walls.add(3.5 - 0.78, -2.5 - 0.78, 3.5 + 0.78, -2.5 + 0.78, 0, 6)
  put("block-grass-low-long", -4, 0, 4) -- a low wall to jump onto
  nova.walls.add(-6, 3, -2, 5, 0, 1)
  slope(6, 0, 0, TOP_A) -- up to island A
  island(10, 18, { -2, 2 }, TOP_A)
  island(32, 40, { -2, 2 }, TOP_A) -- island 2, across the sliding platform
  slope(40, 0, TOP_A, TOP_3 - TOP_A, true) -- a narrow ramp up to island 3
  island(44, 52, { -2, 2 }, TOP_3)
  island(59, 67, { -2, 2 }, TOP_4) -- island 4, across the lift
  -- gems, floating a little over the ground along the way
  local function gem(x, y, z) Level.gems[#Level.gems + 1] = { x, y, z } end
  gem(-2, 1, 0); gem(1, 1, -4); gem(-4, 2.2, 4) -- start island (the last over the low wall)
  gem(8, 1.8, 0) -- on the slope
  gem(12, TOP_A + 1, 0); gem(14, TOP_A + 1, -1.5); gem(16.5, TOP_A + 1, 0)
  gem(34, TOP_A + 1, -2); gem(36, TOP_A + 1, 0); gem(38, TOP_A + 1, 2)
  gem(42, TOP_A + 2.2, 0)
  gem(46, TOP_3 + 1, 0); gem(48, TOP_3 + 1, 2); gem(50, TOP_3 + 1, -2)
  gem(60.5, TOP_4 + 1, 0); gem(63, TOP_4 + 1, 2)
  -- patrollers: x, standing height, start z, how far
  Level.walkers = { { 36, TOP_A, -3, 6 }, { 15, TOP_A, -2, 4 }, { 48, TOP_3, -3, 6 }, { 62.5, TOP_4, -2, 4 } }
  Level.checkpoints = { { 33.5, TOP_A }, { 45.5, TOP_3 } }
  Level.flag = { 65, TOP_4 }
end

function Level.draw()
  for _, p in ipairs(pieces) do nova.model(p[1], p[2], p[3], p[4], { scale = S, ry = p[5] }) end
  for _, d in ipairs(Level.scenery) do nova.model(d[1], d[2], d[3], d[4], { scale = d[5], ry = d[6] }) end
end

-- where a moving platform is at a time t: the centre x, the top height and z (the bot looks ahead with this too)
function Level.platform_at(kind, t)
  if kind == "slide" then return 25 - 3.5 * math.cos(t * math.pi * 2 / 6), TOP_A, 0 end
  return 55.5, 5 - 2 * math.cos(t * math.pi * 2 / 8), 0
end

return Level

-- The level's solid world, for the hero, the enemies and the computer player's look-ahead. A level's tilemaps are layers named by what their
-- tiles do (any tile of the layer, whatever it looks like):
--   ground     solid from every side            platforms  stood on from above, jumped through from below (down + jump drops through)
--   ladders    climbed (a ladder's top is a platform)   hazards    spikes: they hurt
--   water      a fall into it costs a heart     lava       the same, hotter
--   back, front, secret    pictures only (behind, in front; "secret" covers a hidden way and fades when the hero walks into it)
-- Things that move or open (platforms, blocks, doors) are boxes in `world.boxes`. Every tile is 48 units; all layers start at a multiple of 48.
local world = {}

local floor, min, max = math.floor, math.min, math.max
local T = 48
world.T = T
world.SOLID, world.ONEWAY, world.LADDER, world.HAZARD, world.LIQUID, world.LAVA = 1, 2, 4, 8, 16, 32
local SOLID, ONEWAY, LADDER, HAZARD, LIQUID = 1, 2, 4, 8, 16
local LAYER = { ground = SOLID, platforms = ONEWAY, ladders = LADDER, hazards = HAZARD, water = LIQUID, lava = LIQUID | 32 }
world.LAYER = LAYER

local cells, cols, rows = {}, 0, 0
world.boxes = {}   -- { x0, y0, x1, y1, oneway = bool, owner = entity, dx, dy }
world.movers = {}  -- boxes that move by time: box.path(t) -> x0, y0
world.springs = {} -- { x0, y0, x1, y1, owner }
world.t = 0
world.slippery = false

-- maps: a list of { name, tiles (rows of numbers), x, y, tile size } from the scene file
function world.build(maps)
  cols, rows = 0, 0
  for _, m in ipairs(maps) do
    if LAYER[m.name] then
      assert(m.x % T == 0 and m.y % T == 0, "the tilemap '" .. m.name .. "' must start at a multiple of 48")
      assert(m.tile == T, "the tilemap '" .. m.name .. "' must have 48-unit tiles")
      cols = max(cols, m.x // T + #m.tiles[1])
      rows = max(rows, m.y // T + #m.tiles)
    end
  end
  cells = {}
  for i = 1, cols * rows do cells[i] = 0 end
  for _, m in ipairs(maps) do
    local f = LAYER[m.name]
    if f then
      local c0, r0 = m.x // T, m.y // T
      for r, row in ipairs(m.tiles) do
        for c, t in ipairs(row) do
          if t >= 0 then
            local i = (r0 + r - 1) * cols + (c0 + c - 1) + 1
            cells[i] = cells[i] | f
          end
        end
      end
    end
  end
  world.cols, world.rows = cols, rows
  world.width, world.height = cols * T, rows * T
  world.boxes, world.movers, world.springs = {}, {}, {}
  world.t = 0
end

-- the flags of a cell; outside the map's sides it is solid (the level's walls), above and below it is empty (the sky, a pit)
local function flags(c, r)
  if r < 0 or r >= rows then return (c < 0 or c >= cols) and SOLID or 0 end
  if c < 0 or c >= cols then return SOLID end
  return cells[r * cols + c + 1]
end
world.flags = flags
function world.flags_at(x, y) return flags(floor(x / T), floor(y / T)) end

function world.set_cell(c, r, f)
  if c >= 0 and c < cols and r >= 0 and r < rows then cells[r * cols + c + 1] = f end
end

-- every flag of the cells a rectangle touches
function world.area_flags(x0, y0, x1, y1)
  local f = 0
  for r = floor(y0 / T), floor((y1 - 0.001) / T) do
    for c = floor(x0 / T), floor((x1 - 0.001) / T) do f = f | flags(c, r) end
  end
  return f
end

function world.add_box(b) world.boxes[#world.boxes + 1] = b; if b.path then world.movers[#world.movers + 1] = b end; return b end
function world.remove_box(b)
  for i, x in ipairs(world.boxes) do if x == b then table.remove(world.boxes, i); break end end
  for i, x in ipairs(world.movers) do if x == b then table.remove(world.movers, i); break end end
end

-- Move the moving boxes to time t; each remembers how far it went in the last 60th of a second (dx, dy) so that what stands on it goes along.
-- (from its path, not from where it was before: the computer player's look-ahead visits times out of order)
function world.set_time(t)
  world.t = t
  for _, b in ipairs(world.movers) do
    local x0, y0 = b.path(t)
    local px, py = b.path(t - 1 / 60)
    local w, h = b.x1 - b.x0, b.y1 - b.y0
    b.dx, b.dy = x0 - px, y0 - py
    b.x0, b.y0, b.x1, b.y1 = x0, y0, x0 + w, y0 + h
  end
end

-- Is a rectangle inside something solid? Returns the nearest edge in the direction of travel (dir: "left", "right", "up") and the box, if any.
local function blocker(x0, y0, x1, y1, dir)
  local edge, owner
  local r0, r1 = floor(y0 / T), floor((y1 - 0.001) / T)
  local c0, c1 = floor(x0 / T), floor((x1 - 0.001) / T)
  for r = r0, r1 do
    for c = c0, c1 do
      if flags(c, r) & SOLID ~= 0 then
        local e = dir == "right" and c * T or dir == "left" and (c + 1) * T or (r + 1) * T
        if not edge or (dir == "right" and e < edge) or (dir ~= "right" and e > edge) then edge = e end
      end
    end
  end
  for _, b in ipairs(world.boxes) do
    if not b.oneway and not b.off and x0 < b.x1 and x1 > b.x0 and y0 < b.y1 and y1 > b.y0 then
      local e = dir == "right" and b.x0 or dir == "left" and b.x1 or b.y1
      if not edge or (dir == "right" and e < edge) or (dir ~= "right" and e > edge) then edge, owner = e, b end
    end
  end
  return edge, owner
end
world.blocker = blocker

function world.solid_rect(x0, y0, x1, y1) return blocker(x0, y0, x1, y1, "up") ~= nil end

-- What the feet land on when a body's bottom goes from `from` down to `to` (x0..x1 across): the highest top crossed, and its box, if any.
-- Platforms and ladder tops count unless `drop`.
local function landing(x0, x1, from, to, drop, ladders_solid)
  local best, owner
  local c0, c1 = floor(x0 / T), floor((x1 - 0.001) / T)
  for r = floor(from / T), floor((to - 0.001) / T) do
    local top = r * T
    if top >= from - 0.01 and top < to then
      for c = c0, c1 do
        local f = flags(c, r)
        local hit = f & SOLID ~= 0
        if not hit and not drop then
          hit = f & ONEWAY ~= 0 or (ladders_solid and f & LADDER ~= 0 and flags(c, r - 1) & LADDER == 0)
        end
        if hit and (not best or top < best) then best = top end
      end
    end
    if best then break end
  end
  for _, b in ipairs(world.boxes) do
    if not b.off and x0 < b.x1 and x1 > b.x0 and b.y0 >= from - 0.01 and b.y0 < to and (not b.oneway or not drop) then
      if not best or b.y0 <= best then best, owner = b.y0, b end
    end
  end
  -- a solid box already overlapping at the start (a body pushed into it) still stops the fall at its top
  return best, owner
end
world.landing = landing

local STEP = 12

-- Move a body (b.x: the middle, b.y: the feet, b.w, b.h) by dx, dy, sliding along what is solid. Sets b.hit_x ("left"/"right"), b.hit_y ("up"/"down"),
-- b.ground and b.ground_box (what it stands on, for moving platforms), b.bumped (the box a head hit, if any).
-- opts: drop (fall through platforms), ladders (ladder tops hold), corner (nudge round corners when jumping into them)
function world.move(b, dx, dy, drop, ladders, corner)
  b.hit_x, b.hit_y, b.bumped = nil, nil, nil
  local hw = b.w * 0.5
  -- across
  local n = math.max(1, math.ceil(math.abs(dx) / STEP))
  local sx = dx / n
  for _ = 1, n do
    local nx = b.x + sx
    local dir = sx > 0 and "right" or "left"
    local edge = blocker(nx - hw, b.y - b.h, nx + hw, b.y - 0.01, dir)
    if edge then
      b.x = dir == "right" and edge - hw - 0.001 or edge + hw + 0.001
      b.hit_x = dir
      break
    end
    b.x = nx
  end
  -- up and down
  b.ground, b.ground_box = false, nil
  n = math.max(1, math.ceil(math.abs(dy) / STEP))
  local sy = dy / n
  for _ = 1, n do
    if sy > 0 then
      local top, owner = landing(b.x - hw, b.x + hw, b.y, b.y + sy, drop, ladders)
      if top then
        b.y, b.hit_y, b.ground, b.ground_box = top, "down", true, owner
        break
      end
      b.y = b.y + sy
    else
      local ny = b.y + sy
      local edge, owner = blocker(b.x - hw, ny - b.h, b.x + hw, ny - 0.01, "up")
      if edge and corner then
        -- jumping into the corner of a ledge: slide round it if it is only a little in the way
        for k = 2, 16, 2 do
          for _, s in ipairs({ k, -k }) do
            if not edge then break end
            if not blocker(b.x + s - hw, ny - b.h, b.x + s + hw, ny - 0.01, "up") and not blocker(b.x + s - hw, b.y - b.h, b.x + s + hw, b.y - 0.01, "up") then
              b.x, edge = b.x + s, nil
            end
          end
          if not edge then break end
        end
      end
      if edge then
        b.y = edge + b.h + 0.001
        b.hit_y, b.bumped = "up", owner
        break
      end
      b.y = ny
    end
  end
  if not b.ground and dy >= 0 then
    -- standing still on something (no fall this step): check just under the feet
    local top, owner = landing(b.x - hw, b.x + hw, b.y, b.y + 1, drop, ladders)
    if top and top <= b.y + 0.01 then b.ground, b.ground_box = true, owner end
  end
end

return world

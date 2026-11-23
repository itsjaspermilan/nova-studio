-- The placement grid of a building's interior (docs/games/mountain-post.md, "Rooms and the placement grid"). A room's floor is square cells
-- (0.5 m); everything in it has a footprint in cells (w x d, before it is turned), a facing (0, 90, 180, 270) and a position that is its
-- footprint's top-left cell. The data lives in the room's scene file, not here: the room object's props.grid (cell, origin, cols, rows, the
-- door, the window, the counters' own finer grids) and each piece's props.surface / cell / size / face / layer. This module reads it and
-- answers questions about it: where a cell is in the world, what a piece covers, whether pieces overlap or leave their surface, which cells
-- are free (for a decorating mode to offer), and whether a person can walk from one place to another between the pieces.
--
--   surface "floor"                  the room's cells; cell = [col, row], row 0 at the back wall
--   surface "<counter>"              a counter's top, in the finer cells of grid.surfaces[<counter>]
--   surface "wall:back|right|left"   a wall: cell = [along, height] in that wall's cells (height in wall_step metres from the floor)
--   layer "flat"                     a rug or mat: things stand on it, and it overlaps nothing; every other piece is solid to its own surface
local RG = {}
RG.debug = false -- (a flag: when true the room draws its grid and footprints, faintly: RG.draw)

local PERSON_R = 0.26 -- the postmaster's collision radius (entities/postmaster.lua RADIUS)

-- ---- reading the scene file ----------------------------------------------------------------------------------------------------------------
-- The grid of a room, and its pieces, from the scene file (default "office"): { grid, items, by_name }.
function RG.load(scene)
  local data = nova.scene_data(scene or "office")
  local room = { items = {}, by_name = {} }
  for _, o in ipairs(data and data.objects or {}) do
    local p = o.props or {}
    if p.grid then room.grid = p.grid end
    if p.surface then
      local it = { name = o.name, kind = o.kind, x = o.x, y = o.y, z = o.z, surface = p.surface, cell = p.cell, size = p.size,
        face = p.face or 0, layer = p.layer or "item", slot = p.slot }
      room.items[#room.items + 1] = it
      if o.name then room.by_name[o.name] = it end
    end
  end
  return room
end

-- ---- cells and the world --------------------------------------------------------------------------------------------------------------------
-- The surface a piece stands on: { origin = { x, z }, cell, cols, rows, y }.
function RG.surface(grid, name)
  if name == "floor" then return { origin = grid.origin, cell = grid.cell, cols = grid.cols, rows = grid.rows, y = 0 } end
  return grid.surfaces[name]
end

local function is_wall(surface) return surface:sub(1, 5) == "wall:" end

-- The footprint's width and depth in cells, turned by the facing.
function RG.turned(item)
  local w, d = item.size[1], item.size[2]
  if item.face == 90 or item.face == 270 then return d, w end
  return w, d
end

-- Where a piece stands in the world: the middle of its footprint (and, on a counter, the top; on a wall, the bottom of its cells).
function RG.place(grid, item)
  local c, r = item.cell[1], item.cell[2]
  if is_wall(item.surface) then
    local along = grid.origin[1] + (c + item.size[1] / 2) * grid.cell
    local step = grid.wall_step
    if item.surface == "wall:back" then return along, r * step, grid.origin[2] end
    local z = grid.origin[2] + (c + item.size[1] / 2) * grid.cell
    return (item.surface == "wall:right" and -grid.origin[1] or grid.origin[1]), r * step, z
  end
  local s = RG.surface(grid, item.surface)
  local w, d = RG.turned(item)
  return s.origin[1] + (c + w / 2) * s.cell, s.y, s.origin[2] + (r + d / 2) * s.cell
end

-- The middle of a cell on the floor (or on a counter's top, by its surface's name).
function RG.world(grid, col, row, surface)
  local s = RG.surface(grid, surface or "floor")
  return s.origin[1] + (col + 0.5) * s.cell, s.origin[2] + (row + 0.5) * s.cell
end

-- The cell under a world point on the floor: col, row (nil outside the room).
function RG.cell_at(grid, x, z)
  local col, row = math.floor((x - grid.origin[1]) / grid.cell), math.floor((z - grid.origin[2]) / grid.cell)
  if col < 0 or row < 0 or col >= grid.cols or row >= grid.rows then return nil end
  return col, row
end

-- The cells a piece covers: a list of { col, row } on its surface (a wall piece: { along, height }).
function RG.cells(item)
  local out = {}
  local w, d = RG.turned(item)
  if is_wall(item.surface) then w, d = item.size[1], item.size[2] end
  for i = 0, w - 1 do
    for j = 0, d - 1 do out[#out + 1] = { item.cell[1] + i, item.cell[2] + j } end
  end
  return out
end

-- ---- checks ----------------------------------------------------------------------------------------------------------------------------------
-- A problem list: strings, empty when the room is sound. Every piece must be on the grid (its object's x, z the cell's own position) and
-- inside its surface, none may overlap another on the same surface (rugs and mats aside), a counter's top grid must lie on its counter,
-- and nothing solid may stand in the door's cells.
function RG.problems(room)
  local grid, items, out = room.grid, room.items, {}
  local solid = {}
  for _, it in ipairs(items) do
    local name = it.name or it.kind
    local x, _, z = RG.place(grid, it)
    -- (on the grid: the object stands where its cell puts it, to a millimetre; tiles are on their counter's grid)
    if math.abs(x - it.x) > 0.002 or math.abs(z - it.z) > 0.002 then
      out[#out + 1] = string.format("%s is off the grid: at (%.3f, %.3f), its cell says (%.3f, %.3f)", name, it.x, it.z, x, z)
    end
    local ok = it.face == 0 or it.face == 90 or it.face == 180 or it.face == 270
    if not ok then out[#out + 1] = name .. " faces " .. tostring(it.face) .. ", not 0, 90, 180 or 270" end
    -- inside its surface
    local cols, rows
    if is_wall(it.surface) then
      cols = it.surface == "wall:back" and grid.cols or grid.rows
      rows = math.floor(grid.wall_height / grid.wall_step + 0.5)
    else
      local s = RG.surface(grid, it.surface)
      if not s then out[#out + 1] = name .. " is on a surface that is not in the grid: " .. it.surface; cols, rows = 0, 0 else cols, rows = s.cols, s.rows end
    end
    for _, c in ipairs(RG.cells(it)) do
      if c[1] < 0 or c[2] < 0 or c[1] >= cols or c[2] >= rows then out[#out + 1] = name .. " leaves its surface (" .. it.surface .. ")"; break end
    end
    if it.layer ~= "flat" then
      local key = it.surface
      solid[key] = solid[key] or {}
      solid[key][#solid[key] + 1] = it
    end
  end
  for surface, list in pairs(solid) do
    for i = 1, #list do
      local seen = {}
      for _, c in ipairs(RG.cells(list[i])) do seen[c[1] .. "," .. c[2]] = true end
      for j = i + 1, #list do
        for _, c in ipairs(RG.cells(list[j])) do
          if seen[c[1] .. "," .. c[2]] then
            out[#out + 1] = string.format("%s and %s overlap on %s at cell %d,%d", list[i].name or list[i].kind, list[j].name or list[j].kind, surface, c[1], c[2])
            break
          end
        end
      end
    end
  end
  -- the counters' tops lie on their counters
  for name, s in pairs(grid.surfaces) do
    local counter = room.by_name[name]
    if counter then
      local w, d = RG.turned(counter)
      local x0 = grid.origin[1] + counter.cell[1] * grid.cell
      local z0 = grid.origin[2] + counter.cell[2] * grid.cell
      if math.abs(s.origin[1] - x0) > 1e-6 or math.abs(s.origin[2] - z0) > 1e-6
        or math.abs(s.cols * s.cell - w * grid.cell) > 1e-6 or math.abs(s.rows * s.cell - d * grid.cell) > 1e-6 then
        out[#out + 1] = name .. "'s top grid is not on the counter"
      end
    end
  end
  -- the door's cells stay free of anything solid (a mat is flat)
  for _, it in ipairs(solid.floor or {}) do
    for _, c in ipairs(RG.cells(it)) do
      for _, dc in ipairs(grid.door.cols) do
        if c[1] == dc and c[2] >= grid.rows - 2 then out[#out + 1] = (it.name or it.kind) .. " stands in the door's cells" end
      end
    end
  end
  return out
end

-- The floor cells nothing solid stands on: a list of { col, row } (the doorway's own cells included), for a decorating mode to offer.
function RG.blocked(room)
  local set = {}
  for _, it in ipairs(room.items) do
    if it.surface == "floor" and it.layer ~= "flat" then
      for _, c in ipairs(RG.cells(it)) do set[c[1] .. "," .. c[2]] = true end
    end
  end
  return set
end

function RG.free_cells(room)
  local set, out = RG.blocked(room), {}
  for row = 0, room.grid.rows - 1 do
    for col = 0, room.grid.cols - 1 do
      if not set[col .. "," .. row] then out[#out + 1] = { col, row } end
    end
  end
  return out
end

-- The free cells of a counter's top (by its surface's name), and of a wall (cells along it that no wall piece covers, in one height row).
function RG.free_top_cells(room, surface)
  local s, taken, out = room.grid.surfaces[surface], {}, {}
  for _, it in ipairs(room.items) do
    if it.surface == surface and it.layer ~= "flat" then
      for _, c in ipairs(RG.cells(it)) do taken[c[1] .. "," .. c[2]] = true end
    end
  end
  for r = 0, s.rows - 1 do
    for c = 0, s.cols - 1 do
      if not taken[c .. "," .. r] then out[#out + 1] = { c, r } end
    end
  end
  return out
end

-- How many free cells lie beside a piece on its own rows, to the room's wall: left (lower columns) and right (higher), for the walks round
-- the ends of a counter.
function RG.gap_beside(room, name)
  local it, set = room.by_name[name], RG.blocked(room)
  local w, d = RG.turned(it)
  local function run(from, step, limit)
    local n, col = 0, from
    while col >= 0 and col < limit do
      for r = it.cell[2], it.cell[2] + d - 1 do if set[col .. "," .. r] then return n end end
      n, col = n + 1, col + step
    end
    return n
  end
  return run(it.cell[1] - 1, -1, room.grid.cols), run(it.cell[1] + w, 1, room.grid.cols)
end

-- Whether a person of radius `r` can walk from (x0, z0) to (x1, z1) over the floor's cells, round what stands on them: a search over
-- the cells whose middle is further than r from every solid cell's edge (so a walk 1 cell wide passes a body of 0.26 m).
function RG.reachable(room, x0, z0, x1, z1, r)
  local grid, r = room.grid, r or PERSON_R
  local set = RG.blocked(room)
  local cell = grid.cell
  local function passable(col, row)
    if col < 0 or row < 0 or col >= grid.cols or row >= grid.rows then return false end
    if set[col .. "," .. row] then return false end
    -- (the nearest solid cell within reach: its rectangle's distance from this cell's middle)
    local cx, cz = RG.world(grid, col, row)
    local reach = math.ceil(r / cell) + 1
    for dc = -reach, reach do
      for dr = -reach, reach do
        if set[(col + dc) .. "," .. (row + dr)] then
          local bx, bz = grid.origin[1] + (col + dc) * cell, grid.origin[2] + (row + dr) * cell
          local nx, nz = math.max(bx, math.min(cx, bx + cell)), math.max(bz, math.min(cz, bz + cell))
          if math.sqrt((cx - nx) ^ 2 + (cz - nz) ^ 2) < r - 0.02 then return false end -- (a body may brush a cell by 2 cm: a 1 m aisle is two cells)
        end
      end
    end
    return true
  end
  local c0, r0 = RG.cell_at(grid, x0, z0)
  local c1, r1 = RG.cell_at(grid, x1, z1)
  if not c0 or not c1 then return false end
  local seen, queue, head = { [c0 .. "," .. r0] = true }, { { c0, r0 } }, 1
  while head <= #queue do
    local c, rr = queue[head][1], queue[head][2]
    head = head + 1
    if c == c1 and rr == r1 then return true end
    for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
      local nc, nr = c + d[1], rr + d[2]
      local key = nc .. "," .. nr
      if not seen[key] and passable(nc, nr) then seen[key] = true; queue[#queue + 1] = { nc, nr } end
    end
  end
  return false
end

-- ---- the debug view -----------------------------------------------------------------------------------------------------------------------
-- RG.debug = true: the floor's cells as a faint checkerboard, every footprint tinted (solid red, flat blue), the door's cells green, and
-- the counters' own cells on their tops. Drawn from the room's draw().
local CELL_A, CELL_B = { color = { 30, 20, 10, 80 } }, { color = { 30, 20, 10, 20 } }
local SOLID, FLAT, DOOR = { color = { 235, 80, 70, 90 } }, { color = { 80, 140, 235, 80 } }, { color = { 90, 220, 120, 70 } }
function RG.draw(room)
  local g = room.grid
  for row = 0, g.rows - 1 do
    for col = 0, g.cols - 1 do
      local x, z = RG.world(g, col, row)
      nova.quad3(x, 0.03, z, 0, 1, 0, g.cell * 0.96, (col + row) % 2 == 0 and CELL_A or CELL_B)
    end
  end
  for _, dc in ipairs(g.door.cols) do
    local x, z = RG.world(g, dc, g.rows - 1)
    nova.quad3(x, 0.035, z, 0, 1, 0, g.cell * 0.96, DOOR)
  end
  for _, it in ipairs(room.items) do
    if not is_wall(it.surface) and it.kind ~= "tile" then
      local s = RG.surface(g, it.surface)
      -- (a counter's footprint is drawn on its top, so it shows)
      local y = it.surface == "floor" and (it.layer == "flat" and 0.045 or g.surfaces[it.name] and g.surfaces[it.name].y + 0.02 or 0.05) or s.y + 0.14
      local w, d = RG.turned(it)
      for i = 0, w - 1 do
        for j = 0, d - 1 do
          local x, z = s.origin[1] + (it.cell[1] + i + 0.5) * s.cell, s.origin[2] + (it.cell[2] + j + 0.5) * s.cell
          nova.quad3(x, y, z, 0, 1, 0, s.cell * 0.9, it.layer == "flat" and FLAT or SOLID)
        end
      end
    end
  end
end

return RG

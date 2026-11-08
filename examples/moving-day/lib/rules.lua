-- Moving Day's rules: a flat read from its scene file, the mover's steps and pushes, turning a piece, and the wishes on the client's card. The same
-- rules are in scripts/moving-day/rules.mjs for the solver; the self-test (lib/selftest.lua) replays the solver's solution of every level through these,
-- so the two must agree.
--
-- A level (scenes/levels/<n>.scene.json) is objects on the 1 m grid: floor tiles (their kind says the room), walls, windows and doorways (each on the
-- north side of its cell, turned by `ry` to the west, south or east side), rugs, furniture, the mover, the client and a "level" object whose props are
-- the card: name, client, wishes, par, stars, solution, tip. A piece's place is the middle of its first cell; the rest of it lies to +x (its width)
-- and -z (its depth) before it is turned, and its front faces +z.
local Rules = {}
Rules.__index = Rules

-- cells across and deep
Rules.FURNITURE = {
  sofa = { 2, 1 }, armchair = { 1, 1 }, tv = { 2, 1 }, bed = { 2, 2 }, plant = { 1, 1 }, bookcase = { 2, 1 }, lamp = { 1, 1 }, fridge = { 1, 1 }, stove = { 1, 1 },
  desk = { 2, 1 }, desk_chair = { 1, 1 }, table = { 2, 1 }, chair = { 1, 1 }, box = { 1, 1 }, bathtub = { 2, 1 }, washer = { 1, 1 }, side_table = { 1, 1 }, coffee_table = { 1, 1 },
}
-- low pieces do not block the view (a sofa faces the TV over a coffee table)
Rules.LOW = { coffee_table = true }
Rules.RUGS = { rug = { 3, 2 }, rug_round = { 2, 2 } }
Rules.FLOORS = { floor_wood = "living", floor_carpet = "bedroom", floor_tile = "kitchen", floor_bath = "bathroom" }
Rules.EDGES = { wall = "wall", window = "window", doorway = "door" }
-- the d-pad: east, west, south, north
Rules.DIRS = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }
Rules.KEYS = { "r", "l", "d", "u" }
local DIRS = Rules.DIRS
local function opposite(d) return ({ 2, 1, 4, 3 })[d] end
Rules.opposite = opposite

-- a quarter turn (ry + 90 degrees) takes (x, z) to (z, -x)
local function turn(x, z, q)
  q = q % 4
  for _ = 1, q do x, z = z, -x end
  return x, z
end
Rules.turn = turn
local function quarter(ry) return math.floor((ry or 0) / (math.pi / 2) + 0.5) % 4 end
Rules.quarter = quarter
local function front(q) return turn(0, 1, q) end
Rules.front = front
local function dir_of(dx, dz)
  for i, d in ipairs(DIRS) do if d[1] == dx and d[2] == dz then return i end end
end
Rules.dir_of = dir_of

local function ckey(x, z) return x * 1000 + z end
Rules.ckey = ckey
local function ekey(ax, az, bx, bz)
  if ax < bx or (ax == bx and az < bz) then return ax .. "," .. az .. "|" .. bx .. "," .. bz end
  return bx .. "," .. bz .. "|" .. ax .. "," .. az
end
Rules.ekey = ekey

-- the cells of a piece: { x, z, is_front, is_back }
function Rules.cells(kind, ax, az, q)
  local size = Rules.FURNITURE[kind]
  local out = {}
  for j = 0, size[2] - 1 do
    for i = 0, size[1] - 1 do
      local ox, oz = turn(i, -j, q)
      out[#out + 1] = { ax + ox, az + oz, j == 0, j == size[2] - 1 }
    end
  end
  return out
end
local cells = Rules.cells

-- ---- a level from its scene file ----------------------------------------------------------------------------------------------------------------

function Rules.read(name)
  local data = nova.scene_data(name)
  if not data then return nil end
  local L = { name = name, floor = {}, edges = {}, rug = {}, pieces = {}, rugs = {}, walls = {}, floors = {}, x0 = math.huge, z0 = math.huge, x1 = -math.huge, z1 = -math.huge }
  for _, o in ipairs(data.objects or {}) do
    local x, z = math.floor(o.x + 0.5), math.floor((o.z or 0) + 0.5)
    local props = o.props or {}
    local q = quarter(props.ry)
    local k = o.kind
    if k == "level" then
      L.props = props
    elseif Rules.FLOORS[k] then
      L.floor[ckey(x, z)] = Rules.FLOORS[k]
      L.floors[#L.floors + 1] = { kind = k, x = x, z = z }
      L.x0, L.z0, L.x1, L.z1 = math.min(L.x0, x), math.min(L.z0, z), math.max(L.x1, x), math.max(L.z1, z)
    elseif Rules.EDGES[k] then
      local dx, dz = turn(0, -1, q)
      L.edges[ekey(x, z, x + dx, z + dz)] = Rules.EDGES[k]
      L.walls[#L.walls + 1] = { kind = k, x = x, z = z, q = q, dx = dx, dz = dz }
    elseif Rules.RUGS[k] then
      local size = Rules.RUGS[k]
      for j = 0, size[2] - 1 do
        for i = 0, size[1] - 1 do
          local ox, oz = turn(i, -j, q)
          L.rug[ckey(x + ox, z + oz)] = true
        end
      end
      L.rugs[#L.rugs + 1] = { kind = k, x = x, z = z, q = q }
    elseif Rules.FURNITURE[k] then
      L.pieces[#L.pieces + 1] = { kind = k, x = x, z = z, q = q }
    elseif k == "mover" then
      local fx, fz = front(q)
      L.start = { x = x, z = z, f = dir_of(fx, fz) }
    elseif k == "client" then
      L.client = { x = x, z = z, q = q, who = props.who }
    else
      error(name .. ": \"" .. k .. "\" is not a piece of a flat")
    end
  end
  assert(L.props, name .. ": no \"level\" object (its props are the wish card)")
  assert(L.start, name .. ": no \"mover\" object")
  assert(#L.floors > 0, name .. ": no floor")
  L.props.wishes = L.props.wishes or {}
  return L
end

-- ---- the game on a level --------------------------------------------------------------------------------------------------------------------------

function Rules.new(L)
  return setmetatable({ L = L }, Rules)
end

function Rules:floor(x, z) return self.L.floor[ckey(x, z)] ~= nil end
function Rules:edge(ax, az, bx, bz) return self.L.edges[ekey(ax, az, bx, bz)] end
function Rules:wall(ax, az, bx, bz)
  local e = self.L.edges[ekey(ax, az, bx, bz)]
  return e == "wall" or e == "window"
end

function Rules:start()
  local s = { px = self.L.start.x, pz = self.L.start.z, f = self.L.start.f, pieces = {} }
  for i, p in ipairs(self.L.pieces) do s.pieces[i] = { kind = p.kind, x = p.x, z = p.z, q = p.q } end
  return s
end

local function copy(s)
  local pieces = {}
  for i, p in ipairs(s.pieces) do pieces[i] = p end
  return { px = s.px, pz = s.pz, f = s.f, pieces = pieces }
end
Rules.copy = copy

-- the piece on a cell (its number), or nil
function Rules:occupant(s, x, z, skip)
  for i, p in ipairs(s.pieces) do
    if i ~= skip then
      for _, c in ipairs(cells(p.kind, p.x, p.z, p.q)) do
        if c[1] == x and c[2] == z then return i end
      end
    end
  end
  return nil
end

-- a piece can stand on these cells: all floor, none taken by another piece or the mover, and no wall between its own cells
function Rules:fits(s, i, cs, px, pz)
  for _, c in ipairs(cs) do
    if not self:floor(c[1], c[2]) or (c[1] == px and c[2] == pz) or self:occupant(s, c[1], c[2], i) then return false end
  end
  for _, a in ipairs(cs) do
    for _, b in ipairs(cs) do
      if math.abs(a[1] - b[1]) + math.abs(a[2] - b[2]) == 1 and self:wall(a[1], a[2], b[1], b[2]) then return false end
    end
  end
  return true
end

-- The d-pad pressed towards `d`. Returns the new state and what happened: { moved = true, pushed = i } or { bump = "wall" | "piece", piece = i }.
function Rules:step(s, d)
  local dx, dz = DIRS[d][1], DIRS[d][2]
  local nx, nz = s.px + dx, s.pz + dz
  local turned = copy(s)
  turned.f = d
  if not self:floor(nx, nz) or self:wall(s.px, s.pz, nx, nz) then return turned, { bump = "wall" } end
  local i = self:occupant(s, nx, nz)
  if not i then
    turned.px, turned.pz = nx, nz
    return turned, { moved = true }
  end
  local p = s.pieces[i]
  local cs = cells(p.kind, p.x, p.z, p.q)
  for _, c in ipairs(cs) do
    if self:wall(c[1], c[2], c[1] + dx, c[2] + dz) then return turned, { bump = "piece", piece = i } end
  end
  local moved = {}
  for k, c in ipairs(cs) do moved[k] = { c[1] + dx, c[2] + dz } end
  if not self:fits(s, i, moved, -999, -999) then return turned, { bump = "piece", piece = i } end
  turned.px, turned.pz = nx, nz
  turned.pieces[i] = { kind = p.kind, x = p.x + dx, z = p.z + dz, q = p.q }
  return turned, { moved = true, pushed = i }
end

-- A (dir = -1, a quarter clockwise seen from above) or Y (+1): turns the piece the mover faces about the cell in front of them. Returns the new
-- state and the piece's number, or nil and the piece that could not turn (or nothing in front).
function Rules:rotate(s, dir)
  local dx, dz = DIRS[s.f][1], DIRS[s.f][2]
  local tx, tz = s.px + dx, s.pz + dz
  if self:wall(s.px, s.pz, tx, tz) then return nil end
  local i = self:occupant(s, tx, tz)
  if not i then return nil end
  local p = s.pieces[i]
  local ox, oz = turn(p.x - tx, p.z - tz, (dir + 4) % 4)
  local np = { kind = p.kind, x = tx + ox, z = tz + oz, q = (p.q + dir + 4) % 4 }
  if not self:fits(s, i, cells(np.kind, np.x, np.z, np.q), s.px, s.pz) then return nil, i end
  local n = copy(s)
  n.pieces[i] = np
  return n, i
end

-- ---- the wishes ----

function Rules:find(s, kind)
  for i, p in ipairs(s.pieces) do if p.kind == kind then return i end end
end

function Rules:wish(s, w)
  local i = self:find(s, w.piece)
  if not i then return false end
  local p = s.pieces[i]
  local cs = cells(p.kind, p.x, p.z, p.q)
  local fx, fz = front(p.q)
  if w.wish == "faces" then
    local j = self:find(s, w.target)
    if not j then return false end
    for _, c in ipairs(cs) do
      if c[3] then
        local x, z = c[1], c[2]
        for _ = 1, 6 do
          local nx, nz = x + fx, z + fz
          if not self:floor(nx, nz) or self:wall(x, z, nx, nz) then break end
          local o = self:occupant(s, nx, nz)
          if o == j then return true end
          if o and o ~= i and not Rules.LOW[s.pieces[o].kind] then break end
          x, z = nx, nz
        end
      end
    end
    return false
  elseif w.wish == "next" then
    local j = self:find(s, w.target)
    if not j then return false end
    for _, c in ipairs(cs) do
      for _, d in ipairs(DIRS) do
        if self:occupant(s, c[1] + d[1], c[2] + d[2], i) == j and not self:wall(c[1], c[2], c[1] + d[1], c[2] + d[2]) then return true end
      end
    end
    return false
  elseif w.wish == "wall" then
    for _, c in ipairs(cs) do
      if c[4] and not self:wall(c[1], c[2], c[1] - fx, c[2] - fz) then return false end
    end
    return true
  elseif w.wish == "window" then
    for _, c in ipairs(cs) do
      for _, d in ipairs(DIRS) do
        if self:edge(c[1], c[2], c[1] + d[1], c[2] + d[2]) == "window" then return true end
      end
    end
    return false
  elseif w.wish == "rug" then
    for _, c in ipairs(cs) do if not self.L.rug[ckey(c[1], c[2])] then return false end end
    return true
  elseif w.wish == "room" then
    for _, c in ipairs(cs) do if self.L.floor[ckey(c[1], c[2])] ~= w.target then return false end end
    return true
  end
  error(self.L.name .. ": no wish \"" .. tostring(w.wish) .. "\"")
end

-- which wishes hold now (a list of booleans) and whether all do
function Rules:granted(s)
  local out, all = {}, true
  for k, w in ipairs(self.L.props.wishes) do
    out[k] = self:wish(s, w)
    all = all and out[k]
  end
  return out, all
end

-- stars for a number of moves: three within props.stars[1], two within props.stars[2], else one
function Rules:stars_for(moves)
  local st = self.L.props.stars or { 0, 0 }
  if moves <= st[1] then return 3 elseif moves <= st[2] then return 2 end
  return 1
end

-- replays presses (r l d u a y) from the start: the moves that counted and the state at the end
function Rules:replay(presses)
  local s, moves = self:start(), 0
  for ch in presses:gmatch(".") do
    if ch == "a" or ch == "y" then
      local n = self:rotate(s, ch == "a" and -1 or 1)
      if n then s = n; moves = moves + 1 end
    else
      local d
      for k, key in ipairs(Rules.KEYS) do if key == ch then d = k end end
      local n, what = self:step(s, d)
      s = n
      if what.moved then moves = moves + 1 end
    end
  end
  return s, moves
end

return Rules

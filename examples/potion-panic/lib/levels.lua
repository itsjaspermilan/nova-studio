-- The levels, read from their scene files: scenes/levels/1.scene.json, 2, 3 ... (until one is missing) and scenes/levels/primer.scene.json, the
-- tutorial. A level is kitchen pieces placed on the grid (objects of the kinds in entities/, one metre apart: scripts/potion/kitchen-models.mjs)
-- and a "level" object whose props are its settings. Nothing about a level is written in code: change the file and the game follows.
local levels = {}

-- what a piece is to the rules (lib/kitchen.lua's map letters), by its kind without the biome ("meadow_counter" is a counter)
local LETTER = {
  floor = ".", floor_b = ".", start = "@", wall = "#", wall_low = "#", counter = "T", crate_1 = "a", crate_2 = "b", crate_3 = "c", crate_4 = "d",
  bottles = "B", mortar = "M", cauldron = "C", hatch = "S", bin = "X", wash = "W", ice = "i", ice_b = "i", mud = "m", lava = "L", pulse = "v",
  belt_e = ">", belt_w = "<", belt_n = "^", belt_s = "w",
}
-- when two pieces share a cell, the one that matters most to the rules wins: a station (a crate, the cauldron...) over a plain counter, a counter
-- over a wall, a wall over a hazard, a hazard over the start, the start over the floor. So a station dropped on a counter takes its place.
local RANK = { ["."] = 1, ["@"] = 2, i = 3, m = 3, L = 3, v = 3, [">"] = 3, ["<"] = 3, ["^"] = 3, w = 3, ["#"] = 4, T = 5 }
local function rank(ch) return RANK[ch] or 6 end
local BIOMES = { "meadow", "frost", "ember", "mire" }

local function piece_of(kind)
  local p = kind
  for _, b in ipairs(BIOMES) do
    if kind:sub(1, #b + 1) == b .. "_" then p = kind:sub(#b + 2) end
  end
  return p
end

local function read(name)
  local data = nova.scene_data("levels." .. name)
  if not data then return nil end
  local file = "scenes/levels/" .. name .. ".scene.json"
  local level
  local cells, x0, z0, x1, z1 = {}, math.huge, math.huge, -math.huge, -math.huge
  local pieces = {}
  for _, o in ipairs(data.objects or {}) do
    if o.kind == "level" then
      level = o.props
    else
      local ch = LETTER[piece_of(o.kind)]
      assert(ch, file .. ": \"" .. o.kind .. "\" is not a kitchen piece")
      -- (a piece stands on the cell whose middle is nearest: pieces are placed one metre apart)
      local cx, cz = math.floor(o.x + 0.5), math.floor((o.z or 0) + 0.5)
      local key = cx .. "," .. cz
      if not cells[key] or rank(ch) >= rank(cells[key]) then cells[key] = ch end
      x0, z0, x1, z1 = math.min(x0, cx), math.min(z0, cz), math.max(x1, cx), math.max(z1, cz)
      pieces[#pieces + 1] = { kind = o.kind, piece = piece_of(o.kind), cx = cx, cz = cz, ry = o.props and o.props.ry }
    end
  end
  assert(level, file .. ": no \"level\" object (its props are the level's settings)")
  assert(#pieces > 0, file .. ": no kitchen pieces")
  -- the map: from the top left piece; a cell with no piece is outside the kitchen
  level.map = {}
  for cz = z0, z1 do
    local line = {}
    for cx = x0, x1 do line[#line + 1] = cells[cx .. "," .. cz] or " " end
    level.map[#level.map + 1] = table.concat(line)
  end
  -- the pieces in the kitchen's own places (cell column c spans c - 1 to c, so a piece's middle is at c - 0.5)
  for _, p in ipairs(pieces) do
    p.x, p.z = p.cx - x0 + 0.5, p.cz - z0 + 0.5
  end
  level.pieces = pieces
  return level
end

function levels.load()
  local list = {}
  local i = 1
  while true do
    local level = read(tostring(i))
    if not level then break end
    list[i] = level
    i = i + 1
  end
  return list, read("primer")
end

return levels

-- The levels, read from their scene files: scenes/levels/1.scene.json, 2, 3 ... (until one is missing) and scenes/levels/primer.scene.json, the
-- tutorial. Each file holds the kitchen as a grid ("kitchen": a 3D tilemap of the kitchen models, painted in the studio's scene editor, see
-- scripts/potion/kitchen-models.mjs) and its settings as the props of a "level" object. Nothing about a level is written in code: change the file
-- and the game follows.
local levels = {}

-- each tile of the grid's palette as the map letter lib/kitchen.lua reads: the order of scripts/potion/kitchen-models.mjs's palette
-- (22 to 24 are the second floor and ice of the checker, and the near wall, low)
local CELLS = { [0] = ".", "#", "@", "T", "a", "b", "c", "d", "B", "M", "C", "S", "X", "W", "i", "m", "L", "v", ">", "<", "^", "w", ".", "#", "i" }

local function read(name)
  local data = nova.scene_data("levels." .. name)
  if not data then return nil end
  local level, kitchen
  for _, o in ipairs(data.objects or {}) do
    if o.kind == "level" then level = o.props end
  end
  for _, g in ipairs(data.grids or {}) do
    if g.name == "kitchen" then kitchen = g end
  end
  local file = "scenes/levels/" .. name .. ".scene.json"
  assert(level, file .. ": no \"level\" object (its props are the level's settings)")
  assert(kitchen, file .. ": no grid called \"kitchen\"")
  level.map = {}
  for r, row in ipairs(kitchen.tiles) do
    local line = {}
    for c, v in ipairs(row) do
      local ch = (v < 0) and " " or CELLS[v]
      assert(ch, file .. ": tile " .. v .. " at row " .. r .. ", column " .. c .. " is not a kitchen cell")
      line[c] = ch
    end
    level.map[r] = table.concat(line)
  end
  level.grid = kitchen -- (lib/view.lua draws its models)
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

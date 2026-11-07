-- The levels, read from their scene files: scenes/levels/1.scene.json, 2, 3 ... (until one is missing) and scenes/levels/primer.scene.json, the
-- tutorial. Each file holds the kitchen as a tilemap ("kitchen", painted in the studio's scene editor with sprites/kitchen/tiles.png) and its settings
-- as the props of a "level" object. Nothing about a level is written in code: change the file and the game follows.
local levels = {}

-- the tileset's cells, in its order, as the map letters lib/kitchen.lua reads (see the legend in scenes/levels and lib/kitchen.lua)
local CELLS = { [0] = ".", "#", "@", "T", "a", "b", "c", "d", "B", "M", "C", "S", "X", "W", "i", "m", "L", "v", ">", "<", "^", "w" }

local function read(name)
  local data = nova.scene_data("levels." .. name)
  if not data then return nil end
  local level, kitchen
  for _, o in ipairs(data.objects or {}) do
    if o.kind == "level" then level = o.props end
  end
  for _, t in ipairs(data.tilemaps or {}) do
    if t.name == "kitchen" then kitchen = t end
  end
  assert(level, "scenes/levels/" .. name .. ".scene.json: no \"level\" object (its props are the level's settings)")
  assert(kitchen, "scenes/levels/" .. name .. ".scene.json: no tilemap called \"kitchen\"")
  level.map = {}
  for r, row in ipairs(kitchen.tiles) do
    local line = {}
    for c, v in ipairs(row) do
      local ch = (v < 0) and " " or CELLS[v]
      assert(ch, "scenes/levels/" .. name .. ".scene.json: tile " .. v .. " at row " .. r .. ", column " .. c .. " is not a kitchen cell")
      line[c] = ch
    end
    level.map[r] = table.concat(line)
  end
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

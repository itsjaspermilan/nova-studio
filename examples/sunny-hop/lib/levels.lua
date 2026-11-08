-- The worlds and levels, read from scene files. The map (scenes/map.scene.json) has a "region" object for each world (its props: id, name, music,
-- sky...) in the order they stand on the map; a world's levels are scenes/levels/<world>-0.scene.json, -1, -2 ... until one is missing (-0, when
-- there is one, is a short first level). Each level's settings are the props of its "level" object. Nothing about a level is written in code.
local levels = {}

local list, by_id, worlds

local function level_props(scene)
  local data = nova.scene_data(scene)
  if not data then return nil end
  for _, o in ipairs(data.objects or {}) do
    if o.kind == "level" then return o.props or {} end
  end
  error("scenes/" .. scene:gsub("%.", "/") .. ".scene.json: no \"level\" object (its props are the level's settings)")
end

function levels.load()
  if list then return list end
  list, by_id, worlds = {}, {}, {}
  local map = nova.scene_data("map")
  assert(map, "scenes/map.scene.json is missing")
  local regions = {}
  for _, o in ipairs(map.objects or {}) do
    if o.kind == "region" then regions[#regions + 1] = o end
  end
  table.sort(regions, function(a, b) return a.x < b.x end)
  for wi, r in ipairs(regions) do
    local w = { index = wi, levels = {} }
    for k, v in pairs(r.props or {}) do w[k] = v end
    assert(w.id, "scenes/map.scene.json: a region has no \"id\" prop")
    worlds[#worlds + 1] = w
    for n = 0, 20 do
      local scene = "levels." .. w.id .. "-" .. n
      local props = level_props(scene)
      if props then
        local lv = { id = w.id .. "-" .. n, scene = scene, world = w, n = n, props = props, index = #list + 1 }
        lv.name = props.name or lv.id
        lv.label = n == 0 and "Go!" or (wi .. "-" .. n)
        lv.target = props.target
        list[#list + 1] = lv
        w.levels[#w.levels + 1] = lv
        by_id[lv.id] = lv
      elseif n > 0 then
        break
      end
    end
  end
  return list
end

function levels.get(id) levels.load(); return by_id[id] end
function levels.worlds() levels.load(); return worlds end
function levels.all() return levels.load() end
function levels.next(lv)
  levels.load()
  return list[lv.index + 1]
end

return levels

-- Every kind of block and item. Items are blocks that are never placed in the world: the voxel registry gives each a
-- number and a picture, which is all a dropped item or an inventory icon needs.
local tiles = require("lib.tiles")

nova.voxel.atlas("textures/blocks.png", 16)

local B = {} -- name -> number
local P = {} -- number -> properties
local list = {}

local function def(name, opts, props)
  local id = nova.voxel.block(name, opts)
  B[name] = id
  props = props or {}
  props.name = props.name or name:gsub("_", " ")
  P[id] = props
  list[#list + 1] = id
  return id
end

local function all(tile) return { tile = tiles[tile] } end
local function faces(top, side, bottom) return { top = tiles[top], side = tiles[side], bottom = tiles[bottom or side] } end

-- hard: seconds by hand times a fifth; tool: which tool is quick; level: pick strength needed (0 none, 1 wood, 2 stone, 3 iron, 4 diamond)
-- drop: another block (or false for nothing); sound: material for dig/step sounds
def("stone", all("stone"), { hard = 1.5, tool = "pickaxe", level = 1, drop = "cobblestone", sound = "stone" })
def("grass", faces("grass_top", "grass_side", "dirt"), { hard = 0.6, tool = "shovel", drop = "dirt", sound = "grass" })
def("dirt", all("dirt"), { hard = 0.5, tool = "shovel", sound = "grass" })
def("cobblestone", all("cobblestone"), { hard = 2, tool = "pickaxe", level = 1, sound = "stone" })
def("planks", all("planks"), { hard = 2, tool = "axe", sound = "wood" })
def("sapling", { tile = tiles.sapling, shape = "cross" }, { hard = 0, sound = "grass" })
def("bedrock", all("bedrock"), { hard = -1, sound = "stone" })
def("water", { tile = tiles.water, liquid = true, alpha = 175, dim = 2 }, { hard = -1, sound = "water" })
def("lava", { tile = tiles.lava, liquid = true, glow = 15, dim = 0, alpha = 255, cull_same = true }, { hard = -1, sound = "stone" })
def("sand", all("sand"), { hard = 0.5, tool = "shovel", sound = "sand" })
def("gravel", all("gravel"), { hard = 0.6, tool = "shovel", sound = "gravel" })
def("gold_ore", all("gold_ore"), { hard = 3, tool = "pickaxe", level = 3, sound = "stone" })
def("iron_ore", all("iron_ore"), { hard = 3, tool = "pickaxe", level = 2, sound = "stone" })
def("coal_ore", all("coal_ore"), { hard = 3, tool = "pickaxe", level = 1, drop = "coal", sound = "stone" })
def("diamond_ore", all("diamond_ore"), { hard = 3, tool = "pickaxe", level = 3, drop = "diamond", sound = "stone" })
def("log", faces("log_top", "log_side", "log_top"), { hard = 2, tool = "axe", sound = "wood" })
def("birch_log", faces("birch_top", "birch_side", "birch_top"), { hard = 2, tool = "axe", drop = "log", sound = "wood" })
def("leaves", { tile = tiles.leaves, opaque = false, dim = 1, cull_same = true }, { hard = 0.2, drop = "sapling", chance = 0.05, sound = "grass" })
def("birch_leaves", { tile = tiles.birch_leaves, opaque = false, dim = 1, cull_same = true }, { hard = 0.2, drop = "sapling", chance = 0.05, sound = "grass" })
def("glass", { tile = tiles.glass, opaque = false, cull_same = true }, { hard = 0.3, drop = false, sound = "glass" })
def("crafting_table", { top = tiles.crafting_top, side = tiles.crafting_side, bottom = tiles.planks }, { hard = 2.5, tool = "axe", sound = "wood" })
def("furnace", { top = tiles.furnace_top, side = tiles.furnace_side, bottom = tiles.furnace_top, tiles = { tiles.furnace_side, tiles.furnace_side, tiles.furnace_top, tiles.furnace_top, tiles.furnace_front, tiles.furnace_side } }, { hard = 3.5, tool = "pickaxe", level = 1, drop = "furnace", sound = "stone" })
def("torch", { tile = tiles.torch, shape = "torch", glow = 14 }, { hard = 0, sound = "wood" })
def("tall_grass", { tile = tiles.tall_grass, shape = "cross" }, { hard = 0, drop = false, sound = "grass" })
def("dandelion", { tile = tiles.dandelion, shape = "cross" }, { hard = 0, sound = "grass" })
def("rose", { tile = tiles.rose, shape = "cross" }, { hard = 0, sound = "grass" })
def("cactus", faces("cactus_top", "cactus_side", "cactus_top"), { hard = 0.4, sound = "grass" })
def("snow", all("snow"), { hard = 0.2, tool = "shovel", sound = "grass" })
def("snowy_grass", faces("snow", "snow_side", "dirt"), { hard = 0.6, tool = "shovel", drop = "dirt", sound = "grass" })
def("ice", { tile = tiles.ice, alpha = 200, opaque = false, cull_same = true }, { hard = 0.5, tool = "pickaxe", drop = false, sound = "glass" })
def("sandstone", faces("sandstone_top", "sandstone_side", "sandstone_top"), { hard = 0.8, tool = "pickaxe", level = 1, sound = "stone" })
def("brick", all("brick"), { hard = 2, tool = "pickaxe", level = 1, sound = "stone" })
def("clay", all("clay"), { hard = 0.6, tool = "shovel", sound = "gravel" })

-- items (never in the world; the picture is the same on every face)
local function item(name, props)
  props = props or {}
  props.item = true
  def(name, { tile = tiles[name], solid = false, opaque = false }, props)
end
item("stick"); item("coal", { fuel = 8 }); item("iron_ingot"); item("gold_ingot"); item("diamond"); item("gunpowder")
item("apple", { food = 4 }); item("pork", { food = 3 }); item("pork_cooked", { food = 8 })

local MATERIALS = { wood = { speed = 2, level = 1, uses = 60 }, stone = { speed = 4, level = 2, uses = 132 }, iron = { speed = 6, level = 3, uses = 251 }, diamond = { speed = 8, level = 4, uses = 1562 } }
local TOOLS = { "pickaxe", "axe", "shovel", "sword" }
for material, m in pairs(MATERIALS) do
  for _, kind in ipairs(TOOLS) do
    local name = material .. "_" .. kind
    def(name, { tile = tiles[name], solid = false, opaque = false },
      { item = true, tool_kind = kind, speed = m.speed, level = m.level, uses = m.uses, damage = kind == "sword" and (2 + m.level) or (kind == "axe" and 2 + m.level * 0.5 or 1 + m.level * 0.5) })
  end
end

-- overlays drawn over the block being mined, and its outline
for i = 0, 9 do def("crack_" .. i, { tile = tiles["crack_" .. i], solid = false, opaque = false }, { item = true }) end
def("outline", { tile = tiles.outline, solid = false, opaque = false }, { item = true })

-- what a block gives when broken
for _, id in ipairs(list) do
  local p = P[id]
  if p.drop == nil then p.drop = id end
  if type(p.drop) == "string" then p.drop = B[p.drop] end
end

-- a stack's picture: the side of a block, or the item's own
local function icon(id)
  local info = nova.voxel.info(id)
  return P[id].item and info.tile or info.side_tile, info
end

return { B = B, P = P, MATERIALS = MATERIALS, icon = icon, tiles = tiles }

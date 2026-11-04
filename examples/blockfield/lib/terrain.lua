-- The land, as a recipe the engine follows (nova.voxel.terrain): hills and rivers from noise, four biomes, caves, ores and
-- trees. The engine makes the chunks, on worker threads where the device has cores to spare; this file only says what the
-- land is like. Change a number and the world changes; the same seed always gives the same world.
local blocks = require("lib.blocks")

local T = { SEA = 40, seed = 20161 }

function T.configure(seed)
  T.seed = seed or T.seed
  local stoneish = { "stone", "dirt", "gravel", "grass", "sand", "sandstone", "clay" }
  nova.voxel.terrain {
    seed = T.seed,
    sea_level = T.SEA,
    base = 47,
    layers = {
      { scale = 0.004, octaves = 3, amplitude = 24, seed = 0 }, -- continents
      { scale = 0.02, octaves = 4, amplitude = 9, seed = 1 },   -- hills
    },
    rivers = { scale = 0.007, octaves = 2, width = 0.04, depth = 2, seed = 2 },
    temperature = { scale = 0.0025, octaves = 2, seed = 3 },
    wetness = { scale = 0.0025, octaves = 2, seed = 4 },
    biomes = {
      { name = "desert", temperature = { min = 0.22 }, wetness = { max = 0.12 }, top = "sand", under = "sandstone",
        cactus = { block = "cactus", chance = 0.012, height = 3 } },
      { name = "snowy", temperature = { max = -0.28 }, top = "snowy_grass", under = "dirt", ice = true,
        trees = { { kind = "oak", count = 2 } } },
      { name = "forest", wetness = { min = 0.14 }, top = "grass", under = "dirt",
        trees = { { kind = "oak", count = 5 }, { kind = "birch", count = 2 } },
        plants = { { block = "tall_grass", chance = 0.12 }, { block = "dandelion", chance = 0.005 }, { block = "rose", chance = 0.005 } } },
      { name = "plains", top = "grass", under = "dirt",
        trees = { { kind = "oak", count = 1 } },
        plants = { { block = "tall_grass", chance = 0.12 }, { block = "dandelion", chance = 0.005 }, { block = "rose", chance = 0.005 } } },
    },
    beach = { top = "sand", under = "sand", depth = 1 },
    seabed = { top = "gravel", under = "gravel", depth = 3 },
    ice = "ice",
    caves = {
      { kind = "tunnel", ymin = 5, ymax = 62, scale = 0.05, squash = 1.4, threshold = 0.075, seed = 40, through = stoneish },
      { kind = "cavern", ymin = 5, ymax = 28, scale = 0.035, squash = 1.5, threshold = 0.38, seed = 41, through = stoneish },
    },
    ores = {
      { block = "coal_ore", tries = 14, ymin = 6, ymax = 70, size = 8 },
      { block = "iron_ore", tries = 9, ymin = 6, ymax = 52, size = 5 },
      { block = "gold_ore", tries = 2, ymin = 6, ymax = 26, size = 5 },
      { block = "diamond_ore", tries = 2, ymin = 5, ymax = 16, size = 4 },
      { block = "gravel", tries = 3, ymin = 10, ymax = 60, size = 10 },
      { block = "clay", tries = 1, ymin = T.SEA - 6, ymax = T.SEA, size = 8 },
    },
    lava = { block = "lava", tries = 2, ymin = 6, ymax = 11 },
    trees = {
      oak = { log = "log", leaves = "leaves", trunk_min = 4, trunk_max = 6 },
      birch = { log = "birch_log", leaves = "birch_leaves", trunk_min = 5, trunk_max = 7 },
    },
  }
end

function T.height(x, z) return nova.voxel.terrain_height(x, z) end
function T.biome(x, z) return nova.voxel.terrain_biome(x, z) end

return T

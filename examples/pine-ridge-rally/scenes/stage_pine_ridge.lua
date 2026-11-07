-- The rally stage in the country of pine_ridge: point to point, in sections (see lib/race.lua). The layout is in stage_pine_ridge.scene.json.
local look = require("lib.looks").pine_ridge
return require("lib.race").define {
  stage = true,
  horizon = look.horizon,
  surface = "dirt", -- gravel
  grip = 0.88,
  loose = true,
  dust = { 150, 138, 120 },
  sky = look.sky,
  music = "race_forest",
  sun = look.sun,
  terrain = look.terrain,
}

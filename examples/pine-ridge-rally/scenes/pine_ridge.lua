-- Pine Ridge: fast asphalt through the forest. The road, trees, barriers and the start grid are in pine_ridge.scene.json.
local look = require("lib.looks").pine_ridge
return require("lib.race").define {
  horizon = look.horizon,
  surface = "road",
  grip = 1.0,
  dust = { 170, 160, 130 },
  sky = look.sky,
  music = "race_forest",
  sun = look.sun,
  terrain = look.terrain,
}

-- Dust Valley: loose dirt between the mesas. The layout is in dust_valley.scene.json.
local look = require("lib.looks").dust_valley
return require("lib.race").define {
  horizon = look.horizon,
  surface = "dirt",
  grip = 0.9,
  dust = { 214, 178, 124 },
  sky = look.sky,
  music = "race_desert",
  sun = look.sun,
  terrain = look.terrain,
}

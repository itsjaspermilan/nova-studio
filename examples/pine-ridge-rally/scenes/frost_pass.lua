-- Frost Pass: packed snow, little grip. The layout is in frost_pass.scene.json.
local look = require("lib.looks").frost_pass
return require("lib.race").define {
  horizon = look.horizon,
  surface = "dirt",
  grip = 0.72,
  dust = { 235, 240, 248 },
  sky = look.sky,
  music = "race_snow",
  sun = look.sun,
  terrain = look.terrain,
}

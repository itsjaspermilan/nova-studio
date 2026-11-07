-- The rally stage in the country of frost_pass: point to point, in sections (see lib/race.lua). The layout is in stage_frost_pass.scene.json.
local look = require("lib.looks").frost_pass
return require("lib.race").define {
  stage = true,
  horizon = look.horizon,
  surface = "dirt",
  grip = 0.72,
  dust = { 235, 240, 248 },
  sky = look.sky,
  music = "race_snow",
  sun = look.sun,
  terrain = look.terrain,
}

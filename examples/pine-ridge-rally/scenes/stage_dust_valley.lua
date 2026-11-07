-- The rally stage in the country of dust_valley: point to point, in sections (see lib/race.lua). The layout is in stage_dust_valley.scene.json.
local look = require("lib.looks").dust_valley
return require("lib.race").define {
  stage = true,
  horizon = look.horizon,
  surface = "dirt",
  grip = 0.9,
  dust = { 214, 178, 124 },
  sky = look.sky,
  music = "race_desert",
  sun = look.sun,
  terrain = look.terrain,
}

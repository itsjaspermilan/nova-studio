-- The rally stage in the country of harbour_lights: point to point, in sections (see lib/race.lua). The layout is in stage_harbour_lights.scene.json.
local look = require("lib.looks").harbour_lights
return require("lib.race").define {
  stage = true,
  horizon = look.horizon,
  surface = "road",
  grip = 0.95,
  dust = { 90, 100, 120 },
  sky = look.sky,
  music = "race_night",
  night = true,
  sun = look.sun,
  terrain = look.terrain,
}

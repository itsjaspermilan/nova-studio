-- The rally stage in the country of frost_pass: point to point, in sections (see lib/race.lua). The layout is in stage_frost_pass.scene.json.
local look = require("lib.looks").frost_pass
return require("lib.race").define {
  stage = true,
  horizon = look.horizon,
  surface = "dirt",
  grip = 0.72,
  loose = true, -- snow
  dust = { 235, 240, 248 },
  sky = look.sky,
  music = "race_snow",
  sun = look.sun,
  -- designed ground: a heightmap made by the terrain_write tool from this stage's route (the road climbs, crests, drops), see terrain/frost_pass.png
  terrain = { heightmap = "terrain/frost_pass.png", x = -154.44, z = -290, size = 824, height = 29.937 },
  weather = { kind = "snow", count = 360, fall = 2.6, drift = 1.6 },
}

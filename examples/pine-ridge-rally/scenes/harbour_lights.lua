-- Harbour Lights: asphalt after dark. The layout is in harbour_lights.scene.json; the only light is the moon,
-- the street lamps and the cars' own headlights (see `night` in lib/race.lua).
local look = require("lib.looks").harbour_lights
return require("lib.race").define {
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

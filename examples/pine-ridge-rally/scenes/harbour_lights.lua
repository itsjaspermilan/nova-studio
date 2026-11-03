-- Harbour Lights: asphalt after dark. The layout is in harbour_lights.scene.json; the only light is the moon,
-- the street lamps and the cars' own headlights (see `night` in lib/race.lua).
return require("lib.race").define {
  horizon = "night",
  surface = "road",
  grip = 0.95,
  dust = { 90, 100, 120 },
  sky = { top = { 6, 10, 26 }, horizon = { 26, 34, 62 } },
  music = "race_night",
  night = true,
  sun = { dir = { 0.35, -0.8, -0.45 }, color = { 70, 90, 140 }, ambient = { 26, 32, 52 } },
}

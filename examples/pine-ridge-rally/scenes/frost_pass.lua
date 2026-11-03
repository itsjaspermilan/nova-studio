-- Frost Pass: packed snow, little grip. The layout is in frost_pass.scene.json.
return require("lib.race").define {
  horizon = "snow",
  surface = "dirt",
  grip = 0.72,
  dust = { 235, 240, 248 },
  sky = { top = { 150, 175, 205 }, horizon = { 222, 232, 242 } },
  music = "race_snow",
  sun = { dir = { -0.3, -0.9, -0.4 }, color = { 215, 225, 240 }, ambient = { 100, 110, 132 } },
}

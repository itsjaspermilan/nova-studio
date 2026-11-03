-- Dust Valley: loose dirt between the mesas. The layout is in dust_valley.scene.json.
return require("lib.race").define {
  horizon = "desert",
  surface = "dirt",
  grip = 0.9,
  dust = { 214, 178, 124 },
  music = "race_desert",
  sun = { dir = { -0.35, -0.8, -0.5 }, color = { 232, 206, 170 }, ambient = { 96, 86, 84 } },
}

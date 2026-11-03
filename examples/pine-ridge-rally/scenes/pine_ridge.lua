-- Pine Ridge: fast asphalt through the forest. The road, trees, barriers and the start grid are in pine_ridge.scene.json.
return require("lib.race").define {
  horizon = "forest",
  surface = "road",
  grip = 1.0,
  dust = { 170, 160, 130 },
  sky = { top = { 92, 148, 224 }, horizon = { 196, 220, 238 } },
  music = "race_forest",
  sun = { dir = { -0.5, -1, -0.35 }, color = { 230, 220, 196 }, ambient = { 78, 88, 112 } },
}

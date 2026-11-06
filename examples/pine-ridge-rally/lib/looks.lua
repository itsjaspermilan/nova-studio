-- How each circuit looks: the sky, the sun, the ground and mountains (horizon), the road and what stands beside it. The circuit
-- scenes use it for the race and the menus use it for the backdrop, so the title screen changes with the circuit that is chosen.
local looks = {}

looks.pine_ridge = {
  horizon = "forest",
  road = "road_asphalt",
  sky = { top = { 92, 148, 224 }, horizon = { 196, 220, 238 } },
  sun = { dir = { -0.5, -1, -0.35 }, color = { 230, 220, 196 }, ambient = { 78, 88, 112 } },
  trees = { "pine", "pine", "pine_dark", "birch", "autumn_tree" },
  low = { "bush", "bush", "rock" },
}

looks.dust_valley = {
  horizon = "desert",
  road = "road_dirt",
  sky = { top = { 120, 160, 215 }, horizon = { 240, 205, 160 } },
  sun = { dir = { -0.35, -0.8, -0.5 }, color = { 232, 206, 170 }, ambient = { 96, 86, 84 } },
  trees = { "cactus", "cactus", "dry_bush" },
  low = { "rock_red", "dry_bush", "rock" },
  tall = { "mesa" },
}

looks.frost_pass = {
  horizon = "snow",
  road = "road_snow",
  sky = { top = { 150, 175, 205 }, horizon = { 222, 232, 242 } },
  sun = { dir = { -0.3, -0.9, -0.4 }, color = { 215, 225, 240 }, ambient = { 100, 110, 132 } },
  trees = { "pine_snow", "pine_snow", "pine_snow", "pine" },
  low = { "bush_snow", "rock_ice" },
}

looks.harbour_lights = {
  horizon = "night",
  road = "road_asphalt",
  night = true,
  sky = { top = { 6, 10, 26 }, horizon = { 26, 34, 62 } },
  sun = { dir = { 0.35, -0.8, -0.45 }, color = { 70, 90, 140 }, ambient = { 26, 32, 52 } },
  trees = { "pine_dark", "pine_dark" },
  low = { "rock", "bush" },
}

return looks

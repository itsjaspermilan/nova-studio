-- How each circuit looks: the sky, the sun, the ground and mountains (horizon), the road and what stands beside it. The circuit
-- scenes use it for the race and the menus use it for the backdrop, so the title screen changes with the circuit that is chosen.
local sky = require("lib.sky")
local looks = {}

looks.pine_ridge = {
  -- the hills (nova.terrain; heights in metres; the steepest road grade is about 10%)
  terrain = { waves = {
    { wavelength = 380, direction = 20, height = 5, phase = 0.4 },
    { wavelength = 240, direction = 110, height = 2.2, phase = 2.1 },
  } },
  horizon = "forest",
  road = "road_asphalt",
  sun_to = { 0.55, 0.62, 0.38 }, -- mid-morning
  clouds = 0.4,
  trees = { "nk_pinetall_a", "nk_pineround_a", "nk_oak", "nk_pinetall_c", "nk_default", "nk_pinesmall_a", "nk_oak_fall", "nk_pineround_e", "pine" },
  low = { "nk_bush_large", "nk_rock_largeC", "nk_stump", "bush" },
  wind = { direction = 30, strength = 1.0 },
  look = { ao = 0.45, ao_radius = 1.0, bloom = 0.3, bloom_threshold = 0.78, saturation = 1.08 },
  foliage = { { "grass", 7000, 0.55, { 255, 255, 255 }, { 232, 255, 220 }, { 255, 246, 205 } }, { "flowers", 700, 0.4 } },
}

looks.dust_valley = {
  -- the hills (nova.terrain; heights in metres; the steepest road grade is about 10%)
  terrain = { waves = {
    { wavelength = 450, direction = 70, height = 6.5, phase = 1 },
    { wavelength = 280, direction = 160, height = 2.5, phase = 0.2 },
  } },
  horizon = "desert",
  road = "road_dirt",
  sun_to = { 0.78, 0.2, 0.5 }, -- the golden hour: a low sun
  tint = { top = { 1.0, 0.96, 0.9 }, horizon = { 1.0, 0.95, 0.88 } },
  clouds = 0.3,
  trees = { "nk_cactus_tall", "nk_cactus_short", "nk_dead_thin", "cactus", "nk_dead_tall" },
  low = { "nk_rockred_largeC", "dry_bush", "nk_rockred_largeA" },
  tall = { "mesa" },
  wind = { direction = 100, strength = 1.5 },
  look = { ao = 0.4, ao_radius = 1.0, bloom = 0.4, bloom_threshold = 0.74, saturation = 1.06 },
  foliage = { { "grass", 3500, 0.5, { 255, 226, 150 }, { 240, 205, 140 }, { 255, 240, 190 } } },
}

looks.frost_pass = {
  -- the hills (nova.terrain; heights in metres; the steepest road grade is about 10%)
  terrain = { waves = {
    { wavelength = 500, direction = 0, height = 8, phase = 0.7 },
    { wavelength = 320, direction = 90, height = 2.5, phase = 2.5 },
  } },
  horizon = "snow",
  road = "road_snow",
  sun_to = { -0.7, 0.28, -0.55 }, -- early morning, the sun low behind the pass
  tint = { top = { 0.96, 1.0, 1.06 }, horizon = { 0.96, 0.99, 1.04 } },
  clouds = 0.6,
  trees = { "nk_snow_pinetall_a", "nk_snow_pineround_a", "pine_snow", "nk_snow_pinetall_c", "nk_snow_pinesmall_a", "nk_snow_pineround_e" },
  low = { "bush_snow", "nk_rockice_largeC", "nk_rockice_largeA" },
  wind = { direction = 200, strength = 0.8 },
  look = { ao = 0.35, ao_radius = 1.0, bloom = 0.35, bloom_threshold = 0.8, saturation = 1.0 },
  foliage = { { "grass", 1800, 0.4, { 235, 245, 240 }, { 220, 235, 225 } } },
}

looks.harbour_lights = {
  -- the hills (nova.terrain; heights in metres; the steepest road grade is about 10%)
  terrain = { waves = {
    { wavelength = 420, direction = 30, height = 3, phase = 0.1 },
    { wavelength = 240, direction = 120, height = 1.2, phase = 2 },
  } },
  horizon = "night",
  road = "road_asphalt",
  night = true,
  sun_to = { 0.3, -0.45, -0.5 }, -- night: the sun is under the horizon, and the moon opposite it lights the scene:
  sun = { dir = { 0.35, -0.8, -0.45 }, color = { 70, 90, 140 }, ambient = { 26, 32, 52 } },
  clouds = 0.2,
  trees = { "nk_night_pinetall_a", "nk_night_pineround_a", "pine_dark", "nk_night_pinesmall_a", "nk_night_pinetall_c" },
  low = { "nk_rock_largeC", "bush" },
  wind = { direction = 60, strength = 0.7 },
  look = { ao = 0.4, ao_radius = 1.0, bloom = 0.7, bloom_threshold = 0.6, saturation = 1.0, vignette = 0.2 },
  foliage = { { "grass", 4000, 0.5, { 110, 140, 130 }, { 100, 125, 120 } } },
}

for _, look in pairs(looks) do sky.make(look) end

return looks

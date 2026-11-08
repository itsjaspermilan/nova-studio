-- The times to beat. For each rally stage and each class of car, the time in seconds of each section of a run driven by the computer (made by
-- the test `rally_pars` in crates/nova-runtime/tests/rally.rs, which has the first car of each class driven through each stage). A section's
-- score is 1000 for a time well under its par and falls to nothing as it gets slow (see lib/race.lua; the difficulty allows more or less time
-- than the par). `pars.laps`: each circuit's par lap for each class, the best lap of a time trial driven by the computer (the test
-- `lap_pars`), shown on the circuit cards. Run the tests again after changing a course, a car's stats or the hills.
local pars = {
  stage_pine_ridge = {
    formula = { 23.450, 22.733, 32.967, 25.850, 26.733 },
    sport = { 26.050, 24.700, 35.183, 29.100, 30.267 },
    everyday = { 27.267, 25.950, 35.567, 29.667, 31.417 },
    kart = { 25.183, 23.467, 33.533, 26.283, 27.917 },
    fun = { 28.117, 27.050, 35.617, 30.467, 32.133 },
  },
  stage_dust_valley = {
    formula = { 21.883, 20.117, 28.967, 30.150, 18.567 },
    sport = { 25.067, 22.567, 32.700, 32.633, 21.117 },
    everyday = { 26.267, 23.767, 34.117, 33.400, 22.167 },
    kart = { 25.017, 20.400, 29.717, 30.800, 19.050 },
    fun = { 27.050, 24.817, 34.650, 34.150, 22.967 },
  },
  stage_frost_pass = {
    formula = { 18.150, 17.883, 25.817, 18.050, 25.650 },
    sport = { 20.650, 20.083, 29.250, 20.667, 27.500 },
    everyday = { 21.700, 21.083, 30.333, 21.683, 28.300 },
    kart = { 18.800, 17.350, 25.600, 17.833, 25.250 },
    fun = { 22.467, 22.067, 30.800, 22.450, 28.550 },
  },
  stage_harbour_lights = {
    formula = { 13.917, 13.233, 20.700, 11.983, 17.900 },
    sport = { 15.817, 14.150, 23.750, 13.933, 19.900 },
    everyday = { 16.550, 14.417, 25.150, 13.700, 19.500 },
    kart = { 16.417, 16.617, 22.617, 14.867, 19.900 },
    fun = { 16.800, 15.150, 25.917, 13.950, 19.383 },
  },
  stage_autumn_glen = {
    formula = { 20.883, 22.817, 19.750, 17.517, 16.617, 19.733 },
    sport = { 23.667, 25.183, 23.117, 18.867, 18.717, 21.317 },
    everyday = { 24.867, 26.283, 24.250, 20.167, 19.950, 22.383 },
    kart = { 22.800, 22.833, 22.567, 19.667, 19.133, 21.517 },
    fun = { 25.583, 27.317, 24.700, 18.750, 19.150, 22.833 },
  },
  stage_mesa_run = {
    formula = { 19.267, 18.817, 25.983, 23.367, 18.167, 19.817 },
    sport = { 22.317, 20.983, 28.967, 26.433, 20.483, 22.400 },
    everyday = { 23.383, 21.983, 30.517, 27.667, 21.450, 23.483 },
    kart = { 20.950, 20.017, 26.233, 24.433, 18.983, 21.017 },
    fun = { 24.033, 22.833, 31.417, 28.483, 22.267, 24.283 },
  },
  stage_canyon = {
    formula = { 20.783, 21.383, 19.567, 20.100, 22.617, 21.000, 17.083 },
    sport = { 23.317, 23.683, 21.633, 22.450, 25.483, 22.683, 19.650 },
    everyday = { 24.317, 24.800, 22.700, 23.100, 26.400, 23.350, 20.383 },
    kart = { 21.200, 20.867, 19.050, 20.417, 22.083, 20.750, 17.317 },
    fun = { 24.717, 25.667, 23.683, 24.000, 26.967, 23.583, 20.300 },
  },
  stage_glacier_night = {
    formula = { 16.417, 22.950, 16.450, 22.650, 17.383, 21.133, 15.067 },
    sport = { 18.900, 25.650, 18.450, 24.850, 19.533, 23.783, 17.200 },
    everyday = { 19.817, 26.883, 19.417, 25.417, 20.550, 24.917, 18.017 },
    kart = { 17.617, 22.233, 15.983, 22.100, 17.167, 20.950, 15.600 },
    fun = { 20.300, 27.683, 20.150, 25.883, 21.300, 25.900, 18.600 },
  },
  stage_harbour_sprint = {
    formula = { 18.833, 18.067, 17.850, 16.850, 17.600, 19.067, 15.433 },
    sport = { 22.900, 21.717, 20.800, 20.067, 20.250, 21.567, 18.000 },
    everyday = { 23.967, 22.800, 21.833, 22.117, 21.150, 22.050, 19.000 },
    kart = { 20.300, 18.783, 19.367, 18.083, 18.100, 19.183, 16.750 },
    fun = { 24.000, 22.917, 22.333, 22.767, 21.167, 22.733, 19.600 },
  },
  stage_marathon = {
    formula = { 21.150, 26.283, 23.100, 22.000, 25.533, 24.750, 26.317, 25.433 },
    sport = { 24.367, 28.800, 25.683, 24.883, 28.517, 27.917, 29.917, 27.967 },
    everyday = { 25.517, 30.167, 26.950, 26.183, 29.683, 28.667, 30.600, 29.217 },
    kart = { 22.850, 26.017, 25.000, 23.717, 26.950, 24.833, 27.517, 26.267 },
    fun = { 26.133, 31.350, 27.983, 26.883, 30.833, 29.733, 31.367, 30.200 },
  },
}
pars.laps = {
  pine_ridge = { formula = 86.62, sport = 99.15, everyday = 102.33, kart = 100.47, fun = 102.75 },
  dust_valley = { formula = 77.18, sport = 86.92, everyday = 90.35, kart = 80.87, fun = 92.92 },
  frost_pass = { formula = 84.87, sport = 94.95, everyday = 98.87, kart = 85.25, fun = 102.18 },
  harbour_lights = { formula = 67.22, sport = 78.42, everyday = 80.87, kart = 74.98, fun = 79.28 },
  autumn_glen = { formula = 79.85, sport = 91.53, everyday = 93.88, kart = 91.72, fun = 95.38 },
  ridge_gp = { formula = 66.32, sport = 77.40, everyday = 80.92, kart = 77.78, fun = 80.77 },
  copper_canyon = { formula = 112.75, sport = 127.77, everyday = 130.67, kart = 116.28, fun = 133.70 },
  glacier_ring = { formula = 110.93, sport = 126.45, everyday = 132.08, kart = 127.07, fun = 135.35 },
  neon_docks = { formula = 92.60, sport = 109.33, everyday = 114.07, kart = 98.05, fun = 114.63 },
  autumn_summit = { formula = 124.48, sport = 146.68, everyday = 150.78, kart = 145.28, fun = 153.97 },
}
return pars

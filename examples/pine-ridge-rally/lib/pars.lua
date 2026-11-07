-- The times to beat in a rally: for each stage and each class of car, the time in seconds of each section of a run driven by the computer
-- (made by the test `rally_pars` in crates/nova-runtime/tests/rally.rs, which has it drive a car of each class through each stage). A
-- section's score is 1000 for a time well under its par and falls to nothing as it gets slow (see lib/race.lua; the difficulty allows more
-- or less time than the par). Run the test again after changing a stage, a car's stats or the hills.
local pars = {
  stage_pine_ridge = {
    formula = { 23.383, 22.833, 34.167, 25.167, 26.533 },
    sport = { 26.050, 24.983, 35.467, 28.017, 29.967 },
    everyday = { 27.267, 26.183, 36.033, 29.300, 31.083 },
  },
  stage_dust_valley = {
    formula = { 21.883, 20.167, 28.533, 29.700, 18.983 },
    sport = { 25.067, 22.567, 31.517, 32.300, 21.217 },
    everyday = { 26.267, 23.767, 32.967, 33.450, 22.317 },
  },
  stage_frost_pass = {
    formula = { 18.083, 18.083, 25.867, 18.100, 25.833 },
    sport = { 20.517, 20.250, 28.850, 20.367, 27.967 },
    everyday = { 21.533, 21.233, 29.767, 21.383, 28.617 },
  },
  stage_harbour_lights = {
    formula = { 13.483, 12.533, 28.633, 11.667, 16.983 },
    sport = { 15.950, 13.783, 23.000, 13.200, 18.450 },
    everyday = { 16.600, 14.267, 24.050, 13.383, 19.033 },
  },
}
return pars

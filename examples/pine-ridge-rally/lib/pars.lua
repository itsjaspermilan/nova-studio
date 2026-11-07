-- The times to beat in a rally: for each stage and each class of car, the time in seconds of each section of a run driven by the computer
-- (made by the test `rally_pars` in crates/nova-runtime/tests/rally.rs, which has it drive a car of each class through each stage). A
-- section's score is 1000 for a time well under its par and falls to nothing as it gets slow (see lib/race.lua; the difficulty allows more
-- or less time than the par). Run the test again after changing a stage, a car's stats or the hills.
local pars = {
  stage_pine_ridge = {
    formula = { 20.083, 18.383, 27.267, 20.600, 22.067 },
    sport = { 23.200, 20.750, 29.700, 22.500, 24.883 },
    everyday = { 24.350, 21.483, 30.750, 23.200, 25.850 },
  },
  stage_dust_valley = {
    formula = { 21.483, 19.550, 27.367, 28.700, 18.483 },
    sport = { 24.333, 21.533, 30.483, 31.533, 20.283 },
    everyday = { 25.517, 22.600, 31.600, 32.367, 21.267 },
  },
  stage_frost_pass = {
    formula = { 18.083, 18.083, 25.867, 18.100, 25.833 },
    sport = { 20.517, 20.250, 28.850, 20.367, 27.967 },
    everyday = { 21.533, 21.233, 29.767, 21.383, 28.617 },
  },
  stage_harbour_lights = {
    formula = { 13.483, 12.533, 28.533, 11.667, 17.033 },
    sport = { 15.950, 13.783, 23.683, 13.183, 18.633 },
    everyday = { 16.600, 14.267, 24.467, 13.383, 19.000 },
  },
}
return pars

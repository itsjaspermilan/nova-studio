-- Waves per room. A wave is a delay (seconds after the doors shut, or after the last enemy of the wave before died) and a list
-- of rows: which spawn point (a named object `sp_*` in the room's scene file), which kind, how many. `scrap` is what the room
-- pays when it is cleared. Tuning a fight is editing this file.
return {
  market_a = {
    scrap = 20,
    waves = {
      { delay = 1.0, rows = { { at = "sp_w", kind = "scrapper", count = 2 } } },
      { delay = 0.6, rows = { { at = "sp_n", kind = "rat_drone", count = 1 }, { at = "sp_s", kind = "scrapper", count = 1 } } },
      { delay = 0.6, rows = { { at = "sp_e", kind = "bottle_thrower", count = 1 }, { at = "sp_s", kind = "tout", count = 1 }, { at = "sp_w", kind = "scrapper", count = 2 } } },
    },
  },
  market_b = {
    scrap = 30,
    waves = {
      { delay = 1.0, rows = { { at = "sp_e", kind = "bottle_thrower", count = 1 }, { at = "sp_alley", kind = "mimic_vendor", count = 1 } } },
      { delay = 0.6, rows = { { at = "sp_mid", kind = "rat_drone", count = 2 }, { at = "sp_e", kind = "tout", count = 1 } } },
      { delay = 0.6, rows = { { at = "sp_alley", kind = "scrapper", count = 2 }, { at = "sp_e", kind = "scrapper", count = 1 } } },
    },
  },
}

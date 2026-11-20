-- The wave tables of the Gutter Market, by slot (room number). Each slot has three; the run's seed picks one. Same form as
-- data/waves.lua: a wave is a delay and rows (`at` is a spawn point every layout of the slot has: sp_1 .. sp_4, `kind`, `count`);
-- `scrap` is what the room pays. An `elite = true` row is the room's elite (its kind and mark come from the seed). `bonus`
-- pays extra scrap when the fight is won within `within` seconds of the doors shutting. `guarantee` is the rarity of one card
-- of the offer. Tuning a fight is editing this file.
local function row(at, kind, count, extra)
  local r = { at = at, kind = kind, count = count }
  for k, v in pairs(extra or {}) do r[k] = v end
  return r
end
local function wave(delay, ...) return { delay = delay, rows = { ... } } end

return {
  [1] = {
    { scrap = 15, waves = { wave(1.0, row("sp_1", "scrapper", 2)), wave(0.6, row("sp_2", "scrapper", 2), row("sp_3", "scrapper", 1)) } },
    { scrap = 16, waves = { wave(1.0, row("sp_1", "bottle_thrower", 1), row("sp_2", "scrapper", 1)), wave(0.6, row("sp_3", "scrapper", 2), row("sp_4", "bottle_thrower", 1)) } },
    { scrap = 18, waves = { wave(1.0, row("sp_1", "rat_drone", 1)), wave(0.6, row("sp_2", "rat_drone", 1), row("sp_3", "scrapper", 1)), wave(0.6, row("sp_4", "rat_drone", 2)) } },
  },
  [2] = {
    { scrap = 22, waves = { wave(1.0, row("sp_1", "scrapper", 2), row("sp_2", "bottle_thrower", 1)), wave(0.6, row("sp_3", "rat_drone", 1), row("sp_4", "scrapper", 2)) } },
    { scrap = 24, waves = { wave(1.0, row("sp_1", "mimic_vendor", 1), row("sp_2", "scrapper", 2)), wave(0.6, row("sp_3", "bottle_thrower", 1), row("sp_4", "rat_drone", 1)), wave(0.6, row("sp_1", "scrapper", 2)) } },
    { scrap = 24, waves = { wave(1.0, row("sp_1", "rat_drone", 1), row("sp_2", "tout", 1)), wave(0.6, row("sp_3", "scrapper", 2), row("sp_4", "bottle_thrower", 1)), wave(0.6, row("sp_2", "scrapper", 2)) } },
  },
  [3] = {
    { scrap = 28, waves = { wave(1.0, row("sp_1", "scrapper", 2), row("sp_2", "bottle_thrower", 1)), wave(0.6, row("sp_3", "rat_drone", 2)), wave(0.6, row("sp_4", "scrapper", 2), row("sp_1", "tout", 1)) } },
    { scrap = 30, waves = { wave(1.0, row("sp_1", "bottle_thrower", 2)), wave(0.6, row("sp_2", "scrapper", 3)), wave(0.6, row("sp_3", "mimic_vendor", 1), row("sp_4", "rat_drone", 1)) } },
    { scrap = 30, waves = { wave(1.0, row("sp_1", "rat_drone", 1), row("sp_2", "scrapper", 2)), wave(0.6, row("sp_3", "bottle_thrower", 1), row("sp_4", "bottle_thrower", 1)), wave(0.6, row("sp_1", "scrapper", 2), row("sp_2", "rat_drone", 1)) } },
  },
  [4] = {
    -- the elite and its escort; one table (the elite room's variety is its mark)
    { scrap = 40, guarantee = "uncommon", waves = { wave(1.0, row("sp_1", "elite", 1, { elite = true }), row("sp_2", "scrapper", 2)) } },
  },
  [5] = {
    -- a bigger room: waves from two doors (sp_1 and sp_2 are far apart, one at each end of the room)
    { scrap = 40, waves = { wave(1.0, row("sp_1", "scrapper", 2), row("sp_2", "scrapper", 2)), wave(0.6, row("sp_1", "bottle_thrower", 1), row("sp_2", "rat_drone", 1)), wave(0.6, row("sp_3", "scrapper", 2), row("sp_4", "tout", 1)), wave(0.6, row("sp_1", "rat_drone", 1), row("sp_2", "rat_drone", 1)) } },
    { scrap = 42, waves = { wave(1.0, row("sp_1", "bottle_thrower", 1), row("sp_2", "bottle_thrower", 1)), wave(0.6, row("sp_1", "scrapper", 2), row("sp_2", "scrapper", 2)), wave(0.6, row("sp_3", "mimic_vendor", 1), row("sp_4", "rat_drone", 2)) } },
    { scrap = 44, waves = { wave(1.0, row("sp_1", "rat_drone", 2), row("sp_2", "scrapper", 2)), wave(0.6, row("sp_3", "tout", 1), row("sp_1", "scrapper", 2), row("sp_2", "scrapper", 1)), wave(0.6, row("sp_4", "bottle_thrower", 2), row("sp_1", "rat_drone", 1)) } },
  },
  [7] = {
    -- the gauntlet: the hardest mix, a time bonus
    { scrap = 55, bonus = { within = 80, scrap = 20 }, waves = { wave(1.0, row("sp_1", "scrapper", 2), row("sp_2", "bottle_thrower", 1)), wave(0.5, row("sp_3", "rat_drone", 2), row("sp_4", "tout", 1)), wave(0.5, row("sp_1", "scrapper", 2), row("sp_2", "mimic_vendor", 1)), wave(0.5, row("sp_3", "bottle_thrower", 2), row("sp_4", "rat_drone", 1)) } },
    { scrap = 58, bonus = { within = 85, scrap = 20 }, waves = { wave(1.0, row("sp_1", "rat_drone", 2), row("sp_2", "rat_drone", 1)), wave(0.5, row("sp_3", "scrapper", 3), row("sp_4", "bottle_thrower", 1)), wave(0.5, row("sp_1", "tout", 1), row("sp_2", "scrapper", 2), row("sp_3", "bottle_thrower", 1)), wave(0.5, row("sp_4", "mimic_vendor", 1), row("sp_1", "rat_drone", 2)) } },
    { scrap = 60, bonus = { within = 90, scrap = 25 }, waves = { wave(1.0, row("sp_1", "bottle_thrower", 2), row("sp_2", "scrapper", 2)), wave(0.5, row("sp_3", "rat_drone", 1), row("sp_4", "rat_drone", 1), row("sp_1", "tout", 1)), wave(0.5, row("sp_2", "scrapper", 3), row("sp_3", "mimic_vendor", 1)), wave(0.5, row("sp_4", "bottle_thrower", 1), row("sp_1", "scrapper", 2), row("sp_2", "rat_drone", 1)) } },
  },
}

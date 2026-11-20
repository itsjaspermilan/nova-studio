-- The Gutter Market's run: eight rooms in order, and for each fight slot the THREE layouts (scene files under scenes/gutter/) a run
-- may pick from; the run's seed picks one layout and one wave table (data/gutter_waves.lua) for each. The walk-through room (shop and
-- bank) sits after the boss door for now. Names are scene names (`gutter.s1_square` is scenes/gutter/s1_square.scene.json).
return {
  slots = {
    { kind = "fight", hazard = false, layouts = { "gutter.s1_square", "gutter.s1_street", "gutter.s1_cross" } },
    { kind = "fight", hazard = false, layouts = { "gutter.s2_maze", "gutter.s2_stalls", "gutter.s2_ring" } },
    { kind = "fight", hazard = true, layouts = { "gutter.s3_tram", "gutter.s3_flood", "gutter.s3_underpass" } },
    { kind = "elite", hazard = true, layouts = { "gutter.elite" } },
    { kind = "fight", hazard = true, layouts = { "gutter.s5_courts", "gutter.s5_market", "gutter.s5_depot" } },
    { kind = "stranger", hazard = false, layouts = { "gutter.stranger" } },
    { kind = "gauntlet", hazard = true, layouts = { "gutter.s7_yard", "gutter.s7_junction", "gutter.s7_hall" } },
    { kind = "boss", hazard = false, layouts = { "gutter.boss" } },
  },
  walk = "gutter.walk",
  strangers = { "patch", "old_sal" },
}

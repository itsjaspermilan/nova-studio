-- Neon Undertow: the title screen, the Den (the hub: LULLABY, the Workbench, the door) and runs of the Gutter Market ending at Mother Coil.
-- The save (keys, upgrades, friends) is read here, at boot. The slice-2 rooms (market_a, market_b), the slice-1 test rooms and `run_start` (a
-- run straight from room 1, no Den) are still there: start one with `--start-scene run_start`.
-- See docs/games/neon-undertow.md in the Nova repository.
require("lib.meta").load()
nova.start("title")

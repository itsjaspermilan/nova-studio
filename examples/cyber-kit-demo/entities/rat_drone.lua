-- A rat-drone (creature_make { kind = "rat_drone" }): small, fast, a blade for a nose.
return require("lib.enemy") { sprite = "rat_drone", speed = 120, hp = 2, sees = 320, reach = 160 }

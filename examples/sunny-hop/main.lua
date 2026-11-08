-- Sunny Hop: a bright run-and-jump platformer in four worlds, made with Kenney's New Platformer Pack. Levels are scene files
-- (scenes/levels/*.scene.json), painted in the studio's scene editor; the map is scenes/map.scene.json.
local state = require("lib.state")

state.load()
nova.start("title")

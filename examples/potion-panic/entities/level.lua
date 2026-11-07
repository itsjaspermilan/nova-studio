-- A level's settings, kept in its scene file (scenes/levels/<n>.scene.json) as this object's props: name, biome, time, interval, patience,
-- stars, recipes, crates, tip. lib/levels.lua reads them with the kitchen's tilemap; the object itself does nothing.
local Level = nova.entity {}

return Level

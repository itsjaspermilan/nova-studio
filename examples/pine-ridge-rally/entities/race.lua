-- A course's settings, kept in its scene file (scenes/<course>.scene.json) as this object's props and edited in the scene editor:
--   stage    true for a rally stage (point to point, in sections); a circuit leaves it out
--   surface  "road" or "dirt" (how the tyres hold), grip (1 is dry asphalt), loose (gravel, sand or snow that kicks up with every metre),
--   dust     [r, g, b] of what the wheels throw up, music (a file in music/), weather ({ kind, count, fall, drift } for nova.weather)
--   horizon  "forest", "desert", "snow" or "night": the ground, mountains and roadside look; night (true: headlights and street lamps)
--   sun_to   the direction towards the sun [x, y, z] (lib/sky.lua makes the sky, the sunlight and the ambient from it), tint (multipliers
--            for the sky's { top, horizon }), clouds (0 to 1), sun ({ dir, color, ambient }: the light itself, for a night lit by the moon)
--   terrain  the hills (nova.terrain: { waves = ... } or a heightmap), wind (nova.wind), look (nova.look: bloom, ambient occlusion...)
--   menu     a circuit's dressing in the menus' backdrop: { road, trees, low, tall }
-- lib/course.lua reads them; the object itself does nothing in the race.
local course = require("lib.course")

local Race = nova.entity { visible = false }

function Race:create()
  course.set(self)
  self:destroy()
end

return Race

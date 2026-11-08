-- The settings of a course (its sky, sun, hills, surface, grip, dust, music...): the props of the `race` object in the course's scene file
-- (entities/race.lua lists them). Nothing about a course is written in code: change the scene file and the game follows.
local sky = require("lib.sky")

local course = {}

local KEYS = { "stage", "surface", "grip", "loose", "dust", "music", "weather", "horizon", "night", "sun_to", "tint", "clouds", "sun", "terrain", "wind", "look", "menu" }

-- The settings from a race object's fields, with the sky and the sun worked out (lib/sky.lua).
local function settings_of(o, where)
  assert(o.sun_to, where .. ": the race object has no sun_to (the direction towards the sun)")
  local c = {}
  for _, k in ipairs(KEYS) do c[k] = o[k] end
  c.sun = c.sun and { dir = c.sun.dir, color = c.sun.color, ambient = c.sun.ambient } or nil
  sky.make(c)
  return c
end

local current

-- Called by the race object of the scene being built.
function course.set(o) current = settings_of(o, "this course's scene") end

-- The settings of the course being raced (its scene has been built).
function course.current()
  assert(current, "this scene has no `race` object: place one (entities/race.lua) and give it the course's settings as its props")
  return current
end

function course.clear() current = nil end

-- The settings of course `id` read from its scene file without going to it (for the menus' backdrop), kept once read.
local read = {}
function course.of(id)
  if read[id] then return read[id] end
  local data = nova.scene_data(id)
  assert(data, "no scenes/" .. id .. ".scene.json")
  for _, o in ipairs(data.objects or {}) do
    if o.kind == "race" then
      read[id] = settings_of(o.props or {}, "scenes/" .. id .. ".scene.json")
      return read[id]
    end
  end
  error("scenes/" .. id .. ".scene.json has no `race` object", 2)
end

return course

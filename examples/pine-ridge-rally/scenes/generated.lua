-- A course made up on the device (the custom stage and the Daily Race): the scene file is empty, and lib/generate.lua builds into it what
-- a hand-made course's scene file holds (the race settings, waypoints, gates, grid, scenery, crowd, grass and the road) from the chosen
-- course's settings before the race itself starts (lib/race.lua).
local state = require("lib.state")
local generate = require("lib.generate")

local Generated = require("lib.race").scene()
local race_enter, race_leave = Generated.enter, Generated.leave

function Generated:enter(...)
  local info = state.current_track()
  assert(info.generated, "scenes/generated is the scene of a made-up course: choose one in the menus (state.custom)")
  generate.build(generate.course(info.generated))
  return race_enter(self, ...)
end

function Generated:leave(...)
  generate.release()
  return race_leave(self, ...)
end

return Generated

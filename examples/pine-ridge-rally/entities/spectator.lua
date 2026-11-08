-- A person watching the race, placed beside the road in the scene file (the track generator puts them there in groups: by the start, on the
-- outside of the hard bends, along the straights; move, add or take away any of them in the scene editor). Each crowd_* kind is one of
-- Kenney's Mini Characters (CC0). `ry` turns them (to face the road), `sx` is their size (the models are 0.67 m tall as made: 2 makes a
-- person about 1.35 m), `hop` how high they jump as they cheer (0: they stand still), and `rate` and `phase` the speed and start of their
-- clip, so that a crowd does not move as one. lib/crowd.lua draws and animates them.
local crowd = require("lib.crowd")

local Spectator = nova.entity { visible = false, ry = 0, sx = 2, hop = 0, rate = 1, phase = 0 }

function Spectator:create()
  crowd.add(getmetatable(self).__model, self.x, self.y, self.z or 0, self)
  self:destroy()
end

return Spectator

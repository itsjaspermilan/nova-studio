-- A marker the road passes through (road_make's control points, in `order`): the race scene makes the road's middle line from them.
-- It draws nothing and does nothing.
local Mark = nova.entity { tags = { "checkpoint" }, velocity = false }

function Mark:draw() end

return Mark

-- The car on show on the title, menu and results screens, standing on the road. It wears whichever car the player picked.
local state = require("lib.state")

local ShowCar = nova.entity { model = "car", tags = { "show" } }

function ShowCar:create()
  self:wear()
end

function ShowCar:wear()
  self.model = state.current_car().id
end

-- (it stands still on the road; the camera moves)

return ShowCar

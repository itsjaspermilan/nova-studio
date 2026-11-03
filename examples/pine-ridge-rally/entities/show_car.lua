-- The car that turns slowly on the title, menu and results screens. It wears whichever car the player picked.
local state = require("lib.state")

local ShowCar = nova.entity { model = "car", tags = { "show" }, turn = 0.5 }

function ShowCar:create()
  self:wear()
end

function ShowCar:wear()
  self.model = state.current_car().id
end

function ShowCar:update(dt)
  self.ry = (self.ry or 0) + self.turn * dt
end

return ShowCar

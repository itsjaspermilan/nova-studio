-- A 2D crate: a body is all it takes (its box is the size of its picture).
local hud = require("lib.hud")
local Crate = nova.entity { sprite = "items/block_yellow", sx = 0.42, sy = 0.42, body = "dynamic", friction = 0.7, tags = { "thing" } }

function Crate:on_hit(other, hit) hud.knock(hit.speed, 500) end

function Crate:update()
  if self.y > 900 or self.x < -200 or self.x > 1200 then self:destroy() end
end

return Crate

-- A barrel: its shape is the hull round the model, so lying on its side it rolls.
local hud = require("lib.hud")
local Barrel = nova.entity { model = "barrel", body = "dynamic", shape = "hull", density = 250, friction = 0.5, tags = { "thing" } }
function Barrel:on_hit(other, hit) hud.knock(hit.speed, 7) end
function Barrel:update() if self.y < -20 then self:destroy() end end
return Barrel

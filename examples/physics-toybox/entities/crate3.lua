-- A 3D crate: Kenney's model (CC0); its box comes from the model.
local hud = require("lib.hud")
local Crate = nova.entity { model = "crate", body = "dynamic", density = 300, friction = 0.7, tags = { "thing" } }
function Crate:on_hit(other, hit) hud.knock(hit.speed, 7) end
function Crate:update() if self.y < -20 then self:destroy() end end
return Crate

-- A thrown ball.
local hud = require("lib.hud")
local Ball = nova.entity { model = "ball", body = "dynamic", shape = "sphere", radius = 0.25, density = 2500, bounce = 0.4,
  bullet = true, spin_damping = 0.3, tags = { "ball", "thing" } }
function Ball:create() self.age = 0 end
function Ball:on_hit(other, hit) hud.knock(hit.speed, 8) end
function Ball:update(dt)
  self.age = self.age + dt
  if self.age > 15 or self.y < -20 then self:destroy() end
end
return Ball

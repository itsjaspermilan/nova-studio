-- A cannonball: a heavy circle that must not pass through a thin crate between two steps (bullet).
local hud = require("lib.hud")
local Ball = nova.entity { sprite = "items/bomb", sx = 0.42, sy = 0.42, body = "dynamic", shape = "circle", radius = 17,
  density = 6000, bounce = 0.35, bullet = true, tags = { "ball", "thing" } }

function Ball:create() self.age = 0 end
function Ball:on_hit(other, hit) hud.knock(hit.speed, 600) end
function Ball:update(dt)
  self.age = self.age + dt
  if self.age > 12 or self.y > 900 or self.x > 1200 then self:destroy() end
end

return Ball

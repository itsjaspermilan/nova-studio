-- The burn mark an explosion leaves on the street: dark, with embers at first, cooling and fading away over a few seconds. Props: radius.
local J = require("lib.juice")

local Scorch = nova.entity { tags = { "scorch" }, velocity = false, t = 0, life = 9 }

function Scorch:create() self.depth = 92 end

function Scorch:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  if self.t >= self.life then self:destroy() end
end

function Scorch:draw()
  local x, y = nova.cam.to_screen(self.x, self.y)
  local fade = math.min(1, (self.life - self.t) / 3)
  local r = self.radius * 1.2
  nova.sprite("fx_scorch", x, y, { frame = self.t < 1.6 and 0 or 1, w = r * 2, h = r * 2, alpha = 0.9 * fade })
end

return Scorch

-- The streak a shot leaves: a thin line from the gun to where it landed, gone almost at once.
local Tracer = nova.entity { tags = { "tracer" }, velocity = false, life = 0.07 }

function Tracer:create()
  self.t = 0
end

function Tracer:update(dt)
  self.t = self.t + dt
  if self.t >= self.life then self:destroy() end
end

function Tracer:draw()
  local k = 1 - self.t / self.life
  nova.line3(self.x, self.y, self.z, self.ex, self.ey, self.ez, { color = { 255, 235, 150 }, width = 0.05 * k + 0.01 })
end

return Tracer

local Crate = nova.entity {
  sprite = "crate",
  tags = { "crate" },
  vy = 220,
  floor = 440,
}

function Crate:create()
  self.angle = 0
  self.spin = (math.random() - 0.5) * 4
end

function Crate:update(dt)
  self.angle = self.angle + self.spin * dt
  if self.y > self.floor + 8 then self:destroy() end
end

return Crate

local Star = nova.entity {
  sprite = "star",
  tags = { "star" },
  vy = 120,
  hitbox = { r = 10 },
}

function Star:create()
  -- Entities own their timers: this one disappears on its own if nobody collects it.
  self:after(6, function() self:destroy() end)
  self:tween({ sx = 1.25, sy = 1.25 }, 0.4, "out_back")
end

function Star:update(dt)
  self.angle = math.sin(nova.time() * 4 + self.id) * 0.3
  if self.y > 440 then self.vy = 0 end
end

return Star

-- A flash of lightning between two points (Live Wire, Shock Wake): a jagged line that fades in a few frames. Props: x2, y2.
local Zap = nova.entity { tags = { "zap" }, velocity = false, t = 0 }

function Zap:create() self.depth = -self.y - 60 end

function Zap:update(dt)
  self.t = self.t + dt
  if self.t > 0.18 then self:destroy() end
end

function Zap:draw()
  local fade = 1 - self.t / 0.18
  local n = 6
  local px, py = nova.cam.to_screen(self.x, self.y)
  local qx, qy = nova.cam.to_screen(self.x2, self.y2)
  local lx, ly = px, py
  for i = 1, n do
    local k = i / n
    local x = px + (qx - px) * k
    local y = py + (qy - py) * k
    if i < n then x = x + ((i * 7 + math.floor(self.t * 60)) % 5 - 2) * 5; y = y + ((i * 11 + math.floor(self.t * 60)) % 5 - 2) * 5 end
    local c = self.color or { 6, 240, 255 }
    nova.ui.line(lx, ly, x, y, 3, { c[1], c[2], c[3], 255 * fade })
    nova.ui.line(lx, ly, x, y, 1, { 255, 255, 255, 255 * fade })
    lx, ly = x, y
  end
end

return Zap

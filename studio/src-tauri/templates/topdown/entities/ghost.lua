-- A ghost: drifts about, turns round at walls and bumps the player back to the start.
local Ghost = nova.entity { tags = { "ghost" }, speed = 70, size = 24 }

local function blocked(g, x, y)
  for _, s in ipairs(nova.all("solid")) do
    if x + g.size / 2 > s.x and x - g.size / 2 < s.x + s.w and y + g.size / 2 > s.y and y - g.size / 2 < s.y + s.h then return true end
  end
  return false
end

function Ghost:update(dt)
  if not self.dir then self.dir = (self.x * 7 + self.y * 3) % (math.pi * 2) end
  local nx, ny = self.x + math.cos(self.dir) * self.speed * dt, self.y + math.sin(self.dir) * self.speed * dt
  if blocked(self, nx, ny) then
    self.dir = self.dir + math.pi * 0.5 + (self.x % 3) * 0.4 -- turn away from the wall
  else
    self.x, self.y = nx, ny
  end
end

function Ghost:draw()
  nova.rect(self.x - self.size / 2, self.y - self.size / 2, self.size, self.size, { 235, 120, 150 })
  nova.rect(self.x - 6, self.y - 5, 4, 4, { 30, 30, 40 })
  nova.rect(self.x + 2, self.y - 5, 4, 4, { 30, 30, 40 })
end

return Ghost

-- The player: moves in every direction, stops at anything with the "solid" tag, collects gems, and is sent back to the start by a ghost.
local Player = nova.entity {
  tags = { "player" },
  speed = 200,
  size = 22,
  gems = 0,
  won = false,
}

local function blocked(p, x, y)
  for _, s in ipairs(nova.all("solid")) do
    if x + p.size / 2 > s.x and x - p.size / 2 < s.x + s.w and y + p.size / 2 > s.y and y - p.size / 2 < s.y + s.h then return true end
  end
  return false
end

function Player:update(dt)
  if self.won then
    if nova.input.pressed("jump") then nova.restart_scene() end
    return
  end
  self.start_x = self.start_x or self.x
  self.start_y = self.start_y or self.y
  local dx, dy = nova.input.axis("move_x"), nova.input.axis("move_y")
  local len = math.sqrt(dx * dx + dy * dy)
  if len > 1 then dx, dy = dx / len, dy / len end -- no faster along a diagonal
  -- one direction at a time, so that sliding along a wall works
  local nx = self.x + dx * self.speed * dt
  if not blocked(self, nx, self.y) then self.x = nx end
  local ny = self.y + dy * self.speed * dt
  if not blocked(self, self.x, ny) then self.y = ny end

  for _, g in ipairs(nova.all("gem")) do
    if math.abs(g.x - self.x) < 18 and math.abs(g.y - self.y) < 18 then
      g:destroy()
      self.gems = self.gems + 1
    end
  end
  for _, g in ipairs(nova.all("ghost")) do
    if math.abs(g.x - self.x) < 20 and math.abs(g.y - self.y) < 20 then self.x, self.y = self.start_x, self.start_y end
  end
  if #nova.all("gem") == 0 then
    for _, e in ipairs(nova.all("exit")) do
      if math.abs(e.x - self.x) < 24 and math.abs(e.y - self.y) < 24 then self.won = true end
    end
  end
end

function Player:draw()
  nova.rect(self.x - self.size / 2, self.y - self.size / 2, self.size, self.size, { 255, 200, 80 })
  nova.ui.text(36, 66, "Gems: " .. self.gems, { size = 22, color = { 190, 235, 255 } })
  if self.won then
    nova.ui.text(300, 200, "You got out!", { size = 64 })
    nova.ui.text(330, 280, "Press jump to play again", { size = 20 })
  end
end

return Player

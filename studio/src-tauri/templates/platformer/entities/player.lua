-- The player: runs, jumps, lands on anything with the "solid" tag, collects coins and reaches the flag. x and y are where its feet are.
local Player = nova.entity {
  tags = { "player" },
  speed = 230,
  jump_speed = 560,
  gravity = 1500,
  w = 24,
  h = 36,
  score = 0,
  won = false,
}

local function hits(p, s)
  return p.x - p.w / 2 < s.x + s.w and p.x + p.w / 2 > s.x and p.y - p.h < s.y + s.h and p.y > s.y
end

function Player:update(dt)
  if self.won then
    if nova.input.pressed("jump") then nova.restart_scene() end
    return
  end
  self.start_x = self.start_x or self.x
  self.start_y = self.start_y or self.y
  local move = nova.input.axis("move_x")
  if self.grounded and nova.input.pressed("jump") then self.vy = -self.jump_speed end
  self.vy = math.min(self.vy + self.gravity * dt, 900)

  -- across, then up and down, one at a time, so that a wall stops a run and a floor stops a fall
  self.x = self.x + move * self.speed * dt
  for _, s in ipairs(nova.all("solid")) do
    if hits(self, s) then
      if move > 0 then self.x = s.x - self.w / 2 elseif move < 0 then self.x = s.x + s.w + self.w / 2 end
    end
  end
  self.y = self.y + self.vy * dt
  self.grounded = false
  for _, s in ipairs(nova.all("solid")) do
    if hits(self, s) then
      if self.vy > 0 then
        self.y, self.vy, self.grounded = s.y, 0, true
      else
        self.y, self.vy = s.y + s.h + self.h, 0
      end
    end
  end

  -- coins and the flag
  for _, c in ipairs(nova.all("coin")) do
    if math.abs(c.x - self.x) < 20 and c.y > self.y - self.h - 10 and c.y < self.y + 10 then
      c:destroy()
      self.score = self.score + 1
    end
  end
  for _, f in ipairs(nova.all("flag")) do
    if math.abs(f.x - self.x) < 24 and f.y > self.y - 10 and f.y - 70 < self.y then self.won = true end
  end
  -- falling out of the world starts the level again
  if self.y > 700 then self.x, self.y, self.vy = self.start_x, self.start_y, 0 end
end

function Player:draw()
  nova.rect(self.x - self.w / 2, self.y - self.h, self.w, self.h, { 255, 200, 80 })
  nova.rect(self.x - self.w / 2 + 6, self.y - self.h + 8, 4, 4, { 40, 40, 60 })
  nova.rect(self.x + self.w / 2 - 10, self.y - self.h + 8, 4, 4, { 40, 40, 60 })
  nova.ui.text(24, 56, "Coins: " .. self.score, { size = 22, color = { 255, 240, 170 } })
  if self.won then
    nova.ui.text(300, 200, "You win!", { size = 64 })
    nova.ui.text(330, 280, "Press jump to play again", { size = 20 })
  end
end

return Player

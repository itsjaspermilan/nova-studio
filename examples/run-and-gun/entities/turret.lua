-- A gun on a wall: stays put, turns to the player and fires a shot at it every couple of seconds while the player is near.
local rect = require("lib.view").rect
local phys = require("lib.phys")
local atan2, cos, sin, floor = math.atan, math.cos, math.sin, math.floor

local Turret = nova.entity {
  tags = { "enemy" },
  velocity = false,
  w = 26,
  h = 24,
  settings = {
    hp = { 4, min = 1, max = 50, step = 1, help = "Shots it takes" },
    interval = { 1.8, min = 0.4, max = 6, step = 0.1, help = "Seconds between shots" },
    range = { 520, min = 100, max = 900, step = 10, help = "How far away it sees the player" },
  },
}

function Turret:create()
  self.t, self.flash, self.ang = math.random() * 2, 0, math.pi
end

function Turret:hurt(n)
  self.hp = self.hp - n
  self.flash = 0.08
  if self.hp <= 0 then
    for _ = 1, 22 do nova.spawn("spark", self.x, self.y - 12, { color = { 255, 170, 60 }, size = 5, speed = 240 }) end
    local p = nova.first("player")
    if p then p.score = p.score + 300 end
    self:destroy()
  end
end

function Turret:update(dt)
  self.t = self.t + dt
  self.flash = math.max(0, self.flash - dt)
  local p = nova.first("player")
  if not p or p.dead then return end
  local dx, dy = p.x - self.x, (p.y - 20) - (self.y - 14)
  -- it only wakes while it is on the screen (and the player is in its range)
  if not phys.in_view(self.x, self.y - 12, -8) or dx * dx + dy * dy > self.range * self.range then
    self.t = math.min(self.t, self.interval * 0.5)
    return
  end
  self.ang = atan2(dy, dx)
  if self.t >= self.interval then
    self.t = 0
    nova.spawn("ebullet", self.x + cos(self.ang) * 16, self.y - 14 + sin(self.ang) * 16, { dx = cos(self.ang), dy = sin(self.ang) })
  end
end

function Turret:draw()
  local x, y = floor(self.x), floor(self.y)
  local c = self.flash > 0 and { 255, 255, 255 } or { 120, 130, 150 }
  rect(x - 13, y - 12, 26, 12, { 80, 90, 110 })
  rect(x - 9, y - 22, 18, 12, c)
  for i = 1, 3 do rect(floor(x + cos(self.ang) * i * 6 - 2), floor(y - 14 + sin(self.ang) * i * 6 - 2), 5, 5, { 40, 40, 50 }) end
  -- the light blinks just before it fires
  local warn = self.t > self.interval - 0.35 and floor(self.t * 20) % 2 == 0
  rect(x - 2, y - 17, 4, 4, warn and { 255, 255, 255 } or { 255, 90, 90 })
end

return Turret

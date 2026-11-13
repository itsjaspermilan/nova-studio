-- The end of the level: a big gun tower. Wakes when the screen reaches it and fires aimed fans of shots; a few seconds on, a burst. Beat it to clear the stage.
local rect = require("lib.view").rect
local atan2, cos, sin, floor = math.atan, math.cos, math.sin, math.floor

local Boss = nova.entity {
  tags = { "enemy", "boss" },
  velocity = false,
  w = 110,
  h = 150,
  settings = {
    hp = { 40, min = 5, max = 400, step = 1, help = "Shots it takes" },
    interval = { 1.5, min = 0.4, max = 5, step = 0.1, help = "Seconds between fans of shots" },
  },
}

function Boss:create()
  self.t, self.flash, self.awake, self.n = 0, 0, false, 0
  self.max_hp = self.hp
end

function Boss:hurt(n)
  if not self.awake then return end
  self.hp = self.hp - n
  self.flash = 0.06
  if self.hp <= 0 then
    for _ = 1, 80 do nova.spawn("spark", self.x + (math.random() - 0.5) * 100, self.y - math.random() * 150, { color = { 255, 150 + math.random(100), 60 }, size = 7, speed = 320 }) end
    local p = nova.first("player")
    if p then p.score, p.won = p.score + 5000, true end
    for _, b in ipairs(nova.all("ebullet")) do b:destroy() end
    self:destroy()
  end
end

function Boss:update(dt)
  local camx = nova.cam.position()
  if not self.awake then
    if self.x < camx + 440 then self.awake = true end
    return
  end
  self.t = self.t + dt
  self.flash = math.max(0, self.flash - dt)
  local p = nova.first("player")
  if not p or p.dead or p.won then return end
  if self.t >= self.interval then
    self.t = 0
    self.n = self.n + 1
    local a = atan2((p.y - 20) - (self.y - 100), p.x - self.x)
    local fan = (self.n % 4 == 0) and { -0.5, -0.25, 0, 0.25, 0.5 } or { -0.2, 0, 0.2 }
    for _, d in ipairs(fan) do
      nova.spawn("ebullet", self.x - 40, self.y - 100, { dx = cos(a + d), dy = sin(a + d), speed = 200 })
    end
  end
  -- touching it is fatal
  if math.abs(p.x - self.x) < (self.w + p.w) / 2 and p.y > self.y - self.h and p.y - p.h < self.y then p:kill() end
end

function Boss:draw()
  local x, y = floor(self.x), floor(self.y)
  local c = self.flash > 0 and { 255, 255, 255 } or { 90, 100, 130 }
  rect(x - 55, y - 150, 110, 150, c)
  rect(x - 55, y - 150, 110, 12, { 60, 70, 100 })
  rect(x - 40, y - 130, 80, 40, { 50, 55, 80 })
  -- the core
  local glow = self.awake and (180 + floor(60 * math.sin((self.t or 0) * 8))) or 90
  rect(x - 16, y - 120, 32, 22, { 255, glow, 80 })
  rect(x - 60, y - 105, 24, 10, { 40, 40, 50 }) -- the gun
  rect(x - 60, y - 70, 24, 10, { 40, 40, 50 })
end

return Boss

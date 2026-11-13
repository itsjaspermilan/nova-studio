-- A foot soldier: wakes when the screen reaches it, runs at the player, hops small walls, dies to a shot. Touching it is fatal.
local phys = require("lib.phys")
local rect = require("lib.view").rect
local floor, abs = math.floor, math.abs

local Soldier = nova.entity {
  tags = { "enemy" },
  velocity = false,
  w = 18,
  h = 36,
  settings = {
    hp = { 1, min = 1, max = 20, step = 1, help = "Shots it takes" },
    speed = { 105, min = 30, max = 300, step = 5, help = "Running speed" },
  },
}

function Soldier:create()
  self.vx, self.vy, self.t, self.awake, self.face = 0, 0, math.random() * 4, false, -1
  self.flash = 0
end

function Soldier:hurt(n)
  self.hp = self.hp - n
  self.flash = 0.08
  if self.hp <= 0 then
    for _ = 1, 14 do nova.spawn("spark", self.x, self.y - 18, { color = { 220, 70, 60 }, size = 4, speed = 200 }) end
    local p = nova.first("player")
    if p then p.score = p.score + 100 end
    self:destroy()
  end
end

function Soldier:update(dt)
  self.t = self.t + dt
  self.flash = math.max(0, self.flash - dt)
  local camx = nova.cam.position()
  if not self.awake then
    if self.x < camx + 540 then self.awake = true end
  end
  if self.awake then
    local p = nova.first("player")
    if p and not p.dead then
      self.face = (p.x < self.x) and -1 or 1
      self.vx = self.face * self.speed
      if self.hit_wall and self.grounded then self.vy = -420 end
      if abs(p.x - self.x) < (self.w + p.w) / 2 and p.y > self.y - self.h and p.y - p.h < self.y then p:kill() end
    else
      self.vx = 0
    end
  else
    self.vx = 0
  end
  phys.step(self, dt, 1500, 900)
  if self.y > 700 or self.x < camx - 620 then self:destroy() end
end

function Soldier:draw()
  local x, y, f = floor(self.x), floor(self.y), self.face
  local c = self.flash > 0 and { 255, 255, 255 } or { 200, 70, 60 }
  local run = (self.vx ~= 0 and self.grounded) and floor(self.t * 10) % 2 or 0
  rect(x - 6 - run * 2, y - 14, 5, 14, { 70, 40, 40 })
  rect(x + 1 + run * 2, y - 14, 5, 14, { 70, 40, 40 })
  rect(x - 7, y - 27, 14, 14, c)
  rect(x - 4, y - 36, 9, 10, { 190, 150, 120 })
  rect(x + f * 5 - 2, y - 24, 8, 3, { 40, 40, 50 })
end

return Soldier

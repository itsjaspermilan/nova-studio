local rect = require("lib.view").rect
-- A foot soldier. Two ways of fighting (the `style` setting):
--   rusher: waits until you are close, then charges, hopping rocks and small gaps;
--   gunner: keeps its distance (steps back if you come close, forward if you go far) and fires bursts of two, only while it is on the screen.
-- Neither walks off an edge it cannot cross. Touching either is fatal.
local phys = require("lib.phys")
local floor, abs, atan2, cos, sin = math.floor, math.abs, math.atan, math.cos, math.sin

local Soldier = nova.entity {
  tags = { "enemy" },
  velocity = false,
  w = 18,
  h = 36,
  settings = {
    style = { "rusher", choices = { "rusher", "gunner" }, help = "rusher: waits, then charges. gunner: keeps its distance and fires bursts" },
    hp = { 1, min = 1, max = 20, step = 1, help = "Shots it takes" },
    speed = { 150, min = 30, max = 300, step = 5, help = "Running speed when it charges (a gunner walks slower)" },
    fire_interval = { 1.7, min = 0.5, max = 6, step = 0.1, help = "Gunner: seconds between bursts" },
  },
}

function Soldier:create()
  self.vx, self.vy, self.t, self.face = 0, 0, math.random() * 4, -1
  self.flash, self.charging, self.shoot_t, self.burst, self.burst_t = 0, false, 0.6 + math.random(), 0, 0
end

function Soldier:hurt(n)
  self.hp = self.hp - n
  self.flash = 0.08
  self.charging = true -- being shot wakes it up
  if self.hp <= 0 then
    for _ = 1, 14 do nova.spawn("spark", self.x, self.y - 18, { color = { 220, 70, 60 }, size = 4, speed = 200 }) end
    local p = nova.first("player")
    if p then p.score = p.score + (self.style == "gunner" and 150 or 100) end
    self:destroy()
  end
end

-- one aimed shot at the player
function Soldier:fire_at(p)
  local gx, gy = self.x + self.face * 12, self.y - 22
  local a = atan2((p.y - 20) - gy, p.x - gx)
  nova.spawn("ebullet", gx, gy, { dx = cos(a), dy = sin(a), speed = 190 })
end

function Soldier:update(dt)
  self.t = self.t + dt
  self.flash = math.max(0, self.flash - dt)
  local p = nova.first("player")
  local camx = nova.cam.position()
  local near = abs(self.x - camx) < 720 -- asleep until the screen is nearly on it, and again when it is far behind
  local want = 0
  if near and p and not p.dead then
    local dx = p.x - self.x
    local dist = abs(dx)
    local dir = dx > 0 and 1 or -1
    self.face = dir
    if self.style == "gunner" then
      -- keep a distance of about 180 to 340 pixels
      if dist > 340 then want = dir * 0.75 elseif dist < 180 then want = -dir * 0.6 end
      -- fire in bursts of two, only while on the screen and not far above or below
      if phys.in_view(self.x, self.y - 20, -12) and abs(p.y - self.y) < 260 then
        self.shoot_t = self.shoot_t - dt
        if self.burst > 0 then
          self.burst_t = self.burst_t - dt
          if self.burst_t <= 0 then
            self:fire_at(p)
            self.burst, self.burst_t = self.burst - 1, 0.22
          end
        elseif self.shoot_t <= 0 then
          self.burst, self.burst_t, self.shoot_t = 2, 0, self.fire_interval
        end
      else
        self.burst = 0
      end
    else
      -- the rusher waits until you are near (or has been hurt), then charges
      if dist < 320 then self.charging = true end
      if self.charging then want = dir end
    end
    if abs(dx) < (self.w + p.w) / 2 and p.y > self.y - self.h and p.y - p.h < self.y then p:kill() end
  end

  -- walking: the way ahead is checked, so it does not walk off an edge it cannot cross
  local speed = self.style == "gunner" and self.speed * 0.6 or self.speed
  self.vx = want * speed
  if want ~= 0 and self.grounded then
    local ahead = self.x + (want > 0 and 1 or -1) * (self.w / 2 + 12)
    if self.hit_wall then
      self.vy = -430 -- a rock or a step: hop it
    elseif not phys.floor_at(ahead, self.y) then
      -- a gap: a charging rusher jumps it (they cross the gaps in this level), anyone else stops at the edge
      if self.style == "rusher" and self.charging then self.vy = -520 else self.vx = 0 end
    end
  end
  phys.step(self, dt, 1500, 900)
  if self.y > 700 then self:destroy() end
end

function Soldier:draw()
  local x, y, f = floor(self.x), floor(self.y), self.face
  local gunner = self.style == "gunner"
  local c = self.flash > 0 and { 255, 255, 255 } or (gunner and { 200, 140, 60 } or { 200, 70, 60 })
  local run = (self.vx ~= 0 and self.grounded) and floor(self.t * 10) % 2 or 0
  rect(x - 6 - run * 2, y - 14, 5, 14, { 70, 40, 40 })
  rect(x + 1 + run * 2, y - 14, 5, 14, { 70, 40, 40 })
  rect(x - 7, y - 27, 14, 14, c)
  rect(x - 4, y - 36, 9, 10, { 190, 150, 120 })
  if gunner then
    rect(x - 5, y - 38, 11, 4, { 90, 80, 50 }) -- a helmet
    rect(x + f * 5 - 2, y - 24, 11, 3, { 40, 40, 50 }) -- a longer gun
    if self.burst > 0 then rect(x + f * 15, y - 25, 4, 4, { 255, 240, 160 }) end
  else
    rect(x + f * 5 - 2, y - 24, 8, 3, { 40, 40, 50 })
  end
end

return Soldier

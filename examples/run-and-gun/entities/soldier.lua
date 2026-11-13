local rect = require("lib.view").rect
-- A foot soldier. Two ways of fighting (the `style` setting):
--   rusher: waits until you come near, then closes in at a walk to a distance of its own choosing, stops, WINDS UP (it flashes and shows a mark: this is the moment to parry,
--           or to jump away), and lunges a fixed way, not following you; after the lunge it is out of breath for a moment, then thinks again;
--   gunner: keeps a distance that changes after every burst, raises its gun (a blink) before each burst of two, and sometimes hops after one.
-- Neither runs at where you ARE: each looks at you only every third of a second or so and goes to where you were, a little to one side. Neither walks off an edge it cannot
-- cross. Touching one hurts. A stunned soldier (parried or hit) is open: it takes double damage.
local phys = require("lib.phys")
local hpbar = require("lib.hpbar")
local view = require("lib.view")
local world = require("lib.world")
local floor, abs, atan2, cos, sin, random = math.floor, math.abs, math.atan, math.cos, math.sin, math.random
local sign = function(v) return v > 0 and 1 or (v < 0 and -1 or 0) end

local Soldier = nova.entity {
  tags = { "enemy" },
  velocity = false,
  w = 18,
  h = 36,
  settings = {
    style = { "rusher", choices = { "rusher", "gunner" }, help = "rusher: waits, winds up, lunges. gunner: keeps its distance and fires bursts" },
    hp = { 1, min = 1, max = 20, step = 1, help = "Shots it takes" },
    speed = { 150, min = 30, max = 300, step = 5, help = "Running speed (a rusher walks in at 0.7 of it and lunges at 2 times it; a gunner walks at 0.6)" },
    fire_interval = { 1.7, min = 0.5, max = 6, step = 0.1, help = "Gunner: seconds between bursts" },
  },
}

function Soldier:create()
  self.vx, self.vy, self.t, self.face = 0, 0, random() * 4, -1
  self.flash, self.alert, self.state, self.st = 0, false, "approach", 0
  self.seen_x, self.seen_t, self.off = nil, 0, (random() - 0.5) * 90
  self.range = 100 + random() * 60 -- how close a rusher gets before it winds up
  self.want_dist = 190 + random() * 140 -- how far a gunner likes to stand from you
  self.shoot_t, self.wind, self.burst, self.burst_t = 0.8 + random(), 0, 0, 0
  self.lunge_dir = 1
  self.max_hp, self.hit_seen = self.hp, false
end

function Soldier:hurt(n)
  if self.state == "stun" then n = n * 2 end -- open to a hit
  self.hp = self.hp - n
  self.hit_seen = true
  self.flash = 0.08
  self.alert = true -- being shot wakes it up
  if self.hp <= 0 then
    for _ = 1, 14 do nova.spawn("spark", self.x, self.y - 18, { color = { 220, 70, 60 }, size = 4, speed = 200 }) end
    local p = nova.first("player")
    if p then p.score = p.score + (self.style == "gunner" and 150 or 100) end
    self:destroy()
  end
end

-- stopped for a moment (a parried lunge): knocked back a little and open
function Soldier:stun(seconds, from_dir)
  self.state, self.st, self.burst, self.wind = "stun", seconds, 0, 0
  self.vx, self.vy = (from_dir or 1) * 170, -180
  self.alert = true
end

-- one aimed shot at the player
function Soldier:fire_at(p)
  local gx, gy = self.x + self.face * 12, self.y - 22
  local a = atan2((p.y - 20) - gy, p.x - gx)
  nova.spawn("ebullet", gx, gy, { dx = cos(a), dy = sin(a), speed = 190 })
end

-- (a new idea of where to stand and how close to come)
function Soldier:rethink()
  self.range = 100 + random() * 60
  self.want_dist = 190 + random() * 140
  self.off = (random() - 0.5) * 90
end

function Soldier:update(dt)
  self.t = self.t + dt
  self.flash = math.max(0, self.flash - dt)
  local p = nova.first("player")
  local camx, camy = nova.cam.position()
  -- asleep until the screen is nearly on it (across or up and down), and again when it is far away; a sleeping soldier standing on something does nothing at all
  local near = abs(self.x - camx) < view.half_w() + 260 and abs(self.y - camy) < view.half_h() + 220
  if not near and self.grounded then return end
  local want, speed = 0, self.speed

  if near and p and not p.dead then
    -- it looks at you every third of a second or so, and goes to where you were (a little off to one side), not to where you are
    self.seen_t = self.seen_t - dt
    if self.seen_t <= 0 or not self.seen_x then
      self.seen_t = 0.3 + random() * 0.2
      self.seen_x = p.x + self.off
    end
    local dist = abs(p.x - self.x)
    local to_seen = self.seen_x - self.x
    if self.state ~= "lunge" then self.face = p.x < self.x and -1 or 1 end
    if dist < 380 then self.alert = true end

    if self.state == "stun" then
      self.st = self.st - dt
      if self.st <= 0 then self.state = "approach"; self:rethink() end
    elseif self.style == "gunner" then
      if self.alert then
        local gap = abs(to_seen)
        local dir = sign(to_seen)
        if gap > self.want_dist + 30 then want = dir * 0.6 elseif gap < self.want_dist - 50 then want = -dir * 0.55 end
        if dist < 90 then want = -sign(p.x - self.x) * 0.9 end -- too close: back off
        -- a burst of two, with the gun raised first (a blink), only while on the screen and not far above or below
        if phys.in_view(self.x, self.y - 20, -12) and abs(p.y - self.y) < 260 then
          if self.burst > 0 then
            self.burst_t = self.burst_t - dt
            if self.burst_t <= 0 then
              self:fire_at(p)
              self.burst, self.burst_t = self.burst - 1, 0.22
              if self.burst == 0 then
                self:rethink() -- done: somewhere else to stand next time, and now and then a hop
                if self.grounded and random() < 0.3 then self.vy = -380 end
              end
            end
          elseif self.wind > 0 then
            self.wind = self.wind - dt
            if self.wind <= 0 then self.burst, self.burst_t = 2, 0 end
          else
            self.shoot_t = self.shoot_t - dt
            if self.shoot_t <= 0 then self.wind, self.shoot_t = 0.3, self.fire_interval end
          end
        else
          self.burst, self.wind = 0, 0
        end
      end
    else
      -- the rusher
      if self.state == "approach" then
        if self.alert then
          if abs(to_seen) > 10 then want = sign(to_seen) * 0.7 end
          if dist < self.range and abs(p.y - self.y) < 80 and self.grounded then self.state, self.st = "wind", 0.4 end
        end
      elseif self.state == "wind" then
        self.st = self.st - dt
        if self.st <= 0 then
          -- it lunges to where you are standing now, and no further: the length of the lunge is fixed when it starts
          self.state, self.lunge_dir = "lunge", (p.x < self.x) and -1 or 1
          self.st = math.max(0.2, math.min(0.45, (dist + 8) / (self.speed * 2.2)))
        end
      elseif self.state == "lunge" then
        self.st = self.st - dt
        if self.st <= 0 then self.state, self.st = "recover", 0.8 end
      elseif self.state == "recover" then
        self.st = self.st - dt
        if self.st <= 0 then self.state = "approach"; self:rethink() end
      end
    end

    -- touching one hurts (a stunned one is harmless)
    if self.state ~= "stun" and dist < (self.w + p.w) / 2 and p.y > self.y - self.h and p.y - p.h < self.y then p:hurt(30, self.x) end
  end

  -- moving: the way ahead is checked, so that it does not walk off an edge it cannot cross
  if self.state == "lunge" then
    self.vx = self.lunge_dir * self.speed * 2.2
  elseif self.state == "stun" then
    self.vx = self.vx * (1 - math.min(1, 6 * dt)) -- the knock-back dies away
  else
    self.vx = want * (self.style == "gunner" and speed * 0.6 or speed)
  end
  if self.grounded and self.vx ~= 0 and self.state ~= "stun" then
    local dirx = self.vx > 0 and 1 or -1
    local ahead = self.x + dirx * (self.w / 2 + 12)
    if self.hit_wall and self.state ~= "lunge" then
      self.vy = -430 -- a rock or a step: hop it
    elseif not phys.floor_at(ahead, self.y) then
      if self.style == "rusher" and self.state == "approach" and self.alert then self.vy = -520 -- a gap: a rusher on the way in jumps it
      else
        self.vx = 0 -- anyone else stops at the edge (and a lunge ends there)
        if self.state == "lunge" then self.state, self.st = "recover", 0.8 end
      end
    end
  end
  -- (not standing on each other)
  for _, o in ipairs(nova.all("enemy")) do
    if o ~= self and o.style and abs(o.x - self.x) < 16 and abs(o.y - self.y) < 10 and self.state ~= "lunge" then
      self.vx = self.vx + (self.x >= o.x and 1 or -1) * 50
    end
  end
  phys.step(self, dt, 1500, 900)
  if self.y > world.kill_y + 100 then self:destroy() end
end

-- Which picture and pose: a rusher is the zombie (walking, a raised arm as it winds up, a thrown arm as it lunges), a gunner the soldier (an arm out as it raises
-- the gun, another pose as it fires). The frames are in lib/kenney_frames.lua; the pictures in sprites/ (open them in the sprite editor).
local frames = require("lib.kenney_frames")
local SCALE = 0.34

function Soldier:draw()
  local x, y, f = floor(self.x), floor(self.y), self.face
  local gunner = self.style == "gunner"
  local sheet = gunner and "soldier" or "zombie"
  local fr = frames[sheet]
  local walking = self.vx ~= 0 and self.grounded
  local pose = fr.idle
  if self.state == "stun" or self.flash > 0 then pose = fr.hurt
  elseif not self.grounded then pose = fr.jump
  elseif gunner and self.burst > 0 then pose = fr.shoot
  elseif gunner and self.wind > 0 then pose = fr.aim
  elseif self.state == "wind" then pose = fr.windup
  elseif self.state == "lunge" then pose = fr.lunge
  elseif walking then pose = (floor(self.t * 6) % 2 == 0) and fr.walk or fr.walk2
  elseif floor(self.t * 1.5) % 2 == 1 then pose = fr.idle2 end
  -- a tint: pale when it winds up (it flickers), grey when stunned
  local tint = nil
  if self.state == "wind" and floor(self.t * 20) % 2 == 0 then tint = { 255, 190, 190 } end
  if self.state == "stun" then tint = { 170, 170, 195 } end
  view.sprite(sheet, x, y - 55 * SCALE + 1, pose, f < 0, tint, SCALE)
  if gunner and (self.burst > 0 or self.wind > 0) then
    rect(x + f * 10, y - 24, 13, 3, { 40, 40, 50 }) -- the gun it holds out
    if self.wind > 0 and floor(self.t * 24) % 2 == 0 then rect(x + f * 24, y - 26, 5, 5, { 255, 120, 60 }) end
    if self.burst > 0 and self.burst_t > 0.12 then rect(x + f * 24, y - 25, 4, 4, { 255, 240, 160 }) end
  end
  if self.state == "wind" then -- a mark over its head: a lunge is coming
    rect(x - 2, y - 56, 4, 10, { 255, 70, 60 })
    rect(x - 2, y - 43, 4, 4, { 255, 70, 60 })
  elseif self.state == "stun" then
    rect(x - 8, y - 46, 4, 4, { 255, 230, 90 })
    rect(x + 4, y - 48, 4, 4, { 255, 230, 90 })
  end
  hpbar.draw(self, y - 42)
end

return Soldier

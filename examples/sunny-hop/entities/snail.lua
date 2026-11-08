-- A snail: stomped, it hides in its shell; touch the shell from the side to kick it, and it slides, knocking out every enemy in its way,
-- until it hits a wall a few times. A kicked shell hurts on its way back, and stomping it stops it. Left alone, the snail comes out again.
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")
local Enemy = require("entities.enemy")

local Snail = nova.entity(Enemy, { sprite = "enemies/snail", bw = 44, bh = 32, speed = 34, anim_rate = 4, shell = false, sliding = false, shell_t = 0, bounces = 0 })

function Snail:act(dt)
  if not self.shell then return self:walk(dt) end
  local b = self.b
  self.shell_t = self.shell_t + dt
  if self.sliding then
    b.vx = self.slide_dir * 470
    b.vy = math.min(900, b.vy + 2400 * dt)
    world.move(b, b.vx * dt, b.vy * dt, false, true, false)
    if b.ground then b.vy = 0 end
    if b.hit_x then
      self.slide_dir = -self.slide_dir
      self.bounces = self.bounces + 1
      audio.sfx("bump", { pitch = 1.3, volume = 0.6 })
      fx.dust(b.x + self.slide_dir * -20, b.y - 16, 4)
      if self.bounces >= 4 then self:knock(b.x - self.slide_dir) end
    end
    self.x, self.y = b.x, b.y
    -- knock out what it runs into
    for _, e in ipairs(nova.all("enemy")) do
      if e ~= self and not e.dead and not e.boss then
        local x0, y0, x1, y1 = e:box()
        local hw = self.bw * 0.5
        if self.x + hw > x0 and self.x - hw < x1 and self.y > y0 and self.y - self.bh < y1 then e:knock(self.x); fx.sparkle(e.x, e.y - 20, 6) end
      end
    end
    if self.y > world.height + 200 then self:destroy() end
  else
    b.vy = math.min(900, b.vy + 2400 * dt)
    world.move(b, 0, b.vy * dt, false, true, false)
    if b.ground then b.vy = 0 end
    self.x, self.y = b.x, b.y
    if self.shell_t > 6 then self.shell, self.squash_y = false, 1.3; audio.sfx("throw", { pitch = 0.8, volume = 0.5 }) end
  end
end

function Snail:frame_now()
  if self.dead and not self.fly_off then return 3 end
  if self.shell then return 3 end
  return 1 + math.floor(self.t * self.anim_rate) % 2
end

function Snail:predict(dt)
  if self.dead then return nil end
  if self.shell then return self.x + (self.sliding and self.slide_dir * 470 * dt or 0), self.y end
  return self.x + self.dir * self.speed * dt, self.y
end

-- a still shell does not hurt; a sliding one does (from the side)
function Snail:harmless() return self.shell and not self.sliding end

function Snail:stomp(hero)
  audio.sfx("stomp", { pitch = 0.9 })
  fx.dust(self.x, self.y - 6, 6)
  self.squash_x, self.squash_y = 1.3, 0.7
  if not self.shell or self.sliding then
    self.shell, self.sliding, self.shell_t, self.bounces = true, false, 0, 0
    return true
  end
  -- stomping a still shell kicks it away from the hero
  self:kick(hero.x)
  return true
end

function Snail:kick(from_x)
  self.sliding, self.shell_t, self.bounces = true, 0, 0
  self.slide_dir = self.x >= from_x and 1 or -1
  self.dir = self.slide_dir
  audio.sfx("throw")
  fx.dust(self.x, self.y - 6, 6)
end

return Snail

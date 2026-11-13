-- The player. D-pad or left stick runs and aims (up, the diagonals, down), B (bottom) jumps (down and B drops through a ledge), Y (left) or R1/R2 fires,
-- A (right) dashes (a short burst you cannot be hit in; once in the air), L1 or L2 holds you still to aim. Down on the ground with no direction lies prone. One hit and you are down: you start again at the last checkpoint.
local phys = require("lib.phys")
local rect = require("lib.view").rect
local sin, cos, atan2, sqrt, floor, abs = math.sin, math.cos, math.atan, math.sqrt, math.floor, math.abs

local Player = nova.entity {
  tags = { "player" },
  velocity = false,
  depth = -10,
  w = 18,
  settings = {
    speed = { 190, min = 80, max = 400, step = 5, help = "Running speed (pixels a second)" },
    jump_speed = { 580, min = 300, max = 900, step = 10, help = "How hard a jump pushes up (580 is about 112 pixels high)" },
    dash_speed = { 520, min = 200, max = 900, step = 10, help = "How fast a dash is (pixels a second)" },
    hp_max = { 100, min = 10, max = 1000, step = 5, help = "Health (a soldier's shot takes 15, a turret's 20, touching a soldier 30)" },
    lives = { 3, min = 1, max = 30, step = 1, help = "Lives: you lose one when your health runs out or you fall" },
    fire_rate = { 9, min = 2, max = 20, step = 1, help = "Shots a second" },
  },
}

local STAND_H, PRONE_H = 38, 18
local GRAVITY = 1500

function Player:create()
  self.vx, self.vy = 0, 0
  self.h = STAND_H
  self.face, self.t, self.cool, self.inv = 1, 0, 0, 2
  self.dead, self.dead_t = false, 0
  self.gun = "rifle"
  self.score, self.won, self.over = 0, false, false
  self.cx, self.cy = self.x, self.y -- the last checkpoint
  self.prone, self.drop_t, self.cut = false, 0, false
  self.aim_x, self.aim_y, self.flash = 1, 0, 0 -- (the first draw comes before the first update)
  self.dash_t, self.dash_cd, self.dash_dir, self.air_dash = 0, 0, 1, false
  self.hp, self.hurt_t = self.hp_max, 0
end

-- Where the shots go: the eight directions from the stick or D-pad.
local function aim_of(self, mx, my)
  local up, down = my < -0.5, my > 0.5
  local side = (mx > 0.4 and 1) or (mx < -0.4 and -1) or 0
  if side ~= 0 then self.face = side end
  local ax, ay = self.face, 0
  if up and side == 0 then ax, ay = 0, -1
  elseif up then ax, ay = self.face, -1
  elseif down and side ~= 0 then ax, ay = self.face, 1
  elseif down and not self.grounded then ax, ay = 0, 1 end
  local l = sqrt(ax * ax + ay * ay)
  return ax / l, ay / l, side, up, down
end

-- hit by something: lose some health, hop back, flash and cannot be hit again for a moment (like a roll in an action roguelite). At 0 you are down.
-- `from_x` is where it came from, so that you are knocked away from it.
function Player:hurt(damage, from_x)
  if self.dead or self.inv > 0 or self.won or self.dash_t > 0 then return end
  self.hp = self.hp - damage
  if self.hp <= 0 then
    self.hp = 0
    return self:die()
  end
  local away = (self.x >= (from_x or self.x)) and 1 or -1
  self.hurt_t, self.inv = 0.3, 1.2
  self.vx, self.vy, self.grounded, self.cut = away * 230, -300, false, true
  for _ = 1, 8 do nova.spawn("spark", self.x, self.y - 20, { color = { 255, 255, 255 }, size = 4, speed = 160 }) end
  nova.input.rumble(0.6, 0.15)
end

-- falling out of the world (and anything else that takes everything at once)
function Player:kill()
  if self.dead or self.won then return end
  self:die()
end

function Player:die()
  self.dead, self.dead_t = true, 0
  self.lives = self.lives - 1
  for _ = 1, 22 do nova.spawn("spark", self.x, self.y - 18, { color = { 255, 120, 70 }, size = 5, speed = 240 }) end
  nova.input.rumble(1, 0.25)
end

function Player:fire(ax, ay)
  local gx, gy = self.x + ax * 14, self.y - (self.prone and 9 or 24) + ay * 14
  local a = atan2(ay, ax)
  local shots = self.gun == "spread" and { -0.26, 0, 0.26 } or { 0 }
  for _, d in ipairs(shots) do
    nova.spawn("bullet", gx, gy, { dx = cos(a + d), dy = sin(a + d) })
  end
  self.flash = 0.05
end

function Player:update(dt)
  self.t = self.t + dt
  self.cool = math.max(0, self.cool - dt)
  self.inv = math.max(0, self.inv - dt)
  self.drop_t = math.max(0, self.drop_t - dt)
  self.dash_t, self.dash_cd = math.max(0, self.dash_t - dt), math.max(0, self.dash_cd - dt)
  self.hurt_t = math.max(0, self.hurt_t - dt)
  self.flash = math.max(0, (self.flash or 0) - dt)

  if self.over or self.won then
    if nova.input.pressed("start") then nova.restart_scene() end
  end
  if self.dead then
    self.dead_t = self.dead_t + dt
    if self.dead_t > 1.3 then
      if self.lives <= 0 then
        self.over = true
        return
      end
      self.dead, self.x, self.y, self.vx, self.vy, self.inv, self.gun = false, self.cx, self.cy - 120, 0, 0, 2.5, "rifle"
      self.hp, self.hurt_t = self.hp_max, 0
    end
    return
  end

  -- checkpoints passed
  for _, c in ipairs(nova.all("checkpoint")) do
    if self.x > c.x and c.x > self.cx then self.cx, self.cy = c.x, c.y end
  end

  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local hold = nova.input.down("hold")
  local ax, ay, side, up, down = aim_of(self, mx, my)
  self.aim_x, self.aim_y = ax, ay

  -- prone: down on the ground with nothing else pressed
  self.prone = self.grounded and down and side == 0 and not up and not hold
  self.h = self.prone and PRONE_H or STAND_H

  -- running
  if self.hurt_t > 0 then
    -- being knocked back: the push keeps going for a moment, whatever the stick says
  else
    self.vx = (self.prone or hold or self.won) and 0 or side * self.speed
  end

  -- dashing: A. A short burst along the way you face; nothing can hit you in it; one in the air until you land.
  if self.grounded then self.air_dash = false end
  if nova.input.pressed("dash") and self.dash_cd == 0 and not self.prone and not self.won and (self.grounded or not self.air_dash) then
    self.dash_t, self.dash_cd, self.dash_dir = 0.18, 0.6, (side ~= 0 and side or self.face)
    if not self.grounded then self.air_dash = true end
  end
  if self.dash_t > 0 then
    self.vx = self.dash_dir * self.dash_speed
    self.vy = 0
    nova.spawn("spark", self.x, self.y - 20, { color = { 150, 195, 255 }, size = 7, speed = 12 })
  end

  -- jumping: A; down and A on a ledge drops through it. Let go early for a short hop.
  if nova.input.pressed("jump") and self.grounded and not self.won then
    if down then
      self.drop_t, self.y = 0.25, self.y + 2
    else
      self.vy, self.cut = -self.jump_speed, false
    end
  end
  if self.vy < -120 and not nova.input.down("jump") and not self.cut and self.dash_t == 0 then
    self.vy, self.cut = self.vy * 0.45, true
  end

  phys.step(self, dt, GRAVITY, 900)

  if self.y > 640 then self:kill_fall() end

  -- shooting
  if not self.won and nova.input.down("fire") and self.cool == 0 then
    self.cool = 1 / (self.gun == "spread" and self.fire_rate * 0.7 or self.fire_rate)
    self:fire(ax, ay)
  end
end

function Player:kill_fall()
  self:kill()
end

-- (a figure of boxes until there are sprites)
local function box(x, y, w, h, c) rect(floor(x), floor(y), w, h, c) end

function Player:draw()
  if self.dead then return end
  local x, y, f = self.x, self.y, self.face
  local run = (self.vx ~= 0 and self.grounded) and floor(self.t * 12) % 2 or 0
  local skin, shirt, pants = { 240, 200, 160 }, { 70, 110, 220 }, { 60, 60, 90 }
  -- while you cannot be hit you flash white (a quick blink)
  if self.inv > 0 and floor(self.t * 16) % 2 == 0 then skin, shirt, pants = { 255, 255, 255 }, { 255, 255, 255 }, { 235, 235, 245 } end
  if self.prone then
    box(x - 18, y - 12, 34, 10, shirt)
    box(x - 18 * f - 3 + (f > 0 and 36 or 0), y - 14, 8, 8, skin)
    box(x - 14, y - 4, 28, 4, pants)
  else
    box(x - 6 - run * 2, y - 14, 5, 14, pants) -- legs
    box(x + 1 + run * 2, y - 14, 5, 14, pants)
    box(x - 7, y - 28, 14, 15, shirt) -- body
    box(x - 4, y - 38, 9, 10, skin) -- head
    box(x - 4, y - 38, 9, 3, { 150, 40, 40 }) -- headband
  end
  -- the gun, along the aim
  local gy = y - (self.prone and 9 or 22)
  for i = 1, 3 do box(x + self.aim_x * (4 + i * 5) - 2, gy + self.aim_y * (4 + i * 5) - 2, 5, 5, { 40, 40, 50 }) end
  if (self.flash or 0) > 0 then box(x + self.aim_x * 24 - 3, gy + self.aim_y * 24 - 3, 7, 7, { 255, 240, 160 }) end
end

return Player

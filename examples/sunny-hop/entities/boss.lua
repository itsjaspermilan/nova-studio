-- A world's boss, stomped three times. Prop: kind —
--   king_slime  hops at the hero; every hit shakes out two little slimes
--   sand_snail  crawls back and forth; stomped, it rolls round the arena in its shell for a while, then comes out faster
--   frost_block hovers over the hero and slams down; while it rests on the ground its top can be stomped
--   fire_king   hops like the king slime and spits fireballs between hops
-- The level's goal (after_boss = true) appears when it is beaten. Place it by its feet, inside walls.
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local Enemy = require("entities.enemy")

local SIZE = { king_slime = { 110, 84 }, sand_snail = { 120, 92 }, frost_block = { 128, 128 }, fire_king = { 110, 84 } }
local Boss = nova.entity(Enemy, {
  sprite = "boss/king_slime", sx = 0.5, sy = 0.5, kind = "king_slime", hp = 3, max_hp = 3, walker = false, boss = true, depth = 4,
  phase = "intro", timer = 1.6, inv = 0, spins = 0,
})

function Boss:init()
  self.sprite = "boss/" .. self.kind
  local s = SIZE[self.kind] or SIZE.king_slime
  self.bw, self.bh = s[1], s[2]
  self.b.w, self.b.h = self.bw, self.bh
  self.max_hp = self.hp
  self.speed = self.kind == "sand_snail" and 110 or 0
  self.dir = -1
  run.boss = self
end

local function hero() return nova.first("hero") end

function Boss:gravity_move(dt)
  local b = self.b
  b.vy = math.min(1000, b.vy + 2300 * dt)
  world.move(b, b.vx * dt, b.vy * dt, false, true, false)
  if b.hit_x then b.vx = -b.vx * 0.5; self.dir = -self.dir end
  local landed = b.ground and b.vy > 0
  if b.ground then b.vy = 0 end
  self.x, self.y = b.x, b.y
  return landed
end

function Boss:act(dt)
  self.inv = math.max(0, self.inv - dt)
  self.timer = self.timer - dt
  local h = hero()
  local b = self.b
  local angry = self.max_hp - self.hp -- 0, 1, 2: it gets quicker
  if self.phase == "intro" then
    self:gravity_move(dt)
    if self.timer <= 0 then self.phase, self.timer = "wait", 0.5; audio.sfx("boss_roar"); fx.shake(0.4) end
    return
  end
  if self.kind == "king_slime" or self.kind == "fire_king" then
    if self.phase == "wait" then
      b.vx = 0
      self:gravity_move(dt)
      if self.kind == "fire_king" and self.timer < 0.45 and not self.spat then
        self.spat = true
        for k = -1, 1, 2 do
          local s = nova.spawn("spit", self.x, self.y - self.bh * 0.7)
          local tx = h and h.x or self.x
          s.vx, s.vy = (tx - self.x) * 0.9 + k * 70, -560
        end
        audio.sfx("throw", { pitch = 0.7 })
      end
      if self.timer <= 0 then
        local dir = h and (h.x > self.x and 1 or -1) or self.dir
        self.dir = dir
        local dist = h and math.min(math.abs(h.x - self.x), 300) or 200
        b.vx, b.vy = dir * (90 + dist * 0.75), -(820 + angry * 60)
        self.phase, self.squash_x, self.squash_y = "air", 0.75, 1.3
        audio.sfx("jump_high", { pitch = 0.6 })
      end
    else
      if self:gravity_move(dt) then
        self.phase, self.timer, self.spat = "wait", 0.95 - angry * 0.2, false
        self.squash_x, self.squash_y = 1.35, 0.7
        b.vx = 0
        fx.shake(0.45)
        audio.sfx("bump", { pitch = 0.5, volume = 1 })
        fx.dust(self.x - 40, self.y, 8); fx.dust(self.x + 40, self.y, 8)
      end
    end
  elseif self.kind == "sand_snail" then
    if self.phase == "wait" then self.phase = "walk" end
    if self.phase == "walk" then
      b.vx = self.dir * (self.speed + angry * 35)
      self:gravity_move(dt)
      if b.hit_x then self.dir = b.vx > 0 and 1 or -1 end
    elseif self.phase == "shell" then
      b.vx = self.dir * 520
      local vx0 = b.vx
      self:gravity_move(dt)
      if b.hit_x then
        self.dir = -self.dir
        fx.shake(0.25)
        audio.sfx("bump", { pitch = 0.7 })
        fx.dust(self.x - self.dir * 60, self.y - 40, 5)
      end
      if vx0 == 0 then self.dir = 1 end
      if self.timer <= 0 then self.phase, self.squash_y = "walk", 1.3; audio.sfx("boss_roar", { pitch = 1.2 }) end
    end
  elseif self.kind == "frost_block" then
    if self.phase == "wait" then self.phase, self.timer = "hover", 2.0 - angry * 0.4 end
    if self.phase == "hover" then
      local tx = h and h.x or self.x
      self.x = self.x + math.max(-1, math.min(1, (tx - self.x) / 40)) * (170 + angry * 40) * dt
      self.y = self.home_y + math.sin(self.t * 3) * 6
      b.x, b.y, b.vy = self.x, self.y, 0
      if self.timer <= 0 then self.phase, self.timer = "shake", 0.45 end
    elseif self.phase == "shake" then
      self.x = b.x + math.sin(self.t * 70) * 3
      if self.timer <= 0 then self.phase = "slam"; self.x = b.x end
    elseif self.phase == "slam" then
      b.vx = 0
      b.vy = math.min(1300, b.vy + 3200 * dt)
      world.move(b, 0, b.vy * dt, false, false, false)
      self.x, self.y = b.x, b.y
      if b.ground then
        self.phase, self.timer = "rest", 1.7 - angry * 0.25
        fx.shake(0.6)
        audio.sfx("bump", { pitch = 0.45, volume = 1.2 })
        fx.dust(self.x - 50, self.y, 10, { 230, 240, 255, 230 }); fx.dust(self.x + 50, self.y, 10, { 230, 240, 255, 230 })
        self.squash_x, self.squash_y = 1.15, 0.88
      end
    elseif self.phase == "rest" then
      if self.timer <= 0 then self.phase = "rise" end
    elseif self.phase == "rise" then
      self.y = math.max(self.home_y, self.y - 260 * dt)
      b.y = self.y
      if self.y <= self.home_y then self.phase, self.timer = "hover", 2.0 - angry * 0.4 end
    end
  end
end

-- the top is safe to land on (it bounces the hero) except where noted; only some moments let a stomp hurt it
function Boss:vulnerable()
  if self.inv > 0 or self.phase == "intro" then return false end
  if self.kind == "frost_block" then return self.phase == "rest" end
  if self.kind == "sand_snail" then return self.phase == "walk" end
  return true
end
Boss.bounce_top = true

function Boss:predict(dt)
  if self.dead then return nil end
  local b = self.b
  if self.kind == "frost_block" and self.phase == "slam" then return self.x, self.y + 1200 * dt end
  return self.x + b.vx * dt, self.y + math.min(0, b.vy) * dt
end

function Boss:stomp(hero)
  if not self:vulnerable() then
    audio.sfx("bump", { pitch = 1.4 })
    return false
  end
  self.hp = self.hp - 1
  self.inv, self.flash = 1.2, 0.5
  self.squash_x, self.squash_y = 1.5, 0.6
  fx.shake(0.6)
  fx.ring(self.x, self.y - self.bh)
  fx.sparkle(self.x, self.y - self.bh, 12)
  audio.sfx("boss_hit")
  nova.input.rumble(0.6, 0.25)
  if self.hp <= 0 then
    self:defeat()
    return true
  end
  if self.kind == "king_slime" then
    for k = -1, 1, 2 do
      local s = nova.spawn("slime", self.x + k * 70, self.y - 10, { dir = k > 0 and "right" or "left" })
      s.b.vy = -500
    end
  elseif self.kind == "sand_snail" then
    self.phase, self.timer = "shell", 3.2
    self.dir = hero.x > self.x and -1 or 1
  elseif self.kind == "frost_block" then
    self.phase = "rise"
  end
  return true
end

function Boss:defeat()
  self:die(true)
  self.vx_off, self.vy_off = 0, -700
  run.boss_down = true
  run.emit("boss_down")
  audio.sfx("boss_roar", { pitch = 0.8 })
  fx.confetti(self.x, self.y - self.bh, 60)
  for k = 1, 8 do
    local c = nova.spawn("coin", self.x + (k - 4.5) * 30, self.y - self.bh - 20)
    c.base_y = c.y
  end
  -- the little ones go too
  for _, e in ipairs(nova.all("enemy")) do if e ~= self and not e.dead then e:knock(self.x) end end
  for _, s in ipairs(nova.all("spit")) do s:destroy() end
end

function Boss:frame_now()
  if self.kind == "frost_block" then return self.phase == "slam" and 2 or (self.phase == "rest" and 0 or 1) end
  if self.kind == "sand_snail" then return self.phase == "shell" and 3 or 1 + math.floor(self.t * 5) % 2 end
  if self.phase == "air" then return 2 end
  return 1 + math.floor(self.t * 3) % 2
end

function Boss:draw()
  local face = self.dir > 0 and -1 or 1
  local blink = self.inv > 0 and math.floor(self.inv * 14) % 2 == 0
  local h = 144 * self.squash_y
  local spin = (self.kind == "sand_snail" and self.phase == "shell") and self.t * 12 * self.dir or 0
  local yc = self.y - (spin ~= 0 and 46 or 72 * self.squash_y)
  fx.draw(self:picture(), self.x, yc, {
    frame = self:frame_now(), sx = 0.5 * face * self.squash_x, sy = 0.5 * self.squash_y * (self.fly_off and -1 or 1), rotation = spin,
    alpha = (blink and 0.45 or 1) * self.alpha, color = self.flash > 0 and { 255, 150, 150 } or nil,
  })
  if self.kind ~= "frost_block" and spin == 0 and not self.fly_off then
    fx.draw("boss/crown", self.x, self.y - self.bh - 28 * self.squash_y, { sx = 0.6, sy = 0.6, rotation = math.sin(self.t * 2) * 0.08, alpha = self.alpha })
  end
  if self.kind == "frost_block" and self.phase == "rest" then
    fx.draw("fx/glow", self.x, self.y - self.bh - 6, { sx = 2.5, sy = 0.8, color = { 255, 255, 160, 120 + math.floor(math.sin(self.t * 10) * 60) } })
  end
  local _ = h
end

return Boss

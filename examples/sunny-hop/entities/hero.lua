-- Sunny, the hero (spawned by the play scene at the level's start). Moves by lib/hero.lua; here are what it touches and how it looks:
-- squash and stretch, dust, the hurt blink, the walk cycle, and a look at the player when left standing.
local hero = require("lib.hero")
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")

local H = hero.H
local Hero = nova.entity { sprite = "hero", sx = 0.5, sy = 0.5, pivot = { 0.5, 1 }, tags = { "hero" }, depth = -10, velocity = false,
  mode = "play", inv = 0, sqx = 1, sqy = 1, walk_t = 0, idle_t = 0, dust_t = 0, dead_t = 0, combo = 0, frozen = false }

local inp = { x = 0, y = 0, jump = false, jump_pressed = false }

function Hero:create()
  self.b = hero.new(self.x, self.y)
  run.hero = self
end

function Hero:read_input()
  if self.control then return self.control(self) end
  inp.x = nova.input.axis("move_x")
  inp.y = nova.input.axis("move_y")
  inp.jump = nova.input.down("jump")
  inp.jump_pressed = nova.input.pressed("jump")
  return inp
end

local function overlap(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) return ax1 > bx0 and ax0 < bx1 and ay1 > by0 and ay0 < by1 end

function Hero:update(dt)
  self.sqx = self.sqx + (1 - self.sqx) * math.min(1, dt * 14)
  self.sqy = self.sqy + (1 - self.sqy) * math.min(1, dt * 14)
  self.inv = math.max(0, self.inv - dt)
  local b = self.b
  if self.mode == "dying" then
    self.dead_t = self.dead_t + dt
    if self.fall_kind ~= "fall" then
      b.vy = b.vy + 2000 * dt
      b.y = b.y + b.vy * dt
      self.x, self.y = b.x, b.y
    end
    if self.dead_t > (self.fall_kind == "fall" and 0.7 or 1.3) and not self.reported then
      self.reported = true
      run.emit("dead", self.fall_kind)
    end
    return
  end
  if self.mode ~= "play" or self.frozen then return end

  local i = self:read_input()
  local prev_y = b.y
  hero.step(b, i, dt)
  self.x, self.y = b.x, b.y

  for k = 1, b.nev do
    local e = b.ev[k]
    local n = e.name
    if n == "jump" then
      self.sqx, self.sqy = 0.72, 1.3
      audio.sfx("jump", { pitch = 0.96 + math.random() * 0.08 })
      fx.dust(b.x, b.y, 4)
    elseif n == "land" then
      local impact = math.min(1, (e.a or 0) / 900)
      if impact > 0.3 then
        self.sqx, self.sqy = 1 + 0.35 * impact, 1 - 0.3 * impact
        fx.dust(b.x - 12, b.y, 3); fx.dust(b.x + 12, b.y, 3)
        audio.sfx("land", { volume = impact })
      end
      self.combo = 0
    elseif n == "bump" then
      local box = e.a
      if box and box.owner and box.owner.bump then box.owner:bump(self) else audio.sfx("bump", { volume = 0.5, pitch = 1.2 }) end
      self.sqx, self.sqy = 1.15, 0.85
    elseif n == "spring" then
      if e.a and e.a.owner then e.a.owner:boing() end
      self.sqx, self.sqy = 0.65, 1.4
      self.combo = 0
    elseif n == "hurt" then
      self:hurt(b.x - b.face * 10)
    elseif n == "drown" or n == "fall" then
      if n == "drown" then
        audio.sfx("splash")
        fx.dust(b.x, b.y - 10, 10, e.a and { 255, 150, 60, 230 } or { 190, 230, 255, 230 })
      end
      self:die("fall")
      return
    end
  end

  -- skidding and running dust
  self.dust_t = self.dust_t - dt
  if b.ground and self.dust_t <= 0 and math.abs(b.vx) > 140 and b.vx * i.x < 0 then
    fx.dust(b.x - b.face * 8, b.y, 2)
    self.dust_t = 0.07
  end

  -- enemies: a stomp from above, otherwise a hurt
  local hw = b.w * 0.5
  local x0, y0, x1, y1 = b.x - hw, b.y - b.h, b.x + hw, b.y
  for _, e in ipairs(nova.all("enemy")) do
    if not e.dead and self.mode == "play" then
      local ex0, ey0, ex1, ey1 = e:box()
      if overlap(x0 + 3, y0 + 4, x1 - 3, y1, ex0, ey0, ex1, ey1) then
        local from_above = b.vy >= 0 and prev_y <= ey0 + 18
        if from_above and (e.stompable or e.bounce_top) then
          local hit = e:stomp(self)
          b.vy = -(i.jump and H.stomp_hold or H.stomp)
          b.rising, b.ground = i.jump, false
          b.y = math.min(b.y, ey0)
          self.y = b.y
          self.sqx, self.sqy = 0.75, 1.3
          if hit then
            self.combo = self.combo + 1
            fx.shake(0.18 + math.min(0.3, self.combo * 0.05))
            nova.input.rumble(0.3, 0.08)
            if self.combo >= 2 then
              local words = { "Nice!", "Great!", "Super!", "Amazing!", "Sunny!" }
              fx.float(e.x, e.y - 60, words[math.min(#words, self.combo - 1)], { 255, 230, 90 }, 28 + math.min(self.combo, 5) * 3)
            end
          end
          break
        elseif e.harmless and e:harmless() then
          e:kick(b.x)
        else
          self:hurt(e.x)
        end
      end
    end
  end

  -- pickups
  local cx, cy = b.x, b.y - b.h * 0.5
  for _, p in ipairs(nova.all("pickup")) do
    local r = (p.r or 20) + 16
    if math.abs(p.x - cx) < r and math.abs(p.y - cy) < r + b.h * 0.3 then p:collect(self) end
  end
  -- what is touched: locks, switches, checkpoints, the goal
  for _, t in ipairs(nova.all("touch")) do
    local tx0, ty0, tx1, ty1
    if t.zone then tx0, ty0, tx1, ty1 = t:zone() else tx0, ty0, tx1, ty1 = t.x - 26, t.y - 26, t.x + 26, t.y + 26 end
    if overlap(x0 - 4, y0 - 4, x1 + 4, y1 + 2, tx0, ty0, tx1, ty1) then t:touch(self) end
  end

  -- the walk cycle and a glance at the player after standing still a while
  if b.ground and math.abs(b.vx) > 15 then self.walk_t = self.walk_t + math.abs(b.vx) * dt / 95 end
  if b.ground and math.abs(b.vx) < 5 and math.abs(i.x) < 0.1 then self.idle_t = self.idle_t + dt else self.idle_t = 0 end
end

function Hero:hurt(from_x)
  if self.inv > 0 or self.mode ~= "play" then return end
  local left = run.lose_heart()
  audio.sfx("hurt")
  fx.shake(0.4)
  nova.input.rumble(0.5, 0.2)
  if left <= 0 or run.mode == "trial" and false then
    self:die("hurt")
    return
  end
  self.inv = 1.6
  local b = self.b
  b.vx = (b.x < from_x and -1 or 1) * 240
  b.vy, b.rising, b.climbing = -460, false, false
  self.sqx, self.sqy = 1.3, 0.75
end

function Hero:die(kind)
  if self.mode == "dying" then return end
  self.mode, self.fall_kind, self.dead_t, self.reported = "dying", kind, 0, false
  local b = self.b
  b.vy = kind == "fall" and 0 or -760
  b.vx = 0
  self.depth = -100
  if kind ~= "fall" then audio.sfx("fall") end
  nova.input.rumble(0.7, 0.3)
end

-- back to a place (a checkpoint, the start), standing and ready
function Hero:respawn(x, y)
  local b = hero.new(x, y)
  self.b = b
  self.x, self.y = x, y
  self.mode, self.inv, self.depth = "play", 1.2, -10
  self.sqx, self.sqy = 0.6, 1.4
  fx.sparkle(x, y - 30, 10)
end

function Hero:frame_now()
  local b = self.b
  if self.mode == "dying" or self.inv > 1.3 then return 6 end
  if self.mode == "goal" then return self.goal_frame or 1 end
  if b.climbing then return 7 + math.floor(b.y / 22) % 2 end
  if b.duck then return 5 end
  if not b.ground then return 4 end
  if math.abs(b.vx) > 15 then return 2 + math.floor(self.walk_t) % 2 end
  if self.idle_t > 4 then return 1 end
  return 0
end

function Hero:draw()
  local b = self.b
  if self.inv > 0 and self.mode == "play" and math.floor(self.inv * 16) % 2 == 0 then return end
  if self.mode == "dying" and self.fall_kind == "fall" then return end
  local lean = (self.mode == "play" and not b.climbing) and math.max(-0.12, math.min(0.12, b.vx / 2400)) or 0
  if self.mode == "dying" then lean = self.dead_t * 6 end
  local face = b.face
  fx.draw("hero", self.x, self.y - 48 * self.sqy, { frame = self:frame_now(), sx = 0.5 * face * self.sqx, sy = 0.5 * self.sqy, rotation = lean })
end

return Hero

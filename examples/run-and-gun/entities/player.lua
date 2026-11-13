-- The player. D-pad or left stick runs and aims (up, the diagonals, down); B (bottom) jumps (down and B drops through a ledge; in the air B jumps again, once; against a wall B
-- jumps off it); Y (left) or R2 fires; R1 switches between the rifle (long range) and the shotgun (short range); X (the top button) strikes in melee, and a strike also
-- parries: it sends enemy shots back and breaks a lunge; A (right) dashes (a short burst nothing can hit; once in the air); L1 or L2 holds you still to aim. Down on the ground with no
-- direction lies prone. Push towards a wall in the air and you slide down it, still able to shoot out. Up at a ladder climbs it (no gun on a ladder). A hit takes health, knocks you back and
-- flashes you; at 0 health you lose a life and start again at the last checkpoint.
-- The body is drawn from sprites/player.png (one animation for each thing the player does: its tags); the gun is drawn on top of it, from the shoulder.
local phys = require("lib.phys")
local view = require("lib.view")
local rect = view.rect
local sin, cos, atan2, sqrt, floor, abs, max, min = math.sin, math.cos, math.atan, math.sqrt, math.floor, math.abs, math.max, math.min

local Player = nova.entity {
  tags = { "player" },
  velocity = false,
  depth = -10,
  sprite = "player",
  anim = "idle",
  w = 18,
  settings = {
    speed = { 190, min = 80, max = 400, step = 5, help = "Running speed (pixels a second)" },
    jump_speed = { 580, min = 300, max = 900, step = 10, help = "How hard a jump pushes up (580 is about 112 pixels high)" },
    air_jumps = { 1, min = 0, max = 3, step = 1, help = "Jumps you can make in the air (1 is a double jump, 0 turns it off); a wall jump gives them back" },
    coyote_time = { 0.1, min = 0, max = 0.3, step = 0.01, help = "Coyote time: for this many seconds after you run off an edge you can still jump (0 turns it off)" },
    wall_slide_speed = { 80, min = 20, max = 400, step = 5, help = "How fast you slide down a wall (pixels a second)" },
    wall_jump_push = { 240, min = 0, max = 500, step = 10, help = "How hard a wall jump pushes you away from the wall (0 turns the push off)" },
    climb_speed = { 110, min = 40, max = 300, step = 5, help = "How fast you climb a ladder" },
    dash_speed = { 520, min = 200, max = 900, step = 10, help = "How fast a dash is (pixels a second)" },
    knockback = { 140, min = 0, max = 400, step = 10, help = "How hard a hit throws you back (0: not at all; 140 is about 35 pixels back and a small hop)" },
    hp_max = { 100, min = 10, max = 1000, step = 5, help = "Health (a soldier's shot takes 15, a turret's 20, touching a soldier 30)" },
    lives = { 3, min = 1, max = 30, step = 1, help = "Lives: you lose one when your health runs out or you fall" },
    fire_rate = { 13, min = 2, max = 25, step = 1, help = "The rifle: shots a second" },
    melee_damage = { 2, min = 0.5, max = 10, step = 0.5, help = "How much a melee strike hurts (a soldier has 1, a turret 4)" },
    shotgun_interval = { 0.65, min = 0.2, max = 2, step = 0.05, help = "The shotgun: seconds between shots (it is pumped between them)" },
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
  self.coyote = 0
  self.jumps = self.air_jumps -- jumps left in the air
  self.wall, self.wall_dir, self.wall_t, self.sliding = 0, 0, 0, false -- the wall beside you (-1 left, 1 right), the last one you slid on, and a moment's grace to jump off it
  self.lock_t, self.wj_t, self.wj_wall, self.dj_t = 0, 0, 1, 0 -- after a wall jump you cannot steer for a moment; times for the wall jump and double jump pictures
  self.ladder = nil
  self.tag_now = "idle"
  self.melee_t, self.melee_cd, self.melee_hit = 0, 0, {} -- a strike lasts a moment (it is live all that time), then needs a short rest
end

-- Where the shots go: the eight directions from the stick or D-pad. On a wall you face away from it and shoot out. (On a ladder there is no gun: both hands are on it.)
function Player:aim(raw, up, down)
  local side = raw
  if self.sliding then
    self.face = -self.wall
    side = (raw ~= 0) and -self.wall or 0 -- (the stick pushes towards the wall to stay on it: that does not turn the gun into it)
  elseif raw ~= 0 then
    self.face = raw
  end
  if self.ladder then return self.face, 0 end
  local ax, ay = self.face, 0
  if up and side == 0 then ax, ay = 0, -1
  elseif up then ax, ay = self.face, -1
  elseif down and side ~= 0 then ax, ay = self.face, 1
  elseif down and not self.grounded then ax, ay = 0, 1 end
  local l = sqrt(ax * ax + ay * ay)
  return ax / l, ay / l
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
  self.hurt_t, self.inv, self.coyote = (self.knockback > 0) and 0.24 or 0.12, 1.2, 0
  self.ladder, self.sliding = nil, false
  self.vx, self.vy, self.cut = away * self.knockback, -self.knockback * 1.5, true
  if self.knockback > 0 then self.grounded = false end
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
  self.ladder, self.sliding = nil, false
  self.lives = self.lives - 1
  for _ = 1, 22 do nova.spawn("spark", self.x, self.y - 18, { color = { 255, 120, 70 }, size = 5, speed = 240 }) end
  nova.input.rumble(1, 0.25)
end

-- The gun: it is held at the shoulder and points along the aim; the shots start at its muzzle, which is also where the flash is drawn.
local GUN_LEN = 26
function Player:shoulder() return self.x, self.y - (self.prone and 9 or 22) end
function Player:muzzle(ax, ay)
  local sx, sy = self:shoulder()
  return sx + ax * GUN_LEN, sy + ay * GUN_LEN
end

local function wobble(range) return (math.random() * 2 - 1) * range end

-- A shot. The rifle is a little loose: each shot goes a touch higher or lower (about two degrees) and at a touch different speed. The shotgun fires a load of pellets in a
-- cone: each goes its own way, at its own speed, for a short way only, and each hurts a little, so it is strong up close and weak far away.
function Player:fire(ax, ay)
  local gx, gy = self:muzzle(ax, ay)
  local a = atan2(ay, ax)
  if self.gun == "shotgun" then
    for _ = 1, 7 do
      local d = wobble(0.12)
      nova.spawn("bullet", gx, gy + wobble(2), { dx = cos(a + d), dy = sin(a + d), speed = 880 * (0.8 + math.random() * 0.35), life = 0.3 + math.random() * 0.1, damage = 0.8, pellet = true })
    end
    self.flash = 0.09
    -- the pump: the empty hull comes out a moment after the shot
    self:after(0.3, function()
      if not self.dead and not self.ladder then self:eject("shotgun") end
    end)
  else
    local d = wobble(0.035)
    nova.spawn("bullet", gx, gy + wobble(1), { dx = cos(a + d), dy = sin(a + d), speed = 880 * (0.96 + math.random() * 0.08) })
    self.flash = 0.05
    self:eject("rifle")
  end
end

-- A spent shell thrown out of the side of the gun: up and back, a little differently each time.
function Player:eject(kind)
  local shells = nova.all("shell")
  if #shells > 30 then shells[1]:destroy() end -- (never more than about thirty on the floor)
  local sx, sy = self:shoulder()
  nova.spawn("shell", sx + self.aim_x * 7, sy + self.aim_y * 7 - 2, {
    kind = kind,
    vx = -self.face * (35 + math.random() * 70) + self.vx * 0.3,
    vy = -(150 + math.random() * 110),
  })
end

local MELEE_T, MELEE_CD, REACH = 0.26, 0.45, 38

-- The box in front of you that a strike covers: from your side out REACH pixels, the height of the body.
function Player:melee_box()
  local x0 = self.x + self.face * (self.w / 2 - 2)
  local x1 = self.x + self.face * (self.w / 2 + REACH)
  local top = self.y - (self.prone and PRONE_H or STAND_H) + 2
  return min(x0, x1), top, abs(x1 - x0), (self.y - 2) - top
end

-- While a strike is live: it hurts every enemy in the box (each once), and it PARRIES: a shot in the box is sent back the way it came, faster and now hurting enemies;
-- an enemy that is winding up a lunge or lunging is stunned (and a stunned enemy takes double damage).
function Player:strike()
  local bx, by, bw, bh = self:melee_box()
  for _, e in ipairs(nova.all("enemy")) do
    if not self.melee_hit[e] and not e.down and e.x + e.w / 2 > bx and e.x - e.w / 2 < bx + bw and e.y > by and e.y - e.h < by + bh then
      self.melee_hit[e] = true
      local lunging = e.state == "wind" or e.state == "lunge"
      if lunging and e.stun then
        e:stun(1.3, self.face) -- parried: it is stopped, and open for a moment
        self.inv = max(self.inv, 0.3)
        self.score = self.score + 50
        for _ = 1, 10 do nova.spawn("spark", e.x, e.y - 20, { color = { 130, 230, 255 }, size = 5, speed = 200 }) end
        nova.input.rumble(0.7, 0.12)
      else
        e:hurt(self.melee_damage)
        for _ = 1, 5 do nova.spawn("spark", e.x, e.y - 20, { color = { 255, 255, 255 }, size = 4, speed = 160 }) end
        nova.input.rumble(0.4, 0.08)
      end
    end
  end
  for _, b in ipairs(nova.all("ebullet")) do
    if b.x >= bx - 4 and b.x <= bx + bw + 4 and b.y >= by - 4 and b.y <= by + bh + 4 then
      nova.spawn("bullet", b.x, b.y, { dx = -b.dx, dy = -b.dy, speed = 780, damage = 2, reflected = true, life = 1.0 })
      b:destroy()
      self.inv = max(self.inv, 0.3)
      self.score = self.score + 50
      for _ = 1, 8 do nova.spawn("spark", b.x, b.y, { color = { 130, 230, 255 }, size = 4, speed = 180 }) end
      nova.input.rumble(0.7, 0.12)
    end
  end
end

-- which animation (a tag of sprites/player.sprite.json) fits what the player is doing
function Player:tag()
  if self.hurt_t > 0 then return "hurt" end
  if self.melee_t > 0 then return "melee" end
  if self.ladder then return "climb" end
  if self.sliding then return "wall_slide" end
  if self.dash_t > 0 then return "dash" end
  if self.wj_t > 0 then return "wall_jump" end
  if self.dj_t > 0 then return "double_jump" end
  if self.prone then return "prone" end
  if not self.grounded then return self.vy < 0 and "jump" or "fall" end
  if self.vx ~= 0 then return "run" end
  return "idle"
end

function Player:update(dt)
  self.t = self.t + dt
  self.cool = max(-0.02, self.cool - dt) -- (it may go a little below 0: the rest of the step counts towards the next shot, so the rate is as set)
  self.inv = max(0, self.inv - dt)
  self.drop_t = max(0, self.drop_t - dt)
  self.dash_t, self.dash_cd = max(0, self.dash_t - dt), max(0, self.dash_cd - dt)
  self.hurt_t, self.lock_t = max(0, self.hurt_t - dt), max(0, self.lock_t - dt)
  self.melee_t, self.melee_cd = max(0, self.melee_t - dt), max(0, self.melee_cd - dt)
  self.wj_t, self.dj_t, self.wall_t = max(0, self.wj_t - dt), max(0, self.dj_t - dt), max(0, self.wall_t - dt)
  self.flash = max(0, (self.flash or 0) - dt)

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
      self.hp, self.hurt_t, self.jumps = self.hp_max, 0, self.air_jumps
    end
    return
  end

  -- checkpoints passed
  for _, c in ipairs(nova.all("checkpoint")) do
    if self.x > c.x and c.x > self.cx then self.cx, self.cy = c.x, c.y end
  end

  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local hold = nova.input.down("hold")
  local raw = (mx > 0.4 and 1) or (mx < -0.4 and -1) or 0
  local up, down = my < -0.5, my > 0.5
  local jump_pressed = nova.input.pressed("jump") and not self.won

  -- sliding down a wall: in the air, falling, with the stick pushed towards a wall that is beside you
  self.sliding = (not self.ladder) and (not self.grounded) and self.wall ~= 0 and raw == self.wall and self.vy >= 0 and self.dash_t == 0 and self.hurt_t == 0 and self.lock_t == 0
  if self.sliding then self.wall_dir, self.wall_t = self.wall, 0.1 end

  local ax, ay = self:aim(raw, up, down)
  self.aim_x, self.aim_y = ax, ay

  -- ladders: up grabs one you are in front of; down grabs one you are standing on the top of
  local lad = self.ladder
  if lad and not lad:is_alive() then lad = nil end
  if not lad and not hold and not self.won and self.hurt_t == 0 and self.dash_t == 0 then
    for _, l in ipairs(nova.all("ladder")) do
      if abs(self.x - l.x) <= 11 then
        local inside = self.y > l.y + 3 and self.y - 24 < l.y + l.h
        local on_top = self.grounded and abs(self.y - l.y) <= 4
        if (up and inside) or (down and on_top) then
          lad = l
          if on_top then self.y = l.y + 8 end
          break
        end
      end
    end
  end
  self.ladder = lad

  if lad then
    -- climbing: no gravity; up and down move along it; B lets go (with a hop, or a drop with down); the top and the bottom let go by themselves
    self.prone, self.h, self.grounded, self.sliding = false, STAND_H, false, false
    self.x = self.x + (lad.x - self.x) * min(1, 20 * dt)
    self.vx = 0
    self.vy = (up and -1 or (down and 1 or 0)) * self.climb_speed
    self.y = self.y + self.vy * dt
    self.jumps, self.coyote = self.air_jumps, 0
    if jump_pressed then
      self.ladder = nil
      self.vx, self.vy, self.cut = raw * self.speed, down and 0 or -self.jump_speed * 0.6, false
    elseif self.y <= lad.y then
      self.y, self.vy, self.ladder = lad.y, 0, nil -- over the top: you stand on what it leads to
    elseif self.y >= lad.y + lad.h then
      self.y, self.vy, self.ladder = lad.y + lad.h, 0, nil -- the bottom
    end
  else
    -- prone: down on the ground with nothing else pressed
    self.prone = self.grounded and down and raw == 0 and not up and not hold
    self.h = self.prone and PRONE_H or STAND_H

    -- running (not while knocked back, or just after a wall jump: the push keeps going)
    if self.hurt_t > 0 or self.lock_t > 0 then
      -- (nothing: vx is what the hit or the jump gave)
    else
      self.vx = (self.prone or hold or self.won) and 0 or raw * self.speed
    end

    if self.melee_t > 0 then self.vx = self.vx * 0.4 end -- a strike is half a step: you do not run flat out while swinging

    -- dashing: A. A short burst along the way you face; nothing can hit you in it; one in the air until you land.
    if self.grounded then self.air_dash = false end
    if nova.input.pressed("dash") and self.dash_cd == 0 and not self.prone and not self.won and (self.grounded or not self.air_dash) then
      self.dash_t, self.dash_cd, self.dash_dir = 0.18, 0.6, (raw ~= 0 and raw or self.face)
      if not self.grounded then self.air_dash = true end
    end
    if self.dash_t > 0 then
      self.vx = self.dash_dir * self.dash_speed
      self.vy = 0
      nova.spawn("spark", self.x, self.y - 20, { color = { 150, 195, 255 }, size = 7, speed = 12 })
    end

    -- coyote time: standing on something keeps the jump ready, and it stays ready for a moment after you run off the edge
    if self.grounded then self.coyote = self.coyote_time else self.coyote = max(0, self.coyote - dt) end

    -- jumping, B. On the ground (or just off it): a jump, or a drop through a ledge with down. Against a wall (or just off it): a wall jump, up and away from it, and
    -- the air jumps come back. Otherwise, in the air: a double jump, if you have one left. Let go early for a short hop.
    if jump_pressed then
      if self.grounded or self.coyote > 0 then
        if down and self.grounded then
          self.drop_t, self.y = 0.25, self.y + 2
        else
          self.vy, self.cut = -self.jump_speed, false
        end
        self.coyote = 0 -- (one jump for one stretch of ground)
      elseif self.sliding or self.wall_t > 0 then
        local dir = self.sliding and self.wall or self.wall_dir
        self.vy, self.vx, self.cut = -self.jump_speed * 0.95, -dir * self.wall_jump_push, false
        self.face, self.lock_t, self.wj_t, self.wj_wall = -dir, (self.wall_jump_push > 0) and 0.2 or 0, 0.25, dir
        self.jumps, self.sliding, self.wall_t = self.air_jumps, false, 0
        for _ = 1, 5 do nova.spawn("spark", self.x + dir * 8, self.y - 18, { color = { 230, 230, 240 }, size = 3, speed = 70 }) end
      elseif self.jumps > 0 then
        self.jumps = self.jumps - 1
        self.vy, self.cut, self.dj_t = -self.jump_speed * 0.92, false, 0.26
        for _ = 1, 6 do nova.spawn("spark", self.x, self.y - 2, { color = { 170, 210, 255 }, size = 4, speed = 90 }) end
      end
    end
    if self.vy < -120 and not nova.input.down("jump") and not self.cut and self.dash_t == 0 then
      self.vy, self.cut = self.vy * 0.45, true
    end

    phys.step(self, dt, GRAVITY, self.sliding and self.wall_slide_speed or 900)

    -- landing gives the air jumps back; in the air, look for a wall beside you
    if self.grounded then
      self.jumps, self.wall = self.air_jumps, 0
    else
      self.wall = phys.wall_side(self)
    end
  end

  if self.y > 640 then self:kill() end

  -- the weapon: R1 switches between the long-range rifle and the short-range shotgun
  if nova.input.pressed("weapon") and not self.won then
    self.gun = (self.gun == "rifle") and "shotgun" or "rifle"
    self.cool = max(self.cool, 0.15) -- (a moment to bring it up)
  end

  -- melee, X: a strike in front of you (not on a ladder, not while knocked back or dashing). It faces the way you press.
  if nova.input.pressed("melee") and self.melee_cd <= 0 and not self.ladder and self.hurt_t == 0 and self.dash_t == 0 and not self.won then
    self.melee_t, self.melee_cd, self.melee_hit = MELEE_T, MELEE_CD, {}
    if self.sliding then self.face = -self.wall elseif raw ~= 0 then self.face = raw end
    self.cool = max(self.cool, MELEE_T)
  end
  if self.melee_t > 0 then self:strike() end

  -- shooting (on the ground, in the air, on a wall; not on a ladder: both hands are on it)
  if not self.won and not self.ladder and self.melee_t == 0 and nova.input.down("fire") and self.cool <= 0 then
    self.cool = self.cool + (self.gun == "shotgun" and self.shotgun_interval or 1 / self.fire_rate)
    self:fire(ax, ay)
  end

  -- the picture
  local tag = self:tag()
  if tag ~= self.tag_now then
    self.tag_now = tag
    self:play(tag, { restart = true })
  end
  self.anim_speed = (tag == "climb" and self.vy == 0) and 0 or 1
end

local function box(x, y, w, h, c) rect(floor(x), floor(y), w, h, c) end

function Player:draw()
  if self.dead then return end
  local tag = self.tag_now
  -- every picture faces right; turn it round for the other way. On a wall it faces the wall (the hand is on it); a wall jump pushes off it.
  local flip = self.face < 0
  if tag == "wall_slide" then flip = self.wall == -1
  elseif tag == "wall_jump" then flip = self.wj_wall == -1
  elseif tag == "dash" then flip = self.dash_dir < 0 end
  -- while you cannot be hit the picture flashes (a quick blink)
  local blink = (self.inv > 0 and floor(self.t * 16) % 2 == 0) and { 255, 255, 255, 110 } or nil
  view.sprite("player", self.x, self.y - 24, self.frame or 0, flip, blink)
  -- the swish of a strike: a bright crescent in front, there while the strike is live
  if self.melee_t > 0 then
    local k = 1 - self.melee_t / MELEE_T
    local f = self.face
    local px = self.x + f * 12
    local a = floor(230 * (1 - k * 0.7))
    rect(px + f * 6 - (f < 0 and 3 or 0), self.y - 30, 3, 22, { 255, 255, 255, a })
    rect(px + f * 12 - (f < 0 and 3 or 0), self.y - 27, 3, 16, { 200, 235, 255, a })
    rect(px + f * 18 - (f < 0 and 3 or 0), self.y - 22, 3, 8, { 150, 220, 255, a })
  end
  -- the gun, along the aim, from the shoulder to the muzzle (a barrel of little squares close together, so that it is solid at every angle); not when hurt, on a ladder or in a strike
  if tag ~= "hurt" and tag ~= "climb" and tag ~= "melee" then
    local sx, sy = self:shoulder()
    local mx, my = self:muzzle(self.aim_x, self.aim_y)
    for d = 5, GUN_LEN, 3 do box(sx + self.aim_x * d - 2, sy + self.aim_y * d - 2, 4, 4, { 40, 40, 50 }) end
    box(sx + self.aim_x * 7 - 3, sy + self.aim_y * 7 - 3, 6, 6, { 70, 70, 85 }) -- the receiver
    box(mx - 1, my - 1, 3, 3, { 90, 90, 105 }) -- the muzzle
    if (self.flash or 0) > 0 then
      local big = self.gun == "shotgun" and 5 or 3
      box(mx - big, my - big, big * 2 + 1, big * 2 + 1, { 255, 240, 160 })
    end
  end
end

return Player

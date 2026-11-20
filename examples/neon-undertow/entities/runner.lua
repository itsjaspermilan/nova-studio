-- The runner: free movement with a four-way facing, the three-hit baton chain, the dash roll, aim-and-shoot with
-- charge, health with a blink, and the "printed again" beat. Every number is in data/player.lua.
local P = require("data.player")
local J = require("lib.juice")
local C = require("lib.combat")
local A, R, AIM, CH = P.attack, P.roll, P.aim, P.charge

local Runner = nova.entity {
  sprite = "runner", anim = "idle_down",
  tags = { "player" },
  pivot = { 0.5, 0.875 }, hitbox = { -3, -5, 6, 5 },
  sx = 3, sy = 3, velocity = false,
}

function Runner:create()
  self.hp = P.health
  self.charge = CH.pips
  self.state = "free"            -- free | attack | roll | dead
  self.facing = "down"
  self.chain = 0                 -- which hit of the chain the last attack was (0 = none)
  self.chain_window = 0          -- seconds left in which a press continues the chain
  self.f = 0                     -- frames since the attack began
  self.queued = false
  self.roll_t, self.roll_cd = 0, 0
  self.roll_dx, self.roll_dy = 0, 0
  self.untouchable = false
  self.blink_t, self.hurt_t, self.shot_cd, self.dead_t = 0, 0, 0, 0
  self.aiming, self.aim_dx, self.aim_dy = false, 0, 1
  self.moved = 0                 -- how far the last step moved (units), for tests
  self.stats = { baton_hits = 0, shots = 0, clicks = 0, hurt = 0, blocked_by_roll = 0, blocked_by_blink = 0, rolls = 0 }
  nova.spawn("sight", self.x, self.y, { owner = self })
  self.depth = -self.y
end

-- Where a point of the runner's body is (the hips), where swings and shots start.
function Runner:hips() return self.x, self.y - A.hips end

function Runner:move(dx, dy)
  local x, y = self.x, self.y
  self:slide(dx, 0)
  if self:touching("solid") then self.x = x end
  self:slide(0, dy)
  if self:touching("solid") then self.y = y end
  self.moved = math.sqrt((self.x - x) ^ 2 + (self.y - y) ^ 2)
end

function Runner:stick()
  local dx, dy = nova.input.axis("move_x"), nova.input.axis("move_y")
  local len = math.sqrt(dx * dx + dy * dy)
  if len > 1 then dx, dy, len = dx / len, dy / len, 1 end
  return dx, dy, len
end

function Runner:face(dx, dy)
  self.facing = C.four_way(dx, dy, self.facing)
end

function Runner:start_attack()
  self.attack_taken = true
  if self.chain_window > 0 and self.chain < #A.chain then self.chain = self.chain + 1 else self.chain = 1 end
  self.state, self.f, self.queued, self.hit_out = "attack", 0, false, false
  self.aiming = false
  self:play("attack_" .. self.facing, { restart = true })
  nova.log("attack " .. self.chain .. " starts")
end

function Runner:start_roll()
  self.dash_taken = true
  local dx, dy, len = self:stick()
  if len < 0.3 then local v = C.vec[self.facing]; dx, dy = v[1], v[2] else dx, dy = dx / len, dy / len end
  self.roll_dx, self.roll_dy, self.roll_t = dx, dy, 0
  self.state, self.aiming = "roll", false
  self.stats.rolls = self.stats.rolls + 1
  self:face(dx, dy)
  nova.sound.play("roll", { volume = P.sfx.roll })
end

function Runner:fire()
  if self.charge + 1e-6 < CH.shot_cost then
    self.stats.clicks = self.stats.clicks + 1
    nova.sound.play("empty", { volume = P.sfx.empty })
    self.shot_cd = AIM.shot_cooldown
    return
  end
  self.charge = self.charge - CH.shot_cost
  self.stats.shots = self.stats.shots + 1
  local hx, hy = self:hips()
  nova.spawn("shot", hx + self.aim_dx * 22, hy + self.aim_dy * 22, { dx = self.aim_dx, dy = self.aim_dy })
  nova.sound.play("shot", { volume = P.sfx.shot })
  self.shot_cd = AIM.shot_cooldown
end

-- A baton hit landed (called by the swing): the feel, and a third of a pip back.
function Runner:on_baton_hit(target, damage)
  self.stats.baton_hits = self.stats.baton_hits + 1
  self.charge = math.min(CH.pips, self.charge + CH.baton_refund)
  J.stop(A.hitstop_frames)
  J.shake(A.shake, A.shake_frames)
  nova.sound.play("hit", { volume = P.sfx.hit })
  nova.log(string.format("baton hit %d: %d damage", self.chain, damage))
end

function Runner:take_damage(n)
  if self.state == "dead" then return false end
  if self.untouchable then
    self.stats.blocked_by_roll = self.stats.blocked_by_roll + 1
    nova.log(string.format("hit missed: rolling (t %.3f)", self.roll_t))
    return false
  end
  if self.blink_t > 0 then
    self.stats.blocked_by_blink = self.stats.blocked_by_blink + 1
    nova.log("hit missed: blinking")
    return false
  end
  self.hp = math.max(0, self.hp - n)
  self.stats.hurt = self.stats.hurt + 1
  self.blink_t, self.hurt_t, self.aiming = P.blink, 0.18, false
  nova.sound.play("hurt", { volume = P.sfx.hurt })
  J.shake(A.shake * 1.5, 8)
  nova.log(string.format("runner hurt: %d, health %d (%s, roll t %.3f)", n, self.hp, self.state, self.roll_t))
  if self.hp <= 0 then
    self.state, self.dead_t = "dead", 0
    nova.log("printed again")
  end
  return true
end

function Runner:update(dt)
  self.depth = -self.y
  -- presses are remembered for a few frames, so one made during a hit-stop (or just too early) is not lost
  if nova.input.pressed("attack") then self.buf_attack = P.input_buffer_frames end
  if nova.input.pressed("dash") then self.buf_dash = P.input_buffer_frames end
  if J.frozen() then return end

  self.blink_t = math.max(0, self.blink_t - dt)
  self.hurt_t = math.max(0, self.hurt_t - dt)
  self.shot_cd = math.max(0, self.shot_cd - dt)
  self.roll_cd = math.max(0, self.roll_cd - dt)
  self.chain_window = math.max(0, self.chain_window - dt)
  self.moved = 0
  self.alpha = (self.blink_t > 0 and math.floor(self.blink_t * 20) % 2 == 0) and 0.35 or 1

  if self.state == "dead" then
    self.dead_t = self.dead_t + dt
    self.alpha = math.max(0, 1 - self.dead_t / 0.5)
    if self.dead_t >= P.printed_again then nova.restart_scene() end
    return
  end

  local sx, sy, len = self:stick()
  local attack, dash = (self.buf_attack or 0) > 0, (self.buf_dash or 0) > 0
  self.sx, self.sy = 3, 3

  if self.state == "roll" then
    self:update_roll(dt)
  elseif self.state == "attack" then
    self:update_attack(dt, sx, sy, len, dash, attack)
  else
    self:update_free(dt, sx, sy, len, dash, attack)
  end
  self.untouchable = self.state == "roll" and self.roll_t < R.untouchable
  -- (a press that was used is forgotten; the others age)
  if self.state == "roll" then self.buf_attack = 0 end
  if self.attack_taken then self.buf_attack, self.attack_taken = 0, false end
  if self.dash_taken then self.buf_dash, self.dash_taken = 0, false end
  self.buf_attack = math.max(0, (self.buf_attack or 0) - 1)
  self.buf_dash = math.max(0, (self.buf_dash or 0) - 1)
end

function Runner:update_roll(dt)
  local speed = R.distance_tiles * P.tile / R.time
  local step = math.min(dt, R.time - self.roll_t)
  self:move(self.roll_dx * speed * step, self.roll_dy * speed * step)
  self.roll_t = self.roll_t + step
  self.sx, self.sy = 3.5, 2.4 -- squashed low and long
  self:play("walk_" .. self.facing)
  if math.floor(self.roll_t * 60 + 0.5) % 2 == 0 then
    local g = nova.spawn("ghost", self.x, self.y, { sprite = "runner", frame = self.frame, flip_x = self.flip_x, sx = 3, sy = 3, pivot = { 0.5, 0.875 } })
    g.depth = -self.y + 1
  end
  if self.roll_t >= R.time - 1e-6 then
    self.state, self.roll_cd = "free", R.cooldown
    self.untouchable = false
  end
end

function Runner:update_attack(dt, sx, sy, len, dash, attack)
  self.f = self.f + 1
  local startup, active = A.startup_frames, A.active_frames
  local done = startup + active + A.recovery_frames
  if self.f == startup then
    local c = A.chain[self.chain]
    local hx, hy = self:hips()
    nova.spawn("swing", hx, hy, { owner = self, dir = self.facing, damage = c.damage, knockback = c.knockback, area = A.area[c.reach], arc = c.arc, flip = c.flip })
    nova.sound.play("swing", { volume = P.sfx.swing, pitch = 0.95 + 0.08 * self.chain })
  end
  if attack and self.f >= 2 then self.queued, self.attack_taken = true, true end
  -- the end of an attack cancels into a roll (never the other way: a roll cannot be cut short by a swing)
  if dash and self.f >= startup + active and self.roll_cd <= 0 then
    self.chain, self.chain_window = 0, 0
    self:start_roll()
    return
  end
  local mult = A.move_mult
  if mult > 0 and len > 0.1 then self:move(sx * P.walk_speed * mult * dt, sy * P.walk_speed * mult * dt) end
  if self.f >= done then
    if self.queued and self.chain < #A.chain then
      self.chain_window = 1
      self:start_attack()
    else
      self.state = "free"
      self.chain_window = (self.chain < #A.chain) and A.chain_window_frames / 60 or 0
      if self.chain >= #A.chain then self.chain = 0 end
    end
  end
end

function Runner:update_free(dt, sx, sy, len, dash, attack)
  if dash and self.roll_cd <= 0 then
    self:start_roll()
    return
  end
  -- ranged: hold to aim, release to fire
  if nova.input.down("ranged") and self.shot_cd <= 0 then self.aiming = true end
  local mult = 1
  if self.aiming then
    mult = AIM.walk_mult
    if len > AIM.deadzone then self.aim_dx, self.aim_dy = sx / len, sy / len
    else local v = C.vec[self.facing]; self.aim_dx, self.aim_dy = v[1], v[2] end
    self:face(self.aim_dx, self.aim_dy)
    if nova.input.released("ranged") or not nova.input.down("ranged") then
      self.aiming = false
      self:fire()
    end
  elseif attack then
    self:start_attack()
    return
  end
  if len > 0.1 then
    self:move(sx * P.walk_speed * mult * dt, sy * P.walk_speed * mult * dt)
    if not self.aiming then self:face(sx, sy) end
  end
  if self.hurt_t > 0 then self:play("hurt_" .. self.facing)
  elseif len > 0.1 then self:play("walk_" .. self.facing)
  else self:play("idle_" .. self.facing) end
end

return Runner

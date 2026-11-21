-- The runner: free movement with a four-way facing, the three-hit baton chain, the dash roll, aim-and-shoot with
-- charge, health with a blink, and the "printed again" beat. Every number is in data/player.lua.
local P = require("data.player")
local J = require("lib.juice")
local C = require("lib.combat")
local Run = require("lib.run")
local Hits = require("lib.hits")
local V = require("lib.vfx")
local Cards = require("data.cards")
local A, R, AIM, CH = P.attack, P.roll, P.aim, P.charge
local D = A.dash
local N = Cards.num
local OPPOSITE = { left = "right", right = "left", up = "down", down = "up" }

local Runner = nova.entity {
  sprite = "runner", anim = "idle_down",
  tags = { "player" },
  pivot = { 0.5, 0.906 }, hitbox = { -6, -10, 12, 10 },   -- (the detailed sheet: 96 px frames drawn at 1.5; the feet's box is the old one, doubled for the halved scale)
  sx = 1.5, sy = 1.5, velocity = false, shadow = true,
}

function Runner:create()
  -- the run's numbers: health and charge carried in, the maximums the cards changed (lib/run.lua)
  self.max_hp, self.max_charge = Run.max_hp(), Run.max_charge()
  self.hp = math.min(self.max_hp, Run.hp or self.max_hp)
  self.charge = math.min(self.max_charge, Run.charge or self.max_charge)
  self.rolls_used, self.roll_window = 0, 0
  self.zapped = {}
  self.state = "free"            -- free | attack | dashatk (the dash attack) | roll | dead
  self.dash_used, self.roll_attack = false, false   -- the dash attack: one a roll; an attack press made during the roll (the lunge starts as it ends)
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
  self.aim_t, self.slug_ready = 0, false   -- how long ranged has been held (Overpressure)
  self.roll_end, self.slip_t, self.perfect_done, self.rubber_f = -99, 0, false, 0
  -- Old Sal: the first hit in each room is ignored (set again in every room, used once); her bowl in the Den: the first room only
  self.truce = Run.perks.truce == true or (Run.perks.bowl == true and Run.room == 0)
  self.stats = { baton_hits = 0, shots = 0, clicks = 0, hurt = 0, blocked_by_roll = 0, blocked_by_blink = 0, rolls = 0, zaps = 0 }
  nova.spawn("sight", self.x, self.y, { owner = self })
  self.depth = -self.y
end

-- Where a point of the runner's body is (the hips), where swings and shots start.
function Runner:hips() return self.x, self.y - A.hips end

-- The first solid thing the runner overlaps. Shock Wake lets a roll pass through solid enemies (a dummy, a vending machine).
function Runner:solid_hit()
  if not (self.state == "roll" and Run.mods.shock > 0) then return self:touching("solid") end
  for _, o in ipairs(nova.all("solid")) do
    if not o.take_hit and self:overlaps(o) then return o end
  end
  return nil
end

function Runner:move(dx, dy)
  local x, y = self.x, self.y
  self:slide(dx, 0)
  if self:solid_hit() then self.x = x end
  self:slide(0, dy)
  if self:solid_hit() then self.y = y end
  -- (found by the slice-4 soak: a runner standing inside a solid thing (a roll through an enemy that ended there) was pushed out by the engine in
  -- one leap, through the wall and off the map: a step is never longer than it was asked to be)
  if math.abs(self.x - x) + math.abs(self.y - y) > math.abs(dx) + math.abs(dy) + 4 then self.x, self.y = x, y end
  self.moved = math.sqrt((self.x - x) ^ 2 + (self.y - y) ^ 2)
end

-- A roll through an enemy (Shock Wake) can end inside it: step out to the nearest free spot, the way the roll was going first.
-- Is any part of his box on a solid tile? (the tiles are 48 units, his box smaller: its corners and middle tell)
function Runner:in_wall()
  local x0, y0, x1, y1 = self:bounds()
  local mx, my = (x0 + x1) * 0.5, (y0 + y1) * 0.5
  for _, p in ipairs({ { x0 + 0.1, y0 + 0.1 }, { x1 - 0.1, y0 + 0.1 }, { x0 + 0.1, y1 - 0.1 }, { x1 - 0.1, y1 - 0.1 }, { mx, my } }) do
    if nova.solid_at(p[1], p[2]) then return true end
  end
  return false
end

function Runner:unstick()
  if not self:touching("solid") then return end
  local ox, oy = self.x, self.y
  for r = 12, 192, 12 do
    for k = 0, 11 do
      local a = math.atan(self.roll_dy, self.roll_dx) + k / 12 * math.pi * 2
      local x, y = ox + math.cos(a) * r, oy + math.sin(a) * r
      self.x, self.y = x, y
      -- (and not in a wall: no corner of his box on a solid tile. Found by soak 16: the old test, "a step of a unit each way
      -- that the tiles refuse puts him back", took a spot deep inside the bottom wall for free, once the engine stopped throwing
      -- a body that is inside a wall out of it)
      if not self:touching("solid") and not self:in_wall() then
        nova.log(string.format("unstuck from a solid thing: %.0f,%.0f to %.0f,%.0f", ox, oy, x, y))
        return
      end
    end
  end
  self.x, self.y = ox, oy
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

-- How fast the runner walks, as a multiple: Slipstream after a roll, Adrenal below half health.
function Runner:speed_mult()
  local m = 1
  if self.slip_t > 0 then m = m + N.slipstream.mult * Run.mods.slipstream end
  if Run.mods.adrenal > 0 and Hits.low_health(self) then m = m + N.adrenal.share * Run.mods.adrenal end
  return m
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
  self.dash_used, self.roll_attack = false, false
  local dx, dy, len = self:stick()
  if len < 0.3 then local v = C.vec[self.facing]; dx, dy = v[1], v[2] else dx, dy = dx / len, dy / len end
  self.roll_dx, self.roll_dy, self.roll_t = dx, dy, 0
  self.zapped = {}
  self.perfect_done, self.rubber_f = false, 0
  if Run.mods.afterimage > 0 then
    -- Afterimage: a copy stays where the roll began, and enemies go for it
    for _, d in ipairs(nova.all("decoy")) do d:destroy() end
    nova.spawn("afterimage", self.x, self.y, { facing = self.facing, life = N.afterimage.life + N.afterimage.per_copy * (Run.mods.afterimage - 1) })
    nova.log("afterimage left behind")
  end
  self.roll_window = 0
  self.state, self.aiming = "roll", false
  self.stats.rolls = self.stats.rolls + 1
  self:face(dx, dy)
  self:play("roll_" .. self.facing, { restart = true })
  V.dust(self.x, self.y - 2, 4, dx, dy, 52)
  nova.sound.play("roll", { volume = P.sfx.roll })
end

-- The enemy nearest the aim line (in front of the runner), for Smart Round: the smallest distance from the ray, within 640 units.
function Runner:smart_target(dx, dy)
  local best, bd = nil, 1e9
  local hx, hy = self:hips()
  for _, e in ipairs(nova.all("enemy")) do
    if e.state ~= "dead" then
      local ex, ey = e.x - hx, e.y - 14 - hy
      local along = ex * dx + ey * dy
      if along > 0 and along < 640 then
        local off = math.abs(ex * dy - ey * dx)
        if off < bd then best, bd = e, off end
      end
    end
  end
  return best
end

function Runner:fire()
  if self.charge + 1e-6 < CH.shot_cost then
    self.stats.clicks = self.stats.clicks + 1
    nova.sound.play("empty", { volume = P.sfx.empty })
    self.shot_cd = AIM.shot_cooldown
    return
  end
  -- Overpressure: held long enough (and two pips in the magazine) the shot is a slug
  local U = N.slug
  local slug = Run.mods.slug > 0 and self.aim_t >= U.hold and self.charge + 1e-6 >= U.cost
  local cost = slug and U.cost or CH.shot_cost
  self.charge = self.charge - cost
  self.stats.shots = self.stats.shots + 1
  self.aim_t, self.slug_ready = 0, false
  local hx, hy = self:hips()
  local n = slug and 1 or Run.mods.pellets            -- Scatter: a fan of pellets (1 = the plain shot)
  local base = math.atan(self.aim_dy, self.aim_dx)
  local target = Run.mods.smart > 0 and self:smart_target(self.aim_dx, self.aim_dy) or nil
  for i = 1, n do
    local a = base + (i - (n + 1) / 2) * Cards.fan
    local dx, dy = math.cos(a), math.sin(a)
    local dmg = n > 1 and Cards.pellet_damage or AIM.shot_damage
    local props = { dx = dx, dy = dy, damage = Hits.shot_damage(dmg), bounces = Run.mods.bounces, cost = cost / n, smart = target }
    if slug then
      props.damage = Hits.shot_damage(U.damage + U.per_copy * Run.mods.slug)
      props.pierce = U.pierce + Run.mods.slug
      props.slug = true
      props.sx, props.sy = 1.5 * U.scale, 1.5 * U.scale
    end
    nova.spawn("shot", hx + dx * 22, hy + dy * 22, props)
    self.stats.pellets = (self.stats.pellets or 0) + 1
  end
  if slug then self.stats.slugs = (self.stats.slugs or 0) + 1; nova.log("slug fired") end
  nova.sound.play("shot", { volume = P.sfx.shot, pitch = slug and 0.6 or 1 })
  self.shot_cd = AIM.shot_cooldown
end

-- A baton hit landed (called by the swing): the feel, and a third of a pip back.
-- (`dash`: it was the dash attack's slash: a bigger hit-stop and shake, a lower thud on the hit)
function Runner:on_baton_hit(target, damage, chain, fresh, dash)
  self.stats.baton_hits = self.stats.baton_hits + 1
  Hits.last_hit = Hits.clock
  self.charge = math.min(self.max_charge, self.charge + CH.baton_refund)
  J.stop(dash and D.hitstop_frames or A.hitstop_frames)
  J.shake(dash and D.shake or A.shake, dash and D.shake_frames or A.shake_frames)
  nova.sound.play("hit", { volume = P.sfx.hit, pitch = dash and 0.8 or 1 })
  if dash then
    self.stats.dash_hits = (self.stats.dash_hits or 0) + 1
    nova.log(string.format("dash attack hit: %d damage", damage))
  else
    nova.log(string.format("baton hit %d: %d damage", self.chain, damage))
  end
  Hits.after_baton(self, target, chain or self.chain, nil, fresh, damage)
end

function Runner:take_damage(n)
  if self.state == "dead" then return false end
  if self.untouchable then
    self.stats.blocked_by_roll = self.stats.blocked_by_roll + 1
    nova.log(string.format("hit missed: rolling (t %.3f)", self.roll_t))
    -- Phase: an attack that would have landed in the last 0.1 s of the untouchable time is a perfect roll: the enemies' time slows
    if Run.mods.phase > 0 and not self.perfect_done and self.roll_t >= R.untouchable - N.phase.last then
      self.perfect_done = true
      J.slow(N.phase.time)
      self.stats.perfect = (self.stats.perfect or 0) + 1
      nova.sound.play("phase_slow", { volume = P.sfx.phase_slow })
      nova.spawn("fx", self.x, self.y - 30, { sprite = "fx_burst", anim = "burst", scale = 4 })
      nova.log(string.format("perfect roll (t %.3f): time slows for %.1f s", self.roll_t, N.phase.time))
    end
    return false
  end
  if self.truce then
    self.truce = false
    self.blink_t = P.blink
    nova.log("hit ignored: Old Sal's truce")
    return false
  end
  if self.blink_t > 0 then
    self.stats.blocked_by_blink = self.stats.blocked_by_blink + 1
    nova.log("hit missed: blinking")
    return false
  end
  n = n + (Run.mods.overclock > 0 and N.overclock.extra * Run.mods.overclock or 0)    -- (Overclock's cost)
  self.hp = math.max(0, self.hp - n)
  Run.room_hit = true
  self.stats.hurt = self.stats.hurt + 1
  self.blink_t, self.hurt_t, self.aiming = P.blink, 0.18, false
  nova.sound.play("hurt", { volume = P.sfx.hurt })
  J.shake(A.shake * 1.5, 8)
  nova.log(string.format("runner hurt: %d, health %d (%s, roll t %.3f)", n, self.hp, self.state, self.roll_t))
  if self.hp <= 0 and Run.mods.ghost > 0 and not Run.ghost_used then
    -- Ghost in the Shell: once a run, a killing blow leaves you on 1 point, untouchable for 2 s
    Run.ghost_used = true
    self.hp = N.ghost.hp
    self.blink_t = N.ghost.blink
    nova.sound.play("revive", { volume = P.sfx.revive })
    nova.spawn("fx", self.x, self.y - 30, { sprite = "fx_burst", anim = "burst", scale = 5 })
    nova.log("ghost in the shell: left on " .. self.hp)
    return true
  end
  if self.hp <= 0 and (Run.revives or 0) > 0 then
    -- Second Chance (a Workbench upgrade): LULLABY reprints you mid-death, once a run
    Run.revives = Run.revives - 1
    self.hp = math.max(1, self.max_hp // 2)
    self.blink_t = 2.0
    nova.sound.play("revive", { volume = P.sfx.revive })
    nova.spawn("fx", self.x, self.y - 30, { sprite = "fx_burst", anim = "burst", scale = 5 })
    nova.log("second chance: reprinted with " .. self.hp)
    return true
  end
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

  Hits.tick(dt)
  self.slip_t = math.max(0, self.slip_t - dt)
  if Run.mods.regen > 0 then self.charge = math.min(self.max_charge, self.charge + N.regen * Run.mods.regen * dt) end   -- (Red Line)
  self.blink_t = math.max(0, self.blink_t - dt)
  self.hurt_t = math.max(0, self.hurt_t - dt)
  self.shot_cd = math.max(0, self.shot_cd - dt)
  self.roll_cd = math.max(0, self.roll_cd - dt)
  if self.roll_window > 0 then
    self.roll_window = self.roll_window - dt
    if self.roll_window <= 0 then self.rolls_used = 0 end
  end
  self.chain_window = math.max(0, self.chain_window - dt)
  self.moved = 0
  self.alpha = (self.blink_t > 0 and math.floor(self.blink_t * 20) % 2 == 0) and 0.35 or 1

  if self.state == "dead" then
    self.dead_t = self.dead_t + dt
    self.alpha = math.max(0, 1 - self.dead_t / 0.5)
    if self.dead_t >= P.printed_again then
      local scene = nova.scene_now()
      if scene and scene.on_runner_dead then scene:on_runner_dead() else nova.restart_scene() end
    end
    return
  end

  local sx, sy, len = self:stick()
  local attack, dash = (self.buf_attack or 0) > 0, (self.buf_dash or 0) > 0
  self.sx, self.sy = 1.5, 1.5
  self.anim_speed = 1            -- (running and walking set it to keep the feet on the ground: update_free)

  if self.state == "roll" then
    if attack then self.roll_attack = true end
    self:update_roll(dt)
  elseif self.state == "dashatk" then
    self:update_dash_attack(dt, attack)
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
  self:play("roll_" .. self.facing)   -- (the sheet's tumble, 5 frames of 56 ms: the roll's 0.28 s)
  if math.floor(self.roll_t * 60 + 0.5) % 2 == 0 then
    -- (an after-image every other frame, 20 units apart on the 4.2-tile roll, each lasting 0.3 s: the whole path is covered)
    local g = nova.spawn("ghost", self.x, self.y, { sprite = "runner", frame = self.frame, flip_x = self.flip_x, sx = 1.5, sy = 1.5, pivot = { 0.5, 0.906 }, life = 0.3 })
    g.depth = -self.y + 1
  end
  -- Shock Wake: rolling through an enemy zaps it (once per roll)
  if Run.mods.shock > 0 then
    for _, e in ipairs(nova.all("hurtable")) do
      if not self.zapped[e] and self:overlaps(e) then
        self.zapped[e] = true
        Hits.arc(self.x, self.y - 20, e, Run.mods.shock, self.roll_dx, self.roll_dy)
        self.stats.zaps = self.stats.zaps + 1
        nova.sound.play("zap", { volume = P.sfx.zap })
        nova.log("shock wake zaps " .. (e.kind_name or e.name or "enemy"))
      end
    end
  end
  -- Burn Rubber: a trail of fire where the roll went
  if Run.mods.rubber > 0 then
    self.rubber_f = self.rubber_f + 1
    if self.rubber_f % N.rubber.every == 1 then nova.spawn("fire", self.x, self.y, { life = N.rubber.life, friendly = true, quiet = true }) end
  end
  if self.roll_t >= R.time - 1e-6 then
    self.state = "free"
    self.untouchable = false
    self.roll_end = Hits.clock
    V.dust(self.x, self.y - 2, 3, self.roll_dx, self.roll_dy, 44)
    self:unstick()
    if Run.mods.slipstream > 0 then self.slip_t = N.slipstream.time end
    -- Second Wind: more rolls before the wait (the wait starts after the last one; a pause between them also ends the run of rolls)
    self.rolls_used = self.rolls_used + 1
    if self.rolls_used >= Run.mods.rolls then
      self.roll_cd, self.rolls_used = R.cooldown, 0
    else
      self.roll_cd, self.roll_window = 0, R.cooldown
    end
    -- an attack pressed during the roll: the dash attack comes out as it ends
    if self.roll_attack then self:start_dash_attack() end
  end
end

-- The dash attack (attack during a roll, or within D.window seconds after it): a lunge on the way the roll went with a wide, long slash.
-- It costs nothing, is not untouchable, cannot be made twice in one roll, and the normal chain begins again from hit 1 after it.
function Runner:start_dash_attack()
  self.dash_used, self.roll_attack, self.attack_taken = true, false, true
  self.state, self.f, self.queued, self.hit_out, self.aiming = "dashatk", 0, false, false, false
  self.chain, self.chain_window, self.lunge_t = 0, 0, 0
  self.stats.dash_attacks = (self.stats.dash_attacks or 0) + 1
  self:play("dash_attack_" .. self.facing, { restart = true })
  V.dust(self.x, self.y - 2, 4, self.roll_dx, self.roll_dy, 56)
  nova.spawn("streaks", self.x, self.y, { owner = self, dx = self.roll_dx, dy = self.roll_dy })
  nova.sound.play("dash_attack", { volume = P.sfx.dash_attack })
  nova.log("dash attack starts")
end

function Runner:update_dash_attack(dt, attack)
  self.f = self.f + 1
  local lunge_frames = math.ceil(D.time * 60 - 1e-6)
  -- the lunge
  local speed = D.distance_tiles * P.tile / D.time
  local step = math.min(dt, D.time - self.lunge_t)
  if step > 0 then
    self:move(self.roll_dx * speed * step, self.roll_dy * speed * step)
    self.lunge_t = self.lunge_t + step
    if self.f % 2 == 1 then
      local g = nova.spawn("ghost", self.x, self.y, { sprite = "runner", frame = self.frame, flip_x = self.flip_x, sx = 1.5, sy = 1.5, pivot = { 0.5, 0.906 }, life = 0.2 })
      g.depth = -self.y + 1
    end
  end
  -- the slash comes out a few frames in
  if self.f == D.startup_frames then
    local hx, hy = self:hips()
    local area, m = A.area.dash, Run.mods.reach              -- Long Reach: the same single rule as the baton's (the arc is drawn to the box)
    if m ~= 1 then area = { reach = area.reach, length = area.length * m, half_width = area.half_width * m } end
    local rhythm = Hits.rhythm()
    nova.spawn("swing", hx, hy, { owner = self, dir = self.facing, damage = D.damage, knockback = D.knockback, area = area, arc = "heavy", dash = true, chain = 0,
      active_left = D.active_frames, frames_left = D.active_frames + 6, scale_arc = m, rhythm = rhythm })
    -- Backhand: a dash attack is within its 0.4 s too. The slash in front is the dash attack; the hit behind is the ordinary baton swing's, for double damage
    if Run.mods.backhand > 0 and Hits.clock - self.roll_end <= N.backhand_window then
      local c, a = A.chain[1], A.area.short
      if m ~= 1 then a = { reach = a.reach, length = a.length * m, half_width = a.half_width * m } end
      nova.spawn("swing", hx, hy, { owner = self, dir = OPPOSITE[self.facing], damage = c.damage * N.backhand_mult, knockback = 0, area = a, arc = c.arc, flip = true, chain = 1, scale_arc = m, rhythm = rhythm })
      self.stats.backhands = (self.stats.backhands or 0) + 1
      nova.log("backhand swings behind")
    end
  end
  if attack and self.f >= 2 then self.queued, self.attack_taken = true, true end
  if self.f >= lunge_frames + D.recovery_frames then
    self.state = "free"
    self.chain, self.chain_window = 0, 0
    V.dust(self.x, self.y - 2, 3, self.roll_dx, self.roll_dy, 46)
    self:unstick()
    -- (a press made during it: the normal chain, from hit 1)
    if self.queued then self:start_attack() end
  end
end

function Runner:update_attack(dt, sx, sy, len, dash, attack)
  self.f = self.f + 1
  local startup, active = A.startup_frames, A.active_frames
  local done = startup + active + A.recovery_frames
  if self.f == startup then
    local c = A.chain[self.chain]
    local hx, hy = self:hips()
    local area, m = A.area[c.reach], Run.mods.reach            -- Long Reach: the arc is wider and longer
    if m ~= 1 then area = { reach = area.reach, length = area.length * m, half_width = area.half_width * m } end
    local rhythm = Hits.rhythm()                               -- (Metronome: the same answer for both swings below)
    local knock = c.knockback * (c.knockback > 0 and Run.mods.knock or 1)
    nova.spawn("swing", hx, hy, { owner = self, dir = self.facing, damage = c.damage, knockback = knock, area = area, arc = c.arc, flip = c.flip, chain = self.chain, scale_arc = m, rhythm = rhythm })
    nova.sound.play("swing", { volume = P.sfx.swing, pitch = 0.95 + 0.08 * self.chain })
    -- Backhand: a swing within 0.4 s of a roll also hits behind, for double damage
    if Run.mods.backhand > 0 and Hits.clock - self.roll_end <= N.backhand_window then
      nova.spawn("swing", hx, hy, { owner = self, dir = OPPOSITE[self.facing], damage = c.damage * N.backhand_mult, knockback = knock, area = area, arc = c.arc, flip = not c.flip, chain = self.chain, scale_arc = m, rhythm = rhythm })
      self.stats.backhands = (self.stats.backhands or 0) + 1
      nova.log("backhand swings behind")
    end
  end
  if attack and self.f >= 2 then self.queued, self.attack_taken = true, true end
  -- the end of an attack cancels into a roll (never the other way: a roll cannot be cut short by a swing)
  if dash and self.f >= startup + active and self.roll_cd <= 0 then
    self.chain, self.chain_window = 0, 0
    self:start_roll()
    return
  end
  local mult = A.move_mult
  if mult > 0 and len > 0.1 then
    local sm = self:speed_mult()
    self:move(sx * P.run_speed * mult * sm * dt, sy * P.run_speed * mult * sm * dt)
  end
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
  if nova.input.down("ranged") and self.shot_cd <= 0 then
    if not self.aiming then self.aim_t = 0 end
    self.aiming = true
  end
  local mult = 1
  if self.aiming then
    mult = AIM.walk_mult
    self.aim_t = self.aim_t + dt
    -- Overpressure: held this long the sight line goes gold and a tick says the slug is ready
    local ready = Run.mods.slug > 0 and self.aim_t >= N.slug.hold and self.charge + 1e-6 >= N.slug.cost
    if ready and not self.slug_ready then nova.sound.play("slug_ready", { volume = P.sfx.slug_ready }) end
    self.slug_ready = ready
    if len > AIM.deadzone then self.aim_dx, self.aim_dy = sx / len, sy / len
    else local v = C.vec[self.facing]; self.aim_dx, self.aim_dy = v[1], v[2] end
    self:face(self.aim_dx, self.aim_dy)
    if nova.input.released("ranged") or not nova.input.down("ranged") then
      self.aiming = false
      self:fire()
    end
  elseif attack then
    if not self.dash_used and Hits.clock - self.roll_end <= D.window then self:start_dash_attack() else self:start_attack() end
    return
  end
  if not self.aiming then self.aim_t, self.slug_ready = 0, false end
  if len > 0.1 then
    local sm = self:speed_mult()
    self:move(sx * P.run_speed * mult * sm * dt, sy * P.run_speed * mult * sm * dt)
    if not self.aiming then self:face(sx, sy) end
    -- the feet keep step with the ground: the clip plays at (units a second) x (its cycle) / (the ground a cycle covers as drawn), for the run and the walk
    local v = P.run_speed * mult * sm * len
    if self.aiming then self.anim_speed = v * P.walk_cycle / P.walk_stride else self.anim_speed = v * P.run_cycle / P.run_stride end
  end
  -- running (the sheet's run clip: 8 frames of 45 ms at 235 units a second, played at the speed above); while aiming he only walks
  local running = len > 0.1 and not self.aiming
  if running then self:dust_for_run(dt, sx / len, sy / len) else self.run_on = false end
  if self.hurt_t > 0 then self:play("hurt_" .. self.facing)
  elseif running then self:play("run_" .. self.facing)
  elseif len > 0.1 then self:play("walk_" .. self.facing)
  else self:play("idle_" .. self.facing) end
end

-- A small puff at the feet when a run starts and when the runner turns sharply (more than about 110 degrees from where he was heading).
function Runner:dust_for_run(dt, dx, dy)
  local a = math.atan(dy, dx)
  self.turn_cd = math.max(0, (self.turn_cd or 0) - dt)
  if not self.run_on then
    self.run_on, self.run_a = true, a
    V.dust(self.x, self.y - 2, 3, dx, dy, 46)
    self.dust_starts = (self.dust_starts or 0) + 1
    return
  end
  local diff = (a - self.run_a + math.pi) % (2 * math.pi) - math.pi
  if math.abs(diff) > 1.9 and self.turn_cd <= 0 then
    self.turn_cd, self.run_a = 0.25, a
    V.dust(self.x, self.y - 2, 4, dx, dy, 52)
    self.dust_turns = (self.dust_turns or 0) + 1
  else
    -- (the heading the turn is measured from follows the stick a little slower than it moves)
    self.run_a = self.run_a + math.max(-9 * dt, math.min(9 * dt, diff))
  end
end

return Runner

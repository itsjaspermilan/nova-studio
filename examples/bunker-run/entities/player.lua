local state = require("lib.state")
local fx = require("lib.fx")
local Level = require("lib.level")

local cam3 = nova.cam3
local sin, cos, tan, sqrt, max, min, abs = math.sin, math.cos, math.tan, math.sqrt, math.max, math.min, math.abs
local EYE, SPEED = 1.6, 5.6

local Player = nova.entity { tags = { "player" }, hitbox = { r = 0.35, base = 0, height = 1.8 } }

local function approach(v, target, step)
  if v < target then return min(v + step, target) end
  return max(v - step, target)
end

function Player:create()
  self.walk_x, self.walk_z = 0, 0
  self.bob, self.step_t = 0, 0
  self.cool, self.reloading, self.kick = 0, 0, 0
  self.hit_marker, self.hurt_flash = 0, 0
  self.eye = EYE
  cam3.yaw, cam3.pitch = -math.pi / 2, 0 -- facing east, toward the first door
  nova.input.grab_mouse(true)
end

function Player:eye_height() return self.eye + sin(self.bob) * 0.035 end

-- the eye, and the way it looks, as a point and three directions
function Player:basis()
  local sy, cy, sp, cp = sin(cam3.yaw), cos(cam3.yaw), sin(cam3.pitch), cos(cam3.pitch)
  return { self.x, self:eye_height(), self.z }, { -sy * cp, sp, -cy * cp }, { cy, 0, -sy }, { sy * sp, cp, cy * sp }
end

function Player:hurt(amount)
  if state.dead or state.won or state.god then return end
  local soaked = min(state.armor, amount * 0.5)
  state.armor = state.armor - soaked
  state.hp = state.hp - (amount - soaked)
  self.hurt_flash = 0.35
  nova.sound.play("hurt", { volume = 0.7, limit = 2 })
  if state.hp <= 0 then
    state.hp, state.dead = 0, true
    nova.input.grab_mouse(false)
  end
end

local function pellet(self, w, muzzle)
  local yaw = cam3.yaw + (math.random() - 0.5) * 2 * w.spread
  local pitch = cam3.pitch + (math.random() - 0.5) * 2 * w.spread
  local fx_, fz_ = -sin(yaw), -cos(yaw)
  local slope = tan(pitch)
  local ey = self:eye_height()
  local range = 70
  -- what the shot meets first: a wall, the floor, the ceiling, or (nearer than any of them) a creature
  local best, kind, nx, ny, nz = range, nil, 0, 0, 0
  local d, wx, wz = nova.walls.raycast(self.x, self.z, fx_, fz_, range, ey, slope)
  if d then
    best, kind, nx, ny, nz = d, "wall", wx, 0, wz
    if wx == 0 and wz == 0 then ny = slope < 0 and 1 or -1 end
  end
  if slope < -1e-4 and ey / -slope < best then
    best, kind, nx, ny, nz = ey / -slope, "floor", 0, 1, 0
  elseif slope > 1e-4 and (Level.HEIGHT - ey) / slope < best then
    best, kind, nx, ny, nz = (Level.HEIGHT - ey) / slope, "ceiling", 0, -1, 0
  end
  local e, de = nova.raycast(self.x, self.z, fx_, fz_, best, "enemy", { height = ey, slope = slope })
  if e then kind, best = "enemy", de end
  local hx, hy, hz = self.x + fx_ * best, ey + slope * best, self.z + fz_ * best
  if kind == "enemy" then
    e:hurt(w.damage, hx, hy, hz)
    self.hit_marker = 0.12
    fx.sparks(hx, hy, hz, { 255, 70, 50 }, 3, 2.5)
  elseif kind then
    fx.decal(hx, hy, hz, nx, ny, nz, 0.07 + math.random() * 0.04)
    fx.sparks(hx + nx * 0.02, hy, hz + nz * 0.02, { 255, 210, 120 }, 2, 2.2)
  end
  fx.tracer(muzzle[1], muzzle[2], muzzle[3], hx, hy, hz)
end

function Player:fire()
  local w = state.weapons[state.weapon]
  if self.cool > 0 or self.reloading > 0 then return end
  if state.mag[state.weapon] <= 0 then
    nova.sound.play("click", { volume = 0.6 })
    self.cool = 0.3
    self:reload()
    return
  end
  state.mag[state.weapon] = state.mag[state.weapon] - 1
  self.cool = w.cooldown
  self.kick = 1
  cam3.pitch = min(1.4, cam3.pitch + w.kick)
  nova.sound.play(w.name, { volume = 0.9, limit = 3 })
  local eye, f, r, u = self:basis()
  local muzzle = { eye[1] + f[1] * 0.7 + r[1] * 0.2 + u[1] * -0.15, eye[2] + f[2] * 0.7 + u[2] * -0.15, eye[3] + f[3] * 0.7 + r[3] * 0.2 + u[3] * -0.15 }
  fx.flash(muzzle[1], muzzle[2], muzzle[3], { 255, 214, 140 }, 0.06, 10)
  for _ = 1, w.pellets do pellet(self, w, muzzle) end
  -- the noise wakes whoever is near
  nova.each("enemy", function(e)
    local dx, dz = e.x - self.x, e.z - self.z
    if dx * dx + dz * dz < 28 * 28 then e.alert = true end
  end)
end

function Player:reload()
  local w = state.weapons[state.weapon]
  if self.reloading > 0 or state.mag[state.weapon] >= w.mag or state.ammo[w.ammo] <= 0 then return end
  self.reloading = w.reload
  nova.sound.play("reload", { volume = 0.8 })
end

function Player:switch(i)
  if i ~= state.weapon and state.have[i] then
    state.weapon, self.reloading, self.cool = i, 0, 0.25
    nova.sound.play("click", { volume = 0.4, pitch = 0.7 })
  end
end

-- A bot that plays the level, for trying it without hands (F9; F6 for god mode): it goes for the nearest creature it can find,
-- else the key, the red door, the arena and the exit, along the engine's paths, and shoots what it can see.
local function autoplay(self, dt)
  local target, tx, tz
  local e = nova.nearest(self.x, self.z, "enemy", 80)
  -- out of ammunition for what it has: fetch some first
  local low = state.ammo.bullets + state.mag[1] < 8 and not (state.have[2] and state.ammo.shells + state.mag[2] > 0)
  local fetch
  if low then
    local best = 1e9
    nova.each("pickup", function(k)
      local d = (k.x - self.x) ^ 2 + (k.z - self.z) ^ 2
      if (k.kind == "ammo" or k.kind == "shotgun") and d < best then best, fetch = d, k end
    end)
  end
  -- the nearest creature within reach that it can get at: in sight, or with a way to it (not one behind the locked door)
  local close, best_d = nil, 1e9
  for _, c in ipairs(nova.in_radius(self.x, self.z, 25, "enemy", {})) do
    local d = (c.x - self.x) ^ 2 + (c.z - self.z) ^ 2
    if d < best_d and (nova.walls.line_clear(self.x, self.z, c.x, c.z, self:eye_height(), (c.y or 0) + 1.2) or nova.nav.path(self.x, self.z, c.x, c.z)) then
      close, best_d = c, d
    end
  end
  local key
  nova.each("pickup", function(k) if k.kind == "key" then key = k end end)
  if fetch then
    tx, tz = fetch.x, fetch.z
  elseif close then
    target, tx, tz = close, close.x, close.z
  elseif key then
    tx, tz = key.x, key.z -- (the red door needs it)
  elseif state.exit_open then
    local x = nova.first("exit")
    tx, tz = x.x, x.z
  elseif e then
    target, tx, tz = e, e.x, e.z
  else
    tx, tz = Level.width / 2, Level.depth - 8
  end
  if not tx then return 0, 0 end
  local seen = target and nova.walls.line_clear(self.x, self.z, tx, tz, self:eye_height(), (target.y or 0) + 1.2)
  local gx, gz = tx, tz
  if not seen then
    self.bot_repath = (self.bot_repath or 0) - dt
    if self.bot_repath <= 0 or not self.bot_path then
      self.bot_repath = 0.5
      self.bot_path, self.bot_i = nova.nav.path(self.x, self.z, tx, tz), 1
    end
    local wp = self.bot_path and self.bot_path[self.bot_i]
    if wp then
      gx, gz = wp.x, wp.z
      if (wp.x - self.x) ^ 2 + (wp.z - self.z) ^ 2 < 0.5 then self.bot_i = self.bot_i + 1 end
    end
  end
  -- turn toward what it looks at, and fire when it is on it
  local lookx, lookz = (seen and target) and target.x or gx, (seen and target) and target.z or gz
  local want = math.atan(-(lookx - self.x), -(lookz - self.z))
  local diff = (want - cam3.yaw + math.pi) % (2 * math.pi) - math.pi
  cam3.yaw = cam3.yaw + math.max(-6 * dt, math.min(6 * dt, diff))
  if seen and target then
    local dist = sqrt((tx - self.x) ^ 2 + (tz - self.z) ^ 2)
    local pitch_want = math.atan(((target.y or 0) + 1.0 - self:eye_height()) / math.max(dist, 0.5))
    cam3.pitch = cam3.pitch + (pitch_want - cam3.pitch) * min(1, 8 * dt)
    if abs(diff) < 0.12 then self:fire() end
  else
    cam3.pitch = cam3.pitch * (1 - min(1, 5 * dt))
  end
  -- walk toward the goal (not at what it is shooting, unless it is far)
  local dx, dz = gx - self.x, gz - self.z
  local l = sqrt(dx * dx + dz * dz)
  if seen and target and l < 9 then return 0, 0 end
  if l > 0.2 then return dx / l, dz / l end
  return 0, 0
end

function Player:update(dt)
  if state.dead or state.won then return end
  if nova.input.pressed("god") then state.god = not state.god; state.say(state.god and "god mode" or "mortal") end
  if nova.input.pressed("autoplay") then self.bot = not self.bot; state.say(self.bot and "autoplay" or "by hand") end
  self.cool = max(0, self.cool - dt)
  self.kick = max(0, self.kick - dt * 6)
  self.hit_marker = max(0, self.hit_marker - dt)
  self.hurt_flash = max(0, self.hurt_flash - dt)

  -- looking: the mouse, and the right stick
  local ptr = nova.input.pointer()
  cam3.look(-nova.input.axis("look_x") * 2.8 * dt - ptr.dx * 0.0022, -nova.input.axis("look_y") * 2.0 * dt - ptr.dy * 0.0022)

  -- walking: the stick is relative to where the player looks, and the walls stop and guide him
  local fx_, fz_ = cam3.forward()
  local rx, rz = cam3.right()
  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local wx, wz = rx * mx - fx_ * my, rz * mx - fz_ * my
  if self.bot then wx, wz = autoplay(self, dt) end
  local len = sqrt(wx * wx + wz * wz)
  if len > 1 then wx, wz = wx / len, wz / len end
  local accel = 40 * dt
  self.walk_x, self.walk_z = approach(self.walk_x, wx * SPEED, accel), approach(self.walk_z, wz * SPEED, accel)
  local x, z = nova.walls.move(self.x, self.z, self.walk_x * dt, self.walk_z * dt, 0.35)
  local moved = sqrt((x - self.x) ^ 2 + (z - self.z) ^ 2) / dt
  self.x, self.z = x, z
  if moved > 0.5 then
    self.bob = self.bob + moved * dt * 2.1
    self.step_t = self.step_t - moved * dt
    if self.step_t <= 0 then
      self.step_t = 2.1
      nova.sound.play("step", { volume = 0.5, pitch = 0.85 + math.random() * 0.3, limit = 2 })
    end
  end

  -- weapons
  for i = 1, 2 do if nova.input.pressed("weapon_" .. i) then self:switch(i) end end
  if nova.input.pressed("next_weapon") then self:switch(state.weapon % 2 + 1) end
  if nova.input.pressed("prev_weapon") then self:switch((state.weapon + 0) % 2 + 1) end
  if nova.input.pressed("reload") then self:reload() end
  if self.reloading > 0 then
    self.reloading = self.reloading - dt
    if self.reloading <= 0 then
      local w = state.weapons[state.weapon]
      local take = min(w.mag - state.mag[state.weapon], state.ammo[w.ammo])
      state.mag[state.weapon] = state.mag[state.weapon] + take
      state.ammo[w.ammo] = state.ammo[w.ammo] - take
    end
  end
  if nova.input.down("fire") and not self.bot then self:fire() end
  if self.bot and state.mag[state.weapon] <= 0 then self:reload() end
  if self.bot and state.have[2] and state.ammo.shells + state.mag[2] > 0 and state.weapon == 1 then self:switch(2) end

  cam3.first_person({ x = self.x, y = 0, z = self.z }, { height = self:eye_height(), fov = 80 })
end

-- the weapon in hand: boxes in front of the eye, turned with it
function Player:draw()
  if state.dead or not state.weapon then return end
  local eye, f, r, u = self:basis()
  local lower = self.reloading > 0 and sin((1 - self.reloading / state.weapons[state.weapon].reload) * math.pi) * 0.28 or 0
  local kick = self.kick * 0.07
  local bob = sin(self.bob * 0.5) * 0.012
  local function part(lx, ly, lz, w, h, d, color, glow)
    ly, lz = ly - lower + bob, lz - kick
    nova.cuboid_at(
      eye[1] + r[1] * lx + u[1] * ly + f[1] * lz,
      eye[2] + r[2] * lx + u[2] * ly + f[2] * lz,
      eye[3] + r[3] * lx + u[3] * ly + f[3] * lz,
      w, h, d, { ry = cam3.yaw, rx = cam3.pitch + self.kick * 0.06, color = color, glow = glow })
  end
  if state.weapon == 1 then
    part(0.2, -0.17, 0.55, 0.07, 0.09, 0.34, { 50, 54, 62 })
    part(0.2, -0.25, 0.46, 0.06, 0.15, 0.08, { 36, 38, 44 })
    part(0.2, -0.13, 0.72, 0.03, 0.03, 0.04, { 255, 150, 60 }, self.kick > 0.5)
  else
    part(0.17, -0.15, 0.7, 0.06, 0.06, 0.62, { 60, 62, 70 })
    part(0.17, -0.2, 0.62, 0.09, 0.07, 0.22, { 90, 60, 40 })
    part(0.19, -0.22, 0.34, 0.08, 0.12, 0.24, { 90, 60, 40 })
  end
end

return Player

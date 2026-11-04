local state = require("lib.state")
local fx = require("lib.fx")

-- What every creature does: sleep until it sees the player or hears a shot, then go for him by the path round the walls (or straight
-- when it can see him), keep clear of the others, and do what its kind does (see think). Built from boxes.
local Enemy = nova.entity {
  tags = { "enemy" }, hp = 40, speed = 3, radius = 0.45, eye_h = 1.5, sight = 30, close = 12, drop = "none",
}

local sqrt, atan, sin, cos, min, max = math.sqrt, math.atan, math.sin, math.cos, math.min, math.max
local near = {}

function Enemy:create()
  self.mode = self.mode or "idle"
  self.y = self.y or 0
  self.ry = 0
  self.cool = 0.6 + math.random() * 0.6
  self.repath = math.random() * 0.5
  self.phase = math.random() * 6
  self.flash = 0
  self.max_hp = self.hp
  self.speed_now = 0
end

function Enemy:sees(p)
  local dx, dz = p.x - self.x, p.z - self.z
  local d = sqrt(dx * dx + dz * dz)
  if d > self.sight then return false, d end
  return nova.walls.line_clear(self.x, self.z, p.x, p.z, self.y + self.eye_h, p:eye_height()), d
end

function Enemy:update(dt)
  self.flash = max(0, self.flash - dt)
  self.cool = self.cool - dt
  local p = nova.first("player")
  if not p or state.dead or state.won then return end
  local sees, d = self:sees(p)
  if self.mode == "idle" then
    if sees or self.alert then
      self.mode = "chase"
      self:on_wake()
    else
      return
    end
  end
  -- where to go: straight at him when he is in sight and near, else along the path round the walls
  local tx, tz
  if sees and d < self.close then
    tx, tz, self.path = p.x, p.z, nil
  else
    self.repath = self.repath - dt
    if self.repath <= 0 or not self.path then
      self.repath = 0.6 + math.random() * 0.4
      local t0 = nova.clock()
      self.path, self.pi = nova.nav.path(self.x, self.z, p.x, p.z), 1
      local ms = (nova.clock() - t0) * 1000
      state.path_ms, state.path_calls, state.path_worst = state.path_ms + ms, state.path_calls + 1, math.max(state.path_worst, ms)
    end
    local wp = self.path and self.path[self.pi]
    if wp then
      tx, tz = wp.x, wp.z
      if (wp.x - self.x) ^ 2 + (wp.z - self.z) ^ 2 < 0.36 then self.pi = self.pi + 1 end
    end
  end
  local speed = self:wanted_speed(sees, d)
  local vx, vz = 0, 0
  if tx and speed > 0 then
    local dx, dz = tx - self.x, tz - self.z
    local l = sqrt(dx * dx + dz * dz)
    if l > 0.05 then vx, vz = dx / l * speed, dz / l * speed end
  end
  -- keep clear of the others (the engine's grid finds who is near)
  local crowd = nova.in_radius(self.x, self.z, self.radius * 2.2, "enemy", near)
  for i = 1, #crowd do
    local o = crowd[i]
    if o ~= self then
      local ox, oz = self.x - o.x, self.z - o.z
      local od = sqrt(ox * ox + oz * oz)
      if od < self.radius + o.radius and od > 0.001 then vx, vz = vx + ox / od * 2.5, vz + oz / od * 2.5 end
    end
  end
  local moved_x, moved_z = nova.walls.move(self.x, self.z, vx * dt, vz * dt, self.radius, self.y, self.height or 1.8)
  self.speed_now = sqrt((moved_x - self.x) ^ 2 + (moved_z - self.z) ^ 2) / dt
  self.x, self.z = moved_x, moved_z
  self.phase = self.phase + self.speed_now * dt * 2.4
  -- face him when he is in sight, else where it is going
  if sees then self.ry = atan(-(p.x - self.x), -(p.z - self.z)) elseif vx ~= 0 or vz ~= 0 then self.ry = atan(-vx, -vz) end
  self:think(p, sees, d, dt)
end

function Enemy:wanted_speed() return self.speed end
function Enemy:on_wake() end
function Enemy:think() end

function Enemy:hurt(amount, hx, hy, hz)
  self.hp = self.hp - amount
  self.flash = 0.1
  self.alert = true
  if self.hp > 0 then
    nova.sound.play("enemy_hit", { volume = 0.7, pitch = 0.9 + math.random() * 0.3, limit = 4, at = { self.x, self.y + 1, self.z } })
    return
  end
  self:die()
end

function Enemy:die()
  state.kills = state.kills + 1
  nova.sound.play(self.die_sound or "enemy_die", { volume = 0.9, limit = 4, at = { self.x, self.y + 1, self.z } })
  fx.sparks(self.x, self.y + 1, self.z, self.blood or { 255, 80, 60 }, 14, 4)
  fx.flash(self.x, self.y + 1, self.z, { 255, 160, 90 }, 0.12, 8)
  if self.drop == "ammo" and math.random() < 0.5 then nova.spawn("pickup", self.x, 0, { z = self.z, kind = "ammo" }) end
  if self.drop == "health" and math.random() < 0.7 then nova.spawn("pickup", self.x, 0, { z = self.z, kind = "health" }) end
  self:on_death()
  self:destroy()
end

function Enemy:on_death() end

-- a coloured part, whitened for a moment when hit
function Enemy:box(ox, oy, oz, w, h, d, color, glow)
  if self.flash > 0 then color = { 255, 235, 220 } end
  fx.part(self, ox, oy, oz, w, h, d, color, glow)
end

-- A character from the platformer kit (CC0, see licenses/): the model faces +z, a creature's front is -z, and the clip follows what
-- the creature is doing. `scale` is relative to the kit's 0.91 m figure; a hit tints it red-hot for a moment.
function Enemy:figure(model, scale, tint)
  local speed = self.speed_now
  local clip = speed > 3.6 and "sprint" or (speed > 0.3 and "walk" or "idle")
  if clip ~= self.clip then self.clip, self.clip_t = clip, 0 end
  self.clip_t = (self.clip_t or 0) + 1 / 60
  nova.model(model, self.x, self.y, self.z, { scale = scale, ry = self.ry + math.pi, clip = clip, time = self.clip_t + self.phase, tint = self.flash > 0 and { 255, 120, 90 } or tint })
end

return Enemy

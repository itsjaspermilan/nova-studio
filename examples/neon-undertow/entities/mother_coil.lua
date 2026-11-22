-- Mother Coil, the Gutter Market's boss: a scrapyard queen in a crane cab at the top of the arena. Her electromagnet arm drags junk across
-- the floor in lanes, drops cars and slams the magnet where the runner stands (the attack entities: coil_lane, coil_car, coil_magnet).
-- After EACH magnet slam her cable drum is exposed for data/bosses.lua's `drum.window` seconds: that is the only time she takes damage.
-- At half health she magnetises the floor (coil_field) and her pauses shrink. Every number is data/bosses.lua. The room (lib/bossroom.lua)
-- wakes her, draws her bar and name, and pays out when she is gone; `manual = true` stops her choosing attacks (the routes call `cast`).
local B = require("data.bosses").mother_coil
local P = require("data.player")
local J = require("lib.juice")
local F = require("lib.fx")
local V = require("lib.vfx")
local Field = require("lib.field")
local Run = require("lib.run")

local Coil = nova.entity {
  tags = { "hurtable", "solid", "boss", "mother_coil" }, velocity = false, sx = 1, sy = 1, state = "dormant", t = 0, flash = 0,
}

function Coil:create()
  self.kind_name = "mother_coil"
  self.max_hp, self.hp = B.health, B.health
  if Run.mods.open > 0 then
    -- Open Channel: a boss starts at 85% of her health (the bar and the half-health stripes follow the maximum)
    self.hp = math.ceil(B.health * 0.85)
    nova.log("open channel: " .. B.name .. " starts at " .. self.hp .. " of " .. self.max_hp)
  end
  -- (the box reaches a little below the floor's top edge so a shot, which stops at the wall tiles above it, still touches her)
  self.hitbox = { -B.cab.w / 2, -B.cab.h, B.cab.w, B.cab.h + 28 }
  self.depth = -self.y
  local data = nova.scene_data(nova.current_scene())
  self.floor = { x0 = 48, x1 = data.width - 48, y0 = self.y, y1 = data.height - 48 }
  self.open = false
  self.seq_i, self.casts, self.windows, self.clangs, self.lane_casts = 0, 0, 0, 0, 0
  self.lane_dir = -1
  self.idle_for = B.intro
  self.bark_t = 0
  self.phase2 = false
end

function Coil:bark(kind)
  local list = B.barks[kind]
  if not list then return end
  self.bark_text, self.bark_t = list[math.random(#list)], 2.6
  nova.sound.play("boss_bark", { volume = P.sfx.boss_bark })
end

function Coil:wake()
  self.state, self.t = "idle", 0
  self:bark("wake")
  nova.log("mother coil wakes")
end

function Coil:pause_len() return self.phase2 and B.phase2.pause or B.pause end

function Coil:next_attack()
  self.seq_i = self.seq_i % #B.sequence + 1
  return B.sequence[self.seq_i]
end

-- A point of the floor kept off the walls and the doors, for cars.
function Coil:clamp(x, y)
  local f = self.floor
  return math.max(f.x0 + 144, math.min(f.x1 - 144, x)), math.max(f.y0 + 96, math.min(f.y1 - 72, y))
end

function Coil:cast(name)
  self.casts = self.casts + 1
  self.attack, self.state, self.t = name, "cast", 0
  self:bark(name)
  local p = nova.first("player")
  local f = self.floor
  nova.log("mother coil casts " .. name)
  if name == "lanes" then
    local L = B.lanes
    self.lane_casts = self.lane_casts + 1
    self.lane_dir = -self.lane_dir
    local rows = L.layouts[(self.lane_casts - 1) % #L.layouts + 1]
    for i, share in ipairs(rows) do
      nova.spawn("coil_lane", f.x0, f.y0 + share * (f.y1 - f.y0), { dir = self.lane_dir, x0 = f.x0, x1 = f.x1, first = i == 1 })
    end
    self.cast_len = L.tell + (f.x1 - f.x0 + L.length + 160) / L.speed + 0.2
  elseif name == "cars" then
    local C = B.cars
    for k = 1, C.count do
      local x, y = p and p.x or (f.x0 + f.x1) / 2, p and p.y or f.y1 - 200
      if k > 1 then
        local a, d = math.random() * math.pi * 2, C.near + (C.far - C.near) * (0.35 + 0.65 * math.random())
        x, y = x + math.cos(a) * d, y + math.sin(a) * d * 0.8
      end
      x, y = self:clamp(x, y)
      nova.spawn("coil_car", x, y, { delay = (k - 1) * C.gap, first = k == 1 })
    end
    self.cast_len = (C.count - 1) * C.gap + C.tell + 0.9
  elseif name == "slam" then
    local S = B.slam
    nova.spawn("coil_magnet", self.x, f.y0 + 40, { boss = self })
    self.cast_len = S.track + S.lock + S.linger + 0.6
  end
end

function Coil:open_drum()
  self.open, self.state, self.t = true, "window", 0
  self.windows = self.windows + 1
  nova.sound.play("drum_open", { volume = P.sfx.drum_open })
  nova.log(string.format("drum opens (window %d)", self.windows))
end

function Coil:close_drum()
  self.open, self.state, self.t = false, "idle", 0
  self.idle_for = self:pause_len()
  nova.log("drum closes")
end

function Coil:start_phase2()
  self.phase2 = true
  nova.log("phase 2: the floor is magnetised")
  self:bark("phase2")
  nova.spawn("coil_field", 0, 0, { boss = self })
end

function Coil:take_hit(damage, dx, dy, knock)
  if self.state == "dormant" or self.state == "dying" or self.state == "dead" then return false end
  if not self.open then
    self.clangs = self.clangs + 1
    nova.sound.play("drum_clang", { volume = P.sfx.drum_clang, limit = 2, vary = 0.05 })
    F.spark(self.x + (math.random() - 0.5) * B.cab.w * 0.6, self.y - 40, 3)
    nova.log("mother coil: the drum is shut, no damage")
    return false
  end
  self.hp = self.hp - damage
  self.flash = 0.12
  nova.log(string.format("mother coil takes %d (health %d)", damage, math.max(0, self.hp)))
  if self.hp <= 0 then self:die(); return true end
  if math.random() < 0.3 then self:bark("hurt") end
  if not self.phase2 and self.hp <= B.half * self.max_hp then self:start_phase2() end
  return true
end

function Coil:die()
  self.state, self.t, self.open = "dying", 0, false
  self.burst_at = 0
  Field.clear()
  for _, tag in ipairs({ "coil_lane", "coil_car", "coil_magnet", "coil_field" }) do
    for _, e in ipairs(nova.all(tag)) do e:destroy() end
  end
  for _, e in ipairs(nova.all("rat_drone")) do e:take_hit(99, 0, 0, 0) end
  self:bark("die")
  nova.sound.play("boss_die", { volume = P.sfx.boss_die })
  nova.log("mother coil is going down")
end

function Coil:update(dt)
  if J.frozen(self) then return end
  self.flash = math.max(0, self.flash - dt)
  self.bark_t = math.max(0, self.bark_t - dt)
  local s = self.state
  if s == "dormant" or s == "dead" then return end
  self.t = self.t + dt
  if s == "dying" then
    if self.t >= self.burst_at then
      self.burst_at = self.t + 0.09
      local x, y = self.x + (math.random() - 0.5) * B.cab.w, self.y - math.random() * B.cab.h
      V.boom(x, y, 40 + math.random() * 36, { quiet = true, shake = 3 })
      nova.sound.play("boss_burst", { volume = P.sfx.boss_burst, limit = 3, vary = 0.06 })
      J.shake(7, 8)
    end
    if self.t >= B.die.burst then
      V.boom(self.x, self.y - B.cab.h / 2, 190, { shake = 16 })
      J.shake(16, 20)
      self.state = "dead"
      nova.log("mother coil is gone")
      local scene = nova.scene_now()
      if scene and scene.boss_dead then scene:boss_dead() end
      self:destroy()
    end
  elseif s == "idle" then
    if not self.manual and self.t >= self.idle_for then self:cast(self:next_attack()) end
  elseif s == "cast" then
    if self.t >= self.cast_len then self.state, self.t, self.idle_for = "idle", 0, self:pause_len() end
  elseif s == "window" then
    if self.t >= B.drum.window then self:close_drum() end
  end
end

function Coil:draw()
  if self.state == "dead" then return end
  local sx, sy = nova.cam.to_screen(self.x, self.y)
  local tint = self.flash > 0 and { 255, 200, 200 } or { 255, 255, 255 }
  nova.sprite("mother_coil", sx, sy - B.cab.h / 2 - 24, { w = B.cab.w + 48, h = B.cab.h + 96, color = tint })
  nova.light2d(self.x - 100, self.y - 20, { radius = 150, radius_y = 100, color = { 255, 63, 164 }, intensity = 1.8 })
  nova.light2d(self.x + 100, self.y - 20, { radius = 150, radius_y = 100, color = { 53, 230, 255 }, intensity = 1.8 })
  local dx, dy = sx, sy - 36
  if self.open then
    -- the drum glows, pulses and has a marker over it: this is the moment
    local k = 0.5 + 0.5 * math.sin(self.t * 14)
    -- (additive glow: the open drum is the brightest thing in the yard)
    nova.circle(dx, dy, B.drum.w * (0.95 + 0.2 * k), { 6, 240, 255, 120 + 90 * k }, { soft = true, blend = "add", lit = false })
    nova.sprite("crane_arm", dx, dy, { w = B.drum.w * 1.25, h = B.drum.w * 1.25, frame = 0 })
    nova.circle(dx, dy, B.drum.w * 0.45, { 200, 255, 255, 90 + 120 * k }, { soft = true, blend = "add", lit = false })
    nova.light2d(self.x, self.y - 36, { radius = 220, radius_y = 160, color = { 53, 230, 255 }, intensity = 2.8 + k })
    local ay = sy - B.cab.h - 60 + 8 * math.sin(self.t * 10)
    for i = 0, 3 do nova.sprite("solid", dx, ay + i * 8, { w = 44 - i * 12, h = 8, color = { 6, 240, 255 }, blend = "add", lit = false }) end
  else
    nova.sprite("crane_arm", dx, dy, { w = B.drum.w * 1.25, h = B.drum.w * 1.25, frame = 0, color = tint })
  end
end

return Coil

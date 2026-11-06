local state = require("lib.state")
local level = require("lib.level")

local cam3 = nova.cam3
local sin, cos, sqrt, max, min, abs = math.sin, math.cos, math.sqrt, math.max, math.min, math.abs
local RADIUS, HEIGHT = 0.35, 1.7
local WALK, SPRINT, GRAVITY, JUMP = 6, 10, 28, 10
local COYOTE, BUFFER = 0.1, 0.12
local CAM_DIST, CAM_ELEV = 7, 0.4
local STAMINA = 6           -- seconds of climbing (gliding costs 0.7 of a second a second)
local CLIMB_SPEED = 2.6
local GLIDE_SPEED, GLIDE_FALL = 9, 2.4

local CHARACTER = "skater_male" -- one of skater_male, skater_female, criminal, cyborg (Kenney's Animated Characters, CC0)

local Player = nova.entity { tags = { "player" }, velocity = false }

local function approach(v, target, step)
  if v < target then return min(v + step, target) end
  return max(v - step, target)
end

function Player:create()
  self.vx, self.vy, self.vz = 0, 0, 0
  self.ground, self.coyote, self.buffer = false, 0, 0
  self.face, self.slope = math.pi, 0
  self.cam_d = CAM_DIST
  self.step_off = 0 -- how far below the body the picture still is after a hop up a ledge (it eases up)
  self.air_time = 0
  self.mode = "walk"   -- "walk", "climb" or "glide"
  self.stamina = STAMINA
  self.wall, self.wall_age = nil, 9
  cam3.yaw = math.pi
  cam3.eye = { x = self.x, y = self.y + 3, z = self.z - 6 }
  nova.input.grab_mouse(true)
end

function Player:respawn()
  self.x, self.y, self.z = level.start.x, level.start.y, level.start.z
  self.vx, self.vy, self.vz, self.ground, self.mode = 0, 0, 0, false, "walk"
end

-- The bot: walks the route (to the stairs, up them, across to the notch in the cliff and up the path to the flag), jumping when
-- something stops it. In the tests it is also made to climb (it pushes at a wall, which starts a climb) and to glide.
local function autoplay(self)
  self.plan_i = self.plan_i or 1
  local step = (self.route or level.route)[self.plan_i]
  if not step then return 0, 0, false end
  local dx, dz = step.x - self.x, step.z - self.z
  local d = sqrt(dx * dx + dz * dz)
  if d < 1.6 and not self.route_hold then self.plan_i = self.plan_i + 1; return 0, 0, false end
  return dx / d, dz / d, (self.blocked or 0) > 4 and self.mode == "walk" and self.ground
end

local function teleport(self, x, z, y, route, mode)
  self.x, self.z = x, z
  self.y = y or ((nova.solid.floor_below(x, 200, z, 400)) or 0) + 0.2
  self.vx, self.vy, self.vz, self.ground, self.mode = 0, 0, 0, false, "walk"
  self.route, self.plan_i, self.bot, self.bot_script = route, 1, true, mode
  self.stamina, self.wall, self.tired = STAMINA, nil, false
  state.max_height, state.slide_frames, state.climb_time, state.glide_dist, state.glide_time = self.y, 0, 0, 0, 0
  self.start_x, self.start_z = x, z
end

-- tests: F8 puts the player on the hill below the cliff, walking at it; F7 in front of the tower, climbing it; F6 high in the air,
-- gliding; F5 at the foot of the cliff, climbing it
function Player:to_the_cliff() teleport(self, level.peak.x + 26, level.peak.z, nil, { { x = level.peak.x, z = level.peak.z } }, nil) end
-- (F4: the same with no strength left: it cannot climb, so the cliff pushes it back and it slides)
function Player:to_the_cliff_tired() teleport(self, level.peak.x + 26, level.peak.z, nil, { { x = level.peak.x, z = level.peak.z } }, nil); self.tired, self.stamina = true, 0 end
function Player:to_the_tower() teleport(self, level.tower.x, level.tower.z - 5, nil, { { x = level.tower.x, z = level.tower.z } }, "climb") end
function Player:to_the_sky() teleport(self, 0, 0, 24, { { x = -300, z = 300 } }, "glide") end
-- F2: in the air, gliding at the tower: it should grab the wall and climb. F1: climbing the tower and then standing still on it.
function Player:to_the_tower_gliding() teleport(self, level.tower.x, level.tower.z - 28, 16, { { x = level.tower.x, z = level.tower.z } }, "glide") end
function Player:to_the_tower_hanging() teleport(self, level.tower.x, level.tower.z - 5, nil, { { x = level.tower.x, z = level.tower.z } }, "hang"); self.hang_t = 0 end
-- F10: in front of the 0.8 m block (to be jumped onto, not climbed)
function Player:to_the_low_block() teleport(self, 13, 2.2, nil, { { x = 13, z = 9 } }, nil) end
function Player:to_the_cliff_face() teleport(self, level.peak.x + 24, level.peak.z + 0.0, nil, { { x = level.peak.x, z = level.peak.z } }, "climb"); self.route_hold = true end

function Player:update(dt)
  if state.won then return end
  state.time = state.time + dt
  state.message_for = state.message_for - dt
  if nova.input.pressed("autoplay") then self.bot = not self.bot; self.plan_i = nil; state.say(self.bot and "autoplay" or "by hand") end
  if nova.input.pressed("cliff") then self:to_the_cliff() end
  if nova.input.pressed("tower") then self:to_the_tower() end
  if nova.input.pressed("sky") then self:to_the_sky() end
  if nova.input.pressed("cliff_face") then self:to_the_cliff_face() end
  if nova.input.pressed("cliff_tired") then self:to_the_cliff_tired() end
  if nova.input.pressed("glide_wall") then self:to_the_tower_gliding() end
  if nova.input.pressed("hang") then self:to_the_tower_hanging() end
  if nova.input.pressed("low_block") then self:to_the_low_block() end

  local ptr = nova.input.pointer()
  cam3.yaw = cam3.yaw - nova.input.axis("look_x") * 2.8 * dt - ptr.dx * 0.0022
  self.elev = max(0.05, min(1.2, (self.elev or CAM_ELEV) + nova.input.axis("look_y") * 1.6 * dt + ptr.dy * 0.0018))

  local fx_, fz_ = cam3.forward()
  local rx, rz = cam3.right()
  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local wx, wz = rx * mx - fx_ * my, rz * mx - fz_ * my
  local want_jump = nova.input.pressed("jump")
  local jump_held = nova.input.down("jump")
  local sprint = nova.input.down("sprint")
  if self.bot then
    local bx, bz, bj = autoplay(self)
    wx, wz, want_jump, sprint = bx, bz, want_jump or bj, true
    jump_held = true
    -- the hanging test: climb for a second, then stop pushing and just hold on
    if self.bot_script == "hang" and self.mode == "climb" then
      self.hang_t = (self.hang_t or 0) + dt
      if self.hang_t > 1 then wx, wz = 0, 0 end
    end
    -- the glide test: a jump in the air, once
    if self.bot_script == "glide" and self.mode == "walk" and not self.ground and self.air_time > 0.4 and not self.glided then want_jump, self.glided = true, true end
  end
  local len = sqrt(wx * wx + wz * wz)
  if len > 1 then wx, wz = wx / len, wz / len end
  self.wall_age = self.wall_age + dt

  if self.mode == "mantle" then self:mantle(dt)
  elseif self.mode == "climb" then self:climb(dt, wx, wz, len, want_jump)
  elseif self.mode == "glide" then self:glide(dt, wx, wz, len, want_jump)
  else self:walk(dt, wx, wz, len, want_jump, jump_held, sprint) end

  state.max_height = max(state.max_height, self.y)
  if self.y < -20 then state.falls = state.falls + 1; state.say("fell", 1); self:respawn() end
  -- the body hops a 0.3 m step in one frame; what is drawn (and what the camera looks at) eases up it, so a staircase is a smooth climb
  self.step_off = self.step_off * math.exp(-14 * dt)
  self.air_time = (self.ground or self.mode ~= "walk") and 0 or self.air_time + dt
  -- stamina comes back on the ground
  if self.mode == "walk" and self.ground and not self.tired then self.stamina = min(STAMINA, self.stamina + 2.5 * dt) end
  self:aim_camera(dt)
end

function Player:walk(dt, wx, wz, len, want_jump, jump_held, sprint)
  local top = sprint and SPRINT or WALK
  -- on the ground one steers sharply; in the air (and sliding) a little
  local accel = (self.ground and 55 or 18) * dt
  self.vx, self.vz = approach(self.vx, wx * top, accel), approach(self.vz, wz * top, accel)
  if len > 0.1 then
    local want = math.atan(-wx, -wz)
    local diff = (want - self.face + math.pi) % (2 * math.pi) - math.pi
    self.face = self.face + diff * min(1, 14 * dt)
  end

  if want_jump then self.buffer = BUFFER else self.buffer = max(0, self.buffer - dt) end
  if self.ground then self.coyote = COYOTE else self.coyote = max(0, self.coyote - dt) end
  local jumped = false
  if self.buffer > 0 and self.coyote > 0 then
    self.vy, self.buffer, self.coyote, self.ground, self.jumping, jumped = JUMP, 0, 0, false, true, true
    nova.sound.play("jump", { volume = 0.4, limit = 2 })
    state.jumps = (state.jumps or 0) + 1
  end
  -- a jump pressed in the air opens the glider
  if want_jump and not jumped and not self.ground and self.coyote <= 0 and self.air_time > 0.3 and self.stamina > 1 then
    self.mode, self.glide_yaw, self.buffer = "glide", self.face, 0 -- (the press that opened the glider must not be a jump waiting to happen on landing)
    self.glide_start = { x = self.x, z = self.z }
    return
  end
  if self.jumping and self.vy > 0 and not (jump_held or self.bot) then self.vy = self.vy * 0.5; self.jumping = false end
  if not self.ground then self.vy = self.vy - GRAVITY * dt end

  local m = nova.solid.move(self.x, self.y, self.z, RADIUS, HEIGHT, self.vx * dt, self.vy * dt, self.vz * dt)
  local was_air = not self.ground
  self.x, self.y, self.z = m.x, m.y, m.z
  if m.stepped > 0 then state.hops = state.hops + 1; self.step_off = self.step_off - m.stepped end
  -- a wall or a slope too steep to stand on: lose the speed that goes into it (on a slope that leaves the slide)
  self.blocked = 0
  if m.wall then
    local n = m.wall_normal
    local into = self.vx * n.x + self.vy * n.y + self.vz * n.z
    if into < 0 then self.vx, self.vy, self.vz = self.vx - n.x * into, self.vy - n.y * into, self.vz - n.z * into end
    if n.y > 0.05 then state.slide_frames = state.slide_frames + 1 end
    if n.y < 0.6 then self.wall, self.wall_age = { x = n.x, y = n.y, z = n.z }, 0 end   -- something to cling to
    if n.y <= 0.05 then self.blocked = (self.blocked_for or 0) + 1 end
  end
  self.blocked_for = self.blocked
  if m.ceiling and self.vy > 0 then self.vy = 0 end
  if m.ground then
    if was_air and self.vy < -9 then nova.sound.play("land", { volume = 0.4, limit = 2 }) end
    self.vy, self.ground, self.jumping = 0, true, false
    self.slope = m.normal.y
  else
    self.ground = false
  end

  -- cling to a wall: walking at a steep surface, or jumping onto one, starts a climb by itself (pushing at it, with some strength left)
  self.climb_cool = max(0, (self.climb_cool or 0) - dt)
  local low = false
  if self.wall and self.wall_age < 0.15 then
    -- (a floor up to 0.8 m below the feet counts too: a jump that has just cleared the top of a block is still at the wall)
    local lh = self:ledge_ahead(self.wall, 1.7, 0.8)
    low = lh ~= nil -- a block whose top is within a jump of the feet (about 1.8 m) is jumped onto, not climbed
  end
  if self.wall and self.wall_age < 0.15 and not low and self.stamina > 0.3 and not self.tired and self.climb_cool <= 0 and len > 0.1 then
    local pushing = wx * -self.wall.x + wz * -self.wall.z
    if pushing > 0.3 * sqrt(self.wall.x ^ 2 + self.wall.z ^ 2) then
      self.mode, self.cn, self.wall_lost = "climb", self.wall, 0
      self.vx, self.vy, self.vz, self.ground, self.jumping = 0, 0, 0, false, false
    end
  end
end

-- Climbing: gravity is off, the stick moves along the surface (pushing at it is up, pulling away is down), and the clock runs.
function Player:climb(dt, wx, wz, len, want_jump)
  local n = self.cn
  local nl = sqrt(n.x * n.x + n.y * n.y + n.z * n.z)
  n = { x = n.x / nl, y = n.y / nl, z = n.z / nl }
  -- up the surface, and along it (the horizontal direction at right angles to the way the wall faces)
  local ux, uy, uz = -n.x * n.y, 1 - n.y * n.y, -n.z * n.y
  local ul = sqrt(ux * ux + uy * uy + uz * uz)
  ux, uy, uz = ux / ul, uy / ul, uz / ul
  local hl = sqrt(n.x * n.x + n.z * n.z)
  local tx, tz = n.z / max(hl, 1e-4), -n.x / max(hl, 1e-4)
  local lateral = wx * tx + wz * tz
  local vert = (wx * -n.x + wz * -n.z) / max(hl, 1e-4)
  if len < 0.1 then lateral, vert = 0, 0 end
  local s = CLIMB_SPEED
  self.vx = tx * lateral * s + ux * vert * s - n.x * 0.8
  self.vy = uy * vert * s - n.y * 0.8
  self.vz = tz * lateral * s + uz * vert * s - n.z * 0.8
  -- face the wall
  local want = math.atan(n.x, n.z)
  self.face = self.face + ((want - self.face + math.pi) % (2 * math.pi) - math.pi) * min(1, 12 * dt)
  self.climb_effort = (len >= 0.1) and sqrt(lateral * lateral + vert * vert) or 0
  if len >= 0.1 then self.stamina = self.stamina - dt end -- (hanging still is free)
  state.climb_time = (state.climb_time or 0) + dt

  local m = nova.solid.move(self.x, self.y, self.z, RADIUS, HEIGHT, self.vx * dt, self.vy * dt, self.vz * dt)
  self.x, self.y, self.z = m.x, m.y, m.z
  if m.wall then
    local nn = m.wall_normal
    if nn.y < 0.6 then self.cn, self.wall_lost = { x = nn.x, y = nn.y, z = nn.z }, 0 end
  end
  self.wall_lost = (self.wall_lost or 0) + (m.wall and 0 or dt)
  self.ground = false
  -- nothing to hold: the wall has ended under the hands and there is no floor to get up on: let go (and fall), instead of climbing the air
  if self.wall_lost > 0.35 then
    self.mode, self.wall, self.wall_age, self.climb_cool, self.buffer = "walk", nil, 9, 0.5, 0
    self.vx, self.vy, self.vz = 0, 0, 0
    return
  end
  self.ground = false
  -- over the top: no wall under the hands any more while going up, and a floor just ahead at about the height of the hands: get up on it
  local ledge, up = nil, 0
  if vert > 0.3 then ledge, up = self:ledge_ahead(n) end
  -- the hands are on the edge (a real ledge, over a hop above the feet), or the wall has ended under them with a floor near the feet
  if ledge and (up >= 0.4 or self.wall_lost > 0.06) then
    self.mode, self.mantle_t, self.mantle_n, self.mantle_h, self.mantle_y0 = "mantle", 0, n, ledge, self.y
    self.mantle_clip = up < 1.33 and "mantle_low" or "mantle" -- a clip made for each height (a clip for one height looks wrong on another)
    nova.log(string.format("hill: mantle from %.2f to %.2f", self.y, ledge))
    self.vx, self.vz, self.vy = 0, 0, 0
    self.wall, self.wall_age = nil, 9
    state.mantles = (state.mantles or 0) + 1
    if self.anim then self.anim:play(self.mantle_clip, { restart = true }) end
    return
  end
  if m.ground and vert < 0 then self.mode, self.ground = "walk", true; return end
  -- run out of strength (and fall), or jump off the wall (which cannot start another climb at once)
  if self.stamina <= 0 then
    self.mode, self.wall, self.wall_age, self.climb_cool = "walk", nil, 9, 0.6
    self.vx, self.vy, self.vz = 0, 0, 0
    state.say("out of stamina", 1)
  elseif want_jump then
    self.mode, self.wall, self.wall_age, self.climb_cool, self.buffer = "walk", nil, 9, 0.35, 0
    self.vx, self.vz, self.vy = n.x * 6, n.z * 6, 9
    nova.sound.play("jump", { volume = 0.4, limit = 2 })
  end
end

-- Is there somewhere to stand just ahead and above the feet: a floor that faces up, at most 1.55 m higher (about where the hands reach
-- with the arms up: this character's arms are short, so that the climb ends, and the getting up begins, with the hands on the edge)?
-- A `nova.solid.floor_below` probe from above. Returns the floor's height and how far above the feet it is.
function Player:ledge_ahead(n, reach, below)
  reach, below = reach or 1.55, below or 0.15
  local px, pz = self.x - n.x * 0.55, self.z - n.z * 0.55
  local h, nx, ny = nova.solid.floor_below(px, self.y + 3.2, pz, 4.6)
  if h ~= nil and ny > 0.6 and h >= self.y - below and h <= self.y + reach then return h, h - self.y end
  return nil
end

-- Getting up over the top: the body rises to the height of the edge and then moves onto it while the clip plays (0.9 s), no input.
function Player:mantle(dt)
  local n = self.mantle_n
  self.mantle_t = self.mantle_t + dt
  local t = self.mantle_t
  -- up: to the height of the floor (and no higher: smoothly, over the first half second), then onto it
  local rise = min(1, t / 0.65)
  rise = rise * rise * (3 - 2 * rise)
  local want_y = self.mantle_y0 + (self.mantle_h - self.mantle_y0) * rise
  local on = t < 0.5 and 0 or 2.2
  local vy = (want_y - self.y) / dt
  self.vx, self.vz, self.vy = -n.x * on, -n.z * on, vy
  local m = nova.solid.move(self.x, self.y, self.z, RADIUS, HEIGHT, self.vx * dt, self.vy * dt, self.vz * dt)
  self.x, self.y, self.z = m.x, m.y, m.z
  self.face = math.atan(n.x, n.z)
  self.ground = false
  if t >= 1.0 then
    self.mode = "walk"
    self.vx, self.vy, self.vz = -n.x * 1.2, 0, -n.z * 1.2
    self.climb_cool = 0.5
    self.buffer = 0
    self.ground, self.air_time = true, 0 -- standing on the floor it got up on (the animator must not take this for a jump)
  end
end

-- Gliding: a steady speed along the heading, a slow fall, steering with the stick, and the clock runs (slower).
function Player:glide(dt, wx, wz, len, want_jump)
  if len > 0.1 then
    local want = math.atan(-wx, -wz)
    self.glide_yaw = self.glide_yaw + ((want - self.glide_yaw + math.pi) % (2 * math.pi) - math.pi) * min(1, 2.2 * dt)
  end
  local dx, dz = -sin(self.glide_yaw), -cos(self.glide_yaw)
  self.vx, self.vz = approach(self.vx, dx * GLIDE_SPEED, 30 * dt), approach(self.vz, dz * GLIDE_SPEED, 30 * dt)
  self.vy = approach(self.vy, -GLIDE_FALL, 18 * dt)
  self.face = self.glide_yaw
  self.stamina = self.stamina - dt * 0.7
  state.glide_time = (state.glide_time or 0) + dt

  local m = nova.solid.move(self.x, self.y, self.z, RADIUS, HEIGHT, self.vx * dt, self.vy * dt, self.vz * dt)
  self.x, self.y, self.z = m.x, m.y, m.z
  if m.wall then
    local n = m.wall_normal
    -- a wall that is steep enough to hold on to: grab it (the glider folds away)
    -- (not a low block: that is landed on, as when walking)
    local low = self:ledge_ahead(n, 1.7, 0.8) ~= nil
    if n.y < 0.6 and self.stamina > 0.3 and not self.tired and not low then
      self.mode, self.cn, self.wall_lost = "climb", { x = n.x, y = n.y, z = n.z }, 0
      self.vx, self.vy, self.vz, self.ground, self.jumping = 0, 0, 0, false, false
      return
    end
    local into = self.vx * n.x + self.vy * n.y + self.vz * n.z
    if into < 0 then self.vx, self.vy, self.vz = self.vx - n.x * into, self.vy - n.y * into, self.vz - n.z * into end
  end
  state.glide_dist = max(state.glide_dist or 0, sqrt((self.x - (self.glide_start and self.glide_start.x or self.x)) ^ 2 + (self.z - (self.glide_start and self.glide_start.z or self.z)) ^ 2))
  if m.ground or want_jump or self.stamina <= 0 then
    self.mode, self.buffer = "walk", 0
    self.ground = m.ground
    if m.ground then self.vy, self.vx, self.vz = 0, self.vx * 0.5, self.vz * 0.5 end
    if self.stamina <= 0 then state.say("out of stamina", 1) end
  end
end

-- behind and above the player, pulled in where a hill would be in the way
function Player:aim_camera(dt)
  local tx, ty, tz = self.x, self.y + 1.3 + self.step_off, self.z
  local e = self.elev or CAM_ELEV
  local ce, se = cos(e), sin(e)
  local hx, hz = sin(cam3.yaw), cos(cam3.yaw)
  local dx, dy, dz = hx * ce, se, hz * ce
  local want = CAM_DIST
  local d = nova.solid.raycast(tx, ty, tz, dx, dy, dz, CAM_DIST + 0.3)
  if d then want = max(0.9, d - 0.3) end
  if want < self.cam_d then self.cam_d = want else self.cam_d = min(want, self.cam_d + 10 * dt) end
  local ex, ey, ez = tx + dx * self.cam_d, ty + dy * self.cam_d, tz + dz * self.cam_d
  local floor = nova.solid.floor_below(ex, ey + 0.3, ez, 3)
  if floor and ey < floor + 0.5 then ey = floor + 0.5 end
  cam3.eye, cam3.target = { x = ex, y = ey, z = ez }, { x = tx, y = ty, z = tz }
  nova.camera(ex, ey, ez, tx, ty, tz, 65)
end

function Player:draw()
  local x, y, z = self.x, self.y + self.step_off, self.z
  -- (with the sun'"'"'s shadows on, the character casts a real one; the soft round blob is for when they are off)
  local h, nx, ny, nz = nova.solid.floor_below(self.x, self.y + 0.4, self.z, 6)
  if h and not state.shadows then
    local air = max(0, self.y - h)
    nova.quad3(self.x + nx * 0.02, h + ny * 0.02, self.z + nz * 0.02, nx, ny, nz, max(0.6, 1.5 - air * 0.12), { color = { 0, 0, 0, max(60, 190 - air * 20) }, round = true })
  end
  local speed = sqrt(self.vx * self.vx + self.vz * self.vz)
  self.anim = self.anim or nova.animator(CHARACTER, {
    start = "move",
    fade = 0.15,
    states = {
      -- (the kit has idle, run and jump: running at a walk is a slower run; climb and glide are made by scripts/hills/make-clips.mjs)
      move = { blend = "speed", points = { { 0, "idle" }, { 1.5, "run" }, { 6, "run" } } },
      jump = { clip = "jump", loop = false },
      fall = { clip = "jump", loop = false },
      climb = { clip = "climb" },
      glide = { clip = "glide" },
      mantle = { clip = "mantle", loop = false },
      mantle_low = { clip = "mantle_low", loop = false },
    },
  })
  local mode = self.mode
  local playing = (mode == "mantle" and (self.mantle_clip or "mantle")) or (mode == "climb" and "climb") or (mode == "glide" and "glide") or ((self.ground or self.air_time < 0.12) and "move" or (self.vy > 0 and "jump" or "fall"))
  self.anim:play(playing)
  self.anim:set("speed", speed)
  self.anim.speed = mode == "climb" and (self.climb_effort or 0) or (speed > 6 and speed / 6 or math.max(0.6, speed / 6)) -- the run cycle follows the ground speed
  self.anim:update(1 / 60)
  local ry = self.face + math.pi -- (this model faces the other way round from the old one: +z is its back)
  self.anim:draw(x, y, z, { ry = ry })
  if mode == "glide" then
    -- the glider: a canopy above the head on two lines
    local cy = y + 2.7
    nova.cuboid_at(x, cy, z, 3.0, 0.07, 1.7, { ry = self.glide_yaw, color = { 235, 90, 60 } })
    for _, side in ipairs({ -1, 1 }) do
      local sx, sz = cos(self.glide_yaw) * side * 1.3, -sin(self.glide_yaw) * side * 1.3
      nova.line3(x, y + 1.4, z, x + sx, cy, z + sz, { color = { 250, 250, 250 }, width = 0.025 })
    end
  end
end

return Player

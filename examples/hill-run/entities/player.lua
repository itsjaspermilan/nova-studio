local state = require("lib.state")
local level = require("lib.level")

local cam3 = nova.cam3
local sin, cos, tan, sqrt, max, min, abs = math.sin, math.cos, math.tan, math.sqrt, math.max, math.min, math.abs
local RADIUS, HEIGHT = 0.35, 1.7
local WALK, SPRINT, GRAVITY, JUMP = 6, 10, 28, 10
local COYOTE, BUFFER = 0.1, 0.12
local CAM_DIST, CAM_ELEV = 7, 0.4

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
  cam3.yaw = math.pi
  cam3.eye = { x = self.x, y = self.y + 3, z = self.z - 6 }
  nova.input.grab_mouse(true)
end

function Player:respawn()
  self.x, self.y, self.z = level.start.x, level.start.y, level.start.z
  self.vx, self.vy, self.vz, self.ground = 0, 0, 0, false
end

-- The bot: walks the route (to the stairs, up them, across to the notch in the cliff and up the path to the flag), jumping when
-- something stops it.
local function autoplay(self)
  self.plan_i = self.plan_i or 1
  local step = (self.route or level.route)[self.plan_i]
  if not step then return 0, 0, false end
  local dx, dz = step.x - self.x, step.z - self.z
  local d = sqrt(dx * dx + dz * dz)
  if d < 1.6 then self.plan_i = self.plan_i + 1; return 0, 0, false end
  return dx / d, dz / d, (self.blocked or 0) > 4
end

-- (a test of the cliff: F8 puts the player on the hill below it, and the bot then walks straight at the cliff)
function Player:to_the_cliff()
  local x, z = level.peak.x + 26, level.peak.z
  local h = nova.solid.floor_below(x, 100, z, 200)
  self.x, self.y, self.z = x, (h or 0) + 0.2, z
  self.vx, self.vy, self.vz, self.ground = 0, 0, 0, false
  self.route, self.plan_i, self.bot = { { x = level.peak.x, z = level.peak.z } }, 1, true
  state.max_height, state.slide_frames = self.y, 0
end

function Player:update(dt)
  if state.won then return end
  if nova.input.pressed("cliff") then self:to_the_cliff() end
  state.time = state.time + dt
  state.message_for = state.message_for - dt
  if nova.input.pressed("autoplay") then self.bot = not self.bot; self.plan_i = nil; state.say(self.bot and "autoplay" or "by hand") end

  local ptr = nova.input.pointer()
  cam3.yaw = cam3.yaw - nova.input.axis("look_x") * 2.8 * dt - ptr.dx * 0.0022
  self.elev = max(0.05, min(1.2, (self.elev or CAM_ELEV) + nova.input.axis("look_y") * 1.6 * dt + ptr.dy * 0.0018))

  local fx_, fz_ = cam3.forward()
  local rx, rz = cam3.right()
  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local wx, wz = rx * mx - fx_ * my, rz * mx - fz_ * my
  local want_jump = nova.input.pressed("jump")
  local sprint = nova.input.down("sprint")
  if self.bot then
    local bx, bz, bj = autoplay(self)
    wx, wz, want_jump, sprint = bx, bz, want_jump or bj, true
  end
  local len = sqrt(wx * wx + wz * wz)
  if len > 1 then wx, wz = wx / len, wz / len end
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
  if self.buffer > 0 and self.coyote > 0 then
    self.vy, self.buffer, self.coyote, self.ground, self.jumping = JUMP, 0, 0, false, true
    nova.sound.play("jump", { volume = 0.4, limit = 2 })
  end
  if self.jumping and self.vy > 0 and not (nova.input.down("jump") or self.bot) then self.vy = self.vy * 0.5; self.jumping = false end
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
    if n.y > 0.05 then state.slide_frames = state.slide_frames + 1 else self.blocked = (self.blocked_for or 0) + 1 end
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
  state.max_height = max(state.max_height, self.y)

  if self.y < -20 then state.falls = state.falls + 1; state.say("fell", 1); self:respawn() end
  -- the body hops a 0.3 m step in one frame; what is drawn (and what the camera looks at) eases up it, so a staircase is a smooth climb
  self.step_off = self.step_off * math.exp(-14 * dt)
  self.air_time = self.ground and 0 or self.air_time + dt
  self:aim_camera(dt)
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
  -- a soft round shadow on whatever is underneath, flat to it, smaller and fainter the higher the feet are
  local h, nx, ny, nz = nova.solid.floor_below(self.x, self.y + 0.4, self.z, 6)
  if h then
    local air = max(0, self.y - h)
    nova.quad3(self.x + nx * 0.02, h + ny * 0.02, self.z + nz * 0.02, nx, ny, nz, max(0.6, 1.5 - air * 0.12), { color = { 0, 0, 0, max(60, 190 - air * 20) }, round = true })
  end
  local speed = sqrt(self.vx * self.vx + self.vz * self.vz)
  self.anim = self.anim or nova.animator("character-oobi", {
    start = "move",
    fade = 0.15,
    states = {
      move = { blend = "speed", points = { { 0, "idle" }, { 2.2, "walk" }, { 5.5, "sprint" } } },
      jump = { clip = "jump", loop = false },
      fall = { clip = "fall" },
    },
  })
  -- (a hop up a step is a frame or three with no ground under the middle of the body: not a fall)
  self.anim:play((self.ground or self.air_time < 0.12) and "move" or (self.vy > 0 and "jump" or "fall"))
  self.anim:set("speed", speed)
  self.anim:update(1 / 60)
  self.anim:draw(x, y, z, { scale = 1.8, ry = self.face + math.pi })
end

return Player

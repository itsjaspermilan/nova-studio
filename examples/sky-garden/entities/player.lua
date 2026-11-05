local state = require("lib.state")
local Level = require("lib.level")

local cam3 = nova.cam3
local sin, cos, tan, sqrt, max, min, abs = math.sin, math.cos, math.tan, math.sqrt, math.max, math.min, math.abs
local HW, HEIGHT = 0.35, 1.6
local SPEED, GRAVITY, JUMP = 6.5, 30, 11
local COYOTE, BUFFER = 0.1, 0.12
local CAM_DIST, CAM_ELEV = 6.5, 0.42

local Player = nova.entity { tags = { "player" }, velocity = false }

local function approach(v, target, step)
  if v < target then return min(v + step, target) end
  return max(v - step, target)
end

function Player:create()
  self.vx, self.vy, self.vz = 0, 0, 0
  self.ground, self.coyote, self.buffer = nil, 0, 0
  self.face, self.walk_phase, self.land_squash = -math.pi / 2, 0, 0
  self.cam_d = CAM_DIST
  cam3.yaw = -math.pi / 2 -- facing east, toward the stairs
  cam3.eye = { x = self.x + 6.5, y = 3, z = self.z }
  nova.input.grab_mouse(true)
end

function Player:respawn()
  local r = state.respawn
  self.plan_i = nil
  self.x, self.y, self.z = r.x, r.y, r.z
  self.vx, self.vy, self.vz, self.ground = 0, 0, 0, nil
end

-- The bot: a list of places to go. It walks at the next one, jumps at edges, steps and little patrollers, and waits where a
-- platform has to come round first (it looks ahead at where the platform will be).
local AHEAD = 1.1 -- seconds from deciding to being there, for a jump across a gap
local function platform(kind)
  local found
  nova.each("platform", function(p) if p.kind == kind then found = p end end)
  return found
end
local function x_ahead(kind, dt) local p = platform(kind); return (Level.platform_at(kind, p.t + (dt or AHEAD))) end
local function top_ahead(kind, dt) local p = platform(kind); local _, top = Level.platform_at(kind, p.t + (dt or AHEAD)); return top end

-- { x, z }: walk there. { board = kind, ready }: wait for the platform to come near, then get on it.
-- { ride = kind, ready }: stay on it until it is near where it goes next.
local PLAN = {
  { x = 2, z = 0 }, { x = 15, z = 0 }, { x = 16.4, z = 0 },
  { board = "slide", zone = 30, ready = function() return x_ahead("slide") <= 22.6 end },
  { ride = "slide", zone = 30, ready = function() return x_ahead("slide", 0.1) >= 27.4 end },
  { x = 34, z = 0 }, { x = 43, z = 0 }, { x = 46, z = 0 }, { x = 50.4, z = 0 },
  { board = "lift", zone = 58, ready = function() return top_ahead("lift") <= 3.9 end },
  { ride = "lift", zone = 58, ready = function() return top_ahead("lift", 0.2) >= 6.0 end },
  { x = 61, z = 0 }, { x = 63, z = 2 }, { x = 65, z = 0 },
}

local function restart_plan(self)
  -- after a fall: start again from the nearest place that the respawn point has got past
  local best = 1
  for i, step in ipairs(PLAN) do if step.x and step.x <= self.x + 0.01 then best = i + 1 end end
  while PLAN[best] and PLAN[best].zone and self.x >= PLAN[best].zone do best = best + 1 end
  for _, step in ipairs(PLAN) do step.go = nil end
  return best
end

local function autoplay(self, dt)
  self.plan_i = self.plan_i or restart_plan(self)
  local step = PLAN[self.plan_i]
  if not step then
    -- the plan is done: the flag wants more gems, so gather the ones left on this island
    local best, bd = nil, 144
    nova.each("gem", function(g)
      local gx, gz = g.x - self.x, g.z - self.z
      local d = gx * gx + gz * gz
      if d < bd and g.gy > self.y + 0.2 and g.gy < self.y + 2.6 then best, bd = g, d end
    end)
    if not best then return 0, 0, false end
    local d = math.sqrt(bd)
    return (best.x - self.x) / d, (best.z - self.z) / d, false
  end
  local tx, tz = self.x, self.z -- by default, stay put
  if step.x then
    tx, tz = step.x, step.z
    -- a gem close by and level with the feet is worth a short detour
    local best, bd = nil, 16
    nova.each("gem", function(g)
      local gx, gz = g.x - self.x, g.z - self.z
      local d = gx * gx + gz * gz
      if d < bd and g.gy > self.y + 0.2 and g.gy < self.y + 2.6 and (self.ground or self.y > -1) then best, bd = g, d end
    end)
    if best then tx, tz = best.x, best.z end
    if (step.x - self.x) ^ 2 + (step.z - self.z) ^ 2 < 0.36 then self.plan_i = self.plan_i + 1 end
  elseif step.board then
    local p = platform(step.board)
    if not step.go and step.ready() then step.go = true end
    if step.go then
      tx, tz = p.cx, p.cz
      if self.ground == p.wall then self.plan_i = self.plan_i + 1 end
    end
  else
    local p = platform(step.ride)
    if self.ground == p.wall and (p.cx - self.x) ^ 2 + (p.cz - self.z) ^ 2 > 0.09 then tx, tz = p.cx, p.cz end
    if step.ready() then self.plan_i = self.plan_i + 1 end
  end
  local dx, dz = tx - self.x, tz - self.z
  local dist = sqrt(dx * dx + dz * dz)
  if dist < 0.1 then return 0, 0, false end
  local wx, wz = dx / dist, dz / dist
  local jump = false
  if self.ground and dist > 0.8 then
    -- an edge ahead, something in the way, or a patroller: jump
    local h = nova.walls.floor_below(self.x + wx * 0.9, self.y + 0.6, self.z + wz * 0.9, 0.1)
    if not h or h < self.y - 0.9 or self.blocked then jump = true end
    nova.each("walker", function(w)
      local ddx, ddz = w.x - self.x, w.z - self.z
      if ddx * ddx + ddz * ddz < 5 and abs(w.y - self.y) < 1 then jump = true end
    end)
  end
  return wx, wz, jump
end

function Player:hurt_by(w)
  state.hits = state.hits + 1
  state.gems = max(0, state.gems - 1)
  local dx, dz = self.x - w.x, self.z - w.z
  local d = max(0.1, sqrt(dx * dx + dz * dz))
  self.vx, self.vz, self.vy = dx / d * 7, dz / d * 7, 6
  self.ground, self.invulnerable = nil, 1.2
  nova.sound.play("hurt", { volume = 0.6, limit = 2 })
  state.say("ouch", 1)
end

function Player:update(dt)
  if state.won then return end
  state.time = state.time + dt
  state.message_for = state.message_for - dt
  if nova.input.pressed("autoplay") then self.bot = not self.bot; self.plan_i = 1; state.say(self.bot and "autoplay" or "by hand") end
  self.invulnerable = max(0, (self.invulnerable or 0) - dt)

  -- the camera turns with the mouse and the right stick
  local ptr = nova.input.pointer()
  cam3.yaw = cam3.yaw - nova.input.axis("look_x") * 2.8 * dt - ptr.dx * 0.0022
  self.elev = max(0.05, min(1.2, (self.elev or CAM_ELEV) + nova.input.axis("look_y") * 1.6 * dt + ptr.dy * 0.0018))

  -- the platform one stands on moved this frame (before this update): go with it
  if self.ground and self.ground >= 0 then
    nova.each("platform", function(p)
      if p.wall == self.ground then
        local x, y, z = nova.walls.move3(self.x, self.y, self.z, HW, HEIGHT, p.dx, 0, p.dz)
        self.x, self.y, self.z = x, y, z
        state.ride_frames = state.ride_frames + 1
      end
    end)
  end

  -- what the player wants: the stick is relative to the camera
  local fx_, fz_ = cam3.forward()
  local rx, rz = cam3.right()
  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local wx, wz = rx * mx - fx_ * my, rz * mx - fz_ * my
  local want_jump = nova.input.pressed("jump")
  local bot_jump = false
  if self.bot then wx, wz, bot_jump = autoplay(self, dt); want_jump = want_jump or bot_jump end
  local len = sqrt(wx * wx + wz * wz)
  if len > 1 then wx, wz = wx / len, wz / len end

  -- on the ground one steers sharply; in the air a little
  local accel = (self.ground and 55 or 22) * dt
  self.vx, self.vz = approach(self.vx, wx * SPEED, accel), approach(self.vz, wz * SPEED, accel)
  if len > 0.1 then
    local want = math.atan(-wx, -wz)
    local diff = (want - self.face + math.pi) % (2 * math.pi) - math.pi
    self.face = self.face + diff * min(1, 14 * dt)
  end

  -- jumping: a little forgiveness before and after the edge, and a shorter jump when the button is let go
  if want_jump then self.buffer = BUFFER else self.buffer = max(0, self.buffer - dt) end
  if self.ground then self.coyote = COYOTE else self.coyote = max(0, self.coyote - dt) end
  if self.buffer > 0 and self.coyote > 0 then
    self.vy, self.buffer, self.coyote, self.ground, self.jumping = JUMP, 0, 0, nil, true
    nova.sound.play("jump", { volume = 0.4, limit = 2 })
  end
  if self.jumping and self.vy > 0 and not (nova.input.down("jump") or self.bot) then
    self.vy = self.vy * 0.5
    self.jumping = false
  end
  self.vy = self.vy - GRAVITY * dt

  local was_air = not self.ground
  local x, y, z, hx, hy, hz, on_ground, ground = nova.walls.move3(self.x, self.y, self.z, HW, HEIGHT, self.vx * dt, self.vy * dt, self.vz * dt)
  self.blocked = hx or hz
  if hx then self.vx = 0 end
  if hz then self.vz = 0 end
  if hy and self.vy > 0 then self.vy = 0 end -- the head hit something
  self.x, self.y, self.z = x, y, z
  if self.ground and not on_ground then self.edge_x, self.edge_vx = self.x, self.vx end -- where the last footing was left
  if on_ground then
    if was_air and self.vy < -8 then self.land_squash = 0.12; nova.sound.play("land", { volume = 0.4, limit = 2 }) end
    self.vy, self.ground, self.jumping = 0, ground, false
  else
    self.ground = nil
  end

  -- patrollers: land on one from above to beat it, touch one from the side and it knocks you back
  nova.each("walker", function(w)
    local dx, dz = self.x - w.x, self.z - w.z
    if dx * dx + dz * dz < 0.8 and self.y < w.y + 1.1 and self.y > w.y - 0.5 then
      if self.vy < 0 and self.y > w.y + 0.45 then
        w:destroy()
        state.stomps = state.stomps + 1
        self.vy, self.jumping = JUMP * 0.8, true
        nova.sound.play("stomp", { volume = 0.6, limit = 2 })
      elseif self.invulnerable <= 0 then
        self:hurt_by(w)
      end
    end
  end)

  -- off the edge of the world
  if self.y < -14 then
    state.falls = state.falls + 1
    state.fall_x = self.edge_x or self.x
    state.fall_vx = self.edge_vx or 0
    state.say("fell", 1)
    self:respawn()
  end

  self.walk_phase = self.walk_phase + sqrt(self.vx * self.vx + self.vz * self.vz) * dt * 2.2
  self.land_squash = max(0, self.land_squash - dt)
  self:aim_camera(dt)
end

-- behind and above the player, pulled in where a wall or the ground would be in the way
function Player:aim_camera(dt)
  local tx, ty, tz = self.x, self.y + 1.3, self.z
  local e = self.elev or CAM_ELEV
  local ce, se = cos(e), sin(e)
  local hx, hz = sin(cam3.yaw), cos(cam3.yaw) -- from the player toward the camera, along the ground
  local want = CAM_DIST
  local d = nova.walls.raycast(tx, tz, hx, hz, CAM_DIST * ce, ty, tan(e))
  if d then want = max(0.9, d / ce - 0.4); state.cam_pulls = state.cam_pulls + 1 end
  -- a pulled-in camera comes back out slowly, so that it does not flicker at an edge
  if want < self.cam_d then self.cam_d = want else self.cam_d = min(want, self.cam_d + 10 * dt) end
  local ex, ey, ez = tx + hx * self.cam_d * ce, ty + se * self.cam_d, tz + hz * self.cam_d * ce
  local floor = nova.walls.floor_below(ex, ey + 0.2, ez, 0.2)
  if floor and ey < floor + 0.5 then ey = floor + 0.5 end
  cam3.eye, cam3.target = { x = ex, y = ey, z = ez }, { x = tx, y = ty, z = tz }
  nova.camera(ex, ey, ez, tx, ty, tz, 65)
end

function Player:draw()
  local x, y, z = self.x, self.y, self.z
  -- a shadow on whatever is underneath
  local h = nova.walls.floor_below(x, y + 0.3, z, 0.3)
  if h then
    local size = max(0.35, 1.0 - (y - h) * 0.07)
    nova.quad3(x, h + 0.02, z, 0, 1, 0, size, { color = { 0, 0, 0, 120 } })
  end
  if (self.invulnerable or 0) > 0 and math.floor(state.time * 14) % 2 == 0 then return end
  -- Kenney's character (CC0, see licenses/): the clip follows what the body is doing
  local speed = sqrt(self.vx * self.vx + self.vz * self.vz)
  -- an animator crossfades: idle, walk and sprint are one state mixed by speed, jump and fall are their own
  self.anim = self.anim or nova.animator("character-oobi", {
    start = "move",
    fade = 0.15,
    states = {
      move = { blend = "speed", points = { { 0, "idle" }, { 2.2, "walk" }, { 5.5, "sprint" } } },
      jump = { clip = "jump", loop = false },
      fall = { clip = "fall" },
    },
  })
  self.anim:play(self.ground and "move" or (self.vy > 0 and "jump" or "fall"))
  self.anim:set("speed", speed)
  self.anim:update(1 / 60)
  self.anim:draw(x, y, z, { scale = 1.8, ry = self.face + math.pi })
end

return Player

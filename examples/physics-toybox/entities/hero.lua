-- The walker: a character body (a capsule that slides along walls, climbs small steps and shoves loose things).
-- The left stick walks (seen from the camera), the right stick turns the camera, A throws a ball, Y drops a crate in front.
local hud = require("lib.hud")
local cam3 = nova.cam3
local sin, cos, sqrt = math.sin, math.cos, math.sqrt
local SPEED, GRAVITY = 4.5, 22

local Hero = nova.entity { model = "character-oobi", body = "character", shape = "capsule", radius = 0.3, height = 1.25,
  offset = { 0, 0.63, 0 }, velocity = false, tags = { "hero" } }

function Hero:create()
  self.vy, self.face, self.t, self.cool = 0, math.pi, 0, 0
  cam3.yaw = 0
  cam3.eye = { x = self.x, y = self.y + 4, z = self.z + 7 }
end

function Hero:update(dt)
  self.t = self.t + dt
  self.cool = math.max(0, self.cool - dt)
  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local throw, drop = nova.input.pressed("fire"), nova.input.pressed("drop")
  if hud.auto then
    -- walk round the yard and throw at the pile now and then
    local a = self.t * 0.35
    local tx, tz = sin(a) * 4.5, cos(a) * 3 + 1
    local dx, dz = tx - self.x, tz - self.z
    local d = sqrt(dx * dx + dz * dz) + 1e-6
    -- the camera looks past the walker at the wall of crates
    cam3.yaw = math.atan(self.x, self.z + 4)
    local fx, fz = cam3.forward()
    local rx, rz = cam3.right()
    mx, my = (dx * rx + dz * rz) / d, -(dx * fx + dz * fz) / d
    throw = self.cool == 0 and (self.t % 1.6) < dt
    drop = (self.t % 4) < dt
  else
    cam3.yaw = cam3.yaw - nova.input.axis("look_x") * 2.4 * dt
  end
  local fx, fz = cam3.forward()
  local rx, rz = cam3.right()
  local wx, wz = (rx * mx - fx * my) * SPEED, (rz * mx - fz * my) * SPEED
  local speed = sqrt(wx * wx + wz * wz)
  if speed > SPEED then wx, wz, speed = wx / speed * SPEED, wz / speed * SPEED, SPEED end
  if speed > 0.2 then self.face = math.atan(wx, wz) end
  self.vy = self.vy - GRAVITY * dt
  self:walk(wx * dt, self.vy * dt, wz * dt)
  if self.on_ground then self.vy = -1 end
  self.pace = speed
  if self.y < -10 then self.x, self.y, self.z, self.vy = 0, 2, 4, 0 end
  local ax, az = sin(self.face), cos(self.face)
  if hud.auto and throw then
    -- the computer throws at the wall
    local dx, dz = -self.x, -4 - self.z
    local d = sqrt(dx * dx + dz * dz) + 1e-6
    ax, az = dx / d, dz / d
  end
  if throw and self.cool == 0 then
    self.cool = 0.3
    nova.spawn("ball3", self.x + ax * 0.6, self.y + 1.1, { z = self.z + az * 0.6, vx = ax * 11, vy = 3, vz = az * 11 })
    local balls = nova.all("ball")
    for i = 1, #balls - 10 do balls[i]:destroy() end
  end
  if drop then
    nova.spawn("crate3", self.x + ax * 1.6, self.y + 3, { z = self.z + az * 1.6, ry = math.random() * 3 })
  end
  cam3.follow(self, { distance = 7.5, height = 3.6, look_height = 0.9, dt = dt })
end

function Hero:draw()
  self.anim = self.anim or nova.animator("character-oobi", {
    start = "move", fade = 0.15,
    states = { move = { blend = "speed", points = { { 0, "idle" }, { 2.2, "walk" }, { 4.5, "sprint" } } } },
  })
  self.anim:set("speed", self.pace or 0)
  self.anim:update(1 / 60)
  self.anim:draw(self.x, self.y, self.z, { scale = 1.4, ry = self.face })
end

return Hero

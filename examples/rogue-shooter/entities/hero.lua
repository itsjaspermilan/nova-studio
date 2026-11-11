-- The hero. Left stick walks (seen from the camera), right stick turns the camera and aims up and down, the hero faces where it looks.
-- R1 or R2 fires, L2 aims down the sights (zoom, slower), A jumps, B crouches (a toggle; you can still walk, slowly).
local sin, cos, sqrt, atan = math.sin, math.cos, math.sqrt, math.atan
local cam3 = nova.cam3

local Hero = nova.entity {
  tags = { "hero" },
  velocity = false,
  settings = {
    speed = { 5, min = 1, max = 12, step = 0.5, help = "Walking speed (metres a second)" },
    crouch_speed = { 2.2, min = 0.5, max = 8, step = 0.1, help = "Walking speed while crouched" },
    jump = { 7.2, min = 3, max = 12, step = 0.2, help = "How hard a jump pushes up (7.2 clears a crate)" },
    hp = { 5, min = 1, max = 50, step = 1, help = "How many hits the hero can take" },
    fire_rate = { 7, min = 1, max = 20, step = 1, help = "Shots a second" },
    turn_speed = { 2.6, min = 0.5, max = 6, step = 0.1, help = "How fast the right stick turns left and right (radians a second)" },
    pitch_speed = { 1.8, min = 0.5, max = 5, step = 0.1, help = "How fast the right stick aims up and down" },
    ads_zoom = { 38, min = 20, max = 60, step = 1, help = "Field of view when aiming down the sights (60 is normal: less is closer)" },
    cam_distance = { 4, min = 1.5, max = 10, step = 0.5, help = "How far behind the camera is (metres)" },
    cam_shoulder = { 0.8, min = -2, max = 2, step = 0.1, help = "How far to the right of the hero the camera is, so that the crosshair is not on the hero (metres)" },
  },
}

local GRAVITY = 20
local STAND_H, CROUCH_H = 1.8, 1.25
local function lerp(a, b, k) return a + (b - a) * k end
-- The camera is this much higher than the place the crosshair points at, 20 metres ahead: it looks a little downwards, so that the crosshair stays where it was.
local RAISE = 0.45
-- and the crosshair points this much lower still (metres, 20 metres ahead): the view tilts down a little more
local AIM_DROP = 0.35
local DROP = RAISE + AIM_DROP

function Hero:create()
  self.cool, self.t, self.pace = 0, 0, 0
  self.face, self.pitch = 0, 0
  self.jy = 0 -- upward speed
  self.crouching, self.cr, self.ads, self.grounded = false, 0, 0, true
  self.dead, self.hit_t, self.safe, self.max_hp, self.gone = false, 0, 0, self.hp, 0
  self.cam_d = self.cam_distance
  cam3.yaw = 0
end

-- The camera stands behind and to the right of the hero, looks along the aim (turn and pitch) and comes closer when a wall is behind it.
-- Returns the place the crosshair points at, so that shots go there.
function Hero:camera(dt, fx, fz, rx, rz)
  local cp, sp = cos(self.pitch), sin(self.pitch)
  local shoulder = lerp(self.cam_shoulder, 0.45, self.ads)
  local dist = lerp(self.cam_distance, 2.4, self.ads)
  local py = self.y + lerp(1.35, 0.85, self.cr)
  local px, pz = self.x + rx * shoulder, self.z + rz * shoulder -- the point the camera hangs from
  -- a wall behind? (looking down the view backwards from that point)
  local want = dist
  local hit = nova.walls.raycast(px, pz, -fx, -fz, cp * dist + 0.4, py, -sp / cp)
  if hit then want = math.max(0.5, (hit - 0.4) / cp) end
  if want < self.cam_d then self.cam_d = want else self.cam_d = self.cam_d + (want - self.cam_d) * math.min(1, 6 * dt) end
  local ex, ez = px - fx * cp * self.cam_d, pz - fz * cp * self.cam_d
  local ey = math.max(0.15, py - sp * self.cam_d + 0.25 * (self.cam_d / dist)) + RAISE
  nova.camera(ex, ey, ez, ex + fx * cp * 20, ey + sp * 20 - DROP, ez + fz * cp * 20, lerp(60, self.ads_zoom, self.ads))
  -- the view's own turn up or down (a little under the pitch, because the camera looks down at that point 20 metres ahead)
  local vl = sqrt((cp * 20) ^ 2 + (sp * 20 - DROP) ^ 2)
  cp, sp = cp * 20 / vl, (sp * 20 - DROP) / vl
  -- where the crosshair points: the first wall or the floor along the view, 40 metres at most
  local t = 40
  local th = nova.walls.raycast(ex, ez, fx, fz, 40 * cp, ey, sp / cp)
  if th then t = math.min(t, th / cp) end
  if sp < -0.01 then t = math.min(t, -ey / sp) end
  return ex + fx * cp * t, ey + sp * t, ez + fz * cp * t
end

-- an enemy hits: lose health (not again for a moment), flash the screen; at 0 the room starts over
function Hero:hurt(n, dx, dz)
  if self.dead or self.safe > 0 then return end
  self.hp = self.hp - n
  self.safe, self.hit_t = 0.7, 0.3
  nova.input.rumble(0.8, 0.15)
  if self.hp <= 0 then self.dead, self.hp = true, 0 end
end

function Hero:update(dt)
  self.t = self.t + dt
  self.cool = math.max(0, self.cool - dt)
  self.safe, self.hit_t = math.max(0, self.safe - dt), math.max(0, self.hit_t - dt)
  if self.dead then
    self.gone = self.gone + dt
    if self.gone > 2.2 then nova.restart_scene() end
  end
  local aiming = nova.input.down("aim")
  self.ads = self.ads + ((aiming and 1 or 0) - self.ads) * math.min(1, 10 * dt)
  local slow = lerp(1, 0.5, self.ads) -- aiming down the sights turns and walks slower
  cam3.yaw = cam3.yaw - nova.input.axis("look_x") * self.turn_speed * slow * dt
  self.pitch = math.max(-0.75, math.min(0.85, self.pitch - nova.input.axis("look_y") * self.pitch_speed * slow * dt))
  local fx, fz = cam3.forward()
  local rx, rz = cam3.right()

  if nova.input.pressed("crouch") and self.grounded then self.crouching = not self.crouching end
  self.cr = self.cr + ((self.crouching and 1 or 0) - self.cr) * math.min(1, 12 * dt)

  -- walking
  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local wx, wz = (rx * mx - fx * my), (rz * mx - fz * my)
  local len = sqrt(wx * wx + wz * wz)
  if len > 1 then wx, wz, len = wx / len, wz / len, 1 end
  local top = (self.crouching and self.crouch_speed or self.speed) * lerp(1, 0.6, self.ads)
  self.pace = len * top

  -- jumping and falling (the floor is at 0; boxes can be stood on)
  if nova.input.pressed("jump") and self.grounded then
    self.jy, self.grounded = self.jump, false
    self.crouching = false
  end
  self.jy = self.jy - GRAVITY * dt
  local h = self.crouching and CROUCH_H or STAND_H
  local nx, ny, nz, _, hit_y, _, on_ground = nova.walls.move3(self.x, self.y, self.z, 0.35, h, wx * top * dt, self.jy * dt, wz * top * dt, 0.45)
  self.x, self.y, self.z = nx, ny, nz
  if hit_y then self.jy = 0 end
  if self.y <= 0 then self.y, self.jy, on_ground = 0, 0, true end
  self.grounded = on_ground
  if on_ground and self.jy < 0 then self.jy = 0 end

  self.face = atan(fx, fz) -- always faces where the camera looks
  local tx, ty, tz = self:camera(dt, fx, fz, rx, rz)

  if nova.input.down("fire") and self.cool == 0 and not self.dead then
    self.cool = 1 / self.fire_rate
    local mxp, myp, mzp = self.x + fx * 0.8 + rx * 0.25, self.y + lerp(1.3, 0.8, self.cr), self.z + fz * 0.8 + rz * 0.25
    local ax, ay, az = tx - mxp, ty - myp, tz - mzp
    local al = sqrt(ax * ax + ay * ay + az * az)
    if al < 1.5 then
      local cp, sp = cos(self.pitch), sin(self.pitch)
      ax, ay, az = fx * cp, sp, fz * cp -- a point blank wall: just straight ahead
    else
      ax, ay, az = ax / al, ay / al, az / al
    end
    nova.spawn("bullet", mxp, myp, { z = mzp, dx = ax, dy = ay, dz = az })
  end
end

-- a box in the hero's own space (right, up, forward), turned with the hero and placed in the world
local function part(self, ox, oy, oz, w, h, d, color)
  local c, s = cos(self.face), sin(self.face)
  nova.cuboid_at(self.x + ox * c + oz * s, self.y + oy, self.z - ox * s + oz * c, w, h, d, { ry = self.face, color = color })
end

function Hero:draw()
  if self.cam_d < 1.4 then return end -- the camera is squeezed against a wall: do not fill the screen with the hero's back
  local k = self.cr
  local walk = math.min(1, self.pace / 3) * (self.grounded and 1 or 0)
  local bob = sin(self.t * 11) * 0.04 * walk
  local swing = sin(self.t * 11) * 0.12 * walk
  local leg = 0.8 - 0.35 * k
  local air = self.grounded and 0 or 0.12 -- legs apart in the air
  part(self, -0.13, leg / 2 + bob, swing + air, 0.2, leg, 0.22, { 50, 60, 90 }) -- legs
  part(self, 0.13, leg / 2 + bob, -swing - air, 0.2, leg, 0.22, { 50, 60, 90 })
  part(self, 0, 1.15 - 0.5 * k + bob, 0, 0.55, 0.7, 0.3, { 220, 120, 60 }) -- body
  part(self, 0, 1.68 - 0.5 * k + bob, 0, 0.3, 0.3, 0.3, { 240, 200, 160 }) -- head
  -- the gun points where the hero aims
  local gy = 1.2 - 0.5 * k + bob
  local c, s = cos(self.face), sin(self.face)
  local cp, sp = cos(self.pitch), sin(self.pitch)
  local gx, gz = self.x + 0.32 * c + 0.3 * cp * s, self.z - 0.32 * s + 0.3 * cp * c
  nova.cuboid_at(gx, self.y + gy + 0.3 * sp, gz, 0.12, 0.14, 0.6, { ry = self.face, rx = -self.pitch, color = { 60, 60, 70 } })
  local near = 1 - math.min(1, self.y / 1.5) -- the shadow stays on the ground and shrinks as the hero jumps
  nova.quad3(self.x, 0.02, self.z, 0, 1, 0, 1.1 * (0.6 + 0.4 * near), { color = { 0, 0, 0, 90 }, round = true })
end

return Hero

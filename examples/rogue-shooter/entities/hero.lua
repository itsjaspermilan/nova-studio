-- The hero: the left stick walks (seen from the camera), the right stick turns the camera, and the hero faces where it looks. R2 or R1 fires.
local sin, cos, sqrt, atan = math.sin, math.cos, math.sqrt, math.atan
local cam3 = nova.cam3

local Hero = nova.entity {
  tags = { "hero" },
  velocity = false,
  settings = {
    speed = { 5, min = 1, max = 12, step = 0.5, help = "Walking speed (metres a second)" },
    fire_rate = { 7, min = 1, max = 20, step = 1, help = "Shots a second" },
  },
}

function Hero:create()
  self.cool, self.t, self.pace = 0, 0, 0
  self.face = 0
  cam3.yaw = 0
  cam3.eye = { x = self.x, y = 3, z = self.z + 4.5 }
end

function Hero:update(dt)
  self.t = self.t + dt
  self.cool = math.max(0, self.cool - dt)
  cam3.yaw = cam3.yaw - nova.input.axis("look_x") * 2.6 * dt
  local fx, fz = cam3.forward()
  local rx, rz = cam3.right()
  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local wx, wz = (rx * mx - fx * my), (rz * mx - fz * my)
  local len = sqrt(wx * wx + wz * wz)
  if len > 1 then wx, wz = wx / len, wz / len end
  self.pace = len * self.speed
  self.x, self.z = nova.walls.move(self.x, self.z, wx * self.speed * dt, wz * self.speed * dt, 0.35)
  self.face = atan(fx, fz) -- always faces where the camera looks
  self.aim_x, self.aim_z = fx, fz
  if nova.input.down("fire") and self.cool == 0 then
    self.cool = 1 / self.fire_rate
    local mxp, mzp = self.x + fx * 0.8 + rx * 0.25, self.z + fz * 0.8 + rz * 0.25
    nova.spawn("bullet", mxp, 1.2, { z = mzp, dx = fx, dz = fz })
  end
  cam3.follow(self, { distance = 4.5, height = 2.1, look_height = 1.5, dt = dt })
end

-- a point in the hero's own space (right, up, forward), placed in the world
local function part(self, ox, oy, oz, w, h, d, color, extra)
  local c, s = cos(self.face), sin(self.face)
  local o = extra or {}
  o.ry, o.color = self.face, color
  nova.cuboid_at(self.x + ox * c + oz * s, oy, self.z - ox * s + oz * c, w, h, d, o)
end

function Hero:draw()
  local bob = sin(self.t * 11) * 0.04 * math.min(1, self.pace / 3)
  local swing = sin(self.t * 11) * 0.12 * math.min(1, self.pace / 3)
  part(self, -0.13, 0.4 + bob, swing, 0.2, 0.8, 0.22, { 50, 60, 90 }) -- legs
  part(self, 0.13, 0.4 + bob, -swing, 0.2, 0.8, 0.22, { 50, 60, 90 })
  part(self, 0, 1.15 + bob, 0, 0.55, 0.7, 0.3, { 220, 120, 60 }) -- body
  part(self, 0, 1.68 + bob, 0, 0.3, 0.3, 0.3, { 240, 200, 160 }) -- head
  part(self, 0.32, 1.2 + bob, 0.3, 0.12, 0.14, 0.6, { 60, 60, 70 }) -- the gun
  nova.quad3(self.x, 0.02, self.z, 0, 1, 0, 1.1, { color = { 0, 0, 0, 90 }, round = true }) -- a shadow
end

return Hero

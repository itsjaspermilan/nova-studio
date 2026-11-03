-- A rally car. It is a real entity (so it is in the scene and is drawn with the others), but its driving is done by the
-- race scene calling `car:drive(dt)` after it has set `car.ctl` from the player's controls or from the AI.
local world = require("lib.world")
local fx = require("lib.fx")

local Car = nova.entity { model = "car", tags = { "car" } }

local WHEEL_RADIUS = 0.34
local SURFACE = {
  road = { grip = 8.5, lateral = 24, drag = 0 },
  dirt = { grip = 5.2, lateral = 18, drag = 0 },
  rough = { grip = 3.6, lateral = 13, drag = 7 },
}

function Car:create()
  self.heading = self.heading or 0
  self.velx, self.velz = 0, 0
  self.speed = 0               -- forward, metres per second
  self.slip = 0                -- 0 (gripping) to 1 (sliding)
  self.spin = 0                -- wheel turning, radians
  self.steer_visual = 0
  self.roll, self.pitch = 0, 0
  self.surface = "road"        -- "road", "dirt" or "rough" (off the track)
  self.power = 17              -- m/s squared at a standstill
  self.top = 47                -- m/s on the flat
  self.brake_power = 30
  self.enabled = false         -- cars sit still until the race starts
  self.ctl = { throttle = 0, brake = 0, steer = 0, handbrake = false }
  self.progress = 0
  self.waypoint = nil
  self.model_id = getmetatable(self).__model
  self.parts_table = {
    body = { rx = 0, rz = 0 },
    wheel_fl = { rx = 0, ry = 0 }, wheel_fr = { rx = 0, ry = 0 },
    wheel_rl = { rx = 0 }, wheel_rr = { rx = 0 },
  }
  self.draw_opts = { ry = 0, parts = self.parts_table }
  self.shadow_opts = { ry = 0 }
  self.bump_cooldown = 0
  self.y = 0
end

function Car:teleport(x, z, heading)
  self.x, self.z, self.heading = x, z, heading
  self.velx, self.velz, self.speed = 0, 0, 0
end

-- One step of driving. Positive steer is to the right, which turns the heading *down* (heading 0 faces +z, and left is +x).
function Car:drive(dt)
  local c = self.ctl
  local kind = SURFACE[self.surface] or SURFACE.road
  local grip_scale = self.grip_scale or 1
  local live = self.enabled
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local vf = self.velx * sinh + self.velz * cosh
  local top = self.top * (self.surface == "rough" and 0.5 or 1)

  -- steering: the faster you go, the less the wheels can turn the car
  local steer = live and c.steer or 0
  local steering_speed = math.min(1, math.abs(vf) / 4)
  local omega = math.min(2.5, kind.lateral * grip_scale / math.max(math.abs(vf), 1))
  if c.handbrake and live then omega = omega * 1.45 end
  local direction = vf >= -0.5 and 1 or -1
  self.heading = self.heading - steer * omega * steering_speed * direction * dt
  self.yaw_rate = -steer * omega * steering_speed * direction

  -- the same velocity, seen from the new heading: the part sideways is a slide
  sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  vf = self.velx * sinh + self.velz * cosh
  local vl = self.velx * cosh - self.velz * sinh

  if live then
    if c.throttle > 0 then
      local push = vf < 0 and self.power * 1.4 or self.power * math.max(0, 1 - vf / top)
      vf = vf + push * c.throttle * dt
    end
    if c.brake > 0 then
      if vf > 0.6 then vf = vf - self.brake_power * c.brake * dt
      else vf = math.max(-10, vf - self.power * 0.5 * c.brake * dt) end
    end
  end
  -- rolling resistance, engine braking, and the grass dragging at the wheels
  local sign = vf >= 0 and 1 or -1
  vf = vf - sign * math.min(math.abs(vf), (0.7 + kind.drag + 0.03 * math.abs(vf)) * dt)
  if vf > top then vf = vf - (vf - top) * 1.5 * dt end

  local grip = kind.grip * grip_scale * (c.handbrake and live and 0.22 or 1)
  vl = vl * math.exp(-grip * dt)
  self.slip = math.min(1, math.abs(vl) / (math.abs(vf) * 0.25 + 2))

  self.speed = vf
  self.velx, self.velz = vf * sinh + vl * cosh, vf * cosh - vl * sinh
  self.x, self.z = self.x + self.velx * dt, self.z + self.velz * dt

  -- scenery in the way
  local px, pz = world.push(self.x, self.z, 1.35)
  if px then
    self.x, self.z = self.x + px, self.z + pz
    local nl = math.sqrt(px * px + pz * pz)
    if nl > 0 then
      local nx, nz = px / nl, pz / nl
      local into = self.velx * nx + self.velz * nz
      if into < 0 then
        self.velx, self.velz = self.velx - nx * into * 1.25, self.velz - nz * into * 1.25
        self.velx, self.velz = self.velx * 0.82, self.velz * 0.82
        if -into > 4 then self.hit = math.min(1, -into / 20) end
      end
    end
  end

  -- the body leans out of the bend and nods under power
  local lateral_accel = (self.yaw_rate or 0) * vf
  local target_roll = math.max(-0.1, math.min(0.1, lateral_accel * 0.005))
  local target_pitch = math.max(-0.05, math.min(0.05, ((c.brake > 0 and live) and 0.03 or 0) - ((c.throttle > 0 and live) and 0.02 or 0)))
  local ease = math.min(1, dt * 8)
  self.roll = self.roll + (target_roll - self.roll) * ease
  self.pitch = self.pitch + (target_pitch - self.pitch) * ease
  self.steer_visual = self.steer_visual + (steer - self.steer_visual) * math.min(1, dt * 12)
  self.spin = self.spin + vf / WHEEL_RADIUS * dt
  self.bump_cooldown = math.max(0, self.bump_cooldown - dt)

  -- dust and gravel behind the rear wheels
  if (self.surface == "rough" or self.slip > 0.5) and math.abs(vf) > 5 and math.random() < dt * 30 then
    local colour = self.dust_color or { 200, 190, 160 }
    fx.puff(self.x - sinh * 2 + cosh * (math.random() - 0.5) * 2, self.z - cosh * 2 - sinh * (math.random() - 0.5) * 2, -self.velx * 0.2, -self.velz * 0.2, 1.1, colour)
  end
end

function Car:draw()
  local pt = self.parts_table
  pt.body.rx, pt.body.rz = self.pitch, self.roll
  local sv = -self.steer_visual * 0.45
  pt.wheel_fl.ry, pt.wheel_fr.ry = sv, sv
  pt.wheel_fl.rx, pt.wheel_fr.rx, pt.wheel_rl.rx, pt.wheel_rr.rx = self.spin, self.spin, self.spin, self.spin
  self.draw_opts.ry = self.heading
  self.shadow_opts.ry = self.heading
  nova.model("shadow", self.x, 0, self.z, self.shadow_opts)
  nova.model(self.model_id, self.x, 0, self.z, self.draw_opts)
end

return Car

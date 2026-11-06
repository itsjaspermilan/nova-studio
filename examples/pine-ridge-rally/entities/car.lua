-- A rally car. It is a real entity (so it is in the scene and is drawn with the others), but its driving is done by the
-- race scene calling `car:drive(dt)` after it has set `car.ctl` from the player's controls or from the AI.
local fx = require("lib.fx")
local state = require("lib.state")

local Car = nova.entity { model = "car", tags = { "car" } }

local WHEEL_RADIUS = 0.28       -- (the car model is 3.7 m long; it was 4.53, so the sizes below are 0.82 of what they were)
-- A five-speed gearbox: the speed each gear runs out at (m/s, at the car's normal top speed), and how hard it pulls.
-- Low gears pull hard and run out fast; fifth is long and gentle.
local GEARS = { { top = 13, pull = 1.35 }, { top = 22, pull = 1.12 }, { top = 30, pull = 0.97 }, { top = 38, pull = 0.86 }, { top = 44, pull = 0.78 } }
local UPSHIFT, DOWNSHIFT = 0.94, 0.45   -- changes up above this share of the gear's top speed, down below that one
local SHIFT_TIME = 0.17                 -- seconds with no pull while the clutch is in
local IDLE_REV = 0.16
-- Where the wheels are, from the middle of the car: forwards, and to the left (+x is the left side when facing +z).
local WHEELS = {
  wheel_fl = { fwd = 1.1, left = -0.72 }, wheel_fr = { fwd = 1.1, left = 0.72 },
  wheel_rl = { fwd = -1.1, left = -0.72 }, wheel_rr = { fwd = -1.1, left = 0.72 },
}
local WHEEL_NAMES = { "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr" }
local WHEELBASE, TRACK = 2.2, 1.45
-- How bumpy each surface is (metres of ground height), and the body's suspension (a springy, damped mass).
local BUMPS = { road = 0.004, dirt = 0.03, rough = 0.08 }
local WHEEL_FOLLOW = 14     -- how fast a wheel follows the ground (1 / seconds): the bumps come faster than a wheel can rise and fall, and at 40 m/s a 60 fps frame samples them so coarsely that the wheels hopped at random
local SPRING, DAMPER = 240, 30   -- stiff and well damped: the body settles at once instead of wallowing

-- The height of the ground at a spot: a fixed, smooth pattern of bumps.
local function ground(x, z, size)
  return size * (math.sin(x * 0.9 + 1.3) * math.sin(z * 0.7 + 0.4) + 0.5 * math.sin(x * 1.9 - z * 1.1) + 0.3 * math.sin(z * 2.7 + x * 0.5))
end
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
  self.power = 15              -- m/s squared in first, before the gear's pull is applied
  self.top = 44                -- m/s on the flat
  self.gear = 1
  self.shift_time = 0          -- while above 0 the clutch is in and the car is not pulling
  self.rev = IDLE_REV          -- the engine's revs, 0 to 1, for the sound and the rev counter
  self.brake_power = 30
  self.enabled = false         -- cars sit still until the race starts
  self.ctl = { throttle = 0, brake = 0, steer = 0, handbrake = false }
  self.progress = 0
  self.waypoint = nil
  self.model_id = getmetatable(self).__model
  self.parts_table = {
    body = { rx = 0, rz = 0, y = 0 },
    wheel_fl = { rx = 0, ry = 0, y = 0 }, wheel_fr = { rx = 0, ry = 0, y = 0 },
    wheel_rl = { rx = 0, y = 0 }, wheel_rr = { rx = 0, y = 0 },
  }
  -- suspension: where each corner of the body is (b) and how fast it is moving (bv), and the ground under each wheel (h)
  self.susp = { b = { 0, 0, 0, 0 }, bv = { 0, 0, 0, 0 }, h = { 0, 0, 0, 0 }, w = { 0, 0, 0, 0 } }
  self.last_vf, self.last_yaw = 0, 0
  self.draw_opts = { ry = 0, parts = self.parts_table }
  self.shadow_opts = { ry = 0 }
  self.bump_cooldown = 0
  self.y = 0
  self.damage = 0              -- the body, 0 (new) to 1 (wrecked): hits add to it and it never gets better
  self.tyres = 1               -- the tyres, 1 (new) to 0 (bald): sliding and the rough wear them
  self.pull = 0                -- which way a damaged car drifts: -1, 0 or 1
  self.smoke_carry = 0
end

-- How much the tyres hold: the circuit's grip, less what the wear has taken (a bald set holds 30% less).
function Car:grip_now()
  return (self.grip_scale or 1) * (0.7 + 0.3 * self.tyres)
end

function Car:teleport(x, z, heading)
  self.x, self.z, self.heading = x, z, heading
  self.velx, self.velz, self.speed = 0, 0, 0
end

-- One step of driving. Positive steer is to the right, which turns the heading *down* (heading 0 faces +z, and left is +x).
function Car:drive(dt)
  local c = self.ctl
  local kind = SURFACE[self.surface] or SURFACE.road
  local grip_scale = self:grip_now()
  local live = self.enabled
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local vf = self.velx * sinh + self.velz * cosh
  local top = self.top * (self.surface == "rough" and 0.5 or 1) * (1 - 0.25 * self.damage)

  -- steering: the faster you go, the less the wheels can turn the car (and a damaged car drifts to one side)
  local steer = live and c.steer or 0
  if live and self.damage > 0.1 then steer = steer + self.pull * (self.damage - 0.1) * 0.2 * math.min(1, math.abs(vf) / 15) end
  local steering_speed = math.min(1, math.abs(vf) / 4)
  -- downforce: the faster the car goes, the harder the tyres are pressed on the road, so it bites and turns better
  local downforce = 1 + math.min(0.6, math.abs(vf) / 70)
  -- a trigger pulled right through on the brake at speed locks the wheels: the front stops biting (the car understeers), the
  -- rear lets go (it slides), and the braking gets worse. A key or a button is all or nothing, so it never does this.
  local lock = 0
  if live and c.brake_analog and c.brake > 0.85 and vf > 8 then
    local t = (c.brake - 0.85) / 0.15
    lock = t * t * (3 - 2 * t) * math.min(1, (vf - 8) / 12)
  end
  self.lock = lock
  local omega = math.min(2.5, kind.lateral * grip_scale * downforce / math.max(math.abs(vf), 1))
  if c.handbrake and live then omega = omega * 1.45 end
  omega = omega * (1 - 0.45 * lock)
  local direction = vf >= -0.5 and 1 or -1
  self.heading = self.heading - steer * omega * steering_speed * direction * dt
  self.yaw_rate = -steer * omega * steering_speed * direction

  -- the same velocity, seen from the new heading: the part sideways is a slide
  sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  vf = self.velx * sinh + self.velz * cosh
  local vl = self.velx * cosh - self.velz * sinh

  -- the gearbox changes by itself: up near the end of a gear, down when the revs fall away
  local scale = self.top / 44
  self.shift_time = math.max(0, self.shift_time - dt)
  local gear = GEARS[self.gear]
  local share = math.max(0, vf) / (gear.top * scale)
  if live and self.shift_time <= 0 then
    if share > UPSHIFT and self.gear < #GEARS and c.throttle > 0 then
      self.gear, self.shift_time, self.shifted = self.gear + 1, SHIFT_TIME, "up"
    elseif share < DOWNSHIFT and self.gear > 1 and vf > 0 then
      self.gear, self.shift_time, self.shifted = self.gear - 1, SHIFT_TIME * 0.5, "down"
    end
    gear = GEARS[self.gear]
    share = math.max(0, vf) / (gear.top * scale)
  end

  if live then
    if c.throttle > 0 and self.shift_time <= 0 then
      -- the pull fades towards the end of the gear; at the limiter it stops
      local push = vf < 0 and self.power * 1.4 or self.power * (1 - 0.2 * self.damage) * gear.pull * math.max(0, 1 - 0.6 * share * share) * (share >= 1 and 0 or 1)
      vf = vf + push * c.throttle * dt
    end
    if c.brake > 0 then
      if vf > 0.6 then vf = vf - self.brake_power * c.brake * (1 - 0.3 * lock) * dt
      else vf = math.max(-10, vf - self.power * 0.5 * c.brake * dt) end
    end
  end
  -- rolling resistance, engine braking, and the grass dragging at the wheels
  local sign = vf >= 0 and 1 or -1
  vf = vf - sign * math.min(math.abs(vf), (1.1 + kind.drag + 0.055 * math.abs(vf)) * dt)
  if vf > top then vf = vf - (vf - top) * 1.5 * dt end

  local grip = kind.grip * grip_scale * downforce * (c.handbrake and live and 0.22 or 1) * (1 - 0.7 * lock)
  vl = vl * math.exp(-grip * dt)
  self.slip = math.min(1, math.abs(vl) / (math.abs(vf) * 0.25 + 2))
  if lock > 0.2 then self.slip = math.max(self.slip, lock) end -- (locked wheels smoke and wear the tyres)

  self.speed = vf
  self.velx, self.velz = vf * sinh + vl * cosh, vf * cosh - vl * sinh
  self.x, self.z = self.x + self.velx * dt, self.z + self.velz * dt

  -- scenery in the way
  local px, pz = nova.scenery.push(self.x, self.z, 1.15)
  if px then
    self.x, self.z = self.x + px, self.z + pz
    local nl = math.sqrt(px * px + pz * pz)
    if nl > 0 then
      local nx, nz = px / nl, pz / nl
      local into = self.velx * nx + self.velz * nz
      if into < 0 then
        self.velx, self.velz = self.velx - nx * into * 1.25, self.velz - nz * into * 1.25
        self.velx, self.velz = self.velx * 0.82, self.velz * 0.82
        if -into > 4 then
          self.hit = math.min(1, -into / 20)
          if self.damage < 0.1 and self.pull == 0 then self.pull = math.random() < 0.5 and -1 or 1 end
          -- scrapes cost nothing: only hard hits (a 15 m/s one is a tenth of the body, a 30 m/s one a third)
          self.damage = math.min(1, self.damage + math.max(0, -into - 6) * 0.0125)
        end
      end
    end
  end

  -- the engine's revs follow the road speed through the current gear; they drop during a change, and flare with the throttle
  local want = IDLE_REV + (1 - IDLE_REV) * math.min(1, share) + (live and c.throttle > 0 and 0.06 or 0)
  if self.shift_time > 0 then want = want - 0.22 end
  if share >= 1 and live and c.throttle > 0 then want = want - (math.sin(nova.time() * 45) > 0 and 0.05 or 0) end  -- the limiter bounces
  self.rev = self.rev + (want - self.rev) * math.min(1, dt * (self.shift_time > 0 and 9 or 14))

  -- the suspension: the wheels follow the road, the body floats on springs and leans with the forces on it
  self:suspension(dt, vf, (vf - self.last_vf) / dt, (self.yaw_rate or 0) * vf)
  self.last_vf = vf
  self.steer_visual = self.steer_visual + (steer - self.steer_visual) * math.min(1, dt * 12)
  self.spin = self.spin + vf / WHEEL_RADIUS * dt
  self.bump_cooldown = math.max(0, self.bump_cooldown - dt)

  -- the tyres wear: a little all the time, a lot when sliding or on the rough
  if live then
    local wear = 0.0008 + 0.012 * math.max(0, self.slip - 0.3) + (self.surface == "rough" and 0.006 or 0) + ((c.handbrake and math.abs(vf) > 5) and 0.01 or 0)
    self.tyres = math.max(0, self.tyres - wear * dt)
  end
  -- a badly damaged car smokes from the bonnet
  if self.damage > 0.45 and math.abs(self.speed) > 1 then
    self.smoke_carry = self.smoke_carry + dt * (4 + 22 * (self.damage - 0.45))
    while self.smoke_carry >= 1 do
      self.smoke_carry = self.smoke_carry - 1
      fx.puff(self.x + sinh * 1.4, self.z + cosh * 1.4, self.velx * 0.1, self.velz * 0.1, 0.9, { 50, 50, 55 }, 1.0)
    end
  end

  -- skid marks from the rear tyres while they slide on the road (every metre or so they travel)
  if self.surface ~= "rough" and self.slip > 0.45 and math.abs(vf) > 4 then
    self.skid_dist = (self.skid_dist or 0) + math.sqrt(self.velx * self.velx + self.velz * self.velz) * dt
    if self.skid_dist > 1.0 then
      self.skid_dist = 0
      local ry = math.atan(self.velx, self.velz)
      for _, side in ipairs({ -0.75, 0.75 }) do
        fx.skid(self.x - sinh * 1.2 + cosh * side, self.z - cosh * 1.2 - sinh * side, ry)
      end
    end
  end

  -- dust and gravel behind the rear wheels
  if (self.surface == "rough" or self.slip > 0.5) and math.abs(vf) > 5 and math.random() < dt * 30 then
    local colour = self.dust_color or { 200, 190, 160 }
    fx.puff(self.x - sinh * 2 + cosh * (math.random() - 0.5) * 2, self.z - cosh * 2 - sinh * (math.random() - 0.5) * 2, -self.velx * 0.2, -self.velz * 0.2, 1.1, colour)
  end
end

-- Each corner of the body is pulled towards the road under its wheel, plus the weight that braking, accelerating and
-- cornering shift onto it. The body's height, nod and lean come from where its four corners are; each wheel stays on the road.
function Car:suspension(dt, vf, accel, lateral_accel)
  local sp = self.susp
  local size = (BUMPS[self.surface] or BUMPS.road) * math.min(1, 0.3 + math.abs(vf) / 20)
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local long_shift = math.max(-0.14, math.min(0.14, accel * 0.005))    -- braking (negative) drops the nose
  local side_shift = math.max(-0.14, math.min(0.14, lateral_accel * 0.004))   -- turning left (positive) loads the left side
  for i, name in ipairs(WHEEL_NAMES) do
    local w = WHEELS[name]
    local wx = self.x + sinh * w.fwd + cosh * w.left
    local wz = self.z + cosh * w.fwd - sinh * w.left
    local h = ground(wx, wz, size)
    sp.h[i] = h
    sp.w[i] = sp.w[i] + (h - sp.w[i]) * math.min(1, dt * WHEEL_FOLLOW)
    h = sp.w[i]
    local target = h + (w.fwd > 0 and long_shift or -long_shift) + (w.left > 0 and -side_shift or side_shift)
    local pull = SPRING * (target - sp.b[i]) - DAMPER * sp.bv[i]
    if self.hit then pull = pull + 60 * self.hit * ((i * 37) % 3 - 1) end  -- a knock sets the body rocking
    sp.bv[i] = sp.bv[i] + pull * dt
    sp.b[i] = sp.b[i] + sp.bv[i] * dt
  end
  local b = sp.b
  self.lift = (b[1] + b[2] + b[3] + b[4]) / 4
  -- (body pitch is about x and tips the nose down for a positive angle; roll is about z and lifts the left side)
  self.pitch = -((b[1] + b[2]) - (b[3] + b[4])) / 2 / WHEELBASE
  self.roll = ((b[2] + b[4]) - (b[1] + b[3])) / 2 / TRACK
end

function Car:draw()
  local pt = self.parts_table
  pt.body.rx, pt.body.rz, pt.body.y = self.pitch, self.roll, self.lift
  local h = self.susp.w
  pt.wheel_fl.y, pt.wheel_fr.y, pt.wheel_rl.y, pt.wheel_rr.y = h[1], h[2], h[3], h[4]
  local sv = -self.steer_visual * 0.45
  pt.wheel_fl.ry, pt.wheel_fr.ry = sv, sv
  pt.wheel_fl.rx, pt.wheel_fr.rx, pt.wheel_rl.rx, pt.wheel_rr.rx = self.spin, self.spin, self.spin, self.spin
  self.draw_opts.ry = self.heading
  local dim = 255 - math.floor(110 * self.damage)
  self.draw_opts.tint = self.damage > 0.02 and { dim, dim, dim } or nil
  self.shadow_opts.ry = self.heading
  if not state.shadows then nova.model("shadow", self.x, 0, self.z, self.shadow_opts) end -- (a flat blob when there are no real shadows)
  nova.model(self.model_id, self.x, 0, self.z, self.draw_opts)
end

return Car

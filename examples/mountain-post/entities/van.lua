-- The post van. Its body rides on four springs and dampers, one at each wheel, so it leans out in a bend, dips its nose when it
-- brakes and squats when it pulls away, and bobs over the bumps of a gravel lane. The suspension solver and the wheels' layout
-- are taken from Pine Ridge Rally's car (examples/pine-ridge-rally/entities/car.lua, 2026-11-21: `wheel_layout`, `ride_of`,
-- `Car:suspension`, `Car:wheel_offset`), copied here and cut down to one vehicle; the driving is new and gentle: modest power,
-- a top speed of about 63 km/h, brakes that take a moment, steering that forgives, no damage, no fuel, no gears to think about.
-- The scene sets `ctl` from the pad while the postmaster is in it; empty, it stands with its handbrake on.
local engine_sound = require("nova.engine_sound")
local world = require("lib.world")

local Van = nova.entity { model = "van", tags = { "van" }, velocity = false }

-- The feel, in numbers (metres, seconds). Measured over a drive (the play tool's `record`), these give: 0 to 50 km/h in about
-- 6.5 s, a top speed of 17.5 m/s on the flat, about 20 m to stop from 50 km/h, and some 4 degrees of lean in a brisk bend.
local FEEL = {
  power = 4.6,          -- m/s^2 pulling away; it fades as the speed climbs to `top`
  top = 17.5,           -- m/s on the flat (63 km/h)
  reverse = 4.5,        -- m/s at most backwards
  brake = 5.0,          -- m/s^2 at full brake: it takes a moment to stop
  coast = 0.55,         -- m/s^2 rolling and engine braking with nothing pressed
  drag = 0.0045,        -- the air, per (m/s)^2
  lock = math.rad(33),  -- the front wheels at full lock
  steer_rate = 2.6,     -- how fast the wheels follow the stick (1/s): a moment, not a twitch
  grip = 9,             -- how fast a sideways slip dies away (1/s): it holds the road
  pull = 0.0035,        -- radians a second the van wanders to the left with the wheel let go (the Mayor's letter; barely felt)
  hill = 5.5,           -- how much a slope pulls (m/s^2 at 100 %)
}
local GEARS = { 7, 12.5, 17.5 }        -- the speed at which each gear runs out (for the engine's note only)
local GRAVITY = 9.8
local WHEEL_NAMES = { "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr" }

-- Where the model's wheels are (from its parts), as stations of the suspension. (car.lua's wheel_layout)
local function wheel_layout(model)
  local pose = nova.model_pose(model)
  local stations = {}
  for _, name in ipairs(WHEEL_NAMES) do
    local p = pose[name]
    stations[#stations + 1] = { name = name, fwd = p.z, left = p.x, y = p.y, front = name == "wheel_fl" or name == "wheel_fr" }
  end
  for i, s in ipairs(stations) do
    local other = s.name:sub(1, -2) .. (s.name:sub(-1) == "l" and "r" or "l")
    for j, t in ipairs(stations) do if t.name == other then s.pair = j end end
  end
  local wb = (stations[1].fwd + stations[2].fwd) / 2 - (stations[3].fwd + stations[4].fwd) / 2
  local tr = math.abs(stations[1].left - stations[2].left)
  return { stations = stations, wheelbase = wb, track = tr }
end

-- The springs, from how soft the van is: a slow heave (1.3 Hz), lightly damped so it bobs once after a bump, long travel, and a
-- generous lean (car.lua's ride_of, with the van's own numbers).
local function ride_of(layout)
  local hz, zeta = 1.3, 0.34
  local omega = hz * 2 * math.pi
  local sag = GRAVITY / (omega * omega)
  local n = #layout.stations
  local r = { omega = omega, zeta = zeta, sag = sag, k = omega * omega / n, c = 2 * zeta * omega / n, bump = 0.11, droop = 0.14,
    roll = math.rad(6), pitch = math.rad(3.4), arb = 0.3 }
  r.ip = (0.42 * layout.wheelbase) ^ 2
  r.ir = (0.4 * layout.track) ^ 2
  r.sags = {}
  for i = 1, n do r.sags[i] = sag end
  return r
end

-- Bumps of the surface under a tyre (metres): tarmac is smooth, gravel lanes rumble, the grass rolls.
local BUMPS = { road = 0.004, gravel = 0.018, bridge = 0.008, grass = 0.03 }
local function ground_bump(x, z, size)
  return size * (math.sin(x * 0.9 + 1.3) * math.sin(z * 0.7 + 0.4) + 0.5 * math.sin(x * 1.9 - z * 1.1) + 0.3 * math.sin(z * 2.7 + x * 0.5))
end

function Van:create()
  self.heading = self.ry or 0
  self.velx, self.velz, self.speed = 0, 0, 0
  self.steer = 0
  self.ctl = { go = 0, brake = 0, steer = 0 }
  self.driven = false
  self.spin = 0
  self.gear = 1
  self.rev = 0.12
  self.surface = "road"
  local layout = wheel_layout("van")
  self.stations, self.wheelbase = layout.stations, layout.wheelbase
  self.ride = ride_of(layout)
  self.parts_table = { body = { rx = 0, rz = 0, y = 0 }, door_l = { ry = 0 }, door_r = { ry = 0 } }
  for _, s in ipairs(self.stations) do self.parts_table[s.name] = s.front and { rx = 0, ry = 0, y = 0 } or { rx = 0, y = 0 } end
  local n = #self.stations
  local function list(v) local t = {} for i = 1, n do t[i] = v end return t end
  self.susp = { y = 0, vy = 0, p = 0, vp = 0, r = 0, vr = 0, ready = false, s = list(0), touch = list(true), load = list(1), g = list(0), t = list(0), gv = list(0), bump = list(0) }
  self.pitch, self.roll, self.lift = 0, 0, 0
  self.last_vf = 0
  self.draw_opts = { ry = 0, parts = self.parts_table, rigid = true }
  self.back_open = 0      -- the rear doors, 0 shut to 1 open
  self.back_want = 0
  self.knock = 0
  self.engine = engine_sound.new(require("engines.van"), { volume = 0.55 })
  self.engine_on = false
  self.side_opts = { w = 1.9, h = 0.34 }
end

function Van:teleport(x, z, heading)
  self.x, self.z, self.heading = x, z, heading
  self.velx, self.velz, self.speed = 0, 0, 0
  self.susp.ready = false
end

-- A nudge to the body (someone climbing in or out, a door shutting): it rocks on its springs.
function Van:rock(roll, heave)
  self.susp.vr = self.susp.vr + (roll or 0)
  self.susp.vy = self.susp.vy + (heave or 0)
end

function Van:stopped() return math.abs(self.speed) < 0.6 end

-- One step of driving. `ctl.steer` is -1 (left) to 1 (right) and turns the heading down (heading 0 faces +z, and left is +x).
function Van:drive(dt)
  local c = self.ctl
  local live = self.driven
  local go, brake, steer_in = live and c.go or 0, live and c.brake or 0, live and c.steer or 0
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local vf = self.velx * sinh + self.velz * cosh
  local vl = self.velx * cosh - self.velz * sinh
  -- the wheels follow the stick over a moment, and turn less the faster the van goes (it never darts)
  local want = steer_in * (1 - 0.45 * math.min(1, math.abs(vf) / FEEL.top))
  self.steer = self.steer + (want - self.steer) * math.min(1, dt * FEEL.steer_rate * 2)
  local angle = self.steer * FEEL.lock
  -- a van turns by its speed over the radius its front wheels point at (wheelbase / tan(angle))
  local yaw = -vf * math.tan(angle) / self.wheelbase
  if live and math.abs(steer_in) < 0.05 and math.abs(vf) > 2 then yaw = yaw + FEEL.pull * (vf > 0 and 1 or -1) end
  self.heading = self.heading + yaw * dt
  self.yaw_rate = yaw
  sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  vf = self.velx * sinh + self.velz * cosh
  vl = self.velx * cosh - self.velz * sinh
  -- pulling away, braking, reversing (L2 brakes, then reverses once stopped)
  if go > 0 then
    local share = math.max(0, vf) / FEEL.top
    vf = vf + FEEL.power * go * math.max(0, 1 - share * share) * dt
  end
  if brake > 0 then
    if vf > 0.3 then vf = math.max(0, vf - FEEL.brake * brake * dt)
    elseif go <= 0 then vf = math.max(-FEEL.reverse, vf - FEEL.power * 0.7 * brake * dt) end
  end
  -- rolling, engine braking, the air, the hills
  local sign = vf >= 0 and 1 or -1
  local coast = (go > 0 and 0.15 or FEEL.coast) + (self.surface == "grass" and 1.2 or self.surface == "gravel" and 0.15 or 0)
  vf = vf - sign * math.min(math.abs(vf), (coast + FEEL.drag * vf * vf) * dt)
  local gx, gz = nova.terrain_slope(self.x, self.z)
  if not world.on_bridge(self.x, self.z) then vf = vf - (gx * sinh + gz * cosh) * FEEL.hill * dt end
  if not live and math.abs(vf) < 0.4 then vf = 0 end -- (the handbrake: an empty van does not creep down a slope)
  -- the slip sideways dies away quickly: the van holds its line
  vl = vl * math.exp(-FEEL.grip * dt)
  self.speed = vf
  self.velx, self.velz = vf * sinh + vl * cosh, vf * cosh - vl * sinh
  -- moving: two circles along the van (its nose and its tail) against the scenery, the water and the map's edges
  local nx, nz = self.x + self.velx * dt, self.z + self.velz * dt
  local hit = 0
  for _, off in ipairs({ 1.15, -1.15 }) do
    local px, pz = nx + sinh * off, nz + cosh * off
    local mx, mz, stopped = world.move(px, pz, 0, 0, 0.95)
    if stopped then
      local ox, oz = mx - px, mz - pz
      nx, nz = nx + ox, nz + oz
      local l = math.sqrt(ox * ox + oz * oz)
      if l > 1e-4 then
        local ux, uz = ox / l, oz / l
        local into = self.velx * ux + self.velz * uz
        if into < 0 then
          self.velx, self.velz = self.velx - ux * into * 1.15, self.velz - uz * into * 1.15
          hit = math.max(hit, -into)
        end
      end
    end
  end
  self.x, self.z = nx, nz
  self.speed = self.velx * sinh + self.velz * cosh
  if hit > 1.5 and self.knock <= 0 then
    nova.sound.play("impact", { volume = math.min(0.8, 0.2 + hit * 0.06), vary = 0.06 })
    self:rock((math.random() - 0.5) * hit * 0.08, 0)
    self.knock = 0.4
  end
  self.knock = math.max(0, self.knock - dt)
  self.surface = world.surface(self.x, self.z)
  -- the gear (for the engine's note): changes up and down by itself
  local g = GEARS[self.gear]
  if vf > g * 0.96 and self.gear < #GEARS then self.gear = self.gear + 1; if self.engine_on then self.engine:shift("up") end
  elseif self.gear > 1 and vf < GEARS[self.gear - 1] * 0.62 then self.gear = self.gear - 1; if self.engine_on then self.engine:shift("down") end end
  local lo = self.gear > 1 and GEARS[self.gear - 1] * 0.55 or 0
  local share = math.max(0, math.abs(vf) - lo) / (GEARS[self.gear] - lo)
  local rev_want = 0.12 + 0.75 * math.min(1, share) + go * 0.1
  self.rev = self.rev + (rev_want - self.rev) * math.min(1, dt * 6)
  self:suspension(dt, (vf - self.last_vf) / dt, (self.yaw_rate or 0) * vf)
  self.last_vf = vf
  self.spin = self.spin + vf / 0.33 * dt
  -- the rear doors swing open and shut
  self.back_open = self.back_open + ((self.back_want or 0) - self.back_open) * math.min(1, dt * 6)
  self:sound(dt, go)
end

function Van:sound(dt, go)
  if not self.engine_on then self.engine:silence(); return end
  local e = require("engines.van")
  self.engine:update(dt, { rpm = e.idle + (e.max - e.idle) * self.rev, throttle = go, speed = math.abs(self.speed),
    surface = self.surface == "road" and "road" or self.surface == "grass" and "rough" or "gravel", lift = self.lift })
end

-- The suspension (car.lua's Car:suspension, the small rigid-body solver, for four wheels on the valley's ground).
function Van:suspension(dt, accel, lateral_accel)
  local sp, ride, st = self.susp, self.ride, self.stations
  local n = #st
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local h0 = nova.terrain_height(self.x, self.z)
  local size = (BUMPS[self.surface] or 0.01) * math.min(1, 0.3 + math.abs(self.speed) / 12)
  local follow = math.min(1, dt * 14)
  for i = 1, n do
    local s = st[i]
    local wx, wz = self.x + sinh * s.fwd + cosh * s.left, self.z + cosh * s.fwd - sinh * s.left
    local g = world.height(wx, wz)
    sp.t[i] = nova.terrain_height(wx, wz)
    sp.bump[i] = sp.bump[i] + (ground_bump(wx, wz, size) - sp.bump[i]) * follow
    g = g + sp.bump[i]
    if sp.ready then sp.gv[i] = math.max(-6, math.min(6, (g - sp.g[i]) / dt)) else sp.gv[i] = 0 end
    sp.g[i] = g
  end
  if not sp.ready then
    sp.ready = true
    local gy = 0
    for i = 1, n do gy = gy + sp.g[i] end
    sp.y, sp.vy, sp.vp, sp.vr = gy / n, 0, 0, 0
    local gf = (sp.g[1] + sp.g[2]) / 2 - (sp.g[3] + sp.g[4]) / 2
    sp.p, sp.r = gf / self.wheelbase, 0
  end
  local want_p = math.max(-1, math.min(1, accel / (accel < 0 and FEEL.brake or FEEL.power * 1.4))) * ride.pitch
  local want_r = math.max(-1, math.min(1, lateral_accel / 4.5)) * ride.roll
  local k, c, sags, bump, droop = ride.k, ride.c, ride.sags, ride.bump, ride.droop
  local kb, cb, arb = 25 * k, 3 * c, ride.arb * k
  local h = dt / 2
  for _ = 1, 2 do
    local y, p, r, vy, vp, vr = sp.y, sp.p, sp.r, sp.vy, sp.vp, sp.vr
    local fy, mp, mr, kp, kr = 0, 0, 0, 0, 0
    local F = {}
    for i = 1, n do
      local s = st[i]
      local need = sp.g[i] - (y + s.fwd * p + s.left * r)
      if need <= -droop then
        sp.touch[i], sp.s[i], F[i] = false, -droop, 0
      else
        local vel = sp.gv[i] - (vy + s.fwd * vp + s.left * vr)
        local f = k * (sags[i] + math.min(need, bump)) + c * vel
        if need > bump then f = f + kb * (need - bump) + cb * vel end
        sp.touch[i], sp.s[i], F[i] = true, math.min(need, bump), f
      end
    end
    for i = 1, n do
      local s = st[i]
      local f = F[i]
      if sp.touch[i] then
        kp, kr = kp + k * s.fwd * s.fwd, kr + k * s.left * s.left
        local j = s.pair
        if j and sp.touch[j] then f = f + arb * (sp.s[i] - sp.s[j]); kr = kr + 0.5 * arb * (s.left - st[j].left) ^ 2 end
        if f < 0 then f = 0 end
      end
      fy, mp, mr = fy + f, mp + f * s.fwd, mr + f * s.left
    end
    local pressed = math.max(0, math.min(1, fy / GRAVITY))
    vy = vy + (fy - GRAVITY) * h
    vp = vp + (mp + want_p * kp * pressed) / ride.ip * h
    vr = vr + (mr + want_r * kr * pressed) / ride.ir * h
    sp.y, sp.p, sp.r = y + vy * h, math.max(-0.3, math.min(0.3, p + vp * h)), math.max(-0.3, math.min(0.3, r + vr * h))
    sp.vy, sp.vp, sp.vr = vy, vp, vr
  end
  local worst = 0
  for i = 1, n do
    local s = st[i]
    local over = sp.g[i] - (sp.y + s.fwd * sp.p + s.left * sp.r) - bump
    if over > worst then worst = over end
  end
  if worst > 0.02 then
    sp.y = sp.y + worst - 0.02
    if sp.vy < 0 then sp.vy = sp.vy * 0.3 end
  end
  self.lift = sp.y - h0
  self.pitch, self.roll = -sp.p, sp.r
end

function Van:wheel_offset(i)
  local sp, s = self.susp, self.stations[i]
  return sp.y + s.fwd * sp.p + s.left * sp.r + sp.s[i] - sp.t[i]
end

-- Where a point of the van's body is in the world, from the van's own metres (right +x is left, as the model): for the
-- lettering on its sides, the postmaster at its door, the parcel at its back.
function Van:to_world(lx, ly, lz)
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  return self.x + sinh * lz + cosh * lx, (self.lift or 0) + ly - (self.pitch or 0) * lz + (self.roll or 0) * lx, self.z + cosh * lz - sinh * lx
end

function Van:update(dt)
  if not self.susp.ready or self.driven or math.abs(self.speed) > 0.01 or self.back_open > 0.01 or self.back_want > 0 or math.abs(self.susp.vr) > 1e-3 or math.abs(self.susp.vy) > 1e-3 then
    self:drive(dt)
  end
end

local SIDE = { color = { 255, 255, 255, 255 } }
function Van:draw()
  local pt = self.parts_table
  pt.body.rx, pt.body.rz, pt.body.y = self.pitch, self.roll, self.lift or 0
  local sv = -self.steer * FEEL.lock
  for i, s in ipairs(self.stations) do
    local part = pt[s.name]
    part.y = self.susp.ready and self:wheel_offset(i) or 0
    part.rx = self.spin
    if s.front then part.ry = sv end
  end
  -- the rear doors open outwards about their hinges (on the van's back corners)
  pt.door_l.ry, pt.door_r.ry = -self.back_open * 1.9, self.back_open * 1.9
  -- (each door is drawn on its own and lifted by the ground under its hinge: give its height above that ground)
  for _, d in ipairs({ { pt.door_l, 0.84 }, { pt.door_r, -0.84 } }) do
    local hx, hy, hz = self:to_world(d[2], 0, -1.95)
    d[1].y = hy + nova.terrain_height(self.x, self.z) - nova.terrain_height(hx, hz)
  end
  pt.door_l.rx, pt.door_r.rx, pt.door_l.rz, pt.door_r.rz = self.pitch, self.pitch, self.roll, self.roll
  self.draw_opts.ry = self.heading
  nova.model("van", self.x, 0, self.z, self.draw_opts)
  -- FERNHOLLOW POST on both sides of the box, just off the panel, moving with the body's lean
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  for _, side in ipairs({ 1, -1 }) do
    local x, y, z = self:to_world(side * 0.885, 1.6, -0.55)
    SIDE.face = { cosh * side, 0, -sinh * side }
    SIDE.w, SIDE.h = 2.2, 0.38
    nova.billboard("van_side", x, y, z, 2.2, SIDE)
  end
end

return Van

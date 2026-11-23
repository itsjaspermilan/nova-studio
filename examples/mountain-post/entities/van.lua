-- The post van. Its body rides on four springs and dampers, one at each wheel, so it leans out in a bend, dips its nose when it
-- brakes and squats when it pulls away, and bobs over the bumps of a gravel lane. The suspension solver and the wheels' layout
-- are taken from Pine Ridge Rally's car (examples/pine-ridge-rally/entities/car.lua, 2026-11-21: `wheel_layout`, `ride_of`,
-- `Car:suspension`, `Car:wheel_offset`), copied here and cut down to one vehicle; the driving is new and gentle: a leisurely start,
-- a top speed of about 38 km/h (the starting van: upgrades raise Van.TUNE), brakes that take a moment, heavy steering that forgives,
-- no damage, no fuel, no gears to think about.
-- The scene sets `ctl` from the pad while the postmaster is in it; empty, it stands with its handbrake on. The postmaster sits in
-- its open cab while driving (entities/postmaster.lua draws them there); the parcels it holds ride in the hold behind, seen through
-- the back windows and when the rear doors swing open.
local engine_sound = require("nova.engine_sound")
local world = require("lib.world")
local state = require("lib.state")

local Van = nova.entity { model = "van", tags = { "van" }, velocity = false }

-- The feel, in numbers (metres, seconds): the STARTING van (the owner, after the second play: "the van can be slower to start and wait
-- for the upgrades to be faster"; "The turning is too aggressive and doesn't feel like there's actual weight to it"). Upgrades will
-- raise `power`, `top` and `brake` (and perhaps `lock` and `grip`); everything else follows from them. Measured over a drive (the
-- tests' record): 0 to 30 km/h in about 6 s, a top speed of about 10.5 m/s (38 km/h) on the flat.
-- Steering with weight: the stick asks for a wheel angle, less the faster it goes; the wheels move towards it no faster than
-- `steer_speed` (full lock a second) and ease in and out of that; the body's turning then follows what the wheels ask over `yaw_lag`
-- seconds (a heavy van takes a moment to start and to stop turning), and asks less than the wheels as the sideways pull grows past
-- `corner` m/s^2 (gentle understeer: a bend taken too fast runs wide rather than darting in).
-- Letting go comes back quicker than turning in (the owner, third play: "The 'turn back to straight' when the player eases off the
-- left stick while driving is too slow"): wheels heading back towards the middle move at `return_speed` with a quicker easing
-- (`return_ease`), and the body's turning unwinds over `unwind_lag`, so a van let go at town speeds runs straight within a third of a
-- second; turning in keeps its weighty easing. The lock is modest ("We can also increase the turn radius for the van"): a kerb-to-kerb
-- circle of about 9.5 m at a crawl, sweeping round a bend rather than pivoting, and wider the faster it goes (less lock, and the
-- understeer past `corner`).
Van.TUNE = {
  power = 2.3,          -- m/s^2 pulling away (a leisurely start); it fades as the speed climbs to `top`
  top = 12.5,           -- the speed the pull fades to nothing at; with the air and the rolling it tops out near 10.5 m/s on the flat
  reverse = 3.0,        -- m/s at most backwards
  brake = 4.5,          -- m/s^2 at full brake: it takes a moment to stop
  coast = 0.5,          -- m/s^2 rolling and engine braking with nothing pressed
  drag = 0.004,         -- the air, per (m/s)^2
  grass = 0.6,          -- m/s^2 more rolling on the grass (the soft ground holds it back; with the starting van's pull it still gets going)
  gravel = 0.12,        -- and on a gravel lane
  lock = math.rad(18.3), -- the front wheels at full lock, at a crawl: a 10 m kerb-to-kerb circle on the 1.31 m wheelbase (it was 9.2)
  lock_fast = 0.35,     -- the share of the lock the stick gives at the top speed (less lock the faster it goes)
  steer_speed = 1.0,    -- the most the wheels move in a second (in shares of full lock): a flick of the stick is never a snap
  steer_ease = 5.0,     -- how quickly the wheels' own movement starts and stops (1/s)
  return_speed = 5.0,   -- the most the wheels move in a second heading back towards the middle (stick eased off or let go)
  return_ease = 24,     -- and how quickly that movement starts (1/s): back to straight at once, not a slow unwinding
  yaw_lag = 0.28,       -- seconds for the body's turning to catch up with the wheels as they turn in
  unwind_lag = 0.06,    -- and as they come back (the van straightens with the wheels)
  corner = 3.2,         -- m/s^2 of sideways pull past which it turns less than the wheels ask (understeer)
  past = 0.12,          -- the share of what the wheels ask past `corner` that it still turns (small: it runs wide, gently)
  grip = 6,             -- how fast a sideways slip dies away (1/s): it holds the road, with a little give
  pull = 0.0035,        -- radians a second the van wanders to the left with the wheel let go (the Mayor's letter; barely felt)
  hill = 5.5,           -- how much a slope pulls (m/s^2 at 100 %)
}
local FEEL = Van.TUNE
local GEARS = { 4, 7.5, 11 }           -- the speed at which each gear runs out (for the engine's note only; the slower van's range)
-- The body against the world and the walkers: three circles along it (from the model's middle, along +z), each of this radius.
-- The van (tools/van.mjs) is 2.97 m long over its bumpers (z -1.48 to 1.49) and 1.34 wide.
Van.BODY = { offs = { 0.83, 0, -0.83 }, r = 0.66 }
-- The lamps (tools/van.mjs makes each its own part): the headlamps glow softly while `head` is on; the tail lamps glow bright while
-- braking and the reverse lamps light while reversing (by themselves). `beams` casts real light from the headlamps (two spot lights,
-- nova.point_light): off in the daytime slice, for night to switch on. Van:lamps() says what is lit this frame.
Van.LIGHTS = { head = true, beams = false, beam_reach = 16, beam_color = { 255, 236, 200 } }
Van.HEADLAMPS = { { 0.47, 0.5, 1.43 }, { -0.47, 0.5, 1.43 } }   -- (the lenses' middles, the van's own metres)
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
  self.wheel_r = self.stations[1].y
  -- (the rear doors are children of the body in the model: they lean, roll, pitch and turn with it, and only swing on their hinges)
  self.parts_table = { body = { rx = 0, rz = 0, y = 0 }, door_l = { ry = 0 }, door_r = { ry = 0 }, steering = { ry = 0 },
    lamp_head = { visible = true }, lamp_brake = { visible = false }, lamp_reverse = { visible = false }, lamp_reverse_off = { visible = true } }
  for _, s in ipairs(self.stations) do self.parts_table[s.name] = s.front and { rx = 0, ry = 0, y = 0 } or { rx = 0, y = 0 } end
  local n = #self.stations
  local function list(v) local t = {} for i = 1, n do t[i] = v end return t end
  self.susp = { y = 0, vy = 0, p = 0, vp = 0, r = 0, vr = 0, ready = false, s = list(0), touch = list(true), load = list(1), g = list(0), t = list(0), gv = list(0), bump = list(0) }
  self.pitch, self.roll, self.lift = 0, 0, 0
  self.last_vf = 0
  -- (lifted by the hills as one thing, by the ground under its middle: the springs below put each wheel on its own ground)
  -- (never cut away by nova.see_through: when the van would hide the postmaster, the camera moves instead: lib/camera.lua)
  self.draw_opts = { ry = 0, parts = self.parts_table, lift = "origin", see_through = false }
  self.back_open = 0      -- the rear doors, 0 shut to 1 open
  self.back_want = 0
  self.knock = 0
  self.engine = engine_sound.new(require("engines.van"), { volume = 0.55 })
  self.engine_on = false
end

function Van:teleport(x, z, heading)
  self.x, self.z, self.heading = x, z, heading
  self.velx, self.velz, self.speed = 0, 0, 0
  self.yaw_rate, self.steer, self.steer_v = 0, 0, 0
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
  -- the wheels: towards what the stick asks (less lock the faster it goes), at a limited and eased speed (it never darts); heading
  -- back towards the middle (the stick eased off or let go) quicker and with a quicker easing than turning in
  local want = steer_in * (1 - (1 - FEEL.lock_fast) * math.min(1, math.abs(vf) / FEEL.top))
  local back = self.steer ~= 0 and (want - self.steer) * self.steer < 0
  local top, ease = FEEL.steer_speed, FEEL.steer_ease
  if back then top, ease = FEEL.return_speed, FEEL.return_ease
  else self.steer_v = math.max(-top, math.min(top, self.steer_v or 0)) end -- (past the middle, turning in again: its own pace)
  local rate = math.max(-top, math.min(top, (want - self.steer) * (back and 30 or 8)))
  self.steer_v = (self.steer_v or 0) + (rate - (self.steer_v or 0)) * math.min(1, dt * ease)
  local before = self.steer
  self.steer = self.steer + self.steer_v * dt
  -- (no overshoot past what the stick asks)
  if (before - want) * (self.steer - want) < 0 then self.steer, self.steer_v = want, 0 end
  local angle = self.steer * FEEL.lock
  -- a van turns by its speed over the radius its front wheels point at (wheelbase / tan(angle)); past `corner` of sideways pull it
  -- asks less (understeer); the body follows over `yaw_lag`
  local ask = -vf * math.tan(angle) / self.wheelbase
  local side = math.abs(ask * vf)
  if side > FEEL.corner then ask = ask * (FEEL.corner + (side - FEEL.corner) * FEEL.past) / side end
  if live and math.abs(steer_in) < 0.05 and math.abs(vf) > 2 then ask = ask + FEEL.pull * (vf > 0 and 1 or -1) end
  local was = self.yaw_rate or 0
  local lag = (math.abs(ask) < math.abs(was) or ask * was < 0) and FEEL.unwind_lag or FEEL.yaw_lag
  local yaw = was + (ask - was) * math.min(1, dt / lag)
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
  -- (the lamps: the tail lamps glow bright while it brakes, the reverse lamps light while it backs up)
  self.braking, self.reversing = false, false
  if brake > 0 then
    if vf > 0.3 then vf = math.max(0, vf - FEEL.brake * brake * dt); self.braking = brake > 0.05
    elseif go <= 0 then vf = math.max(-FEEL.reverse, vf - FEEL.power * 0.7 * brake * dt); self.reversing = brake > 0.05 end
  end
  if live and vf < -0.15 then self.reversing = true end
  -- rolling, engine braking, the air, the hills
  local sign = vf >= 0 and 1 or -1
  local coast = (go > 0 and 0.15 or FEEL.coast) + (self.surface == "grass" and FEEL.grass or self.surface == "gravel" and FEEL.gravel or 0)
  vf = vf - sign * math.min(math.abs(vf), (coast + FEEL.drag * vf * vf) * dt)
  local gx, gz = nova.terrain_slope(self.x, self.z)
  if not world.on_bridge(self.x, self.z) then vf = vf - (gx * sinh + gz * cosh) * FEEL.hill * dt end
  if not live and math.abs(vf) < 0.4 then vf = 0 end -- (the handbrake: an empty van does not creep down a slope)
  -- the slip sideways dies away quickly: the van holds its line
  vl = vl * math.exp(-FEEL.grip * dt)
  self.speed = vf
  self.velx, self.velz = vf * sinh + vl * cosh, vf * cosh - vl * sinh
  -- moving: three circles along the van (Van.BODY) against the scenery, the water and the map's edges
  local nx, nz = self.x + self.velx * dt, self.z + self.velz * dt
  local hit = 0
  for _, off in ipairs(Van.BODY.offs) do
    local px, pz = nx + sinh * off, nz + cosh * off
    local mx, mz, stopped = world.move(px, pz, 0, 0, Van.BODY.r)
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
  self.spin = self.spin + vf / self.wheel_r * dt
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
  sp.h0 = h0
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
  local want_r = math.max(-1, math.min(1, lateral_accel / 3.2)) * ride.roll -- (full lean at the sideways pull where it begins to run wide)
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

-- How far a wheel's axle is above (or below) where it sits in the model, as the model is drawn: lifted by the ground under the
-- van's middle (`lift = "origin"`), so the wheel's own ground is in `sp.s` and the spring's travel.
function Van:wheel_offset(i)
  local sp, s = self.susp, self.stations[i]
  return sp.y + s.fwd * sp.p + s.left * sp.r + sp.s[i] - (sp.h0 or sp.t[i])
end

-- Where a point of the van's body is in the world, from the van's own metres (right +x is left, as the model): for the
-- lettering on its sides, the postmaster at its door, the parcel at its back.
-- (the body's small pitch and roll, as the model turns it: about x, then about z, for a few degrees taken as straight lines)
function Van:to_world(lx, ly, lz)
  local p, r = self.pitch or 0, self.roll or 0
  lx, ly, lz = lx - r * ly, ly - p * lz + r * lx, lz + p * ly
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  return self.x + sinh * lz + cosh * lx, (self.lift or 0) + ly, self.z + cosh * lz - sinh * lx
end

function Van:update(dt)
  if not self.susp.ready or self.driven or math.abs(self.speed) > 0.01 or self.back_open > 0.01 or self.back_want > 0 or math.abs(self.susp.vr) > 1e-3 or math.abs(self.susp.vy) > 1e-3 then
    self:drive(dt)
  end
end

local SIDE = { color = { 255, 255, 255, 255 } }
local BEAM = { radius = 16, color = { 255, 236, 200 }, dir = { 0, -0.12, 1 }, angle = 46 }
local PARCEL = { hazel = "parcel_hazel", pip = "parcel_pip" }
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
  -- the rear doors open outwards about their hinges (on the van's back corners); they are the body's children in the model, so the
  -- body's lean, roll and pitch carry them: only the swing is theirs
  pt.door_l.ry, pt.door_r.ry = -self.back_open * 1.9, self.back_open * 1.9
  -- the steering wheel turns with the front wheels, about a quarter turn each way
  pt.steering.ry = -self.steer * 1.6
  -- the lamps
  local lit = self:lamps()
  pt.lamp_head.visible, pt.lamp_brake.visible = lit.head, lit.brake
  pt.lamp_reverse.visible, pt.lamp_reverse_off.visible = lit.reverse, not lit.reverse
  self.draw_opts.ry = self.heading
  nova.model("van", self.x, 0, self.z, self.draw_opts)
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  -- (the headlamps' beams, for night: two spot lights tilted down onto the road ahead)
  if lit.beams then
    for _, at in ipairs(Van.HEADLAMPS) do
      local x, y, z = self:to_world(at[1], at[2], at[3])
      BEAM.radius, BEAM.color = Van.LIGHTS.beam_reach, Van.LIGHTS.beam_color
      BEAM.dir[1], BEAM.dir[2], BEAM.dir[3] = sinh, -0.12, cosh
      nova.point_light(x, y + nova.terrain_height(self.x, self.z), z, BEAM)
    end
  end
  -- FERNHOLLOW POST on both sides of the cargo box, on its upper half behind the doorways, just off the panel, moving with the lean
  for _, side in ipairs({ 1, -1 }) do
    local x, y, z = self:to_world(side * 0.68, 1.2, -0.58)
    SIDE.face = { cosh * side, 0, -sinh * side }
    SIDE.w, SIDE.h = 0.95, 0.324
    nova.billboard("van_side", x, y, z, 0.95, SIDE)
  end
  -- the parcels in the hold, on its floor, the first loaded furthest in
  for i, which in ipairs(state.van_load) do
    self:draw_inside(PARCEL[which], i == 1 and 0.2 or -0.22, 0.67, i == 1 and -0.5 or -0.95, i * 0.4)
  end
end

-- What is lit this frame: the headlamps (Van.LIGHTS.head) and their beams (Van.LIGHTS.beams, needs head), the brake lamps while
-- braking, the reverse lamps while backing up.
local LIT = {}
function Van:lamps()
  LIT.head = Van.LIGHTS.head and true or false
  LIT.beams = LIT.head and Van.LIGHTS.beams and true or false
  LIT.brake = self.driven and self.braking or false
  LIT.reverse = self.driven and self.reversing or false
  return LIT
end

-- Draws a model at a place in the van's body (its own metres), turned with the van and carried by the body's lean.
local INSIDE = { ry = 0, rx = 0, rz = 0, lift = "origin", see_through = false }
function Van:draw_inside(model, lx, ly, lz, turn)
  local x, y, z = self:to_world(lx, ly, lz)
  y = y + nova.terrain_height(self.x, self.z) - nova.terrain_height(x, z)
  INSIDE.ry, INSIDE.rx, INSIDE.rz = self.heading + (turn or 0), self.pitch or 0, self.roll or 0
  nova.model(model, x, y, z, INSIDE)
end

return Van

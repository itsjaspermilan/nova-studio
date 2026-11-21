-- A rally car. It is a real entity (so it is in the scene and is drawn with the others), but its driving is done by the
-- race scene calling `car:drive(dt)` after it has set `car.ctl` from the player's controls or from the AI.
local fx = require("lib.fx")
local state = require("lib.state")

local Car = nova.entity { model = "car_gt", tags = { "car" } }

local HIT_POINTS = { 1.0, -1.0 } -- where the car's two collision circles are, along it from the middle (metres)
local WHEEL_RADIUS = 0.30       -- (the models' wheels are 0.6 m across; the cars are 3.5 to 3.9 m long)
-- A gearbox for a car that has none of its own (each car of lib/state.lua has): the speed each gear runs out at (m/s) and how hard it pulls.
local GEARS = { { top = 13, pull = 1.35 }, { top = 22, pull = 1.12 }, { top = 30, pull = 0.97 }, { top = 38, pull = 0.86 }, { top = 44, pull = 0.78 } }
local UPSHIFT, DOWNSHIFT = 0.94, 0.45   -- changes up above this share of the gear's top speed, down below that one
local KICKDOWN = 0.8                    -- throttle pressed well down: down to the lowest gear the speed is below this share of
local SHIFT_TIME = 0.17                 -- seconds with no pull while the clutch is in
local IDLE_REV = 0.16
-- Where the wheels are, from the middle of the car: forwards, and to the left (+x is the left side when facing +z).
local WHEELS = {
  wheel_fl = { fwd = 1.1, left = -0.72 }, wheel_fr = { fwd = 1.1, left = 0.72 },
  wheel_rl = { fwd = -1.1, left = -0.72 }, wheel_rr = { fwd = -1.1, left = 0.72 },
}
local WHEEL_NAMES = { "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr", "wheel_ml", "wheel_mr" }
local WHEELBASE, TRACK = 2.2, 1.45
-- Where a model's wheels really are (from the parts' own origins): each is a station of the suspension, fixed to the body at that spot,
-- so that the ground is found under each tyre and the body is held up by the car's own wheelbase and track (a long coupe on a slope has
-- its front wheel well ahead of the middle, a short 4x4 close to it). `y` is the wheel's middle above the ground at rest (its radius).
-- A six-wheeler's middle pair (wheel_ml, wheel_mr) are stations too. Each station: name, fwd, left (+x), y, front (it steers), and
-- `pair`, the station across the axle from it (the anti-roll bar joins them).
local LAYOUTS = {}
local function wheel_layout(model)
  if LAYOUTS[model] then return LAYOUTS[model] end
  local wheels = {}
  for name, w in pairs(WHEELS) do wheels[name] = { fwd = w.fwd, left = w.left, y = WHEEL_RADIUS } end
  local ok, pose = pcall(nova.model_pose, model)
  if ok and type(pose) == "table" and pose.wheel_fl and pose.wheel_fr and pose.wheel_rl and pose.wheel_rr then
    wheels = {}
    for _, name in ipairs(WHEEL_NAMES) do
      local p = pose[name]
      if p then wheels[name] = { fwd = p.z, left = p.x, y = p.y } end
    end
  end
  local fl, fr, rl, rr = wheels.wheel_fl, wheels.wheel_fr, wheels.wheel_rl, wheels.wheel_rr
  local wb = (fl.fwd + fr.fwd) / 2 - (rl.fwd + rr.fwd) / 2
  local tr = (math.abs(fl.left - fr.left) + math.abs(rl.left - rr.left)) / 2
  if wb < 0.5 or tr < 0.5 then wheels, wb, tr = nil, WHEELBASE, TRACK end
  if not wheels then
    wheels = {}
    for name, w in pairs(WHEELS) do wheels[name] = { fwd = w.fwd, left = w.left, y = WHEEL_RADIUS } end
  end
  local stations = {}
  for _, name in ipairs(WHEEL_NAMES) do
    local w = wheels[name]
    if w then stations[#stations + 1] = { name = name, fwd = w.fwd, left = w.left, y = math.max(0.15, w.y or WHEEL_RADIUS), front = name == "wheel_fl" or name == "wheel_fr" } end
  end
  for i, s in ipairs(stations) do
    local other = s.name:sub(1, -2) .. (s.name:sub(-1) == "l" and "r" or "l")
    for j, t in ipairs(stations) do if t.name == other then s.pair = j end end
    s.index = i
  end
  local layout = { wheels = wheels, stations = stations, wheelbase = wb, track = tr }
  LAYOUTS[model] = layout
  return layout
end
-- How bumpy each surface is (metres of ground height); a tyre rolls over what is smaller than itself, so the bumps under a wheel are
-- followed at this rate (1 / seconds: at 40 m/s a 60 fps frame samples them so coarsely that the wheels would hop at random).
local BUMPS = { road = 0.004, dirt = 0.025, rough = 0.045, verge = 0.025 }
local WHEEL_FOLLOW = 14
local SPRING, DAMPER = 560, 47   -- (a car of lib/state.lua with no numbers of its own)
local GRAVITY = 9.8
local VERGE = -0.035              -- the grass beside the road sits this far below the road's surface (a wheel off the edge drops onto it)

-- The suspension of a car of lib/state.lua, from its few numbers (`spring`, `damper`, `lean`, and `ride` to set any of these by hand):
--   hz       how fast the body bobs on its springs (the heave's natural frequency): from `spring`, 1.2 for the soft 4x4s to 2 for the GT2
--   damping  the share of critical damping: about 0.4, so a landing compresses, rebounds once and settles
--   bump, droop  how far a wheel can rise into its arch (to the bump stop) and hang below its place at rest (to the droop stop), metres:
--            from how far the springs sag under the car's weight, so a soft car has long travel and a stiff one short
--   roll     the body's lean at the car's hardest cornering, degrees (and its nod under the hardest braking is `pitch`): from `lean`
--   arb      the anti-roll bars, as a share of a spring: stiff on the road cars, soft on the 4x4s so each wheel follows the ground
-- Everything the solver needs is worked out here once per car (masses are per kilogram of car, so only the shapes matter).
local RIDES = {}
local function ride_of(c, layout)
  local key = (c.id or "?") .. "/" .. tostring(layout)
  if RIDES[key] then return RIDES[key] end
  local o = c.ride or {}
  local spring, damper, lean = c.spring or SPRING, c.damper or DAMPER, c.lean or 1
  local omega = (o.hz and o.hz * 2 * math.pi) or 0.42 * math.sqrt(spring)
  local zeta = o.damping or math.max(0.3, math.min(0.5, 0.42 * damper / (2 * math.sqrt(spring))))
  local sag = GRAVITY / (omega * omega)
  local n = #layout.stations
  local r = {
    omega = omega, zeta = zeta, sag = sag,
    k = omega * omega / n,                       -- each spring, per kilogram of the car (all of them together hold it up with `sag` of compression)
    c = 2 * zeta * omega / n,                    -- each damper
    bump = o.bump or math.max(0.035, math.min(0.13, 0.6 * sag)),
    droop = o.droop or math.max(0.06, math.min(0.2, 0.8 * sag + 0.02)),
    roll = math.rad(o.roll or (1.6 + 2.6 * (lean - 0.4))),
    pitch = math.rad(o.pitch or 0.75 * (1.6 + 2.6 * (lean - 0.4))),
    arb = o.arb or (c.class == "everyday" and 0.35 or 0.9),
  }
  -- the body's resistance to pitching and rolling (radius of gyration squared), and how stiffly the springs and bars hold it level
  r.ip = (0.42 * layout.wheelbase) ^ 2
  r.ir = (0.4 * layout.track) ^ 2
  local kp, kr = 0, 0
  for _, s in ipairs(layout.stations) do
    kp = kp + r.k * s.fwd * s.fwd
    kr = kr + r.k * s.left * s.left
    if s.pair then kr = kr + 0.5 * r.arb * r.k * (s.left - layout.stations[s.pair].left) ^ 2 end
  end
  r.kp, r.kr = kp, kr
  RIDES[key] = r
  return r
end

-- The height of the ground at a spot: a fixed, smooth pattern of bumps.
local function ground(x, z, size)
  return size * (math.sin(x * 0.9 + 1.3) * math.sin(z * 0.7 + 0.4) + 0.5 * math.sin(x * 1.9 - z * 1.1) + 0.3 * math.sin(z * 2.7 + x * 0.5))
end
-- Dirt on the body (nova.model's `dirt`): a loose road or the rough throws it up, as much as it gets after about 50 seconds at 30 m/s (sooner
-- sliding, or off the road); tarmac wears it off again in about 25 seconds of driving.
local DIRT_GAIN, DIRT_CLEAN = 1 / (50 * 30), 1 / 25
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
  self.power = 8               -- m/s squared in first, before the gear's pull is applied (it was 15: 100 km/h in 1.4 s)
  self.top = 44                -- m/s on the flat
  self.gear = 1
  self.shift_time = 0          -- while above 0 the clutch is in and the car is not pulling
  self.rev = IDLE_REV          -- the engine's revs, 0 to 1, for the sound and the rev counter
  self.brake_power = 30
  self.enabled = false         -- cars sit still until the race starts
  self.ctl = { throttle = 0, brake = 0, steer = 0, handbrake = false }
  self.progress = 0
  self.waypoint = nil
  self.model_id = getmetatable(self).__model   -- the model drawn: a car in one of its paints
  local layout = wheel_layout(self.model_id)
  self.wheels, self.wheelbase, self.track = layout.wheels, layout.wheelbase, layout.track
  self.stations = layout.stations
  self.wheel_radius = WHEEL_RADIUS
  -- the car's own machine (lib/state.lua): engine, gearbox, tyres, what loose ground does to it, suspension
  local c = state.car_of(self.model_id) or state.cars[1]
  self.car_id = c.id
  self.wheel_radius = c.wheel or WHEEL_RADIUS
  self.power, self.top = c.power or self.power, c.top or self.top
  self.grip_stat, self.brake_power = c.grip or 1, 30 * (c.brake or 1)
  self.gears, self.shift_seconds = c.gears or GEARS, c.shift or SHIFT_TIME
  self.turn = c.turn or 1
  self.loose_stat = c.loose or { dirt = 1, rough_top = 0.5, rough_drag = 1, rough_grip = 1 }
  self.ride = ride_of(c, layout)
  self.parts_table = { body = { rx = 0, rz = 0, y = 0 } }
  -- (a six-wheeler's middle axle is two more stations: wheel_ml and wheel_mr)
  for _, s in ipairs(self.stations) do self.parts_table[s.name] = s.front and { rx = 0, ry = 0, y = 0 } or { rx = 0, y = 0 } end
  self.tail = c.tail
  -- the suspension (see Car:suspension): the body's height in the world (`y`, where the model's ground line is), its nod (`p`, nose up)
  -- and lean (`r`, the +x side up) and their speeds; for each station its travel (`s`, metres, positive into the arch), whether its tyre
  -- touches (`touch`), the load on it (`load`, 1 = its share of the car at rest), the ground under it (`g`) and its bumps (`bump`)
  local n = #self.stations
  local function list(v) local t = {} for i = 1, n do t[i] = v end return t end
  self.susp = { y = 0, vy = 0, p = 0, vp = 0, r = 0, vr = 0, ready = false,
    s = list(0), touch = list(true), load = list(1), g = list(0), gv = list(0), bump = list(0), wx = list(0), wz = list(0) }
  self.contact, self.contact_front, self.contact_rear = 1, 1, 1
  for i, s in ipairs(self.stations) do
    if s.name == "wheel_rl" then self.rear_left = i elseif s.name == "wheel_rr" then self.rear_right = i end
  end
  self.air_time = 0
  self.last_vf, self.last_yaw = 0, 0
  -- rigid: the hills lift the whole car by the height under its middle (not every vertex by the height under it, which shears a car on a
  -- slope); the car tilts by its own pitch and roll, which come from the ground under each wheel (see `suspension`)
  self.draw_opts = { ry = 0, parts = self.parts_table, rigid = true }
  self.shadow_opts = { ry = 0 }
  self.bump_cooldown = 0
  self.y = 0
  self.damage = 0              -- the body, 0 (new) to 1 (wrecked): hits add to it and it never gets better
  self.tyres = 1               -- the tyres, 1 (new) to 0 (bald): sliding and the rough wear them
  self.pull = 0                -- which way a damaged car drifts: -1, 0 or 1
  self.smoke_carry = 0
  self.dirt = 0                -- how dirty the body is, 0 (clean) to 1
  self.dirt_rgb = { 0, 0, 0 }
end

-- The body picks up what the wheels throw up (the course's dust; snow lies on the roof and bonnet too) and sheds it on tarmac.
function Car:gather_dirt(dt, vf)
  local speed = math.abs(vf)
  if self.loose or self.surface ~= "road" then
    if speed > 2 then
      local hard = (self.surface == "rough" and 1.6 or 1) * (1 + self.slip)
      self.dirt = math.min(1, self.dirt + speed * DIRT_GAIN * hard * dt)
    end
  elseif speed > 3 then
    self.dirt = math.max(0, self.dirt - DIRT_CLEAN * dt)
  end
  if self.dirt <= 0.01 then
    self.draw_opts.dirt = nil
    return
  end
  if self.snowy == nil then self.snowy = require("lib.course").current().horizon == "snow" end
  -- (what sticks is damper and a little darker than the dust in the air; snow is snow)
  local c, k = self.dust_color or { 200, 190, 160 }, self.snowy and 1 or 0.85
  self.dirt_rgb[1], self.dirt_rgb[2], self.dirt_rgb[3] = c[1] * k, c[2] * k, c[3] * k
  self.draw_opts.dirt, self.draw_opts.dirt_color, self.draw_opts.dirt_on_top = self.dirt, self.dirt_rgb, self.snowy
end

-- How much the tyres hold: the circuit's grip, less what the wear has taken (a bald set holds 30% less).
function Car:grip_now()
  return (self.grip_scale or 1) * (self.grip_stat or 1) * (0.7 + 0.3 * self.tyres)
end

-- How fast the car can turn now (radians a second) with the wheel at full lock: what Car:drive gives a steer of 1 (for a driver that
-- steers by the turn it wants: steer = -turn / this).
function Car:yaw_capacity()
  local kind = SURFACE[self.surface] or SURFACE.road
  local loose = self.loose_stat
  local loose_grip = self.surface == "dirt" and loose.dirt or (self.surface == "rough" and loose.rough_grip or 1)
  local v = math.abs(self.speed)
  local downforce = 1 + math.min(0.6, v / 70)
  local omega = math.min(2.5, kind.lateral * self:grip_now() * loose_grip * downforce / math.max(v, 1), v * 0.2) * self.turn
  return math.max(0.05, omega * math.min(1, v / 1.5) * (0.2 + 0.8 * math.min(1, 4 * (self.contact or 1))))
end

-- How fast a sideways slide dies away now (1 / seconds): the rate at which the car's path swings round to where it points.
function Car:hold_rate()
  local kind = SURFACE[self.surface] or SURFACE.road
  local loose = self.loose_stat
  local loose_grip = self.surface == "dirt" and loose.dirt or (self.surface == "rough" and loose.rough_grip or 1)
  return math.max(1, kind.grip * self:grip_now() * loose_grip * (1 + math.min(0.6, math.abs(self.speed) / 70)))
end

function Car:teleport(x, z, heading)
  self.x, self.z, self.heading = x, z, heading
  self.velx, self.velz, self.speed = 0, 0, 0
  if self.susp then self.susp.ready = false end -- (the body is set down at its ride height, still, where the car now is)
end

-- One step of driving. Positive steer is to the right, which turns the heading *down* (heading 0 faces +z, and left is +x).
function Car:drive(dt)
  local c = self.ctl
  local kind = SURFACE[self.surface] or SURFACE.road
  -- what this car makes of loose ground: a 4x4 holds on gravel and ploughs on through the rough, a road car skates and bogs down
  local loose = self.loose_stat
  local loose_grip = self.surface == "dirt" and loose.dirt or (self.surface == "rough" and loose.rough_grip or 1)
  local grip_scale = self:grip_now() * loose_grip
  local live = self.enabled
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local vf = self.velx * sinh + self.velz * cosh
  local top = self.top * (self.surface == "rough" and loose.rough_top or 1) * (1 - 0.25 * self.damage) * (1 + 0.05 * (self.draft or 0)) -- (a slipstream: see race.lua)

  -- steering: the faster you go, the less the wheels can turn the car (and a damaged car drifts to one side)
  local steer = live and c.steer or 0
  if live and self.damage > 0.1 then steer = steer + self.pull * (self.damage - 0.1) * 0.2 * math.min(1, math.abs(vf) / 15) end
  local steering_speed = math.min(1, math.abs(vf) / 1.5)
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
  -- how fast the car can turn: what the tyres hold (less the faster it goes), and, below about 12 m/s, what the wheels' angle
  -- gives (a car turns by its speed over the radius of the circle the wheels point at: parking-speed turns are slow, not a spin)
  local omega = math.min(2.5, kind.lateral * grip_scale * downforce / math.max(math.abs(vf), 1), math.abs(vf) * 0.2) * self.turn
  if c.handbrake and live then omega = omega * 1.45 end
  -- lifting off the accelerator in a bend moves the weight onto the front tyres, which bite harder: the car turns in sharper (the
  -- player's car; it eases in and out over a quarter of a second or so, so that it is a feel and not a jolt)
  if self.is_player then
    local target = (live and c.throttle < 0.15 and vf > 6) and 1 or 0
    self.off_throttle = (self.off_throttle or 0) + (target - (self.off_throttle or 0)) * math.min(1, dt * 5)
    omega = omega * (1 + 0.3 * self.off_throttle * math.min(1, (math.abs(vf) - 6) / 12))
  end
  omega = omega * (1 - 0.45 * lock)
  -- a car in the air (no tyre on the ground: a jump) steers little and has no grip, power or brakes; while any tyre touches, it drives
  -- as it always has (a crest that lifts the front for a moment changes nothing: the handling is the one the suspension found)
  local touch = math.min(1, 4 * self.contact)
  omega = omega * (0.2 + 0.8 * touch)
  local direction = vf >= -0.5 and 1 or -1
  self.heading = self.heading - steer * omega * steering_speed * direction * dt
  self.yaw_rate = -steer * omega * steering_speed * direction

  -- the same velocity, seen from the new heading: the part sideways is a slide
  sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  vf = self.velx * sinh + self.velz * cosh
  local vl = self.velx * cosh - self.velz * sinh

  -- the gearbox changes by itself: up near the end of a gear, down when the revs fall away
  local GEARS, SHIFT_TIME = self.gears, self.shift_seconds
  local scale = 1 -- (each car's gears are in its own speeds)
  self.shift_time = math.max(0, self.shift_time - dt)
  local gear = GEARS[self.gear]
  local share = math.max(0, vf) / (gear.top * scale)
  if live and self.shift_time <= 0 then
    if share > UPSHIFT and self.gear < #GEARS and c.throttle > 0 then
      self.gear, self.shift_time, self.shifted = self.gear + 1, SHIFT_TIME, "up"
    elseif self.gear > 1 and vf > 0 then
      -- down when the revs fall away; and with the throttle pressed well down, straight to the lowest gear that still has room to
      -- pull (a kick-down: a car slowed in fifth does not crawl back up in it). (Coming into a gear from the one below, its own share
      -- is near UPSHIFT, above KICKDOWN, so the two never fight.)
      local want = self.gear
      while want > 1 do
        local here = vf / (GEARS[want].top * scale)
        local below = vf / (GEARS[want - 1].top * scale)
        if here < DOWNSHIFT or (c.throttle > 0.5 and below < KICKDOWN) then want = want - 1 else break end
      end
      if want < self.gear then
        self.gear, self.shift_time, self.shifted = want, SHIFT_TIME * 0.5, "down"
      end
    end
    gear = GEARS[self.gear]
    share = math.max(0, vf) / (gear.top * scale)
  end

  if live then
    if c.throttle > 0 and self.shift_time <= 0 then
      -- the pull fades towards the end of the gear; at the limiter it stops
      local push = vf < 0 and self.power * 1.4 or self.power * (1 - 0.2 * self.damage) * (1 + 0.12 * (self.draft or 0)) * gear.pull * math.max(0, 1 - 0.6 * share * share) * (share >= 1 and 0 or 1)
      vf = vf + push * c.throttle * touch * dt   -- (wheels in the air spin freely)
    end
    if c.brake > 0 then
      if vf > 0.6 then vf = vf - self.brake_power * c.brake * (1 - 0.3 * lock) * touch * dt
      else vf = math.max(-10, vf - self.power * 0.9 * c.brake * touch * dt) end -- (reverse: enough to back out of the grass, see below)
    end
  end
  -- hills: uphill takes speed away and downhill gives it (a little less than gravity: this is a game)
  local gx, gz = nova.terrain_slope(self.x, self.z)
  vf = vf - (gx * sinh + gz * cosh) * 7.5 * touch * dt
  -- rolling resistance, engine braking, and the grass dragging at the wheels
  -- (the grass drags hardest at speed; at a crawl it holds back only a little, so a car can always reverse out of it: with the
  -- whole drag at every speed, reverse, which pulled half as hard as first gear, could not move a car on the grass at all)
  local sign = vf >= 0 and 1 or -1
  local drag = kind.drag * (self.surface == "rough" and loose.rough_drag or 1) * math.min(1, 0.25 + math.abs(vf) / 10)
  vf = vf - sign * math.min(math.abs(vf), (1.1 + drag + 0.055 * math.abs(vf)) * dt)
  if vf > top then vf = vf - (vf - top) * 1.5 * dt end

  -- a drift: with power on in a bend the rear tyres let go by how much this car likes to (`oversteer`, the player's car only),
  -- and the sideways slide then dies away slowly, so the car goes on round the bend crabwise until the wheel or the throttle is eased
  local slide = 1
  if live and self.oversteer and vf > 9 then
    slide = 1 - math.min(0.8, self.oversteer * c.throttle * math.min(1, math.abs(steer) * 1.4) * math.min(1, (vf - 9) / 10))
  end
  local grip = kind.grip * grip_scale * downforce * (c.handbrake and live and 0.22 or 1) * (1 - 0.7 * lock) * slide * touch
  vl = vl * math.exp(-grip * dt)
  self.slip = math.min(1, math.abs(vl) / (math.abs(vf) * 0.25 + 2))
  if lock > 0.2 then self.slip = math.max(self.slip, lock) end -- (locked wheels smoke and wear the tyres)

  self.speed = vf
  self.velx, self.velz = vf * sinh + vl * cosh, vf * cosh - vl * sinh
  self.x, self.z = self.x + self.velx * dt, self.z + self.velz * dt

  -- scenery in the way: the car is two circles (the front and the rear, a metre either side of the middle), not one big one, so that its length
  -- touches a barrier and a corner glances off. A hit takes the speed into the object away (with a little bounce) and scrapes the rest along.
  self.scrape = math.max(0, (self.scrape or 0) - dt * 6)   -- (rubbing along a barrier: heard, lib/audio.lua)
  for _, off in ipairs(HIT_POINTS) do
    local px, pz = nova.scenery.push(self.x + sinh * off, self.z + cosh * off, 0.9)
    if px then
      self.scrape = math.min(1, math.sqrt(self.velx * self.velx + self.velz * self.velz) / 15)
      self.x, self.z = self.x + px, self.z + pz
      local nl = math.sqrt(px * px + pz * pz)
      if nl > 0 then
        local nx, nz = px / nl, pz / nl
        local into = self.velx * nx + self.velz * nz
        if into < 0 then
          self.velx, self.velz = self.velx - nx * into * 1.2, self.velz - nz * into * 1.2
          self.velx, self.velz = self.velx * 0.95, self.velz * 0.95
          if -into > 4 then
            self.hit = math.min(1, -into / 20)
            if self.damage < 0.1 and self.pull == 0 then self.pull = math.random() < 0.5 and -1 or 1 end
            -- scrapes cost nothing: only hard hits (a 15 m/s one is a tenth of the body, a 30 m/s one a third)
            self.damage = math.min(1, self.damage + math.max(0, -into - 6) * 0.0125)
          end
        end
      end
    end
  end

  -- the engine's revs follow the road speed through the current gear; they drop during a change, and flare with the throttle
  local want = IDLE_REV + (1 - IDLE_REV) * math.min(1, share) + (live and c.throttle > 0 and 0.06 or 0)
  if self.shift_time > 0 then want = want - 0.22 end
  if share >= 1 and live and c.throttle > 0 then want = want - (math.sin(nova.time() * 45) > 0 and 0.05 or 0) end  -- the limiter bounces
  self.rev = self.rev + (want - self.rev) * math.min(1, dt * (self.shift_time > 0 and 9 or 14))

  -- the suspension: each wheel hangs from the body on a spring and a damper and stands on the ground when it can reach it; the body
  -- rides on them and is pushed about by what the tyres do (braking, accelerating, cornering)
  self:suspension(dt, (vf - self.last_vf) / dt, (self.yaw_rate or 0) * vf)
  self.last_vf = vf
  self.steer_visual = self.steer_visual + (steer - self.steer_visual) * math.min(1, dt * 12)
  self.spin = self.spin + vf / self.wheel_radius * dt
  self.bump_cooldown = math.max(0, self.bump_cooldown - dt)

  if live and self.contact > 0 then self:gather_dirt(dt, vf) end

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

  -- skid marks from the rear tyres while they slide on the road (every metre or so they travel), each from where its tyre touches; a
  -- tyre in the air leaves none (its line breaks and starts again where it lands)
  local sp, rl, rr = self.susp, self.rear_left, self.rear_right
  local sliding = self.surface ~= "rough" and self.slip > 0.45 and math.abs(vf) > 4
  if sliding and (sp.touch[rl] or sp.touch[rr]) then
    for k, i in ipairs({ rl, rr }) do
      if sp.touch[i] then fx.skid(self, k, sp.wx[i], sp.wz[i]) end
    end
  elseif self.skidding then
    fx.skid_end(self)
  end
  self.skidding = sliding and (sp.touch[rl] or sp.touch[rr])

  -- a loose road (gravel, sand, snow) is thrown up by the rear wheels all the time, more the faster the car goes and the harder it is
  -- driven: from behind a rear tyre that touches
  if self.loose and self.surface ~= "rough" and math.abs(vf) > 6 and live then
    local rate = (6 + math.abs(vf) * 0.7) * (0.6 + 0.8 * math.min(1, math.max(self.slip, c.throttle * 0.5)))
    if math.random() < dt * rate then
      local i = math.random() < 0.5 and rl or rr
      if sp.touch[i] then
        local colour = self.dust_color or { 200, 190, 160 }
        local side = self.stations[i].left > 0 and 1 or -1
        -- (thrown up and back: a little of the car's speed, and a lot of lift)
        fx.puff(sp.wx[i] - sinh * 0.3, sp.wz[i] - cosh * 0.3, -self.velx * 0.12 + cosh * side * 0.8, -self.velz * 0.12 - sinh * side * 0.8, 0.4 + math.random() * 0.35, colour, 1.6)
      end
    end
  end

  -- dust and gravel behind the rear wheels
  if (self.surface == "rough" or self.slip > 0.5) and math.abs(vf) > 5 and self.contact_rear > 0 and math.random() < dt * 30 then
    local colour = self.dust_color or { 200, 190, 160 }
    local i = math.random() < 0.5 and rl or rr
    fx.puff(sp.wx[i] - sinh * 0.8 + cosh * (math.random() - 0.5) * 0.8, sp.wz[i] - cosh * 0.8 - sinh * (math.random() - 0.5) * 0.8, -self.velx * 0.2, -self.velz * 0.2, 1.1, colour)
  end
end

-- The suspension, a small rigid-body solver (per kilogram of car, so only the shapes and frequencies matter):
--   * the body has a height `y` in the world (where the model's ground line is), a nod `p` (nose up) and a lean `r` (+x side up), each
--     with a speed; gravity pulls it down;
--   * each wheel station is fixed to the body at the car's own wheel position. Its wheel hangs on a spring and a damper along the
--     body's up axis and can move from `droop` below its place at rest to `bump` above it. Where the ground is within reach the tyre
--     stands on it, the spring is compressed by as much and pushes the body up (with the damper against the speed of the compression,
--     the anti-roll bar against a difference across the axle, and a bump stop past the end of the travel); where it is not, the wheel
--     hangs at the droop stop, pushes nothing and grips nothing (Car:drive scales the steering, power, brakes and grip by `contact`);
--   * what the tyres do to the car pushes the body about its springs: braking dives the nose, power squats the tail, cornering leans
--     it out (the outside springs compress), each to at most the car's `roll` and `pitch` (lib/state.lua; see ride_of).
-- The ground under a tyre is the hills, the surface's bumps (rolled over: a tyre smooths what is smaller than itself) and, beside the
-- road, the grass a few centimetres below its edge. Cars far from the camera take one step a frame and no bumps.
local track_lib
function Car:suspension(dt, accel, lateral_accel)
  local sp, ride, st = self.susp, self.ride, self.stations
  local n = #st
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local h0 = nova.terrain_height(self.x, self.z) -- (the model is lifted by this: everything drawn is relative to it)
  local far = self.far
  local speed = math.abs(self.speed or 0)
  local size = far and 0 or (BUMPS[self.surface] or BUMPS.road) * math.min(1, 0.3 + speed / 20)
  -- the road's edge: how far each tyre is from the middle of the road (a race sets `left` and `waypoint` each frame)
  local edge_w, cos_d, sin_d
  if not far and self.left and self.waypoint then
    track_lib = track_lib or require("lib.track")
    local wp = track_lib.point(self.waypoint)
    if wp and wp.heading then
      local d = self.heading - wp.heading
      edge_w, cos_d, sin_d = (wp.w or 6) + 0.2, math.cos(d), math.sin(d)
    end
  end
  local follow = math.min(1, dt * WHEEL_FOLLOW)
  local gy, gfront, grear, nf, nr = 0, 0, 0, 0, 0
  for i = 1, n do
    local s = st[i]
    local wx = self.x + sinh * s.fwd + cosh * s.left
    local wz = self.z + cosh * s.fwd - sinh * s.left
    sp.wx[i], sp.wz[i] = wx, wz
    local g = nova.terrain_height(wx, wz)
    if not far then
      local raw, verge = 0, 0
      local bump_size = size
      if edge_w then
        local out = math.abs(self.left + s.left * cos_d + s.fwd * sin_d) - edge_w
        if out > 0 then
          local k = math.min(1, out / 0.15)
          verge = VERGE * k
          bump_size = size + (math.max(size, BUMPS.verge) - size) * k
        end
      end
      if bump_size > 0 then raw = ground(wx, wz, bump_size) end
      sp.bump[i] = sp.bump[i] + (raw - sp.bump[i]) * follow
      g = g + sp.bump[i] + verge
    end
    if sp.ready then sp.gv[i] = math.max(-6, math.min(6, (g - sp.g[i]) / dt)) else sp.gv[i] = 0 end
    sp.g[i] = g
    gy = gy + g
    if s.fwd > 0 then gfront, nf = gfront + g, nf + 1 else grear, nr = grear + g, nr + 1 end
  end
  if not sp.ready then
    -- set down at rest on the ground under the wheels
    sp.ready = true
    sp.y, sp.vy, sp.vp, sp.vr = gy / n, 0, 0, 0
    sp.p = (gfront / math.max(1, nf) - grear / math.max(1, nr)) / self.wheelbase
    sp.r = 0
    for i = 1, n do sp.s[i], sp.touch[i], sp.load[i] = 0, true, 1 end
  end

  -- what the tyres do to the body: a share of the hardest this car can corner and brake (or pull), each giving at most `roll`/`pitch`
  local lat_ref = 24 * (self.grip_stat or 1) * (self.turn or 1) * 1.2
  local n_lat = math.max(-1, math.min(1, lateral_accel / lat_ref))
  local long_ref = accel < 0 and (self.brake_power or 30) or (self.power or 8) * 1.5
  local n_long = math.max(-1, math.min(1, accel / long_ref))
  local tq_p = n_long * ride.pitch * ride.kp
  local tq_r = n_lat * ride.roll * ride.kr
  if self.hit then sp.vr, sp.vp = sp.vr + self.hit * 0.6 * (math.random() - 0.5), sp.vp + self.hit * 0.4 * (math.random() - 0.5) end -- a knock sets the body rocking

  local k, c, sag, bump, droop = ride.k, ride.c, ride.sag, ride.bump, ride.droop
  local kb, cb, arb = 25 * k, 3 * c, ride.arb * k
  local steps = far and 1 or 2
  local h = dt / steps
  local F = self.forces or {}
  self.forces = F
  local touching, front_touch, rear_touch, fronts = 0, 0, 0, 0
  for _ = 1, steps do
    local y, p, r, vy, vp, vr = sp.y, sp.p, sp.r, sp.vy, sp.vp, sp.vr
    for i = 1, n do
      local s = st[i]
      local need = sp.g[i] - (y + s.fwd * p + s.left * r)   -- how far into its travel the ground pushes this wheel (positive: up into the arch)
      if need <= -droop then
        sp.touch[i], sp.s[i], F[i] = false, -droop, 0
      else
        local vel = sp.gv[i] - (vy + s.fwd * vp + s.left * vr)
        local f = k * (sag + math.min(need, bump)) + c * vel
        if need > bump then f = f + kb * (need - bump) + cb * vel end
        sp.touch[i], sp.s[i], F[i] = true, math.min(need, bump), f
      end
    end
    local fy, mp, mr = 0, 0, 0
    touching = 0
    for i = 1, n do
      local s = st[i]
      local f = F[i]
      if sp.touch[i] then
        touching = touching + 1
        local j = s.pair
        if j and sp.touch[j] then f = f + arb * (sp.s[i] - sp.s[j]) end
        if f < 0 then f = 0 end
      end
      sp.load[i] = f / (k * sag)
      fy, mp, mr = fy + f, mp + f * s.fwd, mr + f * s.left
    end
    local share = touching / n
    vy = vy + (fy - GRAVITY) * h
    vp = vp + (mp + tq_p * share) / ride.ip * h
    vr = vr + (mr + tq_r * share) / ride.ir * h
    if touching == 0 then vp, vr = vp * math.exp(-1.5 * h), vr * math.exp(-1.5 * h) end -- (a little air: a jump does not tumble the car)
    sp.y, sp.p, sp.r = y + vy * h, math.max(-0.3, math.min(0.3, p + vp * h)), math.max(-0.3, math.min(0.3, r + vr * h))
    sp.vy, sp.vp, sp.vr = vy, vp, vr
  end
  -- the bump stops are solid: a wheel driven past one lifts the body with it (a hard landing), instead of sinking into the ground
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
  front_touch, rear_touch, fronts = 0, 0, 0
  for i = 1, n do
    if st[i].front then
      fronts = fronts + 1
      if sp.touch[i] then front_touch = front_touch + 1 end
    elseif sp.touch[i] then rear_touch = rear_touch + 1 end
  end
  -- (eased over a few hundredths of a second, so a tyre skipping over a bump on the grass does not flick the steering)
  local ease = math.min(1, dt * 25)
  self.contact = self.contact + (touching / n - self.contact) * ease
  self.contact_front = self.contact_front + (front_touch / math.max(1, fronts) - self.contact_front) * ease
  self.contact_rear = self.contact_rear + (rear_touch / math.max(1, n - fronts) - self.contact_rear) * ease
  if touching == 0 then self.air_time = self.air_time + dt else self.air_time = 0 end
  self.airborne = touching == 0
  self.lift = sp.y - h0
  -- (the body part's pitch is about x and tips the nose down for a positive angle; its roll is about z and lifts the +x side)
  self.pitch, self.roll = -sp.p, sp.r
end

-- Where a wheel is drawn: its station on the body, moved along its travel (relative to the model's place at rest, lifted by the hill
-- under the car's middle).
function Car:wheel_offset(i)
  local sp, s = self.susp, self.stations[i]
  return self.lift + s.fwd * sp.p + s.left * sp.r + sp.s[i]
end

function Car:draw()
  local pt = self.parts_table
  pt.body.rx, pt.body.rz, pt.body.y = self.pitch, self.roll, self.lift or 0
  local sv = -self.steer_visual * 0.45
  for i, s in ipairs(self.stations) do
    local part = pt[s.name]
    part.y = self.susp.ready and self:wheel_offset(i) or 0
    part.rx = self.spin
    if s.front then part.ry = sv end
  end
  self.draw_opts.ry = self.heading
  local dim = 255 - math.floor(110 * self.damage)
  self.draw_opts.tint = self.damage > 0.02 and { dim, dim, dim } or nil
  self.shadow_opts.ry = self.heading
  if not state.shadows then nova.model("shadow", self.x, 0, self.z, self.shadow_opts) end -- (a flat blob when there are no real shadows)
  nova.model(self.model_id, self.x, 0, self.z, self.draw_opts)
  self:draw_tail_lights()
end

-- Where each model's rear lamps are, in its own metres: `z` the back of the body, `y` the height, `x` how far out to each side (0: one
-- lamp in the middle, as on an open-wheel car or a kart). Measured from the red at the back of each model (2026-11-08); the road cars were
-- remade 2026-11-09 by scripts/rally/cars.mjs, which prints their numbers.
local TAIL = { z = -2.2, y = 0.8, x = 0.65 } -- (when a car's entry in lib/state.lua has no `tail`)
local LENS = { color = { 255, 40, 30, 255 } }
local GLOW = { color = { 255, 30, 20, 110 } }

-- The brake lights: bright red while the brake is on, and dim tail lights after dark. (Drawn as two small glows facing the camera:
-- the models' lamps are only painted on.)
function Car:draw_tail_lights()
  if self.night == nil then self.night = require("lib.course").current().night and true or false end
  local braking = self.enabled and (self.ctl.brake or 0) > 0.1
  if not braking and not self.night then return end
  local t = self.tail or TAIL
  local k = braking and 1 or 0.35
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local y = t.y + 0.06 + (self.lift or 0) - (self.pitch or 0) * t.z
  LENS.color[4] = math.floor(255 * (braking and 1 or 0.7))
  GLOW.color[4] = math.floor(110 * k)
  for _, side in ipairs(t.x > 0 and { -t.x * 0.92, t.x * 0.92 } or { 0 }) do
    local x = self.x + sinh * t.z + cosh * side
    local z = self.z + cosh * t.z - sinh * side
    local yy = y + nova.terrain_height(self.x, self.z) - nova.terrain_height(x, z) -- (a billboard is lifted by the hill under itself)
    nova.billboard("puff", x, yy, z, 0.2 * (0.7 + 0.3 * k), LENS)
    nova.billboard("puff", x, yy, z, 0.75 * k + 0.25, GLOW)
  end
end

return Car

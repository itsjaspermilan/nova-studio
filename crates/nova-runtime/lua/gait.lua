-- nova.gait and nova.spring: walking that keeps its feet on the ground, and the soft follow-through that makes a body look alive.
--
--   self.anim = nova.animator("hero", { start = "move", states = {
--     move = { blend = "speed", by = "distance", points = { { 0, "idle" }, { 1.6, "walk" }, { 3, "run" } } } } })
--   self.gait = nova.gait("hero", { bounce = { { 0, 0 }, { 1.6, 0.025 } } })
--   -- each frame, after moving the entity (x, z, face):
--   self.anim:set("speed", self.speed)
--   self.gait:update(dt, self, self.anim)              -- moves the animator by the ground covered and updates it
--   -- drawing:
--   self.anim:draw(self.x, self.y, self.z, { ry = self.face, parts = self.gait:parts(), extra = self.gait:extra() })
--
-- The gait is for figures whose legs are one piece from hip to ankle (character3d_make's chibi villagers; a jointed leg works too,
-- held straight). Each foot is down for a share of the cycle (`stance`) and then swings to where it will land; while it is down it
-- is fixed to the ground in the world, and each frame the leg is turned from the hip to reach it (and made a little shorter or longer
-- if it must, `squash` and `stretch`); a foot behind the body rolls up onto its toe and one far in front lands on its heel rather than
-- stretch the leg. So the feet cannot slide at any speed, in a turn, starting or stopping. The hips are set at the height the feet
-- allow, dipping as a foot lands (`bounce`), swinging round with the legs (`sway`) and rolling over the foot that stands (`roll`). The
-- cycle is the animator's: it moves by the ground covered (a distance blend), and when the body stops the foot in the air finishes
-- its step and a foot left behind steps up beside the other (a turn on the spot shuffles the feet round).
--
-- `follow` makes parts trail and spring with the body's motion (a big head that lags and nods, ears and a tail that stream and
-- bounce, a bag that swings): each is a damped spring per angle, driven by how the body speeds up, turns and bobs. The springs are
-- solved exactly for each step, so they settle and never blow up, whatever the frame rate.
local M = {}

local sqrt, sin, cos, atan, abs, min, max, exp, pi = math.sqrt, math.sin, math.cos, math.atan, math.abs, math.min, math.max, math.exp, math.pi
local TAU = 2 * pi

-- ------------------------------------------------------------------ springs
local Spring = {}
Spring.__index = Spring

--- `nova.spring { stiffness = 120, damping = 0.5, value = 0 }`: a value that follows a target like a weight on a spring.
--- `stiffness` (per second squared: its square root is how quickly it swings), `damping` (0 swings for ever, 1 settles without
--- overshooting). `s:update(target, dt)` returns the new value; `s:kick(v)` adds speed; `s:set(v)` puts it there at rest.
function M.spring(opts)
  opts = opts or {}
  if type(opts) ~= "table" then error("nova.spring { stiffness = 120, damping = 0.5 }", 2) end
  local k, z = opts.stiffness or 100, opts.damping or 0.5
  if type(k) ~= "number" or k <= 0 then error("nova.spring: stiffness must be a number above 0", 2) end
  if type(z) ~= "number" or z < 0 then error("nova.spring: damping must be 0 or more (1 settles without overshooting)", 2) end
  return setmetatable({ value = opts.value or 0, speed = 0, stiffness = k, damping = min(1, z) }, Spring)
end

-- (exactly: the damped spring's own motion over dt, so a long step lands where a run of short ones would and nothing grows)
function Spring:update(target, dt)
  if not (dt and dt > 0) then return self.value end
  dt = min(dt, 0.25)
  local w, zeta = sqrt(self.stiffness), self.damping
  local x0, v0 = self.value - target, self.speed
  local x, v
  if zeta >= 0.999 then
    local e = exp(-w * dt)
    local c = v0 + w * x0
    x = (x0 + c * dt) * e
    v = (c - w * (x0 + c * dt)) * e
  else
    local wd = w * sqrt(1 - zeta * zeta)
    local e = exp(-zeta * w * dt)
    local A, B = x0, (v0 + zeta * w * x0) / wd
    local c, s = cos(wd * dt), sin(wd * dt)
    x = e * (A * c + B * s)
    v = e * (-zeta * w * (A * c + B * s) + wd * (B * c - A * s))
  end
  if x ~= x or v ~= v then x, v = 0, 0 end
  self.value, self.speed = target + x, v
  return self.value
end
function Spring:kick(v) self.speed = self.speed + v end
function Spring:set(v) self.value, self.speed = v, 0 end

-- ------------------------------------------------------------------ small maths (quaternions are { x, y, z, w })
local function qmul(a, b)
  return { a[4] * b[1] + a[1] * b[4] + a[2] * b[3] - a[3] * b[2], a[4] * b[2] - a[1] * b[3] + a[2] * b[4] + a[3] * b[1],
    a[4] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[4], a[4] * b[4] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3] }
end
local function qconj(q) return { -q[1], -q[2], -q[3], q[4] } end
local function qrot(q, x, y, z)
  -- v + 2 w (u x v) + 2 u x (u x v)
  local ux, uy, uz, w = q[1], q[2], q[3], q[4]
  local cx, cy, cz = uy * z - uz * y, uz * x - ux * z, ux * y - uy * x
  local dx, dy, dz = uy * cz - uz * cy, uz * cx - ux * cz, ux * cy - uy * cx
  return x + 2 * (w * cx + dx), y + 2 * (w * cy + dy), z + 2 * (w * cz + dz)
end
local function qaxis(x, y, z, a) local s = sin(a / 2); return { x * s, y * s, z * s, cos(a / 2) } end
-- the shortest turn from one unit direction to another
local function qarc(ax, ay, az, bx, by, bz)
  local d = ax * bx + ay * by + az * bz
  if d < -0.99999 then return { 1, 0, 0, 0 } end
  local cx, cy, cz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
  local q = { cx, cy, cz, 1 + d }
  local n = sqrt(q[1] ^ 2 + q[2] ^ 2 + q[3] ^ 2 + q[4] ^ 2)
  return { q[1] / n, q[2] / n, q[3] / n, q[4] / n }
end
-- a turn from its three axes (the columns of its matrix)
local function qaxes(X, Y, Z)
  local m00, m11, m22 = X[1], Y[2], Z[3]
  local tr = m00 + m11 + m22
  local q
  if tr > 0 then
    local s = sqrt(tr + 1) * 2
    q = { (Y[3] - Z[2]) / s, (Z[1] - X[3]) / s, (X[2] - Y[1]) / s, 0.25 * s }
  elseif m00 > m11 and m00 > m22 then
    local s = sqrt(1 + m00 - m11 - m22) * 2
    q = { 0.25 * s, (Y[1] + X[2]) / s, (Z[1] + X[3]) / s, (Y[3] - Z[2]) / s }
  elseif m11 > m22 then
    local s = sqrt(1 + m11 - m00 - m22) * 2
    q = { (Y[1] + X[2]) / s, 0.25 * s, (Z[2] + Y[3]) / s, (Z[1] - X[3]) / s }
  else
    local s = sqrt(1 + m22 - m00 - m11) * 2
    q = { (Z[1] + X[3]) / s, (Z[2] + Y[3]) / s, 0.25 * s, (X[2] - Y[1]) / s }
  end
  return q
end
-- (the turn nova.model gives rx, ry, rz: about y, then x, then z)
local function qeuler(rx, ry, rz) return qmul(qmul(qaxis(0, 1, 0, ry), qaxis(1, 0, 0, rx)), qaxis(0, 0, 1, rz)) end
local function norm(x, y, z) local l = sqrt(x * x + y * y + z * z); if l < 1e-9 then return 0, -1, 0, 0 end return x / l, y / l, z / l, l end
local function wrap(a) return (a + pi) % TAU - pi end
local function smooth(u) return u * u * (3 - 2 * u) end
M.qmul, M.qrot, M.qeuler = qmul, qrot, qeuler

-- A number by the speed: a plain number, or points { { speed, value }, ... } in order, straight between them.
local function by_speed(v, s)
  if type(v) == "number" then return v end
  if s <= v[1][1] then return v[1][2] end
  for i = 2, #v do
    if s <= v[i][1] then
      local a, b = v[i - 1], v[i]
      return a[2] + (b[2] - a[2]) * (s - a[1]) / max(b[1] - a[1], 1e-6)
    end
  end
  return v[#v][2]
end

-- ------------------------------------------------------------------ a foot that rolls
-- The sole, seen from the side, is the lower half of an ellipse (`half` long each way from its middle, which is `forward` of the
-- ankle, and `round` deep), on the ground at its lowest point when flat. A foot that rolls onto its toe (a turn `a` above 0, the
-- heel coming up) or its heel (below 0) rolls along the ground like a rocker without slipping: the point it stands on has not
-- moved. The table says, for rolls from -1 to 1 radian, where the ankle is then (along the foot, and up) from where it is flat.
local ROLL_N = 40
function M.roll_table(ankle, forward, half, round)
  local cz, cy, A, B = forward, -(ankle - round), half, round
  local samples = 720
  local function point(t) return cz + A * cos(t), cy + B * sin(t) end
  local function speed(t) return sqrt((A * sin(t)) ^ 2 + (B * cos(t)) ^ 2) end
  local t0 = 1.5 * pi
  local out = {}
  for i = -ROLL_N, ROLL_N do
    local a = i / ROLL_N
    local ca, sa = cos(a), sin(a)
    -- the lowest point of the sole turned by a (z' = z cos a + y sin a, y' = -z sin a + y cos a)
    local best, bt = math.huge, t0
    for j = 0, samples do
      local t = pi + pi * j / samples
      local z, y = point(t)
      local yy = -z * sa + y * ca
      if yy < best then best, bt = yy, t end
    end
    -- the ground rolled along: the length of sole between the flat contact and this one
    local s, n = 0, 64
    for j = 1, n do
      local ta, tb = t0 + (bt - t0) * (j - 1) / n, t0 + (bt - t0) * j / n
      s = s + speed((ta + tb) / 2) * (tb - ta)
    end
    local z, y = point(bt)
    local zz = z * ca + y * sa
    out[i + ROLL_N + 1] = { s - zz + cz, -best }
  end
  return out
end

-- Where the ankle is (along the foot, up) from its flat place, rolled by a (radians, -1 to 1).
local function rolled(tbl, a)
  local f = (max(-1, min(1, a)) + 1) * ROLL_N
  local i = min(2 * ROLL_N, math.floor(f))
  local k = f - i
  local p, q = tbl[i + 1], tbl[min(i + 2, 2 * ROLL_N + 1)]
  return p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k
end
M.rolled = rolled

-- ------------------------------------------------------------------ the gait
local Gait = {}
Gait.__index = Gait

local DEFAULTS = {
  stance = { { 0, 0.6 }, { 1.0, 0.54 }, { 1.6, 0.5 }, { 3.0, 0.36 } }, -- the share of a cycle each foot is down, by speed (below a half: a run)
  lift = { { 0, 0.025 }, { 1.6, 0.045 }, { 3.0, 0.08 } }, -- how high a foot is lifted as it swings (metres)
  bounce = { { 0, 0 }, { 1.6, 0.022 }, { 3.0, 0.032 } },  -- how far the hips dip as a foot lands
  sway = { { 0, 0 }, { 1.6, 0.12 }, { 3.0, 0.08 } },      -- the hips' turn with the legs (radians), the shoulders the other way
  counter = 0.8,                                          -- how far the shoulders turn back against the hips' sway
  roll = { { 0, 0 }, { 1.6, 0.03 }, { 3.0, 0.02 } },      -- the hips' roll over the standing foot (radians)
  shift = { { 0, 0 }, { 1.6, 0.008 } },                  -- the hips' shift over the standing foot (metres)
  lean = { { 0, 0 }, { 1.6, 0.06 }, { 3.0, 0.16 } },      -- the body's lean into the way it goes (radians)
  lean_accel = 0.012,                                     -- more lean while speeding up, back while slowing (radians per m/s^2)
  stretch = 1.12, squash = 0.84,                          -- how far a leg may lengthen or shorten to reach its foot
  toe_roll = 0.75, heel_roll = 0.35,                      -- how far a foot may roll onto its toe behind or its heel in front (radians)
  settle = 2.4,                                           -- cycles a second of the steps that finish a stop or turn on the spot
  settle_speed = 0.3,                                     -- below this (m/s) a stop is settled (a foot in the air comes down, a foot left behind steps up)
  reach = 0.06,                                           -- a standing foot further than this from its place under the hip steps up
  turn = 0.6,                                             -- or one turned further than this (radians) from the body
  teleport = 1.0,                                         -- moved further than this in a step: put down where it is, no walk
  max_drop = 0.1,                                         -- the hips never squat lower than this below where they stand
  idle = true,                                            -- standing a while: a look round now and then, a shift of weight
}

--- `nova.gait(model, opts)`: see the top of this file and docs/project-format.md ("Feet that keep to the ground").
function M.new(model, opts)
  if type(model) ~= "string" then error("nova.gait(model, opts): the model's name", 2) end
  opts = opts or {}
  local o = {}
  for k, v in pairs(DEFAULTS) do o[k] = v end
  for k, v in pairs(opts) do o[k] = v end
  local rest = nova.model_pose(model)
  local g = setmetatable({ model = model, o = o, hips = o.hips or "hips", spine = o.spine or "spine", out = {}, ready = false, phase = 0.01 }, Gait)
  if not rest[g.hips] then error(("nova.gait: model '%s' has no part '%s' (give hips = ...)"):format(model, g.hips), 2) end
  g.rest_hips = rest[g.hips].y
  g.legs = {}
  for i, l in ipairs(o.legs or { { hip = "leg_l", foot = "foot_l", phase = 0.5 }, { hip = "leg_r", foot = "foot_r", phase = 0 } }) do
    local s, f = rest[l.hip], rest[l.foot]
    if not s or not f then error(("nova.gait: model '%s' has no leg '%s' with a foot '%s' (give legs = { { hip, foot, phase } })"):format(model, tostring(l.hip), tostring(l.foot)), 2) end
    local length = sqrt((s.x - f.x) ^ 2 + (s.y - f.y) ^ 2 + (s.z - f.z) ^ 2)
    local sole = l.sole or o.sole or {}
    local ankle = f.y - (f.low or 0)
    g.legs[i] = {
      hip = l.hip, foot = l.foot, offset = l.phase or (i - 1) * 0.5, length = length, hip_x = s.x, ankle = ankle,
      roll = M.roll_table(ankle, sole.forward or 0.025, sole.half or 0.082, sole.round or 0.034),
      sole = { ankle = ankle, forward = sole.forward or 0.025, half = sole.half or 0.082, round = sole.round or 0.034 },
      planted = true, x = 0, z = 0, yaw = 0, pitch = 0, steps = 0, socket_y = s.y,
    }
  end
  g.followers = {}
  for i, f in ipairs(o.follow or {}) do
    if not rest[f.part] then error(("nova.gait: model '%s' has no part '%s' to follow"):format(model, tostring(f.part)), 2) end
    local fl = { part = f.part, axes = {}, max = f.max or 0.8, swing = f.swing }
    for _, ax in ipairs({ "rx", "ry", "rz" }) do
      if f[ax] then fl.axes[#fl.axes + 1] = { name = ax, gains = f[ax], spring = M.spring { stiffness = f.stiffness or 80, damping = f.damping or 0.4 } } end
    end
    g.followers[i] = fl
  end
  g.lean = M.spring { stiffness = o.lean_stiffness or 60, damping = 0.8 }
  g.level = M.spring { stiffness = 260, damping = 1 }
  g.shift_x = M.spring { stiffness = 30, damping = 0.9 }
  g.idle_roll = M.spring { stiffness = 30, damping = 0.9 }
  g.idle_t, g.idle_next, g.idle_n, g.idle_look, g.idle_until = 0, 2.5, 0, 0, 0
  g.speed, g.vx, g.vz, g.ax, g.az, g.turn_rate, g.cadence = 0, 0, 0, 0, 0, 0, 0
  g.hy, g.hvy, g.hay = nil, 0, 0
  return g
end

-- The ground's height under a world point, in the model's own space (the body's own y is 0). The walker it is for is the
-- function's third argument (a body drawn lifted as one by the ground under its own place measures from there).
local function ground_w(g, x, z)
  local f = g.o.ground
  return f and f(x, z, g.e) or 0
end
-- Whether the ground rises by a step (a jump, not a slope) between a world point and `d` metres along (fx, fz) from it: the end is
-- higher, and the ground bends sharply between the middle and the ends (a stair's riser, the edge of a porch).
local function riser(g, x, z, fx, fz, d)
  local g0, g1, g2 = ground_w(g, x, z), ground_w(g, x + fx * d * 0.5, z + fz * d * 0.5), ground_w(g, x + fx * d, z + fz * d)
  return g2 > g0 + 0.015 and math.abs((g2 - g1) - (g1 - g0)) > 0.015
end
local function ground_at(g, e, x, z)
  local f = g.o.ground
  if f then return f(x, z, e) - (e.y or 0) end
  return 0
end

--- Puts both feet down under the hips where the body stands now (after a jump to another place, getting out of a seat).
function Gait:reset(e)
  self.e = e
  local face = e.face or e.ry or 0
  local c, s = cos(face), sin(face)
  for _, L in ipairs(self.legs) do
    L.planted, L.x, L.z, L.yaw, L.pitch, L.pivot = true, e.x + L.hip_x * c, e.z - L.hip_x * s, face, 0, "flat"
  end
  self.px, self.pz, self.face0 = e.x, e.z, face
  self.speed, self.vx, self.vz, self.ax, self.az, self.cadence = 0, 0, 0, 0, 0, 0
  self.ready = true
  self.level:set(0)
  self.last_y = e.y or 0
  self.reset_phase = true
end

--- Moves the gait on a step: `g:update(dt, entity, anim [, extra_layers])`. The entity's x, z and face (or ry) are where it is now;
--- `entity.look` (radians from its facing) is where its eyes go. The animator is moved by the ground covered (`anim:move`) and
--- updated; `extra_layers` are the layers drawn over its own (a carry over the arms), so the springs see the pose that is drawn.
function Gait:update(dt, e, anim, extra)
  local o = self.o
  self.e = e
  if not self.ready then self:reset(e) end
  local face = e.face or e.ry or 0
  local dx, dz = e.x - self.px, e.z - self.pz
  local moved = sqrt(dx * dx + dz * dz)
  if moved > o.teleport then self:reset(e); dx, dz, moved = 0, 0, 0 end
  self.px, self.pz = e.x, e.z
  dt = max(dt, 1e-4)
  -- how it moves: its speed, how it speeds up (in its own frame: forward, to its left), how fast it turns
  local k = min(1, dt * 18)
  local vx, vz = self.vx + (dx / dt - self.vx) * k, self.vz + (dz / dt - self.vz) * k
  local ax, az = (vx - self.vx) / dt, (vz - self.vz) / dt
  self.vx, self.vz = vx, vz
  self.ax, self.az = self.ax + (ax - self.ax) * min(1, dt * 10), self.az + (az - self.az) * min(1, dt * 10)
  local speed = sqrt(vx * vx + vz * vz)
  self.speed = speed
  local fs, fc = sin(face), cos(face)
  self.acc_fwd = self.ax * fs + self.az * fc
  self.acc_side = self.ax * fc - self.az * fs
  local turn = wrap(face - (self.face0 or face)) / dt
  self.face0 = face
  self.turn_rate = self.turn_rate + (turn - self.turn_rate) * min(1, dt * 12)

  -- the cycle: moved on by the ground covered; standing, a step that finishes a stop or turns the feet round
  local stride = (anim and anim.stride and anim:stride()) or o.stride or 0.6
  local slow = speed < o.settle_speed
  local stance = by_speed(o.stance, speed)
  if slow then stance = max(stance, 0.6) end
  local airborne, need = false, false
  for _, L in ipairs(self.legs) do
    if not L.planted then airborne = true
    else
      local hx, hz = e.x + L.hip_x * fc, e.z - L.hip_x * fs
      L.off = sqrt((L.x - hx) ^ 2 + (L.z - hz) ^ 2)
      if L.off > o.reach or abs(wrap(L.yaw - face)) > o.turn then need = true end
    end
  end
  local d = moved
  if slow and (airborne or need) then d = max(d, o.settle * dt * stride) end
  -- (a standing foot left too far behind, in a sharp turn or a stop, is picked up sooner: the cycle hurries while the hips strain)
  d = d + min(3, max(0, (self.strain or 0) - 0.015) / 0.02) * 1.5 * dt * stride
  -- (and before that: a foot behind rolled near the most it may onto its toe is about to be out of reach)
  for _, L in ipairs(self.legs) do
    if L.planted then
      local lim = (L.pitch or 0) >= 0 and o.toe_roll or o.heel_roll
      local r = abs(L.pitch or 0) / lim
      -- (onto its heel only counts once it has stood a moment: every foot lands on its heel)
      if r > 0.7 and ((L.pitch or 0) > 0 or (L.age or 0) > 0.12) then d = d + min(1, (r - 0.7) / 0.3) * 4 * dt * stride end
      L.age = (L.age or 0) + dt
      -- (a foot the body has turned away from, in a turn at a walk, steps round too)
      if abs(wrap(L.yaw - face)) > o.turn then d = d + 2 * dt * stride end
    end
  end
  local before = self.phase
  if anim and anim.move and anim:stride() then
    if self.reset_phase then anim.walk_phase = 0.01 end
    anim:move(d)
    self.phase = anim.walk_phase
  else
    if self.reset_phase then self.phase = 0.01 end
    self.phase = (self.phase + d / max(stride, 1e-3)) % 1
  end
  self.reset_phase = false
  if anim then anim:update(dt) end
  local dphase = (self.phase - before) % 1
  self.cadence = self.cadence + (dphase / dt - self.cadence) * min(1, dt * 8)
  -- the ground one cycle covers now (what it really walked, for where the next foot goes)
  local covered = min(stride, speed / max(dphase / dt, 0.4))
  self.stride_now, self.stance = covered, stance

  -- the feet: down (fixed where they landed) or swinging to where they will land
  local mvx, mvz = vx, vz
  if speed > 0.05 then mvx, mvz = vx / speed, vz / speed else mvx, mvz = fs, fc end
  local lift = by_speed(o.lift, speed)
  for _, L in ipairs(self.legs) do
    local ph = (self.phase - L.offset) % 1
    if ph < stance then
      if not L.planted then
        L.planted, L.x, L.z, L.yaw = true, L.sx or L.x, L.sz or L.z, L.syaw or face
        L.steps = L.steps + 1
        L.landed = true
        L.land_roll = min(0, L.pitch or 0) -- (it lands heel first and rolls down onto the sole)
        L.step_up = false
        L.age = 0
      end
      L.u = nil
    else
      if L.planted then
        L.planted = false
        L.fx, L.fz, L.fyaw, L.fpitch = L.x, L.z, L.yaw, L.pitch or 0
        L.g0 = ground_w(self, L.x, L.z)
        if L.clear then L.clear:set(L.g0) end
      end
      local u = min(1, (ph - stance) / max(1 - stance, 0.05))
      L.u = u
      -- where it lands: under its hip where the body will be then, half a stance's travel ahead
      local ahead = (1 - ph) * covered
      local fwd = stance * covered * 0.5
      -- (no further ahead than the leg can reach when it lands, rolled onto its heel)
      local ha, hu = rolled(L.roll, -o.heel_roll)
      local sh = L.socket_y - by_speed(o.bounce, speed)
      local r2 = (L.length * o.stretch) ^ 2 - (sh - hu) ^ 2
      fwd = min(fwd, 0.92 * ((r2 > 0 and sqrt(r2) or 0) - ha))
      local tx = e.x + mvx * (ahead + fwd) + L.hip_x * fc
      local tz = e.z + mvz * (ahead + fwd) - L.hip_x * fs
      -- (on a stair the whole sole lands on one tread: a toe that would reach into the riser of the step above, or a heel that
      -- would hang into the riser of the step behind, moves the landing back or forward, a little at a time, until it is clear)
      if o.ground then
        -- (with room for the toe as the foot rolls up onto it before it lifts: the ankle goes forward over the toe)
        local toe, heel = L.sole.forward + L.sole.half + 0.04, L.sole.half - L.sole.forward
        for _ = 1, 10 do
          if riser(self, tx, tz, fs, fc, toe) then tx, tz = tx - fs * 0.02, tz - fc * 0.02
          elseif riser(self, tx, tz, fs, fc, -heel) then tx, tz = tx + fs * 0.02, tz + fc * 0.02
          else break end
        end
      end
      local su = smooth(u)
      L.sx, L.sz = L.fx + (tx - L.fx) * su, L.fz + (tz - L.fz) * su
      L.syaw = L.fyaw + wrap(face - L.fyaw) * su
      L.lift = lift * sin(pi * u) * (slow and 0.6 or 1)
      -- (the ground it swings over, in the world: from where it lifted to where it lands, and never below the ground under it, so
      -- a foot goes up a step with the lift of its swing rather than jumping onto it)
      local g0, g1 = L.g0 or ground_w(self, L.fx, L.fz), ground_w(self, tx, tz)
      L.step_up = g1 > g0 + 0.03
      L.clear = L.clear or M.spring { stiffness = 900, damping = 1, value = g0 }
      -- (the ground under the whole sole, toe to heel, so the toe of a foot swinging up a stair clears the riser ahead of it)
      -- (only where the ground jumps, a step: on a slope the ground under the ankle is the one to follow)
      local sfx, sfz = sin(L.syaw), cos(L.syaw)
      local reach_t, reach_h = L.sole.forward + L.sole.half, L.sole.half - L.sole.forward
      local under = ground_w(self, L.sx, L.sz)
      if o.ground then
        if riser(self, L.sx, L.sz, sfx, sfz, reach_t) then under = max(under, ground_w(self, L.sx + sfx * reach_t, L.sz + sfz * reach_t)) end
        if riser(self, L.sx, L.sz, sfx, sfz, -reach_h) then under = max(under, ground_w(self, L.sx - sfx * reach_h, L.sz - sfz * reach_h)) end
      end
      L.swing_gw = max(g0 + (g1 - g0) * su, L.clear:update(under, dt))
    end
  end

  -- the hips: the pose the clips give them, then lowered to where the feet allow, swung and rolled with the step
  local layers = anim and anim:layers() or {}
  for _, l in ipairs(extra or {}) do layers[#layers + 1] = l end
  local pose = nova.model_pose(self.model, { layers = layers })
  self.pose = pose
  local H0, sp = pose[self.hips], pose[self.spine]
  local l1, l2 = pose[self.legs[1].hip], pose[self.legs[2] and self.legs[2].hip or self.legs[1].hip]
  local Xx, Xy, Xz = norm(l1.x - l2.x, l1.y - l2.y, l1.z - l2.z)
  if self.legs[1].hip_x < 0 then Xx, Xy, Xz = -Xx, -Xy, -Xz end
  local Yx, Yy, Yz = norm(sp.x - H0.x, sp.y - H0.y, sp.z - H0.z)
  local Zx, Zy, Zz = norm(Xy * Yz - Xz * Yy, Xz * Yx - Xx * Yz, Xx * Yy - Xy * Yx)
  Yx, Yy, Yz = Zy * Xz - Zz * Xy, Zz * Xx - Zx * Xz, Zx * Xy - Zy * Xx
  local qa = qaxes({ Xx, Xy, Xz }, { Yx, Yy, Yz }, { Zx, Zy, Zz })
  local P = self.phase
  local walking = min(1, speed / 0.5)
  -- (standing a while: now and then a look round or a shift of the weight onto one foot)
  if o.idle and speed < 0.05 and not airborne then
    self.idle_t = self.idle_t + dt
    if self.idle_t > self.idle_next then
      self.idle_n = self.idle_n + 1
      local n = self.idle_n
      local side = (n % 4 < 2) and 1 or -1
      if n % 2 == 1 then self.idle_look, self.idle_shift = side * 0.5, 0 else self.idle_look, self.idle_shift = 0, side end
      self.idle_until = self.idle_t + (n % 2 == 1 and 1.4 or 2.2)
      self.idle_next = self.idle_t + 3.2 + (n * 0.37) % 1.6
    end
    if self.idle_t > self.idle_until then self.idle_look, self.idle_shift = 0, 0 end
  else
    self.idle_t, self.idle_look, self.idle_shift = 0, 0, 0
    self.idle_next = 2.5
  end
  local shift = self.shift_x:update(-by_speed(o.shift, speed) * sin(TAU * P) * walking + (self.idle_shift or 0) * 0.022, dt)
  local idle_roll = self.idle_roll:update((self.idle_shift or 0) * -0.05, dt)
  local sway = by_speed(o.sway, speed) * cos(TAU * P) * walking
  local roll = by_speed(o.roll, speed) * sin(TAU * P) * walking + idle_roll + (type(e.bank) == "number" and e.bank or 0)
  local lean = self.lean:update(by_speed(o.lean, speed) + max(-0.15, min(0.15, (self.acc_fwd or 0) * o.lean_accel)), dt)
  local qt = qeuler(lean * 0.35, sway, roll)
  local qh = qmul(qa, qt)
  -- (the dip as each foot lands, the step's own bob: down on contact, up over the standing foot)
  local psi = (2 * P) % 1
  local bounce = by_speed(o.bounce, speed) * walking
  local want_y = self.rest_hips - bounce * (0.5 + 0.5 * cos(TAU * (psi - 0.08)))
  -- (a step up or down, a porch or a stair, jumps the body's own height; the hips go up or down it smoothly instead, the feet
  -- staying on the steps they stand on)
  -- (only a jump counts, more than 2 cm in a step: a ramp or a slope is followed as it is)
  local ey = e.y or 0
  if self.last_y and abs(ey - self.last_y) > 0.02 then self.level:set(self.level.value - (ey - self.last_y)) end
  self.last_y = ey
  local level = self.level:update(0, dt)
  local step_off = max(-0.25, min(0.25, level))
  want_y = want_y + step_off
  local dy = want_y - H0.y
  -- the sockets where the hips put them (in the model's own space), and each foot's place in it
  local c, s = fc, fs
  local function to_model(wx, wz) local px, pz = wx - e.x, wz - e.z; return px * c - pz * s, px * s + pz * c end
  -- (the sole, the lower half of an ellipse turned with the foot: how high the ankle, at (ax, az) in the model's space, must be for
  -- no point of the sole to be under the ground there)
  local function sole_floor(L, ax_, az_, pitch)
    local S = L.sole
    local fx, fz = sin(L.myaw), cos(L.myaw)
    local ca, sa = cos(pitch), sin(pitch)
    local low = -math.huge
    for j = 0, 8 do
      local t = pi + pi * j / 8
      local z, y = S.forward + S.half * cos(t), -(S.ankle - S.round) + S.round * sin(t)
      local zz, yy = z * ca + y * sa, -z * sa + y * ca
      local px, pz = ax_ + fx * zz, az_ + fz * zz
      low = max(low, ground_at(self, e, e.x + px * c + pz * s, e.z - px * s + pz * c) - yy)
    end
    return low
  end
  for _, L in ipairs(self.legs) do
    local S = pose[L.hip]
    local lx, ly, lz = qrot(qconj(qa), S.x - H0.x, S.y - H0.y, S.z - H0.z)
    L.lx, L.ly, L.lz = lx, ly, lz
    -- (the turn the clips gave the leg, which the gait's turn is put on top of: a swing, seen from where the ankle went)
    local A = pose[L.foot]
    local cx, cy, cz = norm(A.x - S.x, A.y - S.y, A.z - S.z)
    L.qclip = qarc(0, -1, 0, qrot(qconj(qa), cx, cy, cz))
    local fx, fz, fyaw
    if L.planted then fx, fz, fyaw = L.x, L.z, L.yaw else fx, fz, fyaw = L.sx, L.sz, L.syaw end
    local mx, mz = to_model(fx, fz)
    L.mx, L.mz, L.myaw = mx, mz, wrap(fyaw - face)
    L.gy = (not L.planted and L.swing_gw) and (L.swing_gw - (e.y or 0)) or ground_at(self, e, fx, fz)
  end
  local function socket(L, dyy)
    local x, y, z = qrot(qh, L.lx, L.ly, L.lz)
    return H0.x + shift + x, H0.y + dyy + y, H0.z + z
  end
  -- a standing foot's ankle when it rolls by `a` (above 0: onto its toe, below: onto its heel), in the model's space
  local function ankle(L, a)
    local along, up = rolled(L.roll, a)
    return L.mx + sin(L.myaw) * along, L.gy + up, L.mz + cos(L.myaw) * along
  end
  local Lmax = function(L) return L.length * o.stretch end
  local strain = 0
  -- no standing foot may be out of reach, even rolled as far as it goes: the hips come down for it (and for a foot about to land,
  -- or just lifted, a little at a time, so the hips never jump)
  for _, L in ipairs(self.legs) do
    local w = 1
    if not L.planted then
      local u = L.u or 0
      w = max(0, 1 - u / 0.25, smooth(max(0, min(1, (u - 0.5) / 0.5))))
    end
    if w > 0 then
      local sx, sy, sz = socket(L, dy)
      local fwd = (L.mx - sx) * sin(L.myaw) + (L.mz - sz) * cos(L.myaw)
      local ex, ey, ez = ankle(L, fwd < 0 and o.toe_roll or -o.heel_roll)
      local h2 = (ex - sx) ^ 2 + (ez - sz) ^ 2
      local reach = Lmax(L) ^ 2 - h2
      local top = ey + (reach > 0 and sqrt(reach) or 0) + (1 - w) * 0.3
      if sy > top then
        if L.planted then strain = max(strain, sy - top) end
        dy = dy - (sy - top)
      end
    end
  end
  self.strain = strain
  -- ... but never so low that a standing leg, shortened all it may, would push its foot into the ground (nor one about to land: a
  -- foot reaching up onto a step lifts the body as it goes)
  for _, L in ipairs(self.legs) do
    local w = L.planted and 1 or smooth(max(0, min(1, ((L.u or 0) - 0.4) / 0.6)))
    if w > 0 then
      local sx, sy, sz = socket(L, dy)
      local ex, ey, ez = ankle(L, 0)
      local h2 = (ex - sx) ^ 2 + (ez - sz) ^ 2
      local short = (L.length * o.squash) ^ 2 - h2
      local bottom = ey + (short > 0 and sqrt(short) or 0) - (1 - w) * 0.3
      if sy < bottom then dy = dy + (bottom - sy) end
    end
  end
  -- (and never squatting further than max_drop: past that a foot is left a little short rather than the body folding up)
  dy = max(dy, self.rest_hips + step_off - o.max_drop - H0.y)
  self.drop = self.rest_hips + step_off - (H0.y + dy) -- (how far the hips are below where they stand)
  -- the roll a foot needs at its place to be reached from its socket (0 when it is within reach flat)
  local function need(L, sx, sy, sz)
    local fwd = (L.mx - sx) * sin(L.myaw) + (L.mz - sz) * cos(L.myaw)
    local lim = fwd < 0 and o.toe_roll or -o.heel_roll
    local function dist(r) local x, y, z = ankle(L, r); return sqrt((x - sx) ^ 2 + (y - sy) ^ 2 + (z - sz) ^ 2) end
    if dist(0) <= Lmax(L) then return 0 end
    local lo, hi = 0, lim
    for _ = 1, 18 do
      local mid = (lo + hi) / 2
      if dist(mid) > Lmax(L) then lo = mid else hi = mid end
    end
    return hi
  end
  -- each leg turned from its socket to its ankle (a standing foot rolled as little as it must to be reached)
  local out = self.out
  local qhc = qconj(qh)
  for _, L in ipairs(self.legs) do
    local sx, sy, sz = socket(L, dy)
    local axx, axy, axz
    if L.planted then
      local a = need(L, sx, sy, sz)
      -- (just landed heel first: it rolls down onto the sole in a moment, never further than it must)
      L.land_roll = (L.land_roll or 0) * exp(-14 * dt)
      if a <= 0 then a = min(a, L.land_roll) end
      L.pitch, L.pivot = a, a > 1e-4 and "toe" or a < -1e-4 and "heel" or "flat"
      axx, axy, axz = ankle(L, a)
    else
      -- (swinging: rolled off the toe at first, reaching forward to land on the heel, as it must or a little)
      local u = L.u or 0
      local land = min(need(L, sx, sy, sz), -0.12 * walking)
      L.pitch, L.pivot = (L.fpitch or 0) * (1 - smooth(u)) + land * smooth(u), "air"
      axx, axy, axz = ankle(L, L.pitch)
      axy = axy + (L.lift or 0)
      -- (going up a step: a foot under the body cannot be lifted onto the tread above by a straight leg, however short it is made,
      -- and would hang into the riser; the leg kicks it forward instead, the way a short straight leg goes up a stair, until it is
      -- long enough to hold the foot that high)
      -- (and a foot in the air keeps its whole sole over the ground under it, toe to heel: over the edge of a step it is lifted
      -- clear of the tread above, not dragged through the riser)
      if o.ground then
        local fx, fz = sin(L.myaw), cos(L.myaw)
        for _ = 1, 3 do
          local floor = sole_floor(L, axx, axz, L.pitch)
          local low = floor + 0.004
          local changed = false
          if axy < low - 0.004 then axy, changed = low, true end
          -- (going down, a foot still over the step behind is held up there the same way: swung on the way it is from the hip; on
          -- level ground a foot passing under the body is left as it is)
          local hx, hy, hz = axx - sx, axy - sy, axz - sz
          local back = not L.step_up and (hx * fx + hz * fz) < 0
          if L.step_up or floor - L.sole.ankle > 0.03 then
            local gx, gz = fx, fz
            if back then gx, gz = -fx, -fz end
            local along = hx * gx + hz * gz
            local rest2 = hx * hx + hy * hy + hz * hz - along * along
            local short = L.length * o.squash * 1.01
            local want = sqrt(max(0, short * short - rest2))
            if want > along + 1e-4 then axx, axz, changed = axx + gx * (want - along), axz + gz * (want - along), true end
          end
          if not changed then break end
        end
      end
    end
    L.ax, L.ay, L.az = axx, axy, axz
    local nx, ny, nz, len = norm(axx - sx, axy - sy, axz - sz)
    local kx = max(o.squash, min(o.stretch, len / L.length))
    -- (a standing foot the leg cannot reach, left behind on the step below as the body goes up onto the next, hangs short of its
    -- place, and its toe would go into the riser in front of it: the leg swings it back and up instead, pushing off, as little as
    -- it must for the whole sole to be clear of the ground, until its step comes)
    -- (the same for a foot just lifted from the step behind, going down: out of reach up there, it is swung back clear of it)
    if o.ground and len > L.length * o.stretch + 0.004 then
      local r = L.length * o.stretch
      local pitch = max(-0.2, min(0.75, L.pitch))
      if sole_floor(L, sx + nx * r, sz + nz * r, pitch) > sy + ny * r + 0.004 then
        local bx, bz = -sin(L.myaw), -cos(L.myaw)
        local nb, nu = nx * bx + nz * bz, ny
        local lx_, lz_ = nx - nb * bx, nz - nb * bz
        local m, a0 = sqrt(nb * nb + nu * nu), math.atan(nu, nb)
        for k = 1, 14 do
          local a = a0 + k * 0.08
          local qx, qy, qz = lx_ + m * cos(a) * bx, m * sin(a), lz_ + m * cos(a) * bz
          local px, py, pz = sx + qx * r, sy + qy * r, sz + qz * r
          if k == 14 or sole_floor(L, px, pz, pitch) <= py + 0.004 then
            axx, axy, axz = px, py, pz
            nx, ny, nz, len = norm(axx - sx, axy - sy, axz - sz)
            L.pitch, L.pivot = pitch, "air"
            L.ax, L.ay, L.az = axx, axy, axz
            break
          end
        end
      end
    end
    L.scale = kx
    local hx, hy, hz = qrot(qhc, nx, ny, nz)
    local ql = qarc(0, -1, 0, hx, hy, hz)
    local qf = qmul(qconj(qmul(qh, ql)), qmul(qaxis(0, 1, 0, L.myaw), qaxis(1, 0, 0, L.pitch)))
    local turn = qmul(qconj(L.qclip), ql)
    local a = out[L.hip] or {}
    out[L.hip] = a
    a.quat = a.quat or {}
    a.quat.x, a.quat.y, a.quat.z, a.quat.w = turn[1], turn[2], turn[3], turn[4]
    a.scale = kx
    local b = out[L.foot] or {}
    out[L.foot] = b
    b.quat = b.quat or {}
    b.quat.x, b.quat.y, b.quat.z, b.quat.w = qf[1], qf[2], qf[3], qf[4]
    b.scale = 1 / kx
    -- (in the world, for whoever measures: the ankle, and the point of the sole on the ground)
    local wx, wz = e.x + axx * c + axz * s, e.z - axx * s + axz * c
    L.wx, L.wy, L.wz = wx, (e.y or 0) + axy, wz
  end
  -- the hips: shifted (in their own frame) and turned
  local hp = out[self.hips] or {}
  out[self.hips] = hp
  local tx, ty, tz = qrot(qconj(qa), shift, dy, 0)
  hp.x, hp.y, hp.z = tx, ty, tz
  hp.quat = hp.quat or {}
  hp.quat.x, hp.quat.y, hp.quat.z, hp.quat.w = qt[1], qt[2], qt[3], qt[4]
  -- the shoulders turn back against the hips' sway, and the body leans
  local spn = out[self.spine] or {}
  out[self.spine] = spn
  spn.ry = -sway * (1 + o.counter)
  spn.rx = lean * 0.65
  spn.rz = -roll * 0.6
  -- the hips' vertical motion (for the springs: the bob a head nods with)
  local hy = H0.y + dy
  if self.hy then
    local vy = (hy - self.hy) / dt
    self.hay = self.hay + ((vy - self.hvy) / dt - self.hay) * min(1, dt * 20)
    self.hvy = vy
  end
  self.hy = hy
  -- the springs
  local drivers = self.drivers or {}
  self.drivers = drivers
  drivers.fwd, drivers.side, drivers.up, drivers.turn, drivers.speed = self.acc_fwd, self.acc_side, self.hay, self.turn_rate, speed
  drivers.look = (type(e.look) == "number" and e.look or 0) + self.idle_look
  drivers.step = sin(TAU * psi)
  drivers.cycle = sin(TAU * P)
  drivers.one = 1
  for _, f in ipairs(self.followers) do
    if f.swing then
      local a, b = pose[f.swing[1]], pose[f.swing[2]]
      local ang = atan(b.z - a.z, a.y - b.y)
      if f.last_ang then
        local w = (ang - f.last_ang) / dt
        f.swing_rate = (f.swing_rate or 0) + (w - (f.swing_rate or 0)) * min(1, dt * 20)
      end
      f.last_ang = ang
      drivers.swing = f.swing_rate or 0
    else
      drivers.swing = 0
    end
    local p = out[f.part] or {}
    out[f.part] = p
    for _, ax in ipairs(f.axes) do
      local t = 0
      for name, gain in pairs(ax.gains) do t = t + gain * (drivers[name] or 0) end
      t = max(-f.max, min(f.max, t))
      p[ax.name] = ax.spring:update(t, dt)
    end
  end
  return self
end

--- The `parts` to draw with (the hips, legs, feet and the parts that follow), merged into `into` when given (the entries already
--- there, a face's, keep their own fields).
function Gait:parts(into)
  into = into or {}
  for name, v in pairs(self.out) do
    local p = into[name]
    if p == nil then into[name] = v
    elseif p ~= v then for k, x in pairs(v) do p[k] = x end end
  end
  return into
end

--- The layers to draw over the animator's own (`extra`, a carry over the arms): the same as were given to `update`.
function Gait:extra(list) return list or {} end

--- The feet: for each leg `{ x, y, z, planted, pivot, pitch, steps }`, in the world (the ankle; `pivot` is "flat", "toe", "heel" or
--- "air", the part of the sole on the ground).
function Gait:feet()
  local list = {}
  for i, L in ipairs(self.legs) do
    list[i] = { x = L.wx, y = L.wy, z = L.wz, planted = L.planted, pivot = L.pivot, pitch = L.pitch, steps = L.steps, yaw = L.planted and L.yaw or L.syaw, sole = L.sole, part = L.foot }
  end
  return list
end

return M

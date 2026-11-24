-- The postmaster: a fox in a blue postal jacket and a peaked cap (models/postmaster.glb, character3d_make). The left stick moves
-- as the camera sees it, and alone it only walks (a gentle push a slow walk, a full push the full walk), the arms swinging by the
-- sides. Holding B runs (the owner's fourth notes: "Walking the player shouldn't have their arms out. For running they will and
-- turning will also tilt them slightly in the direction that they're turning in"): the arms held straight out to the sides like wings
-- (the "run" clip; the walk and run clips are mixed by speed, so the arms ease up and down in about 0.2 s as B is pressed and let go),
-- and while running the body banks into a turn like an aeroplane, by how fast it is turning. Carrying a parcel, the arms hold it at
-- the chest (the "carry" clip laid over the arms) and B gives a brisk trot instead, banking half as much. In the van they sit at the wheel (the "sit" clip), drawn in the cab and carried by the
-- body as it leans, the hands on the wheel as it turns, the head turning a little into a bend. The scene decides what A and B do;
-- this file only moves, animates and is heard.
--
-- How it moves (the owner's fifth play: "it doesn't look like the character is a stiff person sliding while walking"): the speed
-- eases in and out (a spring: about 0.2 s to the full walk, a little longer to the run, a short settle to a stop); the body turns
-- towards the stick at a limited rate, the head looking round first, and always goes the way it faces, so a sharp turn back slows,
-- plants and pivots instead of sliding backwards. The feet are Nova's gait (nova.gait): the walk, run and trot are played by the
-- ground covered, each foot fixed to the ground while it stands, the legs turned from the hips to reach them, so nothing slides at
-- any speed; the hips dip as a foot lands and sway, the shoulders turn against them, the body leans into the way it goes and back
-- as it stops, and the head, ears, tail, bag and mittens follow on springs.
local world = require("lib.world")
local state = require("lib.state")
local camera = require("lib.camera")
local face = require("lib.face")

-- the top speeds of the walk, run and trot are those of the long, calm strides of tools/strides.mjs (TARGET there; the owner after
-- the second play: "the animation needs to slow down a bit and the player should be able to move faster"); the clips are played by
-- the ground covered, so the feet keep to it at these and every speed between
local STROLL = 1.6                   -- the walk's top: the stick alone walks, up to this
local TILT = 0.9                      -- a push this far (or further) walks at the full walk; less, slower
local TOP, TOP_CARRY = 3.0, 2.2        -- metres a second holding B: running, trotting with a parcel
-- The bank while running: the body rolls into a turn by how fast it is turning (radians of roll per radian a second of turn), up to
-- BANK_MAX, eased in and out; half as much trotting with a parcel; none walking. A sharp about-turn (the way it wants to face far
-- from the way it faces) is a pivot, not a bank.
local BANK_PER, BANK_MAX, BANK_EASE = 0.11, math.rad(13), 10
local RADIUS = 0.26
-- the speed's spring (its square root is how quick: about 0.2 s to the full walk, 0.3 s on to the run, 0.25 s to a stop)
local EASE_WALK, EASE_RUN, EASE_STOP = 19, 13, 18
-- turning (radians a second at most): quicker standing or slow, slower running; a turn back further than about 110 degrees from
-- where it faces brings it to a stop first, so it plants and pivots
local TURN_SLOW, TURN_WALK, TURN_RUN = 13, 8.5, 6
local CRAB = math.rad(78)
-- the stretch of floor the body's height is averaged over on steps (metres along the way it faces), and how much slower it goes on
-- them (a shorter, more careful stride)
local RAMP = {} for i = -10, 10 do RAMP[#RAMP + 1] = i * 0.02 end
local STAIR_PACE = 0.8
local STAIR_GLIDE = 0.65
local RAMP_LEAD = 0.0 -- (metres the stretch leads going up; half as much it lags going down) -- (m/s the hips rise or fall at most on steps)
local wrap = function(a) return (a + math.pi) % (2 * math.pi) - math.pi end

-- the gait: Nova's feet-on-the-ground walking (nova.gait), with the postmaster's own bounce and the parts that follow the body
-- (the owner's eighth play: "he kind of looks like he's shuffling when he's walking". A walk that reads as walking: each foot peels
-- up onto its toe as it leaves the ground (toe_off), is picked up high early in its swing and then reaches forward (lift, lift_peak)
-- to land on its heel with the toes up (heel_strike) and roll down flat; the hips bob, sway and roll over the standing foot more)
local GAIT = {
  bounce = { { 0, 0 }, { 0.8, 0.02 }, { 1.6, 0.03 }, { 2.2, 0.03 }, { 3.0, 0.032 } },
  lift = { { 0, 0.04 }, { 0.8, 0.06 }, { 1.6, 0.07 }, { 3.0, 0.085 } },
  lift_peak = 0.42,
  toe_off = { { 0, 0 }, { 0.4, 0.35 }, { 1.6, 0.55 }, { 2.2, 0.45 }, { 3.0, 0.35 } },
  heel_strike = { { 0, 0.08 }, { 0.8, 0.22 }, { 1.6, 0.3 }, { 3.0, 0.18 } },
  heel_settle = 10,
  roll = { { 0, 0 }, { 1.6, 0.05 }, { 3.0, 0.025 } },
  shift = { { 0, 0 }, { 1.6, 0.014 } },
  -- (the run clip already leans well into it: a little more with speed, more while speeding up, back while stopping)
  lean = { { 0, 0 }, { 1.6, 0.05 }, { 3.0, 0.07 } },
  follow = {
    -- the big head: lags as the body sets off or stops, nods with each step, looks round first into a turn
    { part = "head", stiffness = 90, damping = 0.45, max = 0.45, rx = { fwd = -0.006, up = 0.005 }, ry = { look = 0.55 }, rz = { side = 0.006 } },
    -- the fox's ears trail a little as it goes and flick as it lands (no further than the holes in the hat leave room for)
    { part = "ear_l", stiffness = 160, damping = 0.35, max = 0.25, rx = { fwd = -0.01, speed = -0.04, up = -0.004 }, rz = { side = 0.01, up = -0.003 } },
    { part = "ear_r", stiffness = 160, damping = 0.35, max = 0.25, rx = { fwd = -0.01, speed = -0.04, up = -0.004 }, rz = { side = 0.01, up = 0.003 } },
    -- the brush: swings out of a turn, bounces with the steps
    { part = "tail", stiffness = 45, damping = 0.3, max = 0.6, ry = { turn = 0.12, side = 0.02 }, rx = { up = -0.006, fwd = 0.01 } },
    -- the mittens follow through at the end of each swing of the arms (and the arms out in the run flutter with the bob)
    { part = "hand_l", stiffness = 120, damping = 0.4, max = 0.35, swing = { "arm_l", "hand_l" }, rx = { swing = 0.03 } },
    { part = "hand_r", stiffness = 120, damping = 0.4, max = 0.35, swing = { "arm_r", "hand_r" }, rx = { swing = 0.03 } },
    { part = "arm_l", stiffness = 200, damping = 0.3, max = 0.2, rz = { up = 0.004 } },
    { part = "arm_r", stiffness = 200, damping = 0.3, max = 0.2, rz = { up = -0.004 } },
  },
}

-- the step it takes on and near stairs (the walk before the eighth play), eased into over about a tenth of a second
local STAIRS = {
  bounce = { { 0, 0 }, { 1.6, 0.02 }, { 2.2, 0.026 }, { 3.0, 0.03 } },
  lift = { { 0, 0.025 }, { 1.6, 0.045 }, { 3.0, 0.075 } },
  lift_peak = 0.5, toe_off = 0, heel_strike = 0.12, heel_settle = 14,
  roll = { { 0, 0 }, { 1.6, 0.03 }, { 3.0, 0.02 } },
  shift = { { 0, 0 }, { 1.6, 0.008 } },
}
local STAIR_KEYS = { "bounce", "lift", "lift_peak", "toe_off", "heel_strike", "heel_settle", "roll", "shift" }
-- (a value by the speed: a number, or { { speed, value }, ... } straight between them, as nova.gait reads them)
local function at_speed(v, s)
  if type(v) == "number" then return v end
  if s <= v[1][1] then return v[1][2] end
  for i = 2, #v do
    if s <= v[i][1] then return v[i - 1][2] + (v[i][2] - v[i - 1][2]) * (s - v[i - 1][1]) / (v[i][1] - v[i - 1][1]) end
  end
  return v[#v][2]
end

local Postmaster = nova.entity { model = "postmaster", tags = { "postmaster", "player" }, velocity = false }

local PARCELS = { hazel = "parcel_hazel", pip = "parcel_pip" }

function Postmaster:create()
  self.face = self.ry or 0
  self.speed = 0
  self.control = true          -- the stick moves it (false while it talks, reads, or gets into the van)
  self.seated = false          -- at the wheel of the van (the scene sets it getting in and out)
  self.steps = 0
  self.carry_w = 0
  self.anim = nova.animator("postmaster", {
    start = "move", fade = 0.18,
    states = {
      -- (played by the ground covered: the clips' strides, tools/strides.mjs)
      move = { blend = "speed", by = "distance", points = { { 0, "idle" }, { STROLL, "walk" }, { TOP, "run" } } },
      -- (with a parcel: the walk, then the trot; the carry is laid over the arms of both)
      laden = { blend = "speed", by = "distance", points = { { 0, "idle" }, { STROLL, "walk" }, { TOP_CARRY, "trot" } } },
      wave = { clip = "wave", loop = false, next = "move", fade = 0.15 },
      sit = { clip = "sit", fade = 0.1 },
    },
    on_event = function(event) if event == "step" then self:step() end end,
  })
  self.carry_layer = { { clip = "carry", time = 0, weight = 0, mask = { "arm_l", "arm_r" } } }
  self.parcel_opts = { ry = 0 }
  self.mood = face.new(5)
  self.gait = "still"           -- still, walk, run or trot (what the stick asks for; the tests read it)
  self.dust = {}                 -- little puffs kicked up by the run's steps
  self.draw_opts = { ry = 0 }
  self.bank = 0                  -- the roll into a turn while running (radians; the tests read it)
  self.run_held = false
  self.speed_spring = nova.spring { stiffness = EASE_WALK ^ 2, damping = 1 }
  self.look = 0                  -- where the head looks first, from where the body faces (radians)
  self.walker = nova.gait("postmaster", {
    bounce = GAIT.bounce, lift = GAIT.lift, lean = GAIT.lean, follow = GAIT.follow, lift_peak = GAIT.lift_peak, toe_off = GAIT.toe_off,
    heel_strike = GAIT.heel_strike, heel_settle = GAIT.heel_settle, roll = GAIT.roll, shift = GAIT.shift,
    ground = function(x, z, e)
      if self.indoors then return 0 end
      e = e or self
      if self.on_deck then return world.height(x, z) - nova.terrain_height(e.x, e.z) end
      return world.lift(x, z)
    end,
  })
  self.walk_parts = {}
end

-- A smile for a moment (a parcel handed over, a letter read).
function Postmaster:smile(seconds) face.set(self.mood, "happy", seconds or 2.5); nova.log("face postmaster happy") end

function Postmaster:step()
  self.steps = self.steps + 1
  if self.seated then return end
  local s = self.indoors and "wood" or world.surface(self.x, self.z)
  local name = (s == "road" and "step_road") or ((s == "gravel") and "step_gravel") or ((s == "bridge" or s == "wood") and "step_wood") or "step_grass"
  if self.gait == "run" or self.gait == "trot" then
    -- (light quick steps, a touch higher and softer; a tiny puff of dust off the ground outdoors)
    nova.sound.play(name, { volume = 0.26, pitch = 1.12, vary = 0.08 })
    if self.gait == "run" and not self.indoors and #self.dust < 8 then
      local s, c = math.sin(self.face), math.cos(self.face)
      self.dust[#self.dust + 1] = { x = self.x - s * 0.2, z = self.z - c * 0.2, age = 0 }
    end
  else
    nova.sound.play(name, { volume = 0.32 + 0.12 * math.min(1, self.speed / STROLL), vary = 0.07 })
  end
end

-- (a walk a test or a picture set going is dropped: getting into the van)
function Postmaster:stop_walking() self.walk_to, self.walk_path = nil, nil end

-- Turn to face a point (for a resident, a shelf, the van's door).
function Postmaster:face_to(x, z, dt)
  local want = math.atan(x - self.x, z - self.z)
  local turn = (want - self.face + math.pi) % (2 * math.pi) - math.pi
  self.face = self.face + turn * math.min(1, (dt or 1) * 10)
end

function Postmaster:update(dt)
  if self.seated then return self:sit(dt) end
  local mx, my = 0, 0
  if self.control then mx, my = nova.input.axis("move_x"), nova.input.axis("move_y") end
  local fx, fz = camera.forward()
  local rx, rz = -fz, fx -- (the camera's right: +x is the left of one facing +z)
  local dx, dz = rx * mx - fx * my, rz * mx - fz * my
  local len = math.sqrt(dx * dx + dz * dz)
  if len > 1 then dx, dz, len = dx / len, dz / len, 1 end
  local top = state.carrying and TOP_CARRY or TOP
  -- (the stick alone walks, up to the full walk at TILT; holding B runs, or trots with a parcel)
  self.run_held = self.control and nova.input.down("run") or false
  local want = 0
  if len > 0.15 then want = self.run_held and top or STROLL * math.min(1, len / TILT) end
  -- (on steps: the floor half a metre ahead or behind is a step higher or lower)
  local on_stairs, near = false, false
  if not self.indoors and not world.on_bridge(self.x, self.z) then
    local fx, fz = math.sin(self.face), math.cos(self.face)
    local here = world.lift(self.x, self.z)
    local step = function(d) return math.abs(world.lift(self.x + fx * d, self.z + fz * d) - here) > 0.05 end
    on_stairs = step(0.5) or step(-0.5)
    near = on_stairs or step(0.9) or step(-0.9)
  end
  self.on_stairs = on_stairs
  -- (and the hips glide up or down them, the legs flexing a little more for a moment, rather than jumping a step at a time: from a
  -- stride before the first step to a stride after the last)
  self.walker.o.glide = near and STAIR_GLIDE or nil
  -- (a few points to walk through in turn: a test leading it round the van)
  if not self.walk_to and self.walk_path and #self.walk_path > 0 then self.walk_to = table.remove(self.walk_path, 1) end
  if self.walk_to then
    -- (the scene leads it a few steps: to the van's door, out of the office's doorway)
    local tx, tz = self.walk_to[1] - self.x, self.walk_to[2] - self.z
    local d = math.sqrt(tx * tx + tz * tz)
    -- (a point it cannot reach, against a post or the van's side, is given up when it has had the time the walk should take)
    local pace = math.min(top, self.walk_pace or STROLL)
    if self.walk_for ~= self.walk_to then self.walk_for, self.walk_budget = self.walk_to, d / pace + 1.5 end
    self.walk_budget = self.walk_budget - dt
    if d < 0.12 or self.walk_budget <= 0 then self.walk_to = nil; want = 0 else dx, dz, want = tx / d, tz / d, math.min(pace, d * 4) end
    len = 1
  end
  -- the body turns towards the way asked at a limited rate (the head looks there first), and slows for a sharp turn: further than
  -- about 80 degrees round it slows to a stop, pivots and sets off again, never sliding backwards facing the wrong way
  local turn_rate, pivot = 0, 0
  local look = 0
  self.want_turn = 0
  if want > 0 and len > 0.15 then
    local turn = wrap(math.atan(dx, dz) - self.face)
    local limit = self.speed < 0.5 and TURN_SLOW or self.speed > STROLL + 0.2 and TURN_RUN or TURN_WALK
    -- (a turn right back: it brakes first, nearly straight, the feet planting, and pivots once it has slowed)
    if math.abs(turn) > 1.75 and self.speed > 0.9 then limit = 1.5 end
    local step = math.max(-limit * dt, math.min(limit * dt, turn * math.min(1, dt * 12)))
    self.face = self.face + step
    turn_rate, pivot = step / math.max(dt, 1e-6), math.abs(turn)
    want = want * math.max(0, math.min(1, (math.cos(turn) - 0.2) / 0.8))
    look = math.max(-0.6, math.min(0.6, turn))
    self.want_turn = wrap(turn - step)
  end
  self.look = self.look + (look - self.look) * math.min(1, dt * 14)
  -- it goes the way it faces, or up to CRAB off it towards the way asked while it turns (the feet are planted, so a few frames of
  -- that read as a lean into the turn, never a slide; a test walker that steers by where it went learns the stick)
  local go = self.face + math.max(-CRAB, math.min(CRAB, self.want_turn or 0))
  self.dir_x, self.dir_z = math.sin(go), math.cos(go)
  -- the speed eases in and out (a critically damped spring: no snap, no overshoot)
  if on_stairs then want = want * STAIR_PACE end
  local ss = self.speed_spring
  -- (a stop from a run takes a moment longer than one from a walk: the feet need a step or two to plant)
  local ease = want < self.speed - 0.01 and ((want < 0.05 and self.speed > STROLL + 0.2) and EASE_RUN or EASE_STOP) or (want > STROLL + 0.01 or self.speed > STROLL + 0.01) and EASE_RUN or EASE_WALK
  ss.stiffness = ease * ease
  if math.abs(ss.value - self.speed) > 1e-9 then ss:set(self.speed) end
  self.speed = math.max(0, ss:update(want, dt))
  if want == 0 and self.speed < 0.02 then self.speed = 0; ss:set(0) end
  -- the bank: only running (by how far into the run it is: the arms' share), half trotting, into the turn (turning left, +face, tips
  -- the top to the left, +x: a negative roll)
  local runw = math.max(0, math.min(1, (self.speed - STROLL) / (top - STROLL)))
  local arc = math.max(0, math.min(1, 1 - (pivot - 0.7) / 1.0))
  local bank = -math.max(-BANK_MAX, math.min(BANK_MAX, turn_rate * BANK_PER)) * runw * arc * (state.carrying and 0.5 or 1)
  self.bank = (self.bank or 0) + (bank - (self.bank or 0)) * math.min(1, dt * BANK_EASE)
  if self.speed > 0.01 and self.dir_x then
    local nx, nz = world.move(self.x, self.z, self.dir_x * self.speed * dt, self.dir_z * self.speed * dt, RADIUS)
    self.x, self.z = nx, nz
  end
  self:keep_clear()
  -- (on steps the body rises and falls along a ramp through them, the floor's height averaged over a stride's length along the way it
  -- goes, so stepping up reads as climbing, not as a hop onto each tread; the feet still stand on the treads themselves)
  if self.indoors then self.y = 0 else
    local fx, fz = math.sin(self.face), math.cos(self.face)
    -- (the stretch leads the way it climbs, so the body is already rising as a foot reaches for the step above, and lags the way
    -- it goes down, so it is not already low while the foot behind still stands on the step above)
    local ahead = world.lift(self.x + fx * 0.5, self.z + fz * 0.5) - world.lift(self.x - fx * 0.5, self.z - fz * 0.5)
    local lead = ahead > 0.05 and RAMP_LEAD or ahead < -0.05 and -RAMP_LEAD * 0.5 or 0
    local sum = 0
    for _, d in ipairs(RAMP) do sum = sum + world.lift(self.x + fx * (d + lead), self.z + fz * (d + lead)) end
    self.y = sum / #RAMP
  end
  -- (outdoors it is drawn lifted as one by the ground under it, upright, not each point by the hills under it: on a hillside the
  -- renderer's lift point by point sheared the body with the slope, and on the bridge the creek's bank under the deck bent it; its
  -- feet then stand on the ground's own heights, the hillside's, the deck's or the porch's, where the gait puts them)
  self.on_deck = not self.indoors
  self.carry_w = self.carry_w + ((state.carrying and 1 or 0) - self.carry_w) * math.min(1, dt * 8)
  local laden = state.carrying ~= nil
  self.gait = self.speed < 0.08 and "still" or self.speed <= STROLL + 0.05 and "walk" or laden and "trot" or "run"
  self.anim:play(laden and "laden" or "move", { fade = 0.25 })
  self.anim:set("speed", self.speed)
  -- the feet: the animator moved on by the ground covered, the feet planted, the hips and the springs (nova.gait)
  local extra = self.carry_w > 0.01 and self.carry_layer or nil
  self.carry_layer[1].weight = self.carry_w
  -- (on and near the porch steps the walk eases back to the quieter step it had before the eighth play, which the stair glide is
  -- tuned for: a big bob, push-off and heel strike there would squash a leg past its limit and poke a sole into a tread)
  self.stairs_k = (self.stairs_k or 0) + (((near or on_stairs) and 1 or 0) - (self.stairs_k or 0)) * math.min(1, dt * 8)
  local o, k = self.walker.o, self.stairs_k
  for _, name in ipairs(STAIR_KEYS) do
    if type(GAIT[name]) == "number" then o[name] = GAIT[name] * (1 - k) + STAIRS[name] * k
    else
      -- (a function of the speed the gait measures, made once per walker)
      self.stair_fns = self.stair_fns or {}
      self.stair_fns[name] = self.stair_fns[name] or function(s) local q = self.stairs_k or 0; return at_speed(GAIT[name], s) * (1 - q) + at_speed(STAIRS[name], s) * q end
      o[name] = self.stair_fns[name]
    end
  end
  self.walker:update(dt, self, self.anim, extra)
  for i = #self.dust, 1, -1 do
    local p = self.dust[i]
    p.age = p.age + dt
    if p.age > 0.5 then table.remove(self.dust, i) end
  end
  face.update(self.mood, dt)
end

-- Out of the van's body (three circles along it) and out of the residents' way: nobody walks through a van or a bear.
function Postmaster:keep_clear()
  local function push(cx, cz, r)
    local dx, dz = self.x - cx, self.z - cz
    local d = math.sqrt(dx * dx + dz * dz)
    local reach = r + RADIUS
    if d < reach and d > 1e-4 then self.x, self.z = cx + dx / d * reach, cz + dz / d * reach end
  end
  local v = nova.first("van")
  if v then
    local s, c = math.sin(v.heading), math.cos(v.heading)
    local body = v.BODY or { offs = { 0 }, r = 1 }
    for _, off in ipairs(body.offs) do push(v.x + s * off, v.z + c * off, body.r) end
  end
  for _, r in ipairs(nova.all("resident")) do push(r.x, r.z, 0.62) end
end

-- Where the parcel it carries is: at the chest, in front of it.
function Postmaster:hands()
  local s, c = math.sin(self.face), math.cos(self.face)
  -- (leaning with the bank: the top tips to the side the body rolls to; the model's left, +x, is (cos, -sin) in the world)
  local lean = -0.42 * math.sin(self.bank or 0)
  return self.x + s * 0.33 + c * lean, self.y + 0.42 * math.cos(self.bank or 0), self.z + c * 0.33 - s * lean
end

local DUST = { color = { 196, 178, 150, 110 } }
-- At the wheel: the place in the cab (the van's own metres, tools/van.mjs SEAT less the seated body's depth under its feet's
-- level), kept with the van as it moves; the clip is the seated one.
Postmaster.SEAT = { 0.28, 0.4, 0.22 } -- (2.5 cm into the soft seat, so the big hat clears the cab's lining)
function Postmaster:sit(dt)
  local v = nova.first("van")
  if v then
    local x, _, z = v:to_world(self.SEAT[1], 0, self.SEAT[3])
    self.x, self.y, self.z = x, 0, z
    self.face = v.heading
  end
  self.speed, self.gait, self.bank = 0, "still", 0
  self.walker.ready = false -- (getting out puts both feet down where it stands)
  self.anim:play("sit", { fade = 0.1 })
  self.anim.speed = 1
  self.anim:update(dt)
  self.carry_w = 0
  face.update(self.mood, dt)
end

local SEATED = { ry = 0, rx = 0, rz = 0, lift = "origin", see_through = false } -- (kept whole, like the van)
function Postmaster:draw_seated(v)
  -- in the cab, carried by the body: the van's turn, then the body's pitch and roll, at the seat's place in the leaning body
  local sx, sy, sz = v:to_world(self.SEAT[1], self.SEAT[2], self.SEAT[3])
  -- (drawn lifted by the ground under its own place, like the van by the ground under its middle: take the difference off)
  sy = sy + nova.terrain_height(v.x, v.z) - nova.terrain_height(sx, sz)
  local parts = face.parts(self.mood)
  -- the hands go round with the wheel (one up, one down), the head looks a little into the bend, the tail tucked away behind
  local turn = -(v.steer or 0)
  parts.arm_l = parts.arm_l or {}
  parts.arm_r = parts.arm_r or {}
  parts.head = parts.head or {}
  parts.tail = parts.tail or {}
  parts.arm_l.rx, parts.arm_r.rx = turn * 0.32, -turn * 0.32
  parts.head.ry = turn * 0.32
  parts.tail.visible = false
  SEATED.ry, SEATED.rx, SEATED.rz, SEATED.parts = v.heading, v.pitch or 0, v.roll or 0, parts
  self.anim:draw(sx, sy, sz, SEATED)
end

function Postmaster:draw()
  if self.visible == false then return end
  if self.seated then
    local v = nova.first("van")
    if v then self:draw_seated(v) end
    return
  end
  self.carry_layer[1].weight = self.carry_w
  local o = self.draw_opts
  -- (the face's drawings, and the gait's turns: the hips and legs to the feet, the body's lean and bank, the springs)
  local parts = face.parts(self.mood, self.walk_parts)
  o.ry, o.extra, o.parts = self.face, self.walker:extra(self.carry_w > 0.01 and self.carry_layer or nil), self.walker:parts(parts)
  o.lift = self.on_deck and "origin" or nil
  self.anim:draw(self.x, self.y, self.z, o)
  for _, p in ipairs(self.dust) do
    local k = p.age / 0.5
    DUST.color[4] = math.floor(110 * (1 - k))
    nova.billboard("puff", p.x, self.y + 0.06 + k * 0.12, p.z, 0.16 + k * 0.3, DUST)
  end
  if state.carrying then
    local x, y, z = self:hands()
    self.parcel_opts.ry = self.face + math.pi / 2
    nova.model(PARCELS[state.carrying], x, y - 0.1, z, self.parcel_opts)
  end
end

return Postmaster

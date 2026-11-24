-- The post van. Its body rides on four springs and dampers, one at each wheel, so it leans out in a bend, dips its nose when it
-- brakes and squats when it pulls away, and bobs over the bumps of a gravel lane. The suspension solver and the wheels' layout
-- are taken from Pine Ridge Rally's car (examples/pine-ridge-rally/entities/car.lua, 2026-11-21: `wheel_layout`, `ride_of`,
-- `Car:suspension`, `Car:wheel_offset`), copied here and cut down to one vehicle; the driving is new and gentle: a leisurely start,
-- a top speed of about 38 km/h (the starting van: upgrades raise Van.TUNE), brakes that take a moment, heavy steering that forgives,
-- no damage, no fuel. It is an automatic with a PRNDL lever (the owner's sixth play: "Let's make the truck function like a real
-- automatic with PRNDL gear selection"): it starts in P each time someone gets in; A steps the lever one gear towards D, X one
-- towards P (a column P R D, top to bottom: lib/gear_hud.lua shows it; the owner's ninth notes took N and L away), at once, with no pedal; only never into P on the
-- move, nor into R going forwards (a soft click and "Stop to shift"). P holds the wheels; R backs up on R2; D drives. D and R creep at idle
-- with the pedals up (Van.TUNE.creep). L2 is only the brake. In R a soft beeper sounds. Van:shift, Van:park.
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
  top = 12.5,           -- the speed the steering is measured against (less lock towards it); the pull: Van.TUNE.cap, pull_top below
  reverse = 3.0,        -- m/s at most backwards
  brake = 4.5,          -- m/s^2 at full brake: it takes a moment to stop
  coast = 0.5,          -- m/s^2 rolling and engine braking with nothing pressed
  drag = 0.004,         -- the air, per (m/s)^2
  grass = 0.6,          -- m/s^2 more rolling on the grass (the soft ground holds it back; with the starting van's pull it still gets going)
  edge = 22,            -- m/s^2 more at the playable area's very edge, growing over the last twelve metres of grass before it (world.rough: tussocks, roots,
                        -- stones), so the van comes up to the edge slowly and stops there without a knock (the owner's eighth play, note 6)
  gravel = 0.05,        -- and on gravel: a little (every road is gravel since the owner's ninth notes; it was 0.12 on the lanes, and the van was tuned on the tarmac of Post Road)
  -- the front wheels at full lock, at a crawl: a 10 m kerb-to-kerb circle on the 1.51 m wheelbase (the rear axle moved back in the
  -- owner's fourth notes; on the old 1.31 m one it was 18.3 degrees: the same tan(lock) / wheelbase keeps the same circle)
  lock = math.rad(20.9),
  lock_fast = 0.35,     -- the share of the lock the stick gives at the top speed (less lock the faster it goes)
  -- Crawling and parking (the owner's fifth play: "the turning radius while slow isn't as tight as I would hope"): below `crawl` m/s
  -- the wheels go over much further, to `lock_slow`, a kerb-to-kerb circle of about 6.4 m (a U-turn on Post Road in one sweep or
  -- one easy shunt); between `crawl` and `cruise` the extra lock eases away (smoothly: no step in the steering), so from `cruise` up
  -- the van steers exactly as above (about 11.4 m at 4 m/s, wider still faster). The wheels also move a little quicker at a crawl
  -- (`slow_steer` times), so full lock is not a long wait in a car park.
  lock_slow = math.rad(31),
  crawl = 1.8,
  cruise = 4.0,
  slow_steer = 1.5,
  drawn_lock = math.rad(25), -- the most the front wheels are drawn turned (see Van:draw)
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
  -- The handbrake (B held; the owner's fourth notes: "hold for handbrake while driving"): the rear wheels lock, it slows firmly
  -- (more than the pedal can pull against), and turning at some speed the tail steps out a little: the rear tyres hold the road less,
  -- so the body turns more than the wheels ask and the van slides a little sideways, gently, and comes back into line the moment it
  -- is let go. Stopped, it holds the van still on a slope.
  handbrake = 4.0,      -- m/s^2 it slows by
  hb_from = 3.0,        -- m/s: from this speed up the tail begins to step out ...
  hb_full = 7.0,        -- ... fully from this one
  hb_yaw = 0.7,         -- how much more the body turns than the wheels ask, fully (the tail stepping out)
  hb_grip = 0.3,        -- the share of the sideways grip left at the back (the slip dies away slower: a gentle slide)
  hb_corner = 1.5,      -- and how much more sideways pull it takes before it runs wide
  hb_slip = math.rad(7), -- the slide (between the way it points and the way it goes) past which the tail stops stepping further out
}
-- The top speed in D: a governor holds the van at `cap` on the flat (the owner: "the van caps out at 40 since there are no upgrades
-- yet"; the speedometer reads to 100): upgrades raise it. `pull_top` is where the pull would fade to nothing without it.
Van.TUNE.cap = 40 / 3.6       -- m/s: 40 km/h
Van.TUNE.pull_top = 16         -- m/s
Van.TUNE.cap_band = 0.12       -- m/s: the governor eases the pull out over the last of this below the cap
Van.TUNE.roll = 0.22      -- m/s^2 of rolling alone while the engine creeps instead of braking
Van.TUNE.park = 8         -- m/s^2 the parking pawl stops it with, in P (it is only put in P all but stopped)
-- Creep (the owner: "We need to add creep for D R and L"; L went with the ninth notes): in D and R, with the pedals up, the engine at idle pulls the van
-- along gently, as a real automatic does. Its pull is `creep_pull` m/s^2 (each gear's own) while the van is well under the creep
-- speed, fading to nothing over the last `creep_band` m/s below `creep` (that gear's target); while it creeps the engine braking gives
-- way (only the rolling is left against it), so it settles near 1.35 m/s in D on a flat road, 1.0 backwards
-- in R, a little slower on the grass (about 1.05 in D). It
-- builds in and dies away over `creep_build` seconds (smoothly: the acceleration never jumps). Any brake (or the handbrake) takes
-- it away at once; P never creeps. On a hill it may not hold the van: in D it slows on a climb and rolls back on a steep one;
-- downhill the slope adds to it.
Van.TUNE.creep = { D = 1.45, R = 1.1 }       -- m/s: the speed the creep aims at (it settles a little under)
Van.TUNE.creep_pull = { D = 1.6, R = 1.3 }   -- m/s^2: its pull, well under the creep speed (enough to get going on the grass)
Van.TUNE.creep_band = 0.8    -- m/s: under the creep speed by this much, the full pull; it fades to nothing at the creep speed
Van.TUNE.creep_build = 0.12  -- s: how quickly it builds in and dies away (two first-order eases in a row, each this long: 90 % in about 0.3 s; it was one of 0.45 s, 95 % in 1.35 s: the owner's "the creep should start sooner")
Van.TUNE.creep_brake = 0.03  -- the least brake pedal that takes the creep away
Van.ORDER = { "P", "R", "D" }
-- Shifting: never into P moving faster than `speed` m/s, nor into R going forwards faster than it; refused, the hint shows `hint` s.
-- `beep`: the reversing beeper's period (s).
Van.SHIFT = { speed = 1.0, hint = 1.8, beep = 1.2 }
local FEEL = Van.TUNE
local GEARS = { 4, 7.5, 11 }           -- the speed at which each of the gearbox's own ratios runs out in D (for the engine's note only)
-- The body against the world and the walkers: three circles along it (from the model's middle, along +z), each of this radius.
-- The van (tools/van.mjs) is 2.97 m long over its bumpers (z -1.48 to 1.49) and 1.34 wide; its axles at z 0.72 and -0.79.
Van.BODY = { offs = { 0.83, 0, -0.83 }, r = 0.66 }
-- The lamps (tools/van.mjs makes each its own part): the headlamps glow softly while `head` is on; the tail lamps glow bright while
-- braking and the reverse lamps light while reversing (by themselves). `beams` casts real light from the headlamps (two spot lights,
-- nova.point_light): off in the daytime slice, for night to switch on. Van:lamps() says what is lit this frame.
Van.LIGHTS = { head = true, beams = false, beam_reach = 16, beam_color = { 255, 236, 200 } }
Van.HEADLAMPS = { { 0.47, 0.5, 1.43 }, { -0.47, 0.5, 1.43 } }   -- (the lenses' middles, the van's own metres)
local GRAVITY = 9.8
-- The wheels' travel on their springs, along the body's own up (metres from where they sit in the model): up into the well, down
-- out of it. `tilt`: the steepest the body may lean or pitch on its springs (radians), past the valley's steepest playable bank.
Van.TRAVEL = { up = 0.08, down = 0.10, tilt = 0.6 }
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
  -- (bump and droop are the wheels' travel, Van.TRAVEL: a wheel never leaves its round well, 0.34 m about a middle 2 cm over the
  -- axle, for a 0.27 m tyre, so 8 cm up is the most it can rise in it; the bump stop starts a centimetre before)
  local r = { omega = omega, zeta = zeta, sag = sag, k = omega * omega / n, c = 2 * zeta * omega / n, bump = Van.TRAVEL.up - 0.01, droop = Van.TRAVEL.down,
    roll = math.rad(6), pitch = math.rad(3.4), arb = 0.3 }
  r.ip = (0.42 * layout.wheelbase) ^ 2
  r.ir = (0.4 * layout.track) ^ 2
  r.sags = {}
  for i = 1, n do r.sags[i] = sag end
  return r
end

-- Bumps of the surface under a tyre (metres): tarmac is smooth, gravel lanes rumble, the grass rolls; a junction's gravel is packed
-- (the ninth notes made every road gravel: its junctions are as smooth as their tarmac was, or braking into one drove the front springs
-- into their stops).
local BUMPS = { road = 0.004, gravel = 0.018, bridge = 0.008, grass = 0.03, packed = 0.005 }
local function ground_bump(x, z, size)
  return size * (math.sin(x * 0.9 + 1.3) * math.sin(z * 0.7 + 0.4) + 0.5 * math.sin(x * 1.9 - z * 1.1) + 0.3 * math.sin(z * 2.7 + x * 0.5))
end

-- The ground as it is DRAWN under a tyre. On the meadow that is entities/valley_ground.lua's mesh: 4 m squares from the map's corner
-- (world.limits), each cut corner to corner into two flat triangles, the points lifted by the hills. On a steep curved bank those
-- flat squares stand up to 22 cm off nova.terrain_height (the heightmap's 2 m samples, smoothly blended), so a tyre put on
-- terrain_height sank into the drawn grass at one end of the van and floated at the other. Roads and driveways are ribbons that
-- follow the hills every metre or two (terrain_height); decks and the bridge stand at their own height (world.height). Off a road the
-- tyre goes from the one to the other over `BLEND` metres past the ribbon's edge, so nothing steps under a wheel (the mesh's 15 cm
-- dip beside a road, which keeps it under the ribbon, is left out: there a tyre may stand a little over the drawn grass).
-- `kind` is chosen once per wheel a frame (`ground_kind`): "deck", or how far onto the meadow (0 on a road to 1); the corners'
-- heights are kept (the hills never change).
local GRID, BLEND, corner_h = 4, 2.0, {}
local function mesh_corner(i, j)
  local key = i * 65536 + j
  local h = corner_h[key]
  if not h then
    local L = world.limits
    h = nova.terrain_height(L.x0 + i * GRID, L.z0 + j * GRID)
    corner_h[key] = h
  end
  return h
end
local function ground_kind(x, z)
  if world.lift(x, z) > 0 then return "deck" end
  if not world.limits or world.surface(x, z) ~= "grass" then return 0 end
  local edge = math.huge
  for _, what in ipairs({ "road", "drive" }) do
    local r, d = world.nearest(what, x, z)
    if r then edge = math.min(edge, d - r.width / 2 - 0.3) end
  end
  -- (and from a junction's patch or a yard: their edges reach further out than a road's width)
  edge = math.min(edge, world.off_patch(x, z))
  return math.max(0, math.min(1, edge / BLEND))
end
local function ground_at(kind, x, z)
  if kind == "deck" then return world.height(x, z) end
  local th = nova.terrain_height(x, z)
  if kind <= 0 then return th end
  local L = world.limits
  local fx, fz = (x - L.x0) / GRID, (z - L.z0) / GRID
  local i, j = math.floor(fx), math.floor(fz)
  local u, v = fx - i, fz - j
  local a, c = mesh_corner(i, j), mesh_corner(i + 1, j + 1)
  -- (the square's two triangles share its diagonal from (i, j) to (i + 1, j + 1): valley_ground's a-c-b and a-d-c)
  local m
  if u >= v then m = a + u * (mesh_corner(i + 1, j) - a) + v * (c - mesh_corner(i + 1, j))
  else m = a + v * (mesh_corner(i, j + 1) - a) + u * (c - mesh_corner(i, j + 1)) end
  return th + (m - th) * kind
end
-- (the van asks through these fields: a test can give one van a ground of its own, a plane at a set slope)
Van.ground_at, Van.ground_kind = ground_at, ground_kind

function Van:create()
  self.heading = self.ry or 0
  self.velx, self.velz, self.speed = 0, 0, 0
  self.steer = 0
  self.ctl = { go = 0, brake = 0, steer = 0, handbrake = 0 }
  self.handbrake = false
  self.driven = false
  self.spin = 0
  self.ratio = 1          -- the gearbox's own ratio in D (1 to #GEARS): it changes by itself, for the engine's note
  self.gear = "P"         -- the lever: "P", "R" or "D"
  self.hint, self.hint_t = nil, 0 -- a refused shift: why ("brake", "stop") and how long the gear display still says so
  self.beep_t = 0
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
  self.susp = { y = 0, vy = 0, p = 0, vp = 0, r = 0, vr = 0, ready = false, kind = list("deck"), s = list(0), touch = list(true), load = list(1), g = list(0), t = list(0), gv = list(0), bump = list(0) }
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

-- The lever one gear along Van.ORDER (P R D): `dir` 1 towards D (A), -1 towards P (X). It moves at once, with no pedal (the
-- owner: "We can remove the brake requirement honestly"; it needed L2 held among P, R and D). One guard against nonsense: not into
-- P while moving faster than Van.SHIFT.speed either way, nor into R while going forwards faster than that; refused, it stays, with
-- a soft click, and the gear display says "Stop to shift" for a moment (`hint` "stop"). Says whether it moved.
function Van:shift(dir)
  local i = 1
  for k, g in ipairs(Van.ORDER) do if g == self.gear then i = k end end
  local to = Van.ORDER[i + dir]
  if not to then return false end
  local fast = (to == "P" and math.abs(self.speed) > Van.SHIFT.speed) or (to == "R" and self.speed > Van.SHIFT.speed)
  if fast then
    self.hint, self.hint_t = "stop", Van.SHIFT.hint
    nova.sound.play("gear_refuse", { volume = 0.55 })
    nova.log("shift refused: " .. self.gear .. " to " .. to .. ", rolling")
    return false
  end
  self.gear = to
  self.hint_t = 0
  nova.sound.play("gear_shift", { volume = 0.5, vary = 0.04 })
  if to == "R" then self.beep_t = 0.35 end
  nova.log("gear " .. to)
  return true
end

-- Into P at once (getting in, and getting out of a van that has stopped), with no sound of its own.
function Van:park()
  self.gear = "P"
  self.hint_t = 0
end

-- How much of the crawl's extra lock is on at a speed: 1 up to `crawl`, easing (smoothstep) to 0 at `cruise`.
function Van.crawl_mix(v)
  local t = math.max(0, math.min(1, (math.abs(v) - FEEL.crawl) / (FEEL.cruise - FEEL.crawl)))
  return 1 - t * t * (3 - 2 * t)
end
-- The most the stick turns the wheels at a speed, in shares of `lock`: lock_slow / lock at a crawl, then as before (less lock the
-- faster it goes, down to lock_fast at the top speed).
function Van.lock_share(v)
  local fast = 1 - (1 - FEEL.lock_fast) * math.min(1, math.abs(v) / FEEL.top)
  local k = Van.crawl_mix(v)
  return fast + (FEEL.lock_slow / FEEL.lock - fast) * k
end

-- One step of driving. `ctl.steer` is -1 (left) to 1 (right) and turns the heading down (heading 0 faces +z, and left is +x).
function Van:drive(dt)
  local c = self.ctl
  local live = self.driven
  local go, brake, steer_in = live and c.go or 0, live and c.brake or 0, live and c.steer or 0
  local hb = live and (c.handbrake or 0) > 0.5
  self.handbrake = hb
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local vf = self.velx * sinh + self.velz * cosh
  local vl = self.velx * cosh - self.velz * sinh
  -- the wheels: towards what the stick asks (less lock the faster it goes), at a limited and eased speed (it never darts); heading
  -- back towards the middle (the stick eased off or let go) quicker and with a quicker easing than turning in
  -- (`steer` is in shares of `lock`: past 1 at a crawl, where the wheels go over further, up to lock_slow)
  local want, quick = steer_in * Van.lock_share(vf), Van.crawl_mix(vf)
  local back = self.steer ~= 0 and (want - self.steer) * self.steer < 0
  local top, ease = FEEL.steer_speed * (1 + (FEEL.slow_steer - 1) * quick), FEEL.steer_ease
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
  -- (the handbrake at speed: the locked rear lets the tail step out, the body turning more than the wheels ask)
  local slide = hb and math.max(0, math.min(1, (math.abs(vf) - FEEL.hb_from) / (FEEL.hb_full - FEEL.hb_from))) or 0
  -- (and never a wild drift: past hb_slip of sliding it eases off, so the tail settles a little way out, catchable)
  slide = slide * math.max(0, math.min(1, (FEEL.hb_slip * 2 - math.atan(math.abs(vl), math.abs(vf) + 0.1)) / FEEL.hb_slip))
  ask = ask * (1 + FEEL.hb_yaw * slide)
  local corner = FEEL.corner * (1 + (FEEL.hb_corner - 1) * slide)
  local side = math.abs(ask * vf)
  if side > corner then ask = ask * (corner + (side - corner) * FEEL.past) / side end
  if live and math.abs(steer_in) < 0.05 and math.abs(vf) > 2 then ask = ask + FEEL.pull * (vf > 0 and 1 or -1) end
  local was = self.yaw_rate or 0
  local lag = (math.abs(ask) < math.abs(was) or ask * was < 0) and FEEL.unwind_lag or FEEL.yaw_lag
  local yaw = was + (ask - was) * math.min(1, dt / lag)
  self.heading = self.heading + yaw * dt
  self.yaw_rate = yaw
  sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  vf = self.velx * sinh + self.velz * cosh
  vl = self.velx * cosh - self.velz * sinh
  -- pulling away (R2) by the lever: forwards in D, backwards in R; in P the pedal only revs the engine
  local gear = self.gear
  if go > 0 and gear == "D" then
    -- (the pull fades as the speed climbs towards `pull_top`, and the governor takes the last of it away over the last `cap_band`
    -- m/s before the cap: in D it settles at the cap on the flat)
    local limit = FEEL.cap
    local share = math.max(0, vf) / FEEL.pull_top
    local governor = math.max(0, math.min(1, (limit - vf) / FEEL.cap_band))
    vf = vf + FEEL.power * go * math.max(0, 1 - share * share) * governor * dt
  elseif go > 0 and gear == "R" then
    local share = math.max(0, -vf) / FEEL.reverse
    vf = vf - FEEL.power * 0.7 * go * math.max(0, 1 - share * share) * dt
  end
  -- the creep: in D and R, eased in and out (`creep_k`, 0 to 1), gone the moment the brake or the handbrake is on
  local target = FEEL.creep[gear]
  local creeping = live and target ~= nil and brake < FEEL.creep_brake and not hb
  if not creeping and (brake >= FEEL.creep_brake or hb) then self.creep_k, self.creep_j = 0, 0 end
  -- (two eases one after the other: the pull starts at once, within a third of a second, yet its start is smooth, no jolt)
  local ease = math.min(1, dt / FEEL.creep_build)
  self.creep_j = (self.creep_j or 0) + ((creeping and 1 or 0) - (self.creep_j or 0)) * ease
  self.creep_k = (self.creep_k or 0) + (self.creep_j - (self.creep_k or 0)) * ease
  if target and self.creep_k > 0 then
    local dir = gear == "R" and -1 or 1
    local short = target - vf * dir
    local a = FEEL.creep_pull[gear] * math.max(0, math.min(1, short / FEEL.creep_band))
    vf = vf + dir * a * self.creep_k * dt
  end
  -- (the lamps: the tail lamps glow bright while it brakes, the reverse lamps are lit in R)
  self.braking, self.reversing = false, live and gear == "R"
  -- L2 is only the brake (it used to back the van up once stopped): it slows it whichever way it rolls, never further
  if brake > 0 then
    vf = vf - (vf >= 0 and 1 or -1) * math.min(math.abs(vf), FEEL.brake * brake * dt)
    self.braking = brake > 0.05
  end
  -- the handbrake: the rear wheels locked drag it down firmly, whatever the pedals do; the brake lamps light with it
  if hb then
    vf = vf - (vf >= 0 and 1 or -1) * math.min(math.abs(vf), FEEL.handbrake * dt)
    self.braking = true
  end
  -- P: the parking pawl holds the wheels
  if live and gear == "P" then vf = vf - (vf >= 0 and 1 or -1) * math.min(math.abs(vf), FEEL.park * dt) end
  -- rolling, engine braking, the air, the hills
  local sign = vf >= 0 and 1 or -1
  local coast = (go > 0 and 0.15 or FEEL.coast)
  -- (creeping, the engine pulls instead of holding back: only the rolling is left, as the creep comes in; well over the creep
  -- speed the engine brakes as before, fully from a metre a second over it)
  local k = target and self.creep_k or 0
  if k > 0 then k = k * math.max(0, math.min(1, 1 - (vf * (gear == "R" and -1 or 1) - target))) end
  if live and k > 0 and coast > FEEL.roll then coast = FEEL.roll + (coast - FEEL.roll) * (1 - k) end
  coast = coast + (self.surface == "grass" and FEEL.grass or self.surface == "gravel" and FEEL.gravel or 0)
  -- (near the playable area's edge the ground gets rough: harder going the nearer the edge and the faster it goes, but only heading
  -- out towards it: along it or back in, the van drives away as it would anywhere on the grass; a road is never rough)
  local rough = world.rough(self.x, self.z)
  self.rough = rough
  if rough > 0 and self.surface == "grass" and math.abs(vf) > 0.05 then
    local _, ix, iz = world.play_edge(self.x, self.z)
    local sp = math.sqrt(self.velx * self.velx + self.velz * self.velz)
    local out = sp > 0.05 and math.max(0, -(self.velx * ix + self.velz * iz) / sp) or 0
    coast = coast + FEEL.edge * rough * out * math.min(1, 0.35 + math.abs(vf) / 6)
  end
  vf = vf - sign * math.min(math.abs(vf), (coast + FEEL.drag * vf * vf) * dt)
  local gx, gz = nova.terrain_slope(self.x, self.z)
  if not world.on_bridge(self.x, self.z) then vf = vf - (gx * sinh + gz * cosh) * FEEL.hill * dt end
  -- (how hard the engine works, for the exhaust: the pedal)
  self.work = go
  -- (an empty van, one held on the handbrake, on the brake pedal or in P, does not creep down a slope)
  -- (and any touch of the brake holds a van that has all but stopped: no creeping, no shudder)
  if ((not live or hb or gear == "P" or brake > 0.3) and math.abs(vf) < 0.4) or (brake >= FEEL.creep_brake and math.abs(vf) < 0.15) then vf = 0 end
  -- the slip sideways dies away quickly: the van holds its line (less quickly with the rear wheels locked: the tail slides a little)
  vl = vl * math.exp(-FEEL.grip * (1 - (1 - FEEL.hb_grip) * slide) * dt)
  self.speed = vf
  self.velx, self.velz = vf * sinh + vl * cosh, vf * cosh - vl * sinh
  -- moving: three circles along the van (Van.BODY) against the scenery, the water and the map's edges
  local nx, nz = self.x + self.velx * dt, self.z + self.velz * dt
  local hit = 0
  for _, off in ipairs(Van.BODY.offs) do
    local px, pz = nx + sinh * off, nz + cosh * off
    local mx, mz, stopped, edge = world.move(px, pz, 0, 0, Van.BODY.r)
    if stopped then
      local ox, oz = mx - px, mz - pz
      nx, nz = nx + ox, nz + oz
      local l = math.sqrt(ox * ox + oz * oz)
      if l > 1e-4 then
        local ux, uz = ox / l, oz / l
        local into = self.velx * ux + self.velz * uz
        if into < 0 then
          -- (against the playable area's edge alone it just stops going that way: no bounce, no knock)
          local k = edge and 1.0 or 1.15
          self.velx, self.velz = self.velx - ux * into * k, self.velz - uz * into * k
          if not edge then hit = math.max(hit, -into) end
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
  -- the engine's note: in D the gearbox's own ratio changes up and down by itself; R holds one low ratio; in P the pedal revs it free
  local rev_want
  if gear == "D" or not live then
    local g = GEARS[self.ratio]
    if vf > g * 0.96 and self.ratio < #GEARS then self.ratio = self.ratio + 1; if self.engine_on then self.engine:shift("up") end
    elseif self.ratio > 1 and vf < GEARS[self.ratio - 1] * 0.62 then self.ratio = self.ratio - 1; if self.engine_on then self.engine:shift("down") end end
    local lo = self.ratio > 1 and GEARS[self.ratio - 1] * 0.55 or 0
    local share = math.max(0, math.abs(vf) - lo) / (GEARS[self.ratio] - lo)
    rev_want = 0.12 + 0.75 * math.min(1, share) + go * 0.1
  elseif gear == "R" then
    self.ratio = 1
    rev_want = 0.12 + 0.6 * math.min(1, math.abs(vf) / FEEL.reverse) + go * 0.1
  else
    self.ratio = 1
    rev_want = 0.12 + 0.5 * go
  end
  self.rev = self.rev + (rev_want - self.rev) * math.min(1, dt * 6)
  self:suspension(dt, (vf - self.last_vf) / dt, (self.yaw_rate or 0) * vf)
  self.last_vf = vf
  self.spin = self.spin + vf / self.wheel_r * dt
  if not hb then self.spin_rear = (self.spin_rear or 0) + vf / self.wheel_r * dt end -- (locked while the handbrake is on)
  -- the rear doors swing open and shut
  self.back_open = self.back_open + ((self.back_want or 0) - self.back_open) * math.min(1, dt * 6)
  -- (creeping, the engine sits at idle with a little load)
  self:sound(dt, math.max(go, 0.15 * (self.creep_k or 0)))
end

function Van:sound(dt, go)
  if not self.engine_on then self.engine:silence(); return end
  -- in R, the reversing beeper: a soft, low, rounded double boop every Van.SHIFT.beep seconds, quiet (heard from the cab, well under
  -- the horn); it stops the moment the lever leaves R
  if self.driven and self.gear == "R" then
    self.beep_t = self.beep_t - dt
    if self.beep_t <= 0 then
      nova.sound.play("reverse_beep", { volume = 0.22 })
      nova.log("reverse beep")
      self.beep_t = Van.SHIFT.beep
    end
  end
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
  -- (a junction's gravel is packed hard by the turning wheels: smoother, as its tarmac was before the owner's ninth notes)
  local surface = (self.surface == "gravel" and world.junction_surface(self.x, self.z)) and "packed" or self.surface
  local size = (BUMPS[surface] or 0.01) * math.min(1, 0.3 + math.abs(self.speed) / 12)
  local follow = math.min(1, dt * 14)
  for i = 1, n do
    local s = st[i]
    local wx, wz = self.x + sinh * s.fwd + cosh * s.left, self.z + cosh * s.fwd - sinh * s.left
    sp.kind[i] = self.ground_kind(wx, wz)
    local g = self.ground_at(sp.kind[i], wx, wz)
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
    local tilt = math.tan(Van.TRAVEL.tilt)
    sp.y, sp.p, sp.r = y + vy * h, math.max(-tilt, math.min(tilt, p + vp * h)), math.max(-tilt, math.min(tilt, r + vr * h))
    sp.vy, sp.vp, sp.vr = vy, vp, vr
  end
  -- (the solver's p and r are the body's rise per metre forward and to the left: drawn as the angles whose tangents they are)
  self.pitch, self.roll = -math.atan(sp.p), math.atan(sp.r)
  self.lift = sp.y - h0
  self:place_wheels()
end

-- The wheels, the way driving games hang them: each is the body's child at a fixed mount (its axle in the model, tools/van.mjs),
-- and its spring moves it only along the body's own up, by `travel` (from Van.TRAVEL.down below to Van.TRAVEL.up above where it
-- sits in the model). The travel is found by a ray from the mount down the body's -up to the ground as drawn under the tyre's foot
-- (`ground_at`: the meadow's mesh, a road, the bridge's deck, a porch step), so the tyre touches what is seen; the surface's small
-- bumps, which are not drawn, are felt by the body only. The wheel's turn is the body's, then
-- the steering about the body's up (front wheels), then the spin about its axle (Van:draw: the part's ry and rx, Ry * Rx inside
-- the body); never the ground's slope on its own. A wheel that would need more than its travel up lifts the body along the world's
-- up instead (the bump stop), so it never leaves its well.
local UP = { 0, 0, 0 }
function Van:body_up()
  local p, r = self.pitch or 0, self.roll or 0
  -- (Rx(pitch) * Rz(roll) applied to (0, 1, 0), as Van:to_world turns a point)
  UP[1], UP[2], UP[3] = -math.sin(r), math.cos(r) * math.cos(p), math.cos(r) * math.sin(p)
  return UP
end

-- The travel a wheel needs for its tyre to touch the ground (not limited): the tyre's foot is the mount less the radius, along up.
function Van:wheel_reach(i)
  local s, sp = self.stations[i], self.susp
  local h0 = sp.h0 or nova.terrain_height(self.x, self.z)
  local uy = self:body_up()[2]
  local t = 0
  for _ = 1, 4 do
    local cx, cy, cz = self:to_world(s.left, t, s.fwd)
    local g = self.ground_at(sp.kind[i] or "deck", cx, cz) -- (the drawn ground: the small bumps are the body's to feel)
    t = t + (g - (cy + h0)) / uy
  end
  return t
end

function Van:place_wheels()
  local sp, T = self.susp, Van.TRAVEL
  self.travel = self.travel or {}
  local need, worst = {}, 0
  for i = 1, #self.stations do
    need[i] = self:wheel_reach(i)
    worst = math.max(worst, need[i] - T.up)
  end
  if worst > 0 then
    -- (the bump stop: the body rises along the world's up until the most pressed wheel is at the top of its travel)
    local d = worst * self:body_up()[2]
    sp.y, self.lift = sp.y + d, self.lift + d
    if sp.vy < 0 then sp.vy = sp.vy * 0.3 end
    for i = 1, #need do need[i] = need[i] - worst end
  end
  for i = 1, #self.stations do
    self.travel[i] = math.max(-T.down, math.min(T.up, need[i]))
  end
end

-- The front wheels' drawn steer about the body's up (radians; the part's ry).
function Van:drawn_steer()
  return -math.max(-FEEL.drawn_lock, math.min(FEEL.drawn_lock, (self.steer or 0) * FEEL.lock))
end

-- Where a wheel is as it is drawn (for the tests and anything that must touch it): its hub in the world (x, y over the ground under
-- the van's middle, as Van:to_world, z), and its axle, a unit vector out of its left face: the body's turn, then the steer.
function Van:wheel_hub(i)
  local s = self.stations[i]
  return self:to_world(s.left, s.y + (self.travel and self.travel[i] or 0), s.fwd)
end
function Van:wheel_axle(i)
  local a = self.stations[i].front and self:drawn_steer() or 0
  local ox, oy, oz = self:to_world(0, 0, 0)
  -- (the part's x axis turned by the steer about the body's up, Ry(a) * (1, 0, 0) = (cos a, 0, -sin a), then by the body)
  local x, y, z = self:to_world(math.cos(a), 0, -math.sin(a))
  return x - ox, y - oy, z - oz
end

-- Where a point of the van's body is in the world, from the van's own metres (right +x is left, as the model): for the
-- postmaster at his seat, the parcels in the hold, the headlamps' beams, the exhaust's tip.
-- Exactly as the engine turns the body (nova.model's turn is Ry(heading) * Rx(pitch) * Rz(roll) and the body part is lifted by
-- `lift`; Van:draw): the point is rolled about z, then pitched about x, then turned by the heading. No small-angle shortcut, so on a
-- steep bank (0.3 rad is the most the springs allow) nothing drifts from the body it sits in (the lettering is in the model itself).
function Van:to_world(lx, ly, lz)
  local p, r = self.pitch or 0, self.roll or 0
  local sr, cr, sp, cp = math.sin(r), math.cos(r), math.sin(p), math.cos(p)
  local x, y = lx * cr - ly * sr, lx * sr + ly * cr
  local py, pz = y * cp - lz * sp, y * sp + lz * cp
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  return self.x + sinh * pz + cosh * x, (self.lift or 0) + py, self.z + cosh * pz - sinh * x
end

function Van:update(dt)
  self.hint_t = math.max(0, (self.hint_t or 0) - dt)
  if not self.susp.ready or self.driven or math.abs(self.speed) > 0.01 or self.back_open > 0.01 or self.back_want > 0 or math.abs(self.susp.vr) > 1e-3 or math.abs(self.susp.vy) > 1e-3 then
    self:drive(dt)
  end
  self:exhaust(dt)
  self:dust(dt)
end

-- The exhaust (the owner: "We should add a tailpipe with exhaust for the truck"): soft round puffs from the tailpipe's tip
-- (tools/van.mjs TAILPIPE), light grey-white and see-through, growing and fading over about a second as they drift up and back with
-- the wind; a gentle trickle at idle, more and a little darker pulling away or climbing in L (`work`); only while the engine runs
-- (from getting in until getting out). At most Van.EXHAUST.max alive; the oldest gives way.
Van.EXHAUST = { tip = { 0.4, 0.31, -1.5 }, max = 12, idle = 0.28, busy = 0.11, life = 1.1, size = 0.26, grow = 0.85,
  wind = { 0.35, 0.2 } }
function Van:exhaust(dt)
  local E = Van.EXHAUST
  self.puffs = self.puffs or {}
  local puffs = self.puffs
  for i = #puffs, 1, -1 do
    local p = puffs[i]
    p.age = p.age + dt
    if p.age >= E.life then table.remove(puffs, i)
    else
      p.x, p.y, p.z = p.x + p.vx * dt, p.y + p.vy * dt, p.z + p.vz * dt
      p.vx, p.vz = p.vx * (1 - 1.5 * dt), p.vz * (1 - 1.5 * dt)
    end
  end
  if not self.engine_on then self.puff_t = 0; return end
  local work = self.work or 0
  self.puff_t = (self.puff_t or 0) - dt
  if self.puff_t > 0 then return end
  self.puff_t = E.idle + (E.busy - E.idle) * math.min(1, work)
  if #puffs >= E.max then table.remove(puffs, 1) end
  local x, y, z = self:to_world(E.tip[1], E.tip[2], E.tip[3])
  local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
  local back = 0.5 + 0.6 * work
  self.puff_n = (self.puff_n or 0) + 1
  local j = math.sin(self.puff_n * 12.9898) * 0.075 -- (a little sideways scatter, without touching math.random)
  -- (billboards are lifted by the ground under them, as the van is by the ground under its middle: y stays the height above it)
  puffs[#puffs + 1] = { age = 0, x = x, y = y, z = z,
    vx = self.velx * 0.3 - sinh * back + cosh * j + E.wind[1], vy = 0.6 + 0.25 * work, vz = self.velz * 0.3 - cosh * back - sinh * j + E.wind[2],
    dark = math.min(1, work), spin = self.puff_n * 2.4 }
end
-- (for the tests: how many puffs are alive)
function Van:puff_count() return #(self.puffs or {}) end

-- ---- the dust (the owner's ninth notes: "We should add some dust that comes up but not too much") ------------------------------------
-- Soft sandy puffs kicked up behind the rear wheels while they roll on gravel (every road, driveway and yard is gravel; none on the
-- bridge's deck or the grass): none when slow (under `from` m/s), a light trail at a cruise, a little more braking hard and more again
-- while the handbrake slides it. Each rises a little, swells, drifts with the wind (the valley's nova.wind: 60 degrees, a breeze) and
-- fades over its `life`; at most `max` alive, the oldest giving way. Drawn with nova.puff: soft round blobs whose alpha falls smoothly
-- to nothing at the rim (a billboard's faint pixels are cut). Self-contained: Van:dust(dt) from update, Van:draw_dust() from draw.
Van.DUST = { from = 3.0, full = 9.5, rate = 7, max = 16, life = 1.6, size = 0.42, grow = 0.8, rise = 0.3, alpha = 0.6,
  brake = 0.55, slide = 0.9, wind = { 0.3, 0.52 }, color = { 236, 226, 204 } }
-- How much dust it raises now: 0 (none) to about 1.6 (sliding on the handbrake at speed).
function Van:dust_amount()
  local D, v = Van.DUST, math.abs(self.speed or 0)
  if v < D.from then return 0 end
  local k = math.min(1, (v - D.from) / (D.full - D.from))
  local c = self.ctl or {}
  if (c.brake or 0) > 0.3 and self.driven then k = k + D.brake * c.brake * math.min(1, v / 6) end
  if self.handbrake and self.driven then k = k + D.slide * math.min(1, v / 6) end
  return k
end
function Van:dust(dt)
  local D = Van.DUST
  self.dusts = self.dusts or {}
  local dusts = self.dusts
  for i = #dusts, 1, -1 do
    local p = dusts[i]
    p.age = p.age + dt
    if p.age >= D.life then table.remove(dusts, i)
    else
      p.x, p.y, p.z = p.x + p.vx * dt, p.y + p.vy * dt, p.z + p.vz * dt
      -- (the kick dies away; the wind carries on)
      local keep = 1 - math.min(1, 2.2 * dt)
      p.vx, p.vz = D.wind[1] + (p.vx - D.wind[1]) * keep, D.wind[2] + (p.vz - D.wind[2]) * keep
      p.vy = p.vy * (1 - math.min(1, 0.8 * dt))
    end
  end
  local k = self:dust_amount()
  if k <= 0 then self.dust_t = 0; return end
  self.dust_t = (self.dust_t or 0) + dt * D.rate * k
  while self.dust_t >= 1 do
    self.dust_t = self.dust_t - 1
    self.dust_n = (self.dust_n or 0) + 1
    -- (the rear wheels in turn: just behind each tyre, low)
    local rear = {}
    for _, s in ipairs(self.stations or {}) do if not s.front then rear[#rear + 1] = s end end
    local s = rear[self.dust_n % math.max(1, #rear) + 1]
    if s then
      local back = self.speed >= 0 and -0.45 or 0.45
      local x, y, z = self:to_world(s.left, 0.25, s.fwd + back)
      if world.surface(x, z) == "gravel" then
        if #dusts >= D.max then table.remove(dusts, 1) end
        -- (a little scatter, without touching math.random)
        local j1, j2 = math.sin(self.dust_n * 12.9898) * 0.5, math.sin(self.dust_n * 78.233) * 0.5
        local sinh, cosh = math.sin(self.heading), math.cos(self.heading)
        local kick = (self.speed >= 0 and -1 or 1) * (0.6 + 0.4 * math.min(1, k))
        dusts[#dusts + 1] = { age = 0, x = x, y = y, z = z, k = math.min(1.6, k),
          vx = self.velx * 0.15 + sinh * kick + cosh * j1 * 0.6 + D.wind[1], vy = D.rise * (1 + j2 * 0.4),
          vz = self.velz * 0.15 + cosh * kick - sinh * j1 * 0.6 + D.wind[2], size = 1 + j2 * 0.3 }
      end
    end
  end
end
-- (for the tests: how many puffs of dust are alive)
function Van:dust_count() return #(self.dusts or {}) end
local DUST_COLOR = { 0, 0, 0, 0 }
function Van:draw_dust()
  local D = Van.DUST
  DUST_COLOR[1], DUST_COLOR[2], DUST_COLOR[3] = D.color[1], D.color[2], D.color[3]
  for _, p in ipairs(self.dusts or {}) do
    local t = p.age / D.life
    -- (in quickly, out slowly; a thicker cloud when it was kicked up harder)
    DUST_COLOR[4] = math.floor(255 * D.alpha * (0.7 + 0.3 * math.min(1, p.k)) * math.min(1, t * 6) * (1 - t) ^ 1.3)
    if DUST_COLOR[4] > 0 then nova.puff(p.x, p.y, p.z, D.size * p.size * (1 + D.grow * 2.2 * t), DUST_COLOR) end
  end
end

local PUFF = { color = { 236, 236, 240, 0 }, rot = 0 }
local BEAM = { radius = 16, color = { 255, 236, 200 }, dir = { 0, -0.12, 1 }, angle = 46 }
local PARCEL = { hazel = "parcel_hazel", pip = "parcel_pip" }
function Van:draw()
  local pt = self.parts_table
  pt.body.rx, pt.body.rz, pt.body.y = self.pitch, self.roll, self.lift or 0
  -- (the wheels as drawn turn no further than `drawn_lock`: at the crawl's full lock, 31 degrees, the tyre's back would push through
  -- the round well and the doorway's step; 25 degrees keeps it inside, and nobody reads the last few degrees off a turning wheel)
  -- (the wheels are the body's children in the model: `y` slides each along the body's up, `ry` steers about it, `rx` spins it)
  local sv = self:drawn_steer()
  for i, s in ipairs(self.stations) do
    local part = pt[s.name]
    part.y = self.susp.ready and self.travel and self.travel[i] or 0
    part.rx = s.front and self.spin or (self.spin_rear or 0)
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
  -- the exhaust's puffs: fading in quickly, growing as they rise, gone by the end of their life; a little darker while it works
  local E = Van.EXHAUST
  for _, p in ipairs(self.puffs or {}) do
    local t = p.age / E.life
    local grey = 232 - 46 * p.dark
    PUFF.color[1], PUFF.color[2], PUFF.color[3] = grey, grey, grey + 4
    PUFF.color[4] = math.floor((160 + 40 * p.dark) * math.min(1, t * 5) * (1 - t) ^ 1.4)
    PUFF.rot = p.spin + t * 0.8
    nova.billboard("puff", p.x, p.y, p.z, E.size * (1 + E.grow * 3 * t), PUFF)
  end
  self:draw_dust()
  -- (FERNHOLLOW POST on the cargo's sides is part of the van's model, tools/van.mjs: it moves with the body exactly)
  -- the parcels in the hold, on its floor (0.68 m: tools/van.mjs HOLD_FLOOR), the first loaded furthest in
  for i, which in ipairs(state.van_load) do
    self:draw_inside(PARCEL[which], i == 1 and 0.2 or -0.22, 0.68, i == 1 and -0.5 or -0.95, i * 0.4)
  end
end

-- What is lit this frame: the headlamps (Van.LIGHTS.head) and their beams (Van.LIGHTS.beams, needs head), the brake lamps while
-- braking, the reverse lamps while backing up.
local LIT = {}
function Van:lamps()
  LIT.head = Van.LIGHTS.head and true or false
  LIT.beams = LIT.head and Van.LIGHTS.beams and true or false
  LIT.brake = self.driven and self.braking or false -- (the pedal, or the handbrake)
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

-- The race: building a circuit's scene into a start grid, the countdown, laps and places, the chase camera, the HUD,
-- pause and the finish. A circuit's own scene file (scenes/pine_ridge.lua) just says which ground, sky and music it has.
local state = require("lib.state")
local track = require("lib.track")
local lamps = require("lib.lamps")
local grid = require("lib.grid")
local fx = require("lib.fx")
local stage_lib = require("lib.stage")
local transition = require("lib.transition")
local pars = require("lib.pars")
local crowd = require("lib.crowd")
local foliage = require("lib.foliage")
local course = require("lib.course")
local horizon = require("lib.horizon")
local audio = require("lib.audio")
local haptics = require("lib.haptics")
local ui = require("lib.ui")
local racing = require("lib.racing")
local targets = require("lib.targets")

local race = {}

local ROAD_OPTS = { shadow = false }
-- rally: how fast a class of car covers a stage, on average (m/s), for a section's par when no driven pars are recorded
local TYPICAL_SPEED = { sport = 25, everyday = 22 }
-- The three rivals, each a driver of their own (see "the computer's driving" below): Mika is the one to beat, Rosa the one you will.
local RIVALS = {
  { name = "Mika", pace = 1.0, bravery = 1.0, consistency = 0.97 },
  { name = "Dax", pace = 0.955, bravery = 0.95, consistency = 0.92 },
  { name = "Rosa", pace = 0.905, bravery = 0.88, consistency = 0.88 },
}
-- the computer driving the player's car (F9): at its best, and evenly
local IDEAL = { pace = 1, bravery = 1, consistency = 1 }
-- (a harder course's rivals are a touch quicker, an easier one's a touch slower: the course's level, Easy to Expert)
local COURSE_PACE = { 0.985, 1, 1.01, 1.02 }
local CATCH_UP = 0.02         -- at most this much quicker (never past what the car can do) when far behind you, or slower when far ahead
local MAP_COLORS = { { 96, 165, 250 }, { 74, 222, 128 }, { 244, 114, 182 } }
local ROAD_EDGE = 0.2        -- metres from the edge of the road's surface (a waypoint's `w`, 6 on most of a course) to where the grass starts
-- what a road kind is under the tyres: asphalt is a road, the rest is loose (gravel, sand, snow, dirt)
local function surface_of(road) if road == "road_asphalt" then return "road", false end return "dirt", true end
local RESCUE_FAR = 30         -- metres from the middle of the road at which the player is put back by itself
local RESCUE_OUT, RESCUE_HOLD, RESCUE_IN = 0.45, 0.2, 0.45 -- the fade to black, the moment of black, and the fade back (seconds)
local LOOK_FAR = 240         -- metres of scenery drawn around the camera (fog hides its edge)
local SUSPENSION_NEAR = 110  -- metres from the camera inside which a car's suspension is worked out in full

-- ---- driving: the player's controls and the other drivers ---------------------------------------------------------------

local function read_controls(car)
  local c = car.ctl
  c.throttle = nova.input.axis("throttle")
  c.brake = nova.input.axis("brake")
  -- a trigger gives every value from 0 to 1 and a key or a button gives 0 or 1, so a press that starts part way is a trigger
  -- (pulled right through at speed it locks the wheels: see Car:drive)
  if c.brake <= 0 then car.brake_analog = nil
  elseif (car.brake_before or 0) <= 0 then car.brake_analog = c.brake < 0.95 end
  car.brake_before = c.brake
  c.brake_analog = car.brake_analog
  c.steer = nova.input.axis("steer")
  c.handbrake = nova.input.down("handbrake")
end

-- ---- the computer's driving ------------------------------------------------------------------------------------------------------
-- Every car the computer drives (the rivals, and the player's car on F9) follows the course's racing line (lib/racing.lua) at the speeds
-- its own profile allows: the profile is the car's (its grip, brakes, engine, gears) scaled by the driver's skill:
--   pace         the share of the line's corner speed it dares (1 is the ideal: what the speed profile says the car can do)
--   bravery      the share of the brakes it uses into a bend (braking later or earlier)
--   consistency  how evenly it drives: a driver below 1 is a little faster or slower into each bend, a different way each lap
-- It steers by the turn it wants (the line's own bend, plus a pull back onto the line), not by aiming at a point: so it holds the line
-- through a bend instead of cutting it. In traffic (Race:update_traffic) it moves off the line to pass a slower car where there is
-- room, keeps a car's width from one alongside, and otherwise follows without running into it.
local function point_at(s)
  if track.open then s = math.max(0, math.min(track.length, s)) else s = s % track.length end
  local _, _, lo = track.at(s)
  local p = track.point(lo)
  return lo, (p.seg or 0) > 0 and (s - p.s) / p.seg or 0
end

local function lerp_speed(v, L, i, frac)
  local b = L.open and math.min(L.n, i + 1) or (i % L.n + 1)
  frac = math.max(0, math.min(1, frac))
  return v[i] + (v[b] - v[i]) * frac
end

local function drive_itself(car)
  local c = car.ctl
  local ai = car.ai
  local L = ai.line
  local v = car.speed
  local s_here = car.last_s or 0
  -- the line a little ahead (the steering is a turn rate: it starts turning as the bend arrives, not after)
  local i, frac = point_at(s_here + math.max(0, v) * 0.05 + 0.5)
  local o_line, h_line, k_line = racing.at(L, i, frac)
  local here = track.point(car.waypoint or i)
  local lim = math.max(0, (here.w or 6) - (math.abs(ai.shift or 0) > 0.3 and 0.9 or 1.1)) -- (passing: right to the edge)
  local target = math.max(-lim, math.min(lim, o_line + (ai.shift or 0)))
  local err = target - (car.left or 0)
  -- the way it should be going: along the line, turned towards it by how far off it is (back onto it in about a third of a second)
  local want = h_line + math.max(-0.4, math.min(0.4, math.atan(3 * err, math.max(math.abs(v), 6))))
  -- The car's path swings round towards where it points at the rate its tyres hold it (fast on tarmac, slowly on gravel and snow), so
  -- to turn its path at a rate it must point that far ahead of its path: the turn it wants of its path, then of its nose.
  local course = (v > 3) and math.atan(car.velx, car.velz) or car.heading
  local turn_path = v * k_line + 3 * track.wrap(want - course)
  local lead = math.max(-0.5, math.min(0.5, turn_path / car:hold_rate()))
  local yaw = turn_path + 8 * track.wrap(course + lead - car.heading)
  local capacity = car:yaw_capacity()
  c.steer = math.max(-1, math.min(1, -yaw / capacity))

  -- the speed: the profile's, a little ahead (the brakes take a moment to bite), as this driver dares (and as the traffic allows)
  local j, jf = point_at(s_here + math.max(0, v) * 0.18)
  local want_speed = lerp_speed(ai.speeds, L, j, jf) * (ai.noise and ai.noise[j] or 1) * (ai.push or 1)
  if ai.ideal then want_speed = math.min(want_speed, lerp_speed(ai.ideal, L, j, jf)) end -- (never faster than the car can go)
  ai.want = want_speed -- (what it would do with the road to itself: Race:update_traffic compares it with the car ahead)
  if ai.follow and ai.follow < want_speed then want_speed = ai.follow end
  if car.cruise then want_speed = math.min(want_speed, car.cruise) end
  if math.abs(yaw) > capacity * 1.05 and v > 8 then want_speed = math.min(want_speed, v - 0.5) end -- (cannot turn that hard: lift)
  -- off the road: back on, gently, round anything in the way (on the road there is nothing to dodge: the scenery stands off it)
  local urgency = 0
  if (car.off_middle or 0) > (here.w or 6) + 1.5 then
    if car.off_middle > (here.w or 6) + 3 then want_speed = math.min(want_speed, math.max(14, v * 0.9)) end
    local h = car.heading
    local ahead = 9 + math.abs(v) * 0.8
    local dist, ox, oz = nova.scenery.ahead(car.x, car.z, math.sin(h), math.cos(h), ahead, 1.45)
    if dist then
      urgency = 1 - dist / ahead
      local on_left = (ox - car.x) * math.cos(h) - (oz - car.z) * math.sin(h) >= 0
      c.steer = math.max(-1, math.min(1, c.steer + (on_left and 1 or -1) * (0.3 + 1.2 * urgency)))
      if urgency > 0.45 then want_speed = math.max(5, want_speed * (1.3 - urgency)) end
    end
  end
  want_speed = math.max(want_speed, 6)
  local diff = want_speed - v
  if diff > 0 then
    c.throttle, c.brake = math.min(1, 0.3 + diff * 1.2), 0
  elseif diff > -0.4 then
    c.throttle, c.brake = 0.12, 0
  else
    c.throttle, c.brake = 0, math.min(1, (-diff - 0.4) / 1.5)
  end
  c.handbrake = false
  -- pinned against something (a barrier on the outside of a bend): back away from it, the wheel turned the other way, and try again
  if (car.reversing or 0) > 0 then
    c.throttle, c.brake, c.steer = 0, 1, -c.steer
  end
end

-- ---- the scene ---------------------------------------------------------------------------------------------------------

-- The scene of a course: everything about the course is in its scene file (the road's waypoints, the grid, the scenery, and the `race`
-- object's settings, read by lib/course.lua), so a course's own script is just `return require("lib.race").scene()`.
function race.scene()
  local Race = nova.scene {}
  local config -- the course's settings (lib/course.lua), from its scene's race object

  function Race:enter()
    config = course.current()
    local sun = config.sun
    nova.light { dir = sun.dir, color = sun.color, ambient = sun.ambient }
    -- the sky, and fog the colour of its horizon so that the far scenery fades out instead of popping in
    nova.scenery.range = LOOK_FAR -- (the engine draws the scene file's scenery out to here, around the camera)
    nova.shadows(state.shadows and { radius = 42, strength = 0.55 } or nil)
    nova.terrain(config.terrain) -- the hills (flat when the circuit has none)
    if config.weather then nova.weather(config.weather) end
    nova.sky(config.sky)
    if config.sky then nova.fog { color = config.sky.horizon, near = 70, far = 330 } end
    local info = state.current_track()
    nova.log("rally: course " .. info.id)
    self.stage = config.stage and true or false   -- a rally stage: from A to B, in sections
    self.laps = self.stage and 1 or state.laps
    track.open = self.stage
    track.ensure()
    assert(track.count() > 10, "this scene has no waypoints: place `waypoint` objects along the road")
    nova.log("rally: crowd " .. crowd.count() .. " people") -- (the stands, flags, billboards and spectators are objects of the scene file)
    local look = config
    state.apply_look(look)
    -- the circuit's look with a speed blur added each frame (see Race:update_camera)
    self.look_now = nil
    if state.effects and look.look then
      self.look_now = {}
      for k, v in pairs(look.look) do self.look_now[k] = v end
      self.look_now.fxaa = state.smooth and 1 or 0
      self.blur_now = 0
    end
    foliage.start(state.effects and 1 or 0)
    self.length = track.length
    if self.stage then self:build_stage() end
    self.phase = "countdown"
    self.notes_live, self.note_fx, self.split = false, nil, nil
    self.clock = 0              -- time since the green light
    self.countdown = 3.9
    self.last_beep = 4
    haptics.reset()
    self.paused, self.pause_choice = false, 1
    self.leaving = false
    transition.reveal(1.0) -- (coming from the wipe that the chooser started: stay covered a moment more, then wipe off; the countdown waits)
    -- a frame that takes more than 26 ms is written to the log with what was going on (read it with adb logcat after a play session)
    nova.hitch(26, function()
      local p = self.player
      return string.format("speed %.0f steer %.2f slip %.2f %s view %d", p.speed, p.ctl.steer, p.slip, tostring(p.surface), self.view_mode)
    end)
    self.view_mode = 1 -- the near chase view (C changes it)
    self.message, self.message_time = "", 0
    self.cars = {}
    self.lap_times = {}
    self.best_lap = nil
    self.camera = { x = 0, y = 4, z = 0, heading = 0, fov = 62, tx = 0, ty = 1, tz = 0 }
    self:build_cars()
    self:build_minimap()
    self.player.engine = audio.engine(0.6, self.player.car_id)
    self.trial = state.mode == "trial"
    self.ghost = self.trial and nova.save.get("ghost_" .. info.id, nil) or nil
    self.recording = { t = 0, pts = {} }
    audio.music(config.music, { volume = 0.95, fade = 0.8 })
    self.camera.heading = self.player.heading -- the chase camera starts behind the car, looking where it looks
    self:update_camera(1 / 60)
  end

  function Race:leave()
    for _, car in ipairs(self.cars) do if car.engine then car.engine:stop() end end
    nova.music.volume(state.music_volume)
    nova.hitch(0); nova.weather(); nova.sky(nil); nova.fog(nil); nova.shadows(nil); nova.terrain()
    crowd.clear(); course.clear(); stage_lib.clear(); lamps.clear(); track.clear(); grid.clear(); fx.clear(); foliage.clear(); racing.clear()
    nova.look(); nova.wind()
  end

  -- The player and three rivals on the grid; the player starts at the back (the rivals ahead are in view, none under the camera).
  function Race:build_cars()
    local mine = state.current_car().id
    -- the rivals drive your car in its other paints: the same machine, so a race is the drivers'
    local pool = {}
    for k, model in ipairs(state.current_car().paints) do if k > 1 then pool[#pool + 1] = model end end
    -- which cars the rivals drive: a different three for each circuit and each car of yours (the same every time)
    local turn = (state.track * 3 + state.car * 5) % #pool
    for _ = 1, turn do
      local first = table.remove(pool, 1) -- (not `pool[#pool + 1] = table.remove(pool, 1)`: the index is worked out before the removal)
      pool[#pool + 1] = first
    end
    local slots = { 1, 2, 3 }  -- the rivals' places; the player has slot 4
    local length = self.length
    local function put(kind, slot)
      local g = grid.slots[slot] or grid.slots[1]
      local car = nova.spawn(kind, g.x, 0, { z = g.z })
      car:teleport(g.x, g.z, g.heading)
      car.slot = slot
      car.grip_scale = config.grip or 1
      car.dust_color = config.dust or { 200, 190, 160 }
      car.loose = config.loose -- gravel, sand or snow: it kicks up with every metre
      local idx, s = track.locate(car.x, car.z)
      car.waypoint = idx
      car.last_s = s
      car.progress = self.stage and s or s - length   -- (a circuit: behind the line, negative until it is crossed; a stage starts at its first point)
      car.start_progress = car.progress
      return car
    end
    self.player = put(mine, 4)
    self.player.is_player = true
    self.player.oversteer = state.current_car().oversteer
    self.player.name = "You"
    self.cars[1] = self.player
    local level = state.current_rival_level()
    if state.mode == "race" then nova.log("rivals: difficulty " .. state.current_difficulty().id); nova.log("rivals: " .. level.id) end
    local line = racing.line()
    nova.log(string.format("rivals: ideal %.2f s a %s on the line (%s)", self:ideal_time(self.player), self.stage and "stage" or "lap", self.player.car_id))
    for i, r in ipairs(state.mode == "race" and RIVALS or {}) do
      local car = put(pool[(i - 1) % #pool + 1], slots[i])
      -- a rival drives its own car (the same machine as yours, in another paint) as well as its skill, the rivals' setting and the
      -- course's level say
      car.name = r.name
      local scale = level.pace * (COURSE_PACE[state.current_track().level or 2] or 1)
      self:setup_driver(car, { pace = math.min(1.04, r.pace * scale), bravery = math.min(1.04, r.bravery * level.bravery), consistency = math.min(1, r.consistency * level.consistency) })
      car.engine = audio.engine(0.3, car.car_id, true)
      self.cars[#self.cars + 1] = car
    end
    assert(line)
  end

  -- The options of the speed profile on this course (lib/racing.lua), with the hills' slope along the line worked out once.
  function Race:profile_opts(car, skill)
    local line = racing.line()
    if not line.slope then line.slope = line.opts.slope_of(line) end
    local o = { grip = (line.opts.grip or 1) * (0.7 + 0.3 * (car.tyres or 1)), surface = line.opts.surface, surfaces = line.opts.surfaces, slope = line.slope, standing = false }
    o.lateral = racing.lateral * skill.pace * skill.pace
    o.braking = racing.braking * skill.bravery
    return o
  end

  -- The ideal time of a lap (or of the stage) for `car` on this course: its speed profile at its best (lib/racing.lua).
  function Race:ideal_time(car)
    local o = self:profile_opts(car, IDEAL)
    o.standing = self.stage
    return racing.speeds(racing.line(), car, o).time
  end

  -- A computer driver for `car` with `skill` ({ pace, bravery, consistency }): its speeds along the line, and the car's best speeds (it
  -- never goes faster than those, whatever the catch-up says).
  function Race:setup_driver(car, skill)
    local line = racing.line()
    car.ai = { line = line, skill = skill, shift = 0, push = 1, lap = nil }
    self:refresh_driver(car)
  end

  -- Worked out again each lap: the tyres have worn (and hold less), and a driver who is not perfectly consistent takes each bend a
  -- little differently.
  function Race:refresh_driver(car)
    local ai = car.ai
    ai.speeds = racing.speeds(ai.line, car, self:profile_opts(car, ai.skill)).v
    ai.ideal = racing.speeds(ai.line, car, self:profile_opts(car, IDEAL)).v
    local spread = (1 - ai.skill.consistency) * 0.6
    if spread > 0 then
      -- a smooth wobble along the course: some bends a few per cent quicker than its pace, some slower
      local n = ai.line.n
      local raw = {}
      for j = 1, n do raw[j] = (math.random() * 2 - 1) end
      ai.noise = ai.noise or {}
      for j = 1, n do
        local sum = 0
        for d = -4, 4 do sum = sum + raw[(j + d - 1) % n + 1] end
        ai.noise[j] = 1 + spread * sum / 9 * 1.5
      end
    else
      ai.noise = nil
    end
  end

  function Race:build_minimap()
    local lo_x, hi_x, lo_z, hi_z = 1e9, -1e9, 1e9, -1e9
    for i = 1, track.count(), 2 do
      local p = track.point(i)
      lo_x, hi_x, lo_z, hi_z = math.min(lo_x, p.x), math.max(hi_x, p.x), math.min(lo_z, p.z), math.max(hi_z, p.z)
    end
    local scale = 120 / math.max(hi_x - lo_x, hi_z - lo_z)
    -- north (+z) is at the top and +x on the left, as seen from behind a car leaving the start line
    self.map = { scale = scale, hi_x = hi_x, hi_z = hi_z, dots = {}, w = (hi_x - lo_x) * scale, h = (hi_z - lo_z) * scale }
    for i = 1, track.count(), 2 do
      local p = track.point(i)
      self.map.dots[#self.map.dots + 1] = { (hi_x - p.x) * scale, (hi_z - p.z) * scale }
    end
  end

  function Race:say(text, seconds)
    self.message, self.message_time = text, seconds or 2
  end

  -- Where each car is: waypoint, distance along the circuit, and how far from the middle of the road.
  function Race:locate(car)
    local idx, s, left, dist = track.locate(car.x, car.z, car.waypoint)
    car.waypoint = idx
    car.left, car.off_middle = left, dist
    -- progress is the running total of distance covered (it goes down when driving backwards)
    local delta = s - car.last_s
    if not self.stage then
      if delta > self.length / 2 then delta = delta - self.length
      elseif delta < -self.length / 2 then delta = delta + self.length end
    end
    car.progress = car.progress + delta
    car.last_s = s
    -- (a zone of the course can change the road: its width, and its surface, gravel into tarmac)
    local wp = track.point(idx)
    if wp.road then car.surface, car.loose = surface_of(wp.road) else car.surface, car.loose = config.surface or "road", config.loose end
    if car.is_player and car.road_kind ~= (wp.road or "course") then
      if car.road_kind then nova.log("rally: the road turns to " .. (wp.road or "the course's own")) end
      car.road_kind = wp.road or "course"
    end
    if car.off_middle > wp.w + ROAD_EDGE + 0.8 then car.surface = "rough" end
  end

  -- every tenth of a second of a trial lap: where the car was (x, z, heading), kept as flat numbers for the save file
  function Race:record_ghost(dt)
    local rec = self.recording
    rec.t = rec.t + dt
    local n = #rec.pts
    if rec.t >= (n // 3) * 0.1 and n < 3 * 3000 then
      local p = self.player
      rec.pts[n + 1], rec.pts[n + 2], rec.pts[n + 3] = math.floor(p.x * 10 + 0.5) / 10, math.floor(p.z * 10 + 0.5) / 10, math.floor(p.heading * 100 + 0.5) / 100
    end
  end

  -- where the ghost is now (it starts its lap when the player does), or nil when its lap is over
  function Race:ghost_pose()
    local g = self.ghost
    if not g or self.phase ~= "racing" then return nil end
    if not self.player.lap_started then return nil end -- before the line is crossed there is nothing to race
    local t = self.clock - self.player.lap_started
    local i = t / 0.1
    local k = math.floor(i)
    local a, b = k * 3 + 1, (k + 1) * 3 + 1
    if not g.pts[b + 2] then return nil end
    local f = i - k
    local dh = track.wrap(g.pts[b + 2] - g.pts[a + 2])
    return g.pts[a] + (g.pts[b] - g.pts[a]) * f, g.pts[a + 1] + (g.pts[b + 1] - g.pts[a + 1]) * f, g.pts[a + 2] + dh * f
  end

  -- How far ahead of (negative) or behind (positive) the ghost the player is, in seconds: the ghost was at the player's spot
  -- some time into its lap; the player has been going for this long. Looks only a few seconds either side of where the
  -- ghost should be, so a lap that crosses itself cannot confuse it.
  function Race:ghost_gap()
    local g = self.ghost
    if not g or self.phase ~= "racing" or self.player.finish_time then return nil end
    if not self.player.lap_started then return nil end
    local t = self.clock - self.player.lap_started
    local near = math.floor(t / 0.1)
    local best, at = 1e9, nil
    for k = math.max(0, near - 60), near + 60 do
      local i = k * 3 + 1
      local gx, gz = g.pts[i], g.pts[i + 1]
      if not gz then break end
      local d = (gx - self.player.x) ^ 2 + (gz - self.player.z) ^ 2
      if d < best then best, at = d, k end
    end
    if not at or best > 15 * 15 then return nil end
    return t - at * 0.1
  end

  -- Slipstream: close behind another car, in its wake, a car is pulled along: `car.draft` (0 to 1) builds up over a second or so and fades as
  -- the wake is left, and entities/car.lua gives that much more top speed and pull. It works the same for the rivals, who also pull out to
  -- the side to pass when they are drafting right behind a car.
  local DRAFT_RANGE, DRAFT_WIDTH = 26, 2.2
  function Race:update_draft(dt)
    for _, car in ipairs(self.cars) do
      local sh, ch = math.sin(car.heading), math.cos(car.heading)
      local gap, lateral
      for _, other in ipairs(self.cars) do
        if other ~= car then
          local dx, dz = other.x - car.x, other.z - car.z
          local ahead = dx * sh + dz * ch
          if ahead > 3.5 and ahead < DRAFT_RANGE and other.speed > 20 then
            local side = dx * ch - dz * sh -- positive: it is on this car's left
            if math.abs(side) < DRAFT_WIDTH and (not gap or ahead < gap) then gap, lateral = ahead, side end
          end
        end
      end
      local want = 0
      if gap and car.speed > 22 and car.enabled then
        want = math.min(1, (DRAFT_RANGE - gap) / (DRAFT_RANGE - 9)) * (1 - math.abs(lateral) / DRAFT_WIDTH * 0.6)
      end
      local now = car.draft or 0
      car.draft = now + (want - now) * math.min(1, dt * (want > now and 1.5 or 0.8))
      if car.is_player and car.draft > 0.5 and not self.drafted then self.drafted = true; nova.log("rally: slipstream") end
    end
  end

  -- The computer's cars in traffic: for each, the cars just ahead of it and beside it. One in its way that it is catching is passed
  -- on the side with room (it moves off its line by `ai.shift`, at a walking pace sideways: no swerves) or, with no room, followed
  -- (`ai.follow`, its speed, plus what the gap allows) so that it is never run into; one alongside is given a car's width. A car being
  -- caught does nothing about it: it keeps its line (no weaving to block), and it leaves room for one alongside, the player too.
  local PASS_ROOM, ALONGSIDE = 2.3, 2.2
  function Race:update_traffic(dt)
    local cars, length = self.cars, self.length
    for _, car in ipairs(cars) do
      local ai = car.ai
      if ai and (not car.is_player or car.autopilot) then
        local here = track.point(car.waypoint or 1)
        local lim = math.max(0, (here.w or 6) - 0.9)
        local line_o = racing.at(ai.line, car.waypoint or 1, 0)
        local my_o, v = car.left or 0, car.speed
        local my_s = car.last_s or 0
        local shift_target, follow = 0, nil
        for _, other in ipairs(cars) do
          if other ~= car then
            local ds = (other.last_s or 0) - my_s
            if not self.stage then
              if ds > length / 2 then ds = ds - length elseif ds < -length / 2 then ds = ds + length end
            end
            local oo = other.left or 0
            if ds > 4.2 and ds < 12 + math.max(0, v) * 0.9 then
              -- how much quicker this driver would go here than the car ahead is going
              local closing = (ai.want or v) - other.speed
              local in_path = math.abs(oo - my_o) < 2.2 or math.abs(oo - (line_o + ai.shift)) < 2.2
              if in_path and (closing > 0.3 or ds < 9) then
                -- pass where there is room (on the side its own line is on, if both have room), else follow
                local room_left, room_right = lim - oo, oo + lim
                local side
                if room_left >= PASS_ROOM and room_right >= PASS_ROOM then side = line_o >= oo and 1 or -1
                elseif room_left >= PASS_ROOM then side = 1
                elseif room_right >= PASS_ROOM then side = -1 end
                if side and closing > 0.3 then shift_target = oo + side * PASS_ROOM - line_o end
                -- never into it: while still behind it (not yet moved across), no faster than it plus what the gap beyond a safe one
                -- allows (a car moving out to pass keeps its speed until it is close)
                if math.abs(oo - my_o) < 1.9 then
                  local safe = 4.5 + math.max(0, v) * 0.12
                  local allow = other.speed + math.max(-4, (ds - safe) * (side and closing > 0.3 and 1.2 or 0.6))
                  if not follow or allow < follow then follow = allow end
                end
              end
            elseif ds > -7.5 and ds <= 4.2 and math.abs(oo - my_o) < ALONGSIDE then
              -- alongside: keep a car's width (move to the side of it this car is already on)
              local side = my_o >= oo and 1 or -1
              shift_target = oo + side * ALONGSIDE - line_o
            end
          end
        end
        shift_target = math.max(-lim - line_o, math.min(lim - line_o, shift_target))
        local step = dt * 2.2
        ai.shift = ai.shift + math.max(-step, math.min(step, shift_target - ai.shift))
        ai.follow = follow
      end
    end
  end

  -- ---- rally stages ----------------------------------------------------------------------------------------------------------

  -- The corners of the stage as pace notes: where each starts (metres along the stage), which way it turns, and how hard (1 is a hairpin,
  -- 6 a gentle bend), from how sharply the waypoints say the road turns.
  local function pace_notes()
    local notes = {}
    local n = track.count()
    local open_corner
    local function close(at)
      if open_corner then
        local peak = open_corner.peak
        local grade = (peak > 0.060 and 1) or (peak > 0.042 and 2) or (peak > 0.030 and 3) or (peak > 0.021 and 4) or (peak > 0.014 and 5) or 6
        notes[#notes + 1] = { s = open_corner.s, left = open_corner.sign > 0, grade = grade }
        open_corner = nil
      end
    end
    for i = 1, n do
      local p = track.point(i)
      local k = p.k or 0
      local a = math.abs(k)
      if open_corner and k * open_corner.sign < 0 and a > 0.0085 then close(p.s) end
      if not open_corner then
        if a > 0.0085 then open_corner = { s = p.s, sign = k > 0 and 1 or -1, peak = a } end
      else
        if a > open_corner.peak then open_corner.peak = a end
        if a < 0.0045 then close(p.s) end
      end
    end
    close(0)
    return notes
  end

  -- The sections of the stage (the scene's gates, the last of them the finish), their times to beat and the pace notes.
  function Race:build_stage()
    local info = state.current_track()
    local class = state.current_car().class
    local driven = (pars[info.id] or {})[class]
    if info.generated then
      -- a made-up course: each section's ideal time for this car, at the pace the gold medal asks for (lib/targets.lua)
      local ideal = targets.ideal(info, state.current_car())
      local t = targets.of(info, state.current_car())
      driven = {}
      for k, sec in ipairs(ideal.sections) do driven[k] = sec * t.gold / t.ideal end
      self.targets = t
    end
    self.sections = {}
    local from = 0
    for k, g in ipairs(stage_lib.gates()) do
      local _, s = track.locate(g.x, g.z)
      self.sections[k] = { from = from, to = s, par = driven and driven[k] or ((s - from) / TYPICAL_SPEED[class]) }
      from = s
    end
    assert(#self.sections > 0, "a rally stage needs section_gate objects (the last is the finish)")
    self.section, self.section_start, self.section_log, self.score = 1, 0, {}, 0
    self.notes = pace_notes()
    nova.log(string.format("rally: stage %s, %.0f m, %d sections, %d pace notes", info.id, track.length, #self.sections, #self.notes))
  end

  -- A section's score: 1000 for a time well under its par (the difficulty allows more or less time), less as it gets slower, nothing at
  -- 1.45 times the par.
  function Race:section_score(time, par)
    local ratio = time / (par * state.current_difficulty().allow)
    return math.floor(1000 * math.max(0, math.min(1, (1.45 - ratio) / 0.55)) + 0.5)
  end

  function Race:update_stage()
    local p = self.player
    local sec = self.sections[self.section]
    if p.finish_time or not sec or p.progress < sec.to then return end
    local t = self.clock - self.section_start
    local score = self:section_score(t, sec.par)
    local delta = t - sec.par * state.current_difficulty().allow
    self.section_log[#self.section_log + 1] = { time = t, par = sec.par, score = score }
    self.score = self.score + score
    self.section_start = self.clock
    nova.log(string.format("section %d done in %s (par %s), %d points t=%.3f", self.section, ui.time(t), ui.time(sec.par), score, t))
    if self.section >= #self.sections then
      p.finish_time = self.clock
      audio.sfx("finish")
      haptics.event("finish")
      self.player_finished_at = self.clock
      self:say("FINISH!", 4)
      p.autopilot = true
      p.cruise = 16 -- (the computer drives it on, gently)
    else
      self.section = self.section + 1
      audio.sfx(delta <= 0 and "best_lap" or "lap")
      -- (no message in the middle of the road: the split shows small top left, under the time; see hud_top_left)
      self.split = { n = self.section - 1, delta = delta, score = score, at = self.clock }
    end
  end

  function Race:lap_of(car) return math.floor(car.progress / self.length) + 1 end

  function Race:places()
    local order = {}
    for _, c in ipairs(self.cars) do order[#order + 1] = c end
    table.sort(order, function(a, b)
      if a.finish_time and b.finish_time then return a.finish_time < b.finish_time end
      if a.finish_time then return true end
      if b.finish_time then return false end
      return a.progress > b.progress
    end)
    for i, c in ipairs(order) do c.place = i end
    return order
  end

  -- Putting the player back: the screen fades to black, the car is set on the road (the nearest waypoint, facing along it) while
  -- it is dark, and the picture fades back in.
  function Race:update_rescue(dt)
    local r = self.rescue
    if not r then return end
    r.t = r.t + dt
    local p = self.player
    if not r.done and r.t >= RESCUE_OUT then
      r.done = true
      self:respawn(p)
      self:update_camera(1) -- (the camera jumps behind the car while the screen is black)
      if self.stage and r.asked then
        self.clock = self.clock + 5 -- (a stage is timed: asking to be put back costs five seconds)
        self:say("Back on the road   +5 s", 1.8)
      else
        self:say("Back on the road", 1.5)
      end
      nova.log(string.format("You put back on the road (%s)", r.asked and "asked" or "too far from it"))
    end
    if r.t >= RESCUE_OUT + RESCUE_HOLD + RESCUE_IN then self.rescue = nil end
  end
  function Race:rescue_dark()
    local r = self.rescue
    if not r then return 0 end
    if r.t < RESCUE_OUT then return r.t / RESCUE_OUT end
    if r.t < RESCUE_OUT + RESCUE_HOLD then return 1 end
    return math.max(0, 1 - (r.t - RESCUE_OUT - RESCUE_HOLD) / RESCUE_IN)
  end

  function Race:respawn(car)
    local p = track.point(car.waypoint or 1)
    car:teleport(p.x, p.z, p.heading)
    car.surface = config.surface or "road"
    car.stuck = 0
    car.off_middle = 0
  end

  -- Cars touch as two circles each (front and rear, 1 m either side of the middle, 0.95 m across): side by side they pass at 1.9 m, not 3.6.
  function Race:bump_cars()
    for i = 1, #self.cars do
      for j = i + 1, #self.cars do
        local a, b = self.cars[i], self.cars[j]
        local near = (b.x - a.x) ^ 2 + (b.z - a.z) ^ 2 < 6 * 6
        local asin, acos, bsin, bcos = math.sin(a.heading), math.cos(a.heading), math.sin(b.heading), math.cos(b.heading)
        for ka = -1, 1, 2 do
          for kb = -1, 1, 2 do
            if not near then break end
            local dx, dz = (b.x + bsin * kb) - (a.x + asin * ka), (b.z + bcos * kb) - (a.z + acos * ka)
            local d2 = dx * dx + dz * dz
            if d2 < 1.9 * 1.9 then
          local d = math.max(0.01, math.sqrt(d2))
          local nx, nz = dx / d, dz / d
          local push = (1.9 - d) / 2
          a.x, a.z, b.x, b.z = a.x - nx * push, a.z - nz * push, b.x + nx * push, b.z + nz * push
          local rel = (b.velx - a.velx) * nx + (b.velz - a.velz) * nz
          if rel < 0 then
            local share = rel * 0.55
            a.velx, a.velz, b.velx, b.velz = a.velx + nx * share, a.velz + nz * share, b.velx - nx * share, b.velz - nz * share
            if (a.is_player or b.is_player) and a.bump_cooldown <= 0 and rel < -1.5 then
              a.bump_cooldown, b.bump_cooldown = 0.4, 0.4
              audio.sfx("bump", { volume = math.min(1, -rel / 8) })
            end
          end
        end
          end
        end
      end
    end
  end

  function Race:finish_car(car)
    car.finish_time = self.clock
    if car.is_player then
      audio.sfx("finish")
      haptics.event("finish")
      self.player_finished_at = self.clock
      self:say("FINISH!", 4)
      car.autopilot = true
      car.cruise = 30
    end
  end

  function Race:update_player_lap()
    local p = self.player
    local lap = math.floor(p.progress / self.length)    -- laps completed (negative before the start line)
    if lap <= (p.laps_done or -1) then return end
    p.laps_done = lap
    if lap == 0 and self.trial then
      -- in a trial the clock for lap one starts as the line is crossed, so every lap (and the ghost) is a flying lap
      p.lap_started = self.clock
      self.recording = { t = 0, pts = {} }
    end
    if lap < 1 then return end
    local t = self.clock - (p.lap_started or 0)
    p.lap_started = self.clock
    self.lap_times[#self.lap_times + 1] = t
    local record = not self.best_lap or t < self.best_lap
    if record then self.best_lap = t end
    nova.log(string.format("lap %d done in %s", lap, ui.time(t)))
    if self.trial then
      -- the ghost is the best lap: keep this one's path if it beat it
      if record and (not self.ghost or t < self.ghost.time) then
        self.ghost = { time = t, pts = self.recording.pts }
        nova.save.set("ghost_" .. state.current_track().id, self.ghost)
        nova.log(string.format("ghost saved: %d points", #self.ghost.pts // 3))
      end
      self.recording = { t = 0, pts = {} }
    end
    if lap < self.laps then
      audio.sfx(record and "best_lap" or "lap")
      self:say((lap + 1 == self.laps and "FINAL LAP   " or ("LAP " .. (lap + 1) .. "   ")) .. ui.time(t), 2.6)
    end
  end

  function Race:update(dt)
    transition.update(dt)
    if self.phase ~= "countdown" and not self.player_finished_at and nova.input.pressed("pause") then
      self.paused = not self.paused
      self.pause_choice = 1
      -- (the grass and the trees keep still while the game is paused)
      nova.pause(self.paused)
      nova.music.volume(state.music_volume * (self.paused and 0.35 or 1))
      audio.sfx("pause")
      for _, car in ipairs(self.cars) do if car.engine then car.engine:silence() end end
      return
    end
    if self.paused then return self:update_pause() end
    self.crowd_time = (self.crowd_time or 0) + dt -- (the crowd keeps still while the game is paused)
    -- a frame that took too long is written to the log with what was going on, so that a hitch can be found from a play session
    if dt > 0.026 and self.phase == "racing" then
      local p = self.player
      self.hitches = (self.hitches or 0) + 1
      nova.log(string.format("rally: hitch %.1f ms at %.0f s: speed %.0f steer %.2f slip %.2f %s lua %.0f KB view %d orbit %.2f", dt * 1000, self.clock, p.speed, p.ctl.steer, p.slip, tostring(p.surface), collectgarbage("count"), self.view_mode, self.orbit and self.orbit.yaw or 0))
    end

    if self.message_time > 0 then self.message_time = self.message_time - dt end
    foliage.plant_some()
    -- every five seconds of racing: how the device is doing (read from the log when measuring; fps and the GPU's own milliseconds)
    self.perf_t = (self.perf_t or 0) + dt
    if self.perf_t >= 5 and self.phase ~= "countdown" then
      self.perf_t = 0
      local m = nova.perf()
      nova.log(string.format("rally: perf effects=%s fps=%.1f gpu=%.2f p95=%.1f max=%.1f draws=%d triangles=%d", tostring(state.effects), m.fps, m.gpu_ms, m.frame_p95_ms, m.frame_max_ms, m.draws, m.triangles))
    end
    if nova.input.pressed("stats") then
      local c = self.player
      nova.log(string.format("rally: speed=%.1f slip=%.2f heading=%.2f yaw=%.2f x=%.1f z=%.1f orbit=%.2f lift=%.2f off=%.1f rough=%d gear=%d", c.speed, c.slip, c.heading, c.yaw_rate or 0, c.x, c.z, self.orbit and self.orbit.yaw or 0, self.orbit and self.orbit.lift or 0, c.off_middle or 0, c.surface == "rough" and 1 or 0, c.gear or 1))
    end
    if nova.input.pressed("view") then self.view_mode = self.view_mode % 3 + 1 end
    -- F9 lets the computer drive for you (for demos, and for testing the circuits without a controller)
    if nova.input.pressed("autodrive") then
      self.player.autopilot = not self.player.autopilot
      if self.player.autopilot then self:setup_driver(self.player, IDEAL) end
    end

    if self.phase == "countdown" and transition.covering() then
      -- (the countdown starts when the wipe starts to go)
    elseif self.phase == "countdown" then
      self.countdown = self.countdown - dt
      local whole = math.ceil(self.countdown)
      if whole < self.last_beep and whole >= 1 and whole <= 3 then
        audio.sfx("beep")
        haptics.event("light")
        self.last_beep = whole
      end
      if self.countdown <= 0 then
        nova.log("go")
        self.phase = "racing"
        audio.sfx("go")
        haptics.event("go")
        for _, c in ipairs(self.cars) do c.enabled = true end
        self.clock = 0
        self:say("GO!", 1.2)
      end
    else
      self.clock = self.clock + dt
    end

    local cam = self.camera
    if self.phase == "racing" then self:update_traffic(dt) end
    for _, car in ipairs(self.cars) do
      -- (a car far from the camera has a cheaper suspension: one step a frame, no bumps; entities/car.lua)
      car.far = not car.is_player and (car.x - cam.x) ^ 2 + (car.z - cam.z) ^ 2 > SUSPENSION_NEAR * SUSPENSION_NEAR
      if car.is_player and not car.autopilot then
        read_controls(car)
      else
        if not car.ai then self:setup_driver(car, IDEAL) end
        -- each lap: the driver's speeds again, for the tyres as they are now (and its bends taken a little differently)
        local lap = math.floor((car.progress or 0) / math.max(1, self.length))
        if car.ai.lap ~= lap then
          if car.ai.lap ~= nil then self:refresh_driver(car) end
          car.ai.lap = lap
        end
        drive_itself(car)
      end
      if car.finish_time and not car.is_player then car.cruise = 26 end
      car:drive(dt)
      if car.is_player then
        if (car.lock or 0) > 0.3 and not self.lock_logged then self.lock_logged = true; nova.log("brake: the wheels locked") end
        if (car.lock or 0) == 0 then self.lock_logged = nil end
      end
      self:locate(car)
    end
    self:bump_cars()
    if self.phase == "racing" then
      self:update_draft(dt)
      -- (how long each car spends with its wheels off the road, for the results' log: the rivals should keep to the road)
      for _, car in ipairs(self.cars) do
        if not car.finish_time then
          car.race_time = (car.race_time or 0) + dt
          if car.surface == "rough" then car.rough_time = (car.rough_time or 0) + dt end
        end
      end
    end

    if self.phase == "racing" then
      -- a rival far behind you tries a little harder, one far ahead eases a little: at most CATCH_UP of its speed, and never faster
      -- than its car can go (drive_itself caps it at the car's own best speeds), so it is never seen to do the impossible
      for _, car in ipairs(self.cars) do
        if car.ai and not car.is_player and not car.finish_time then
          local gap = self.player.progress - car.progress        -- positive: the rival is behind
          car.ai.push = 1 + math.max(-CATCH_UP, math.min(CATCH_UP, gap * 0.00005))
        end
      end
      if self.stage then
        self:update_stage()
      else
        self:update_player_lap()
        for _, car in ipairs(self.cars) do
          if not car.finish_time and car.progress >= self.laps * self.length then self:finish_car(car) end
        end
      end
    end

    -- help: the player (unless the computer is driving for them) is put back only when they ask, or are far from the road (a car that has simply stopped on the road, or
    -- that is waiting, is left alone; there is no way to be upside down in this game's cars). The rivals are also put back when they
    -- are stuck against something, so that a race is never held up.
    local p = self.player
    if self.phase == "racing" then
      for _, car in ipairs(self.cars) do
        local asked = car == p and not p.autopilot and nova.input.pressed("reset")
        if math.abs(car.speed) < 1.5 and car.enabled then car.stuck = (car.stuck or 0) + dt else car.stuck = 0 end
        if car ~= p or p.autopilot then
          if car.stuck > 1.0 and (car.reversing or 0) <= 0 then car.reversing = 1.4 end
          if (car.reversing or 0) > 0 then car.reversing = car.reversing - dt end
        end
        if car == p and not p.autopilot and (asked or car.off_middle > RESCUE_FAR) then
          -- the player is put back behind a fade to black (asked for, or far from the road), not in a jump
          if not self.rescue then self.rescue = { t = 0, asked = asked } end
        elseif asked or car.off_middle > 60 or ((car ~= p or p.autopilot) and car.stuck > 4) then
          self:respawn(car)
          if car == p and self.stage and asked then
            self.clock = self.clock + 5 -- (a stage is timed: being put back costs five seconds)
            self:say("Back on the road   +5 s", 1.8)
          elseif car == p then self:say("Back on the road", 1.5) end
          if car ~= p or not p.autopilot then nova.log(string.format("%s put back on the road (at %.0f, %.0f; speed %.1f, %.0f m from the middle, waypoint %d)", car.name, car.x, car.z, car.speed, car.off_middle, car.waypoint or 0)) end
        end
      end
    end

    self:update_rescue(dt)

    -- the sound of every engine that is close enough to hear
    -- (engines, gear changes, tyres, wind, suspension thumps, scrapes, rivals placed in the world: lib/audio.lua)
    audio.cars(self.cars, p, dt)
    for _, car in ipairs(self.cars) do
      if car.hit then
        if car.is_player then
          audio.sfx("bump", { volume = car.hit })
          haptics.event("hit", car.hit)
        end
        car.hit = nil
      end
    end
    -- what the player's car feels through the controller (the road only while racing; the finish's second beat after it)
    haptics.drive(p, dt, self.phase == "racing" and not self.player_finished_at)

    if self.trial and self.phase == "racing" and not p.finish_time and p.lap_started then self:record_ghost(dt) end
    self:places()
    self:update_camera(dt)

    -- the race is over a few seconds after the player finishes
    if self.player_finished_at and self.clock - self.player_finished_at > 2.6 and not self.leaving then
      self.leaving = true
      local place = self.player.place or 1
      local spec = { palette = "finish", finish = true }
      if self.stage then spec.title, spec.sub = "STAGE COMPLETE", "" else spec.title, spec.sub = (place == 1 and "YOU WIN!" or "FINISH!"), string.upper(ui.ordinal(place)) .. " PLACE" end
      transition.cover(spec, function() self:to_results() end)
    end
  end

  -- ---- camera ---------------------------------------------------------------------------------------------------------

  function Race:update_camera(dt)
    local p, cam = self.player, self.camera
    local sinh, cosh = math.sin(p.heading), math.cos(p.heading)
    local speed = math.abs(p.speed)
    -- the camera's own heading trails the car's a little, so a bend swings into view
    local diff = track.wrap(p.heading - cam.heading)
    cam.heading = cam.heading + diff * math.min(1, dt * 7)
    -- the right stick picks a view, as in the open-world racers: left looks out of the left, right out of the right, down looks
    -- behind, up is the way ahead, and the camera goes to any angle in between, wherever the stick points. The camera goes to the view and stays there while the stick is held,
    -- and eases back behind the car when it is let go; a press of the stick looks back too.
    local lx, ly = nova.input.axis("look_x"), nova.input.axis("look_y")
    local orbit = self.orbit
    if not orbit then orbit = { yaw = 0, lift = 0 }; self.orbit = orbit end
    -- (a stick let go springs back through the middle and its direction swings about on the way: the view is only taken from a stick pushed
    -- well over, is kept while it is half way, and lets go once it is near the middle, so that letting go never flicks the camera)
    local push = math.sqrt(lx * lx + ly * ly)
    if push > 0.6 then
      -- the camera goes to where the stick points: its angle from "up" (0 ahead, negative a quarter turn to the right, a half turn behind;
      -- a car's left is +x, so right is the negative turn)
      orbit.held = math.atan(-lx, -ly)
    elseif push < 0.3 then
      orbit.held = nil
    end
    local want_yaw = orbit.held or 0
    if not orbit.held and nova.input.down("look_back") then want_yaw = math.pi end
    orbit.yaw = orbit.yaw + track.wrap(want_yaw - orbit.yaw) * math.min(1, dt * (want_yaw ~= 0 and 8 or 4))
    -- a little higher when looking behind, to see over the car
    orbit.lift = orbit.lift + ((math.abs(want_yaw) > 2.5 and 0.3 or 0) - orbit.lift) * math.min(1, dt * 5)
    -- speed blur: the picture streaks toward its edges as the speed climbs past 30 m/s (and not while looking round)
    if self.look_now then
      local want = (math.max(0, math.min(1, (speed - 30) / 16)) * 0.55 + (p.draft or 0) * 0.3) * (1 - math.min(1, math.abs(orbit.yaw)))
      self.blur_now = self.blur_now + (want - self.blur_now) * math.min(1, dt * 3)
      self.look_now.blur = self.blur_now
      nova.look(self.look_now)
    end
    local sh, ch = math.sin(cam.heading), math.cos(cam.heading)
    local oy = math.abs(orbit.yaw)
    if self.view_mode == 3 then          -- bonnet: the stick turns the head
      local a = p.heading + orbit.yaw * 1.3
      cam.x, cam.y, cam.z = p.x + sinh * 0.6, 1.25, p.z + cosh * 0.6
      cam.tx, cam.ty, cam.tz = cam.x + math.sin(a) * 20, 1.1 + orbit.lift * 4, cam.z + math.cos(a) * 20
      cam.fov = 70 + speed * 0.2
      cam.bonnet = true
    else
      local near = self.view_mode == 1
      local back = (near and 6.4 or 9.5) + speed * 0.03
      local height = (near and 3.1 or 4.2) + orbit.lift * (near and 2.5 or 3.5)
      -- the camera's place on a circle round the car: behind it when the angle is 0
      local a = cam.heading + orbit.yaw
      local ox, oz = math.sin(a), math.cos(a)
      cam.x, cam.y, cam.z = p.x - ox * back, height, p.z - oz * back
      -- looking ahead of the car when behind it, at the car itself as it swings away
      -- (the near view sits a little higher and looks further up the road, so the car is low in the picture and the road ahead fills it)
      local ahead = (near and 8 or 5) * math.max(0, 1 - oy / 0.9)
      cam.tx, cam.ty, cam.tz = p.x + sh * ahead, near and 1.7 or 1.1, p.z + ch * ahead
      cam.fov = 62 + speed * 0.2
      cam.bonnet = false
    end
  end

  -- After dark the renderer has room for eight point lights a frame: two pools of light in front of the player, one
  -- in front of each of the two nearest rivals, and whatever is left goes to the street lamps nearest the camera.
  -- Headlights are spot lights: a cone from each lamp, tilted a little down so that it lands on the road and fades out along it.
  local HEADLIGHT = { color = { 255, 238, 190 }, radius = 28, angle = 46 }
  local PLAYER_BEAM = { color = { 255, 238, 190 }, radius = 60, angle = 36 }
  local rival_beam = { color = { 0, 0, 0 }, radius = HEADLIGHT.radius, angle = HEADLIGHT.angle }
  local LAMP = { color = { 255, 226, 150 }, radius = 26 }
  local beam_opts = { color = HEADLIGHT.color, radius = 0, angle = 0, dir = { 0, 0, 0 } }
  -- One headlight: `side` is -1 (right lamp), 1 (left) or 0 (one lamp in the middle); the beams point a little outwards.
  local function headlight(car, side, opts)
    local fx, fz = math.sin(car.heading), math.cos(car.heading)
    local lx, lz = fz, -fx -- to the car's left
    local o = beam_opts
    o.color, o.radius, o.angle = opts.color, opts.radius, opts.angle
    o.dir[1], o.dir[2], o.dir[3] = fx + lx * side * 0.07, -0.1, fz + lz * side * 0.07
    local px, pz = car.x + fx * 1.7 + lx * side * 0.55, car.z + fz * 1.7 + lz * side * 0.55
    nova.point_light(px, 0.75 + nova.terrain_height(px, pz), pz, o)
  end

  function Race:night_lights(cam)
    local p = self.player
    headlight(p, 1, PLAYER_BEAM)
    headlight(p, -1, PLAYER_BEAM)
    local used = 2
    local a, b, da, db
    for _, car in ipairs(self.cars) do
      if car ~= p then
        local d = (car.x - p.x) ^ 2 + (car.z - p.z) ^ 2
        if d < 60 * 60 then
          if not a or d < da then b, db, a, da = a, da, car, d
          elseif not b or d < db then b, db = car, d end
        end
      end
    end
    -- (a rival's lamps fade in over its last 15 m before the 60 m, and the street lamps always have the same four lights, so that a lamp
    -- never switches on because a rival came near)
    for _, car in ipairs({ a or false, b or false }) do
      if car then
        local fade = math.min(1, (60 - math.sqrt((car.x - p.x) ^ 2 + (car.z - p.z) ^ 2)) / 15)
        rival_beam.color[1], rival_beam.color[2], rival_beam.color[3] = HEADLIGHT.color[1] * fade, HEADLIGHT.color[2] * fade, HEADLIGHT.color[3] * fade
        headlight(car, 0, rival_beam)
      end
    end
    lamps.light(cam.x, cam.z, 70, 4, LAMP)
  end

  function Race:draw()
    local cam = self.camera
    -- (the renderer lifts everything on the ground by the hills; a camera, like a light, is placed by hand: above the ground under it, and
    -- over the crest of a hill that it is behind)
    local ground_here, ground_there = nova.terrain_height(cam.x, cam.z), nova.terrain_height(cam.tx, cam.tz)
    if cam.bonnet then
      -- on the bonnet the camera rides with the car: the ground under the car, never lifted over a crest ahead (the road ahead may climb)
      local p = self.player
      nova.camera(cam.x, cam.y + (p.lift or 0) + nova.terrain_height(p.x, p.z), cam.z, cam.tx, cam.ty + ground_there, cam.tz, cam.fov)
    else
      nova.camera(cam.x, math.max(cam.y + ground_here, ground_there + 1.2), cam.z, cam.tx, cam.ty + ground_there, cam.tz, cam.fov)
    end
    if config.night then self:night_lights(cam) end
    horizon.draw(cam.x, cam.z, config.horizon)
    -- the road: one ribbon along the whole circuit (made from tracks/<course>.track.json with the scene). The scene's `road` object draws it
    -- (entities/road.lua); a scene without one gets it drawn from here (it casts no shadow)
    if not self.road_object then self.road_object = nova.first("road") or false end
    if not self.road_object then nova.model("road_" .. state.current_track().id, 0, 0, 0, ROAD_OPTS) end
    fx.draw_skids(cam.x, cam.z, 90)
    crowd.draw(cam.x, cam.z, self.crowd_time or 0)
    local gx, gz, gh = self:ghost_pose()
    if gx then
      self.ghost_opts = self.ghost_opts or { ry = 0, tint = { 130, 200, 255 } }
      self.ghost_opts.ry = gh
      nova.model(self.player.model_id, gx, 0, gz, self.ghost_opts)
    end
  end

  -- ---- the HUD ----------------------------------------------------------------------------------------------------------
  -- As the mockup has it: no panels, white Barlow with a soft dark edge so it reads on dusk and snow alike; the time, how it is going
  -- and the place top left, the pace notes top right, the route bottom left and the speed bottom right.
  local C, F = ui.color, ui.font
  local EDGE = { 0, 0, 0, 150 }
  local function hud_text(x, y, text, font, size, colour, opts)
    local o = { font = font, size = size, color = colour or C.white, outline = { color = EDGE, width = math.max(0.75, size / 34) }, shadow = { 0, 0, 0, 90 } }
    if opts then for k, v in pairs(opts) do o[k] = v end end
    return nova.ui.text(x, y, text, o)
  end
  local function signed(d) return string.format("%s%.2f", d <= 0 and "-" or "+", math.abs(d)) end

  -- top left: the time, a gap beside it (green ahead, red behind), and a line under it
  function Race:hud_top_left(w)
    local p = self.player
    local tw = hud_text(36, 27, ui.time(math.max(0, self.clock)), F.bold, 31.5, C.white)
    local delta
    if self.stage then
      local sec = self.sections[math.min(self.section, #self.sections)]
      local through = math.max(0, math.min(1, (p.progress - sec.from) / math.max(1, sec.to - sec.from)))
      if self.phase == "racing" and not p.finish_time then
        delta = (self.clock - self.section_start) - sec.par * state.current_difficulty().allow * through
      end
    elseif self.trial then
      delta = self:ghost_gap()
    end
    if delta then hud_text(36 + tw + 10, 35, signed(delta), F.heavy, 21, delta <= 0 and C.green or C.red) end
    local under
    if self.stage then
      under = "SECTION " .. self.section .. " / " .. #self.sections .. "   ·   " .. self.score .. " PTS"
    else
      local lap = math.max(1, math.min(self.laps, self:lap_of(p)))
      under = (self.trial and "" or ("P" .. (p.place or 1) .. " / " .. #self.cars .. "   ·   ")) .. "LAP " .. lap .. " / " .. self.laps
      if self.best_lap then under = under .. "   ·   BEST " .. ui.time(self.best_lap) end
    end
    hud_text(36, 69, under, F.bold, 19.5, C.hud, { spacing = 0.06 })
    -- a rally section just done: its time against par and its points, under the line, fading in and out again after four seconds
    local split = self.split
    if self.stage and split then
      local age = self.clock - split.at
      local a = math.min(1, age / 0.25) * math.min(1, math.max(0, (4 - age) / 0.5))
      if a > 0 then
        local y = 97 - (1 - math.min(1, age / 0.25)) * 6
        local fade = function(c) return { c[1], c[2], c[3], math.floor(255 * a) } end
        local o = { outline = { color = { 0, 0, 0, math.floor(175 * a) }, width = 1 }, shadow = false }
        local x = 36 + hud_text(36, y, "SPLIT " .. split.n .. "  ", F.bold, 18, fade(C.hud), o)
        x = x + hud_text(x, y, signed(split.delta) .. "  ", F.heavy, 18, fade(split.delta <= 0 and C.green or C.red), o)
        hud_text(x, y, "+" .. split.score, F.heavy, 18, fade(C.gold), o)
      end
    end
  end

  -- The pace notes, top right: the next corner big, the one after it smaller under it, each an icon from the mockup's set on the side
  -- the road turns to (no distance) and its grade (L4, R2, HAIRPIN). Each slides up and fades in as it comes on, moves up into the big
  -- place when the corner before it is passed, and slides on up and fades out when its own corner is behind the car. They show only
  -- once the car is under way.
  local GANTRY_Y, MESSAGE_Y = 104, 196
  local NOTE_Y = { 27, 66 }     -- the big note's top, the small one's
  local NOTE_SIZE = { 30, 21 }
  function Race:draw_pace_notes(w, live)
    local p = self.player
    local now = nova.time()
    local dt = math.max(0, math.min(0.1, now - (self.notes_t or now)))
    self.notes_t = now
    local fx = self.note_fx or {}
    self.note_fx = fx
    -- which notes are up: the next two corners within 450 m
    local want = {}
    if live then
      local shown = 0
      for k, note in ipairs(self.notes) do
        local away = note.s - p.progress
        if away > -20 and away < 450 and shown < 2 then
          shown = shown + 1
          want[k] = shown
        end
      end
    end
    for k, place in pairs(want) do
      if not fx[k] then fx[k] = { a = 0, y = NOTE_Y[place] + 20, size = NOTE_SIZE[place] } end
    end
    local right = w - 36
    for k, f in pairs(fx) do
      local place = want[k]
      local ease = math.min(1, dt * 9)
      if place then
        f.a = f.a + (1 - f.a) * ease
        f.y = f.y + (NOTE_Y[place] - f.y) * ease
        f.size = f.size + (NOTE_SIZE[place] - f.size) * ease
      else
        -- done: on up and away
        f.a = f.a - dt * 4
        f.y = f.y - dt * 60
      end
      if f.a <= 0 then
        fx[k] = nil
      else
        local note = self.notes[k]
        local size = f.size
        local a = f.a
        local hairpin = note.grade == 1
        local text = hairpin and "HAIRPIN" or ((note.left and "L" or "R") .. note.grade)
        local colour = { C.gold[1], C.gold[2], C.gold[3], math.floor(255 * a) }
        local o = { outline = false, shadow = { 0, 0, 0, math.floor(130 * a) } }
        local tw = nova.ui.text_width(text, { font = F.heavy, size = size })
        local icon = size * 1.15
        local gap = size * 0.3
        local icon_name = hairpin and (note.left and "hairpin" or "hairpin_right") or (note.left and "left" or "right")
        local shade = { 0, 0, 0, math.floor(110 * a) }
        -- the icon on the side the road turns to: before the words for a left, after them for a right
        if note.left then
          local x = right - tw - gap - icon
          ui.icon(icon_name, x, f.y + (size - icon) / 2 + size * 0.08, icon, colour, nil, shade)
          hud_text(right - tw, f.y, text, F.heavy, size, colour, o)
        else
          local x = right - icon
          hud_text(x - gap - tw, f.y, text, F.heavy, size, colour, o)
          ui.icon(icon_name, x, f.y + (size - icon) / 2 + size * 0.08, icon, colour, nil, shade)
        end
      end
    end
  end

  function Race:draw_ui()
    -- (text is drawn over the wipe, so the HUD waits until the wipe has gone)
    if self.paused then self:draw_pause() elseif not transition.busy() then self:draw_hud() end
    local dark = self:rescue_dark()
    if dark > 0 and not self.paused then
      local w = nova.view()
      nova.ui.rect(0, 0, w, 540, { 0, 0, 0, math.floor(255 * dark) })
    end
    transition.draw()
  end

  function Race:draw_hud()
    local w = nova.view()
    local p = self.player
    -- bottom right: the gear, the speed big, km/h, and a thin line of the engine's revs under them
    local right = w - 36
    local kmh = math.floor(math.abs(p.speed) * 3.6 + 0.5)
    local gear = p.speed < -0.5 and "R" or ("G" .. (p.gear or 1))
    local kw = nova.ui.text_width("km/h", { font = F.body, size = 16.5 })
    hud_text(right - kw, 467, "km/h", F.body, 16.5, C.hud, { valign = "baseline" })
    local sw = nova.ui.text_width(tostring(kmh), { font = F.heavy, size = 54 })
    local sx = right - kw - 9 - math.max(sw, nova.ui.text_width("888", { font = F.heavy, size = 54 }))
    hud_text(right - kw - 9 - sw, 467, tostring(kmh), F.heavy, 54, C.white, { valign = "baseline" })
    hud_text(sx - 9 - nova.ui.text_width(gear, { font = F.bold, size = 18 }), 467, gear, F.bold, 18, p.shift_time > 0 and C.dim or C.hud, { valign = "baseline" })
    local rev = math.max(0, math.min(1, ((p.rev or 0.16) - 0.16) / 0.84))
    local limiter = rev > 0.985 and math.floor(nova.time() * 16) % 2 == 0
    nova.ui.rect(right - 165 - 1, 476 - 1, 167, 4.25, { 0, 0, 0, 115 })
    nova.ui.rect(right - 165, 476, 165 * rev, 2.25, limiter and C.orange or C.white)
    -- a word or two above it only when something needs saying
    local say = 395
    local function warn(text, colour)
      hud_text(right - nova.ui.text_width(text, { font = F.bold, size = 16.5, spacing = 0.12 }), say, text, F.bold, 16.5, colour, { spacing = 0.12 })
      say = say - 21
    end
    if (p.draft or 0) > 0.04 then warn("SLIPSTREAM", C.green) end
    if p.damage > 0.5 then warn("CAR DAMAGED", C.red) end
    if p.tyres < 0.35 then warn("TYRES WORN", C.gold) end

    self:hud_top_left(w)
    if self.stage then
      -- (they wait until the car is under way, a moment after GO!, so that they never sit on the start lights)
      if self.phase == "racing" and not self.notes_live and self.clock > 1.2 and math.abs(p.speed) > 6 then self.notes_live = true end
      self:draw_pace_notes(w, self.notes_live and not p.finish_time)
    end

    -- bottom left: the route (dark band, the road white, the way already driven fainter), the cars on it, and what is left under it
    local m = self.map
    local mx, my = 36, 540 - 30 - 24 - m.h
    local dots = m.dots
    local mine = self.player.waypoint and math.floor((self.player.waypoint + 1) / 2) or 1
    local closed = not self.stage
    for pass = 1, 2 do
      for i = 1, #dots - (closed and 0 or 1) do
        local a, b = dots[i], dots[i % #dots + 1]
        if pass == 1 then
          nova.ui.line(mx + a[1], my + a[2], mx + b[1], my + b[2], 6.75, { 0, 0, 0, 150 })
        else
          local driven = self.stage and i < mine
          nova.ui.line(mx + a[1], my + a[2], mx + b[1], my + b[2], 3, driven and { 255, 255, 255, 115 } or C.white)
        end
      end
    end
    if self.stage then
      local e = dots[#dots]
      nova.ui.rect(mx + e[1] - 4.5, my + e[2] - 4.5, 9, 9, C.white)
    end
    for i = #self.cars, 1, -1 do
      local car = self.cars[i]
      local dx, dz = (m.hi_x - car.x) * m.scale, (m.hi_z - car.z) * m.scale
      if car.is_player then
        nova.ui.rect(mx + dx - 6.75, my + dz - 6.75, 13.5, 13.5, C.white)
        nova.ui.rect(mx + dx - 4.5, my + dz - 4.5, 9, 9, C.orange)
      else
        nova.ui.rect(mx + dx - 3.5, my + dz - 3.5, 7, 7, MAP_COLORS[(i - 2) % 3 + 1])
      end
    end
    local below
    if self.stage then
      below = string.format("%.1f km left", math.max(0, self.length - math.max(0, p.progress)) / 1000)
    else
      below = string.format("%.1f km lap", self.length / 1000)
    end
    hud_text(36, 540 - 30 - 18, below, F.bold, 18, C.hud, { spacing = 0.04 })

    -- countdown, messages, wrong way
    -- (below the pace notes and the top corners: the lights at GANTRY_Y, the number and the messages under them)
    -- the start: three lights light one by one on a gantry at the top (red, then all green at GO!), and the number pops in big
    local n = self.phase == "countdown" and math.ceil(self.countdown) or 0
    local go = self.message == "GO!" and self.message_time > 0
    if self.phase == "countdown" or go then
      local wv = nova.view()
      local lit = go and 3 or math.max(0, 4 - n)
      nova.ui.slant(wv / 2 - 120, GANTRY_Y, 240, 84, 0, { C.panel[1], C.panel[2], C.panel[3], 235 })
      for i = 1, 3 do
        local image = (go and "ui/light_green") or (i <= lit and "ui/light_red") or "ui/light_off"
        nova.ui.sprite(image, wv / 2 + (i - 2) * 70, GANTRY_Y + 42, { w = 56, h = 56 })
      end
    end
    if n >= 1 and n <= 3 then
      local frac = self.countdown - (n - 1) -- 1 as the number appears, falling to 0
      local pop = 1 + 0.35 * math.max(0, frac - 0.7) / 0.3
      hud_text(w / 2, MESSAGE_Y + 40 - 40 * pop, tostring(n), F.title, 84 * pop, C.white, { align = "center" })
    end
    if self.message_time > 0 then
      local go_message = self.message == "GO!"
      -- (a message may have a second line, in smaller type; both are fitted to the screen)
      local first, second = self.message:match("^(.-)\n(.*)$")
      first = first or self.message
      local width = w - 60
      local size = go_message and 96 or 42
      local _, _, used = hud_text(30, MESSAGE_Y, string.upper(first), F.title, size, go_message and C.green or C.white,
        { width = width, align = "center", fit = "shrink" })
      if second then hud_text(30, MESSAGE_Y + used * 1.25, second, F.semi, 22.5, C.gold, { width = width, align = "center", fit = "shrink" }) end
    end
    local here = track.point(p.waypoint or 1)
    if self.phase == "racing" and math.abs(p.speed) > 4 then
      local facing = math.sin(p.heading) * here.tx + math.cos(p.heading) * here.tz
      if facing < -0.3 then hud_text(w / 2, MESSAGE_Y + 96, "WRONG WAY", F.title, 39, C.red, { align = "center" }) end
    end
    if p.surface == "rough" and self.phase == "racing" and p.off_middle > 14 then
      local words = "Back on the road"
      local tw = nova.ui.text_width(words, { font = F.semi, size = 18 })
      ui.pad("pad_select", w / 2 - (tw + 34) / 2, 426, 26)
      hud_text(w / 2 - (tw + 34) / 2 + 34, 430, words, F.semi, 18, C.hud)
    end
  end

  -- ---- pause -----------------------------------------------------------------------------------------------------------
  -- As the mockup has it: the race dimmed behind, a dark panel down the left with the menu, and the run so far on the right.

  -- (the pause menu reads the pad as it draws: see draw_pause)
  function Race:update_pause() end

  function Race:draw_pause()
    local w = nova.view()
    local p = self.player
    local info = state.current_track()
    nova.ui.rect(0, 0, w, 540, { 8, 11, 15, 184 })
    ui.side_panel(420, 1)
    local kicker = self.stage and ("Section " .. self.section .. "  ·  " .. info.name)
      or ("Lap " .. math.max(1, math.min(self.laps, self:lap_of(p))) .. "  ·  " .. info.name)
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 42, ui.header(kicker, "Paused", 72) }
    -- the run so far: the time, how it is going, the last three sections or laps, and a few facts
    local delta
    if self.stage then
      local sec = self.sections[math.min(self.section, #self.sections)]
      local through = math.max(0, math.min(1, (p.progress - sec.from) / math.max(1, sec.to - sec.from)))
      delta = (self.clock - self.section_start) - sec.par * state.current_difficulty().allow * through
    elseif self.trial then
      delta = self:ghost_gap()
    end
    local top = { "row", align = "end", { "text", ui.time(math.max(0, self.clock)), font = F.heavy, size = 63, h = 60, grow = 1 } }
    if delta then top[#top + 1] = { "text", signed(delta), font = F.heavy, size = 27, color = C.ink, panel = { color = delta <= 0 and C.green or C.red }, pad = { 12, 3 } } end
    local splits = { "row", gap = 7.5 }
    local done = self.stage and self.section_log or self.lap_times
    for k = 1, 3 do
      local i = math.max(0, #done - 3) + k
      local d = done[i]
      local value, colour = "-", C.dim
      if d then
        if self.stage then value, colour = signed(d.time - d.par), (d.time <= d.par) and C.green or C.red
        else value, colour = ui.time(d), C.white end
      end
      splits[#splits + 1] = { "panel", grow = 1, panel = { color = C.panel2 }, pad = { 10.5, 7.5 }, gap = 0,
        { "text", (self.stage and "Section " or "Lap ") .. i, font = F.body, size = 15, color = C.dim },
        { "text", value, font = F.heavy, size = 24, color = colour } }
    end
    local function fact(label, value, colour)
      return { "row", h = 27, { "text", label, font = F.body, size = 18, color = C.dim, grow = 1 }, { "text", value, font = F.semi, size = 18, color = colour or C.white, w = 200, align = "right" } }
    end
    local look = require("lib.course").current()
    local panel = { "panel", anchor = "topright", margin = 48, y = -6, w = 420, pad = { 21, 18 }, gap = 6,
      { "text", "RUN SO FAR", style = "label" }, top, { "space", h = 8 }, splits, { "space", h = 8 },
      { "box", h = 1.5, draw = function(r) nova.ui.rect(r.x, r.y, r.w, r.h, C.divider) end } }
    if not self.stage and not self.trial then panel[#panel + 1] = fact("Position", ui.ordinal(p.place or 1) .. " of " .. #self.cars) end
    if self.stage then panel[#panel + 1] = fact("Score", tostring(self.score), C.gold) end
    if info.generated then
      -- a made-up course: the gold time to aim for, and on a Daily Race how long until the next one appears
      local t = targets.of(info, state.current_car(), self.laps)
      panel[#panel + 1] = fact("Gold / silver / bronze", ui.time(t.gold):gsub("%.%d%d$", "") .. " · " .. ui.time(t.silver):gsub("%.%d%d$", "") .. " · " .. ui.time(t.bronze):gsub("%.%d%d$", ""), C.gold)
      if info.daily then
        local daily = require("lib.daily")
        panel[#panel + 1] = fact("Next Daily Race in", daily.clock_text(daily.until_next()))
      end
    end
    panel[#panel + 1] = fact("Weather", (look.weather and look.weather.kind == "snow") and "Snow" or (look.night and "Clear night" or "Clear"))
    panel[#panel + 1] = fact("Tyres", math.floor(p.tyres * 100 + 0.5) .. "%", p.tyres < 0.35 and C.gold or nil)
    panel[#panel + 1] = fact("Car damage", math.floor(p.damage * 100 + 0.5) .. "%", p.damage > 0.15 and C.gold or nil)
    nova.ui.layout(panel)
    -- (it opens on Resume, and the press that paused is not also taken by the menu: Escape is both pause and back)
    local fresh = self.pause_choice == 1
    if fresh then nova.ui.focus("pause", "resume"); self.pause_choice = 0 end
    local r = nova.ui.menu {
      id = "pause", anchor = "topleft", margin = 0, x = 48, y = 165, w = 315, active = not fresh, enter = false,
      { "button", "RESUME", id = "resume", h = 51 }, { "button", "RESTART " .. (self.stage and "STAGE" or "RACE"), id = "restart", h = 51 },
      { "button", "QUIT TO MENU", id = "quit", h = 51, danger = true },
    }
    ui.hints({ { "pad_a", "Select" }, { "pad_start", "Resume" } })
    if r.back or r.pressed == "resume" then
      if r.pressed then audio.sfx("menu_accept") end
      self.paused = false
      nova.pause(false) -- (the wind blows again)
      nova.music.volume(state.music_volume)
    elseif r.pressed then
      audio.sfx("menu_accept")
      if r.pressed == "restart" then
        nova.restart_scene()
      else
        audio.stop_music(0.4)
        nova.goto_scene("title", "menu")
      end
    end
  end

  -- ---- the end -----------------------------------------------------------------------------------------------------------

  -- A rival still on the road when the player finishes is not "did not finish": its time is worked out from how far it has to go at its
  -- average pace so far (the table says it is an estimate).
  function Race:estimate_finishes()
    local goal = self.laps * self.length
    for _, car in ipairs(self.cars) do
      if not car.finish_time then
        local covered = math.max(1, car.progress - (car.start_progress or -self.length * 0.02))
        local pace = math.max(8, covered / math.max(1, self.clock))
        car.finish_time = self.clock + math.max(0, goal - car.progress) / pace
        car.estimated = true
      end
    end
  end

  -- A made-up course's medal (its gold, silver and bronze times for this car, lib/targets.lua), the codes played lately, and a Daily
  -- Race's result for its day. Filled into state.result.generated.
  function Race:generated_result(time)
    local info = state.current_track()
    local t = targets.of(info, state.current_car(), self.laps)
    local medal = targets.medal(time, t)
    local out = { medal = medal, targets = t, code = info.code, daily = info.daily }
    state.add_recent(info.code)
    if info.daily then out.best = require("lib.daily").record(info.day, time, medal) end
    nova.log(string.format("results: %s %s, ideal %.1f, gold %.1f silver %.1f bronze %.1f: %s", info.code, ui.time(time), t.ideal, t.gold, t.silver, t.bronze, targets.NAMES[medal]))
    return out
  end

  function Race:to_results()
    if not self.trial then self:estimate_finishes() end
    local order = self:places()
    local info = state.current_track()
    local rows = {}
    if self.stage and info.generated then
      -- (a made-up stage: scored as any stage, but its progress is its medal, not the career's stars)
      local total_time = self.player.finish_time
      local stars = (self.score >= 4500 and 3) or (self.score >= 3500 and 2) or (self.score >= 2250 and 1) or 0
      state.result = {
        track = info.id, track_name = info.name, laps = 1, rows = {}, place = 1, time = total_time, trial = false,
        rally = { sections = self.section_log, score = self.score, time = total_time, stars = stars, max = 1000 * #self.sections },
      }
      state.result.record_time = state.submit("rally", info.id, total_time)
      state.result.generated = self:generated_result(total_time)
      state.result.coins = state.reward(info, { stars = state.result.generated.medal })
      state.add_coins(state.result.coins)
      audio.stop_music(0.5)
      nova.goto_scene("results")
      return
    end
    if self.stage then
      local total_time = self.player.finish_time
      local stars = (self.score >= 4500 and 3) or (self.score >= 3500 and 2) or (self.score >= 2250 and 1) or 0
      state.result = {
        track = info.id, track_name = info.name, laps = 1, rows = {}, place = 1, time = total_time, trial = false,
        rally = { sections = self.section_log, score = self.score, time = total_time, stars = stars, max = 1000 * #self.sections },
      }
      state.result.record_time = state.submit("rally", info.id, total_time)
      state.result.record_score = state.submit_score(info.id, self.score)
      state.result.opened = state.record(state.stages, info.id, stars)
      state.result.coins = state.reward(info, { stars = stars })
      state.add_coins(state.result.coins)
      nova.log(string.format("results: rally score %d of %d in %s, %d stars", self.score, 1000 * #self.sections, ui.time(total_time), stars))
      nova.log(string.format("results: %d coins, %d in all%s", state.result.coins, state.coins(), state.result.opened and (", opened " .. state.result.opened.id) or ""))
      audio.stop_music(0.5)
      nova.goto_scene("results")
      return
    end
    if self.trial then
      -- a trial's table is the laps, fastest highlighted
      for i, t in ipairs(self.lap_times) do rows[i] = { name = "Lap " .. i, time = t, you = t == self.best_lap } end
    else
      for i, car in ipairs(order) do
        rows[i] = { name = car.name, car = car.model_id, place = i, time = car.finish_time, you = car.is_player, estimated = car.estimated }
      end
    end
    local me = self.player
    state.result = {
      track = info.id, track_name = info.name, laps = self.laps, rows = rows, place = me.place, time = me.finish_time,
      best_lap = self.best_lap, record_time = false, record_lap = false, trial = self.trial,
    }
    if me.finish_time then state.result.record_time = state.submit("race" .. self.laps, info.id, me.finish_time) end
    if not self.trial and me.place == 1 and me.finish_time then state.add_win() end
    if self.best_lap then state.result.record_lap = state.submit("lap", info.id, self.best_lap) end
    if info.generated and me.finish_time then state.result.generated = self:generated_result(me.finish_time) end
    -- the circuit's progress (a race against rivals) and the coins it pays
    if me.finish_time then
      if not self.trial and not info.generated then state.result.opened = state.record(state.tracks, info.id, me.place) end
      state.result.coins = state.reward(info, self.trial and { trial = true, record = state.result.record_lap } or { place = me.place, laps = self.laps })
      state.add_coins(state.result.coins)
    end
    if not self.trial then
      local timed, ids, times = 0, {}, {}
      for _, car in ipairs(order) do
        if car.finish_time then timed = timed + 1 end
        if not car.is_player then ids[#ids + 1] = car.model_id end
        times[#times + 1] = string.format("%s%s=%.1f", car.is_player and "*" or "", car.model_id, car.finish_time or 0)
      end
      nova.log("results: times " .. table.concat(times, " "))
      local off = {}
      for _, car in ipairs(order) do
        if not car.is_player then off[#off + 1] = string.format("%s=%.1f%%", car.model_id, 100 * (car.rough_time or 0) / math.max(1, car.race_time or 1)) end
      end
      nova.log("results: off the road " .. table.concat(off, " "))
      nova.log(string.format("results: a time for %d of %d cars; rivals: %s", timed, #order, table.concat(ids, " ")))
    end
    nova.log(string.format("results: place %d of %d, time %s", me.place, #order, ui.time(me.finish_time)))
    nova.log(string.format("results: %d coins, %d in all%s", state.result.coins or 0, state.coins(), state.result.opened and (", opened " .. state.result.opened.id) or ""))
    nova.log(string.format("wear: tyres %.2f, body %.2f", me.tyres, 1 - me.damage))
    audio.stop_music(0.5)
    nova.goto_scene("results")
  end

  return Race
end

return race

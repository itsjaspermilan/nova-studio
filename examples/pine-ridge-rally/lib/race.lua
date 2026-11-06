-- The race: building a circuit's scene into a start grid, the countdown, laps and places, the chase camera, the HUD,
-- pause and the finish. A circuit's own scene file (scenes/pine_ridge.lua) just says which ground, sky and music it has.
local state = require("lib.state")
local track = require("lib.track")
local lamps = require("lib.lamps")
local grid = require("lib.grid")
local fx = require("lib.fx")
local roadside = require("lib.roadside")
local foliage = require("lib.foliage")
local looks = require("lib.looks")
local horizon = require("lib.horizon")
local audio = require("lib.audio")
local ui = require("lib.ui")

local race = {}

local RIVALS = {
  { name = "Mika", skill = 0.93, lane = -1.8 },
  { name = "Dax", skill = 0.88, lane = 2.2 },
  { name = "Rosa", skill = 0.83, lane = 0.4 },
}
local MAP_COLORS = { { 96, 165, 250 }, { 74, 222, 128 }, { 244, 114, 182 } }
local ROAD_HALF = 6.2        -- metres from the middle to where the grass starts
local LOOK_FAR = 240         -- metres of scenery drawn around the camera (fog hides its edge)

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

-- Steers a car along the waypoints. `car.skill` (0.8 to 1) is how hard it dares to go.
local function drive_itself(car)
  local c = car.ctl
  local look = 3 + math.floor(math.abs(car.speed) / 8)
  local target = track.point((car.waypoint or 1) + look)
  local tx = target.x + target.tz * (car.lane or 0)
  local tz = target.z - target.tx * (car.lane or 0)
  local want = math.atan(tx - car.x, tz - car.z)
  local err = track.wrap(want - car.heading)
  -- what is in the way? (a barrier on the outside of a bend, a tree on a straight): steer away from it and ease off
  local h = car.heading
  local ahead = 9 + math.abs(car.speed) * 0.8
  local dist, ox, oz = nova.scenery.ahead(car.x, car.z, math.sin(h), math.cos(h), ahead, 1.45)
  local urgency = 0
  if dist then
    urgency = 1 - dist / ahead
    local on_left = (ox - car.x) * math.cos(h) - (oz - car.z) * math.sin(h) >= 0
    -- (the heading grows to the left, so turning away from something on the left lowers it)
    err = err + (on_left and -1 or 1) * (0.25 + 0.9 * urgency)
  end
  c.steer = math.max(-1, math.min(1, -err * 2.4))
  -- slow for the sharpest bend in the next stretch
  local kmax = 0
  for j = 1, 14 do kmax = math.max(kmax, math.abs(track.point((car.waypoint or 1) + j).k)) end
  -- how hard it dares to corner: what the tyres can hold on this surface, less a margin for the weaker drivers
  local hold = ({ road = 21, dirt = 15, rough = 11 })[car.surface] or 21
  local a_lat = hold * car:grip_now() * (car.skill or 0.9)
  local want_speed = math.min(car.vmax or 40, math.sqrt(a_lat / math.max(kmax, 0.0008)))
  want_speed = math.max(want_speed, 13)
  if urgency > 0.45 then want_speed = math.max(13, want_speed * (1.3 - urgency)) end
  local diff = want_speed - car.speed
  c.throttle = diff > 0 and math.min(1, diff / 3) or 0
  c.brake = diff < -2 and math.min(1, (-diff - 2) / 8) or 0
  c.handbrake = false
  if math.abs(err) > 1.0 then c.throttle = math.min(c.throttle, 0.4) end
end

-- ---- the scene ---------------------------------------------------------------------------------------------------------

function race.define(config)
  local Race = nova.scene {}

  function Race:enter()
    local sun = config.sun
    nova.light { dir = sun.dir, color = sun.color, ambient = sun.ambient }
    -- the sky, and fog the colour of its horizon so that the far scenery fades out instead of popping in
    nova.scenery.range = LOOK_FAR -- (the engine draws the scene file's scenery out to here, around the camera)
    nova.shadows(state.shadows and { radius = 42, strength = 0.55 } or nil)
    nova.sky(config.sky)
    if config.sky then nova.fog { color = config.sky.horizon, near = 70, far = 330 } end
    local info = state.current_track()
    self.laps = state.laps
    track.ensure()
    assert(track.count() > 10, "this scene has no waypoints: place `waypoint` objects along the road")
    nova.log("rally: roadside " .. roadside.build(config.horizon) .. " props")
    local look = looks[state.current_track().id]
    state.apply_look(look)
    -- the circuit's look with a speed blur added each frame (see Race:update_camera)
    self.look_now = nil
    if state.effects and look.look then
      self.look_now = {}
      for k, v in pairs(look.look) do self.look_now[k] = v end
      self.blur_now = 0
    end
    foliage.start(look, state.effects and 1 or 0)
    self.length = track.length
    self.phase = "countdown"
    self.clock = 0              -- time since the green light
    self.countdown = 3.9
    self.last_beep = 4
    self.paused, self.pause_choice = false, 1
    self.view_mode = 1
    self.message, self.message_time = "", 0
    self.cars = {}
    self.lap_times = {}
    self.best_lap = nil
    self.camera = { x = 0, y = 4, z = 0, heading = 0, fov = 62, tx = 0, ty = 1, tz = 0 }
    self:build_cars()
    self:build_minimap()
    self.player.engine = audio.engine(1.0)
    self.trial = state.mode == "trial"
    self.ghost = self.trial and nova.save.get("ghost_" .. info.id, nil) or nil
    self.recording = { t = 0, pts = {} }
    audio.music(info.music or config.music, { volume = 0.5, fade = 0.8 })
    self:update_camera(1 / 60)
  end

  function Race:leave()
    for _, car in ipairs(self.cars) do if car.engine then car.engine:stop() end end
    nova.music.volume(state.music_volume)
    nova.sky(nil); nova.fog(nil); nova.shadows(nil)
    lamps.clear(); track.clear(); grid.clear(); fx.clear(); foliage.clear()
    nova.look(); nova.wind()
  end

  -- The player and three rivals on the grid; the player starts third.
  function Race:build_cars()
    local mine = state.current_car().id
    local pool = {}
    for _, c in ipairs(state.cars) do if c.id ~= mine then pool[#pool + 1] = c.id end end
    local slots = { 1, 2, 4 }  -- the rivals' places; the player has slot 3
    local length = self.length
    local function put(kind, slot)
      local g = grid.slots[slot] or grid.slots[1]
      local car = nova.spawn(kind, g.x, 0, { z = g.z })
      car:teleport(g.x, g.z, g.heading)
      car.slot = slot
      car.grip_scale = config.grip or 1
      car.dust_color = config.dust or { 200, 190, 160 }
      local idx, s = track.locate(car.x, car.z)
      car.waypoint = idx
      car.last_s = s
      car.progress = s - length   -- behind the line: negative until it is crossed
      return car
    end
    self.player = put(mine, 3)
    self.player.is_player = true
    self.player.oversteer = state.current_car().oversteer
    self.player.name = "You"
    self.cars[1] = self.player
    for i, r in ipairs(state.mode == "trial" and {} or RIVALS) do
      local car = put(pool[i], slots[i])
      car.name, car.skill, car.lane = r.name, r.skill, r.lane
      car.vmax = 40 * r.skill + 4
      car.engine = audio.engine(0.55, true)
      self.cars[#self.cars + 1] = car
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
    if delta > self.length / 2 then delta = delta - self.length
    elseif delta < -self.length / 2 then delta = delta + self.length end
    car.progress = car.progress + delta
    car.last_s = s
    car.surface = car.off_middle > ROAD_HALF + 0.8 and "rough" or (config.surface or "road")
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

  function Race:respawn(car)
    local p = track.point(car.waypoint or 1)
    car:teleport(p.x, p.z, p.heading)
    car.surface = config.surface or "road"
    car.stuck = 0
    car.off_middle = 0
  end

  function Race:bump_cars()
    for i = 1, #self.cars do
      for j = i + 1, #self.cars do
        local a, b = self.cars[i], self.cars[j]
        local dx, dz = b.x - a.x, b.z - a.z
        local d2 = dx * dx + dz * dz
        if d2 < 3.6 * 3.6 then
          local d = math.max(0.01, math.sqrt(d2))
          local nx, nz = dx / d, dz / d
          local push = (3.6 - d) / 2
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

  function Race:finish_car(car)
    car.finish_time = self.clock
    if car.is_player then
      audio.sfx("finish")
      self.player_finished_at = self.clock
      self:say("FINISH!", 4)
      car.autopilot = true
      car.skill, car.vmax, car.lane = 0.8, 30, 0
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
    if self.phase ~= "countdown" and not self.player_finished_at and nova.input.pressed("pause") then
      self.paused = not self.paused
      self.pause_choice = 1
      nova.music.volume(state.music_volume * (self.paused and 0.35 or 1))
      audio.sfx("pause")
      for _, car in ipairs(self.cars) do if car.engine then car.engine:silence() end end
      return
    end
    if self.paused then return self:update_pause() end

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
      nova.log(string.format("rally: speed=%.1f slip=%.2f heading=%.2f yaw=%.2f x=%.1f z=%.1f orbit=%.2f lift=%.2f", c.speed, c.slip, c.heading, c.yaw_rate or 0, c.x, c.z, self.orbit and self.orbit.yaw or 0, self.orbit and self.orbit.lift or 0))
    end
    if nova.input.pressed("view") then self.view_mode = self.view_mode % 3 + 1 end
    -- F9 lets the computer drive for you (for demos, and for testing the circuits without a controller)
    if nova.input.pressed("autodrive") then
      self.player.autopilot = not self.player.autopilot
      self.player.skill, self.player.vmax, self.player.lane = 0.95, 44, 0
    end

    if self.phase == "countdown" then
      self.countdown = self.countdown - dt
      local whole = math.ceil(self.countdown)
      if whole < self.last_beep and whole >= 1 and whole <= 3 then
        audio.sfx("beep")
        self.last_beep = whole
      end
      if self.countdown <= 0 then
        nova.log("go")
        self.phase = "racing"
        audio.sfx("go")
        for _, c in ipairs(self.cars) do c.enabled = true end
        self.clock = 0
        self:say("GO!", 1.2)
      end
    else
      self.clock = self.clock + dt
    end

    for _, car in ipairs(self.cars) do
      if car.is_player and not car.autopilot then read_controls(car) else drive_itself(car) end
      if car.finish_time and not car.is_player then car.vmax = 26 end
      car:drive(dt)
      if car.is_player then
        if (car.lock or 0) > 0.3 and not self.lock_logged then self.lock_logged = true; nova.log("brake: the wheels locked") end
        if (car.lock or 0) == 0 then self.lock_logged = nil end
      end
      self:locate(car)
    end
    self:bump_cars()

    if self.phase == "racing" then
      -- rivals try a little harder when behind the player, and a little less when far ahead
      for _, car in ipairs(self.cars) do
        if not car.is_player and not car.finish_time then
          local gap = self.player.progress - car.progress        -- positive: the rival is behind
          car.vmax = (40 * car.skill + 4) * (1 + math.max(-0.07, math.min(0.07, gap * 0.0004)))
        end
      end
      self:update_player_lap()
      for _, car in ipairs(self.cars) do
        if not car.finish_time and car.progress >= self.laps * self.length then self:finish_car(car) end
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
        if asked or car.off_middle > 60 or ((car ~= p or p.autopilot) and car.stuck > 4) then
          self:respawn(car)
          if car == p then self:say("Back on the road", 1.5) end
          if car ~= p or not p.autopilot then nova.log(car.name .. " put back on the road") end
        end
      end
    end

    -- the sound of every engine that is close enough to hear
    for _, car in ipairs(self.cars) do
      if car.engine then
        local rev = math.max(0, math.min(1, car.rev))
        if car.shifted then
          -- a change of gear: a short chuff, and a pop of the exhaust on the way up near the top of the rev range
          if car.is_player then audio.sfx("shift", { volume = car.shifted == "up" and 0.5 or 0.3, pitch = car.shifted == "up" and 1.0 or 1.3 }) end
          car.shifted = nil
        end
        if car.is_player then
          car.engine:update(dt, rev, car.ctl.throttle, car.surface == "rough" and math.abs(car.speed) > 3, car.slip)
        else
          local d = math.sqrt((car.x - p.x) ^ 2 + (car.z - p.z) ^ 2)
          if d < 70 then
            car.engine.volume = 0.5 * (1 - d / 70)
            car.engine:update(dt, rev, car.ctl.throttle)
          else
            car.engine:silence()
          end
        end
      end
      if car.hit then
        if car.is_player then
          audio.sfx("bump", { volume = car.hit })
          if state.vibration then nova.input.rumble { strong = math.min(1, car.hit * 1.2), weak = math.min(1, car.hit), seconds = 0.12 + 0.2 * car.hit } end
        end
        car.hit = nil
      end
    end

    if self.trial and self.phase == "racing" and not p.finish_time and p.lap_started then self:record_ghost(dt) end
    self:places()
    self:update_camera(dt)

    -- the race is over a few seconds after the player finishes
    if self.player_finished_at and self.clock - self.player_finished_at > 4 then self:to_results() end
  end

  -- ---- camera ---------------------------------------------------------------------------------------------------------

  function Race:update_camera(dt)
    local p, cam = self.player, self.camera
    local sinh, cosh = math.sin(p.heading), math.cos(p.heading)
    local speed = math.abs(p.speed)
    if self.phase == "countdown" then
      -- a slow sweep round the car before the lights go out
      local t = 1 - math.max(0, self.countdown) / 3.9
      local a = p.heading + math.pi * (1.2 - 1.2 * t)
      cam.heading = p.heading
      cam.x, cam.z, cam.y = p.x + math.sin(a + math.pi) * 9, p.z + math.cos(a + math.pi) * 9, 3.2 - 0.5 * t
      cam.tx, cam.ty, cam.tz = p.x, 1.0, p.z
      cam.fov = 58
      return
    end
    -- the camera's own heading trails the car's a little, so a bend swings into view
    local diff = track.wrap(p.heading - cam.heading)
    cam.heading = cam.heading + diff * math.min(1, dt * 7)
    -- the right stick picks a view, as in the open-world racers: left looks out of the left, right out of the right, down looks
    -- behind, up is the way ahead, and the camera goes to any angle in between, wherever the stick points. The camera goes to the view and stays there while the stick is held,
    -- and eases back behind the car when it is let go; a press of the stick looks back too.
    local lx, ly = nova.input.axis("look_x"), nova.input.axis("look_y")
    local orbit = self.orbit
    if not orbit then orbit = { yaw = 0, lift = 0 }; self.orbit = orbit end
    local want_yaw = 0
    if lx * lx + ly * ly > 0.4 * 0.4 then
      -- the camera goes to where the stick points: its angle from "up" (0 ahead, a quarter turn to the right, a half turn behind)
      want_yaw = math.atan(lx, -ly)
    elseif nova.input.down("look_back") then
      want_yaw = math.pi
    end
    orbit.yaw = orbit.yaw + track.wrap(want_yaw - orbit.yaw) * math.min(1, dt * (want_yaw ~= 0 and 8 or 4))
    -- a little higher when looking behind, to see over the car
    orbit.lift = orbit.lift + ((math.abs(want_yaw) > 2.5 and 0.3 or 0) - orbit.lift) * math.min(1, dt * 5)
    -- speed blur: the picture streaks toward its edges as the speed climbs past 30 m/s (and not while looking round)
    if self.look_now then
      local want = math.max(0, math.min(1, (speed - 30) / 16)) * 0.55 * (1 - math.min(1, math.abs(orbit.yaw)))
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
    else
      local near = self.view_mode == 1
      local back = (near and 6.4 or 9.5) + speed * 0.03
      local height = (near and 2.6 or 4.2) + orbit.lift * (near and 2.5 or 3.5)
      -- the camera's place on a circle round the car: behind it when the angle is 0
      local a = cam.heading + orbit.yaw
      local ox, oz = math.sin(a), math.cos(a)
      cam.x, cam.y, cam.z = p.x - ox * back, height, p.z - oz * back
      -- looking ahead of the car when behind it, at the car itself as it swings away
      local ahead = 5 * math.max(0, 1 - oy / 0.9)
      cam.tx, cam.ty, cam.tz = p.x + sh * ahead, 1.1, p.z + ch * ahead
      cam.fov = 62 + speed * 0.2
    end
  end

  -- After dark the renderer has room for eight point lights a frame: two pools of light in front of the player, one
  -- in front of each of the two nearest rivals, and whatever is left goes to the street lamps nearest the camera.
  -- Headlights are spot lights: a cone from each lamp, tilted a little down so that it lands on the road and fades out along it.
  local HEADLIGHT = { color = { 255, 238, 190 }, radius = 28, angle = 46 }
  local PLAYER_BEAM = { color = { 255, 238, 190 }, radius = 60, angle = 36 }
  local LAMP = { color = { 255, 226, 150 }, radius = 26 }
  local beam_opts = { color = HEADLIGHT.color, radius = 0, angle = 0, dir = { 0, 0, 0 } }
  -- One headlight: `side` is -1 (right lamp), 1 (left) or 0 (one lamp in the middle); the beams point a little outwards.
  local function headlight(car, side, opts)
    local fx, fz = math.sin(car.heading), math.cos(car.heading)
    local lx, lz = fz, -fx -- to the car's left
    local o = beam_opts
    o.color, o.radius, o.angle = opts.color, opts.radius, opts.angle
    o.dir[1], o.dir[2], o.dir[3] = fx + lx * side * 0.07, -0.1, fz + lz * side * 0.07
    nova.point_light(car.x + fx * 1.7 + lx * side * 0.55, 0.75, car.z + fz * 1.7 + lz * side * 0.55, o)
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
    for _, car in ipairs({ a or false, b or false }) do
      if car then headlight(car, 0, HEADLIGHT); used = used + 1 end
    end
    lamps.light(cam.x, cam.z, 70, 8 - used, LAMP)
  end

  function Race:draw()
    local cam = self.camera
    nova.camera(cam.x, cam.y, cam.z, cam.tx, cam.ty, cam.tz, cam.fov)
    if config.night then self:night_lights(cam) end
    horizon.draw(cam.x, cam.z, config.horizon)
    fx.draw_skids(cam.x, cam.z, 90)
    local gx, gz, gh = self:ghost_pose()
    if gx then
      self.ghost_opts = self.ghost_opts or { ry = 0, tint = { 130, 200, 255 } }
      self.ghost_opts.ry = gh
      nova.model(self.player.model_id, gx, 0, gz, self.ghost_opts)
    end
  end

  -- ---- the HUD ----------------------------------------------------------------------------------------------------------

  function Race:draw_ui()
    local w = nova.view()
    local p = self.player
    -- the car, bottom right: tyres and body, then the gear and speed, then a bar for how near top speed it is
    local px, py, pw, ph = w - 232, 388, 212, 136
    ui.panel(px, py, pw, ph, 205, ui.color.sky)
    for i, bar in ipairs({ { "TYRES", p.tyres }, { "BODY", 1 - p.damage } }) do
      local by = py + 14 + (i - 1) * 18
      ui.label(px + 12, by - 4, bar[1])
      nova.ui.rect(px + 66, by, 134, 7, { 255, 255, 255, 36 })
      local v = math.max(0, math.min(1, bar[2]))
      nova.ui.rect(px + 66, by, 134 * v, 7, v > 0.55 and { 74, 222, 128 } or (v > 0.25 and { 245, 158, 11 } or { 239, 68, 68 }))
    end
    nova.ui.rect(px + 12, py + 52, pw - 24, 1, { 255, 255, 255, 30 })
    local kmh = math.floor(math.abs(p.speed) * 3.6 + 0.5)
    local gear = p.speed < -0.5 and "R" or tostring(p.gear or 1)
    nova.ui.rect(px + 12, py + 64, 42, 46, { 255, 255, 255, 22 })
    ui.center(gear, py + 62, 40, p.shift_time > 0 and ui.color.dim or ui.color.gold, { font = "comic", cx = px + 33 })
    ui.right(tostring(kmh), px + pw - 62, py + 58, 58, ui.color.white, { font = "comic" })
    ui.label(px + pw - 54, py + 92, "KM/H")
    local fill = math.min(1, math.abs(p.speed) / 44)
    nova.ui.rect(px + 12, py + 118, pw - 24, 6, { 255, 255, 255, 36 })
    nova.ui.rect(px + 12, py + 118, (pw - 24) * fill, 6, fill > 0.85 and { 239, 68, 68 } or { 245, 158, 11 })

    -- place and lap, top left
    ui.panel(16, 16, 176, 76, 205)
    if self.trial then
      ui.text(30, 20, "TRIAL", 36, ui.color.gold, { font = "comic" })
      local gap = self:ghost_gap()
      if gap then
        local ahead = gap <= 0
        ui.text(124, 28, string.format("%s%.2f", ahead and "-" or "+", math.abs(gap)), 26, ahead and ui.color.green or ui.color.red, { font = "comic" })
      end
    else
      local place = p.place or 1
      local number, suffix = tostring(place), ui.ordinal(place):gsub("^%d+", "")
      local _, nw = nova.ui.text(30, 18, number, { size = 54, color = ui.color.gold, font = "comic", shadow = true })
      local o = { size = 24, color = ui.color.gold, font = "comic" }
      local width = nova.ui.text_width(number, { size = 54, font = "comic" })
      nova.ui.text(30 + width + 2, 24, suffix, o)
      ui.text(30 + width + 44, 36, "/ " .. #self.cars, 20, ui.color.dim)
    end
    local lap = math.max(1, math.min(self.laps, self:lap_of(p)))
    ui.label(30, 66, "LAP")
    ui.text(62, 62, lap .. " / " .. self.laps, 20, ui.color.white)

    -- times, top right
    ui.panel(w - 212, 16, 196, 76, 205)
    ui.label(w - 198, 24, "TIME")
    ui.right(ui.time(math.max(0, self.clock)), w - 28, 18, 24, ui.color.white, { font = "mono" })
    ui.label(w - 198, 50, "LAST")
    ui.right(ui.time(self.lap_times[#self.lap_times]), w - 28, 45, 16, ui.color.dim, { font = "mono" })
    ui.label(w - 198, 68, "BEST")
    ui.right(ui.time(self.best_lap), w - 28, 63, 16, ui.color.gold, { font = "mono" })

    -- minimap, bottom left
    local m = self.map
    local mx, my = 24, 540 - 24 - m.h - 10
    ui.panel(mx - 10, my - 8, m.w + 20, m.h + 26, 200, ui.color.green)
    for _, d in ipairs(m.dots) do nova.ui.rect(mx + d[1] - 1, my + d[2] - 1, 3, 3, { 255, 255, 255, 140 }) end
    for i = #self.cars, 1, -1 do
      local car = self.cars[i]
      local dx, dz = (m.hi_x - car.x) * m.scale, (m.hi_z - car.z) * m.scale
      local size = car.is_player and 7 or 5
      local colour = car.is_player and { 252, 211, 77 } or MAP_COLORS[(i - 2) % 3 + 1]
      nova.ui.rect(mx + dx - size / 2, my + dz - size / 2, size, size, colour)
    end

    -- countdown, messages, wrong way
    if self.phase == "countdown" then
      local n = math.ceil(self.countdown)
      if n >= 1 and n <= 3 then
        local frac = self.countdown - (n - 1)
        ui.center(tostring(n), 70 - (1 - frac) * 10, 130 * (0.7 + 0.3 * frac), ui.color.gold, { font = "display" })
      end
    end
    if self.message_time > 0 then
      ui.center(self.message, 110, 44, self.message == "GO!" and ui.color.green or ui.color.white, { font = "comic" })
    end
    local here = track.point(p.waypoint or 1)
    if self.phase == "racing" and math.abs(p.speed) > 4 then
      local facing = math.sin(p.heading) * here.tx + math.cos(p.heading) * here.tz
      if facing < -0.3 then ui.center("WRONG WAY", 190, 40, ui.color.red, { font = "comic" }) end
    end
    if p.surface == "rough" and self.phase == "racing" and p.off_middle > 14 then
      ui.center("Press R to get back on the road", 470, 18, ui.color.dim)
    end

    if self.paused then self:draw_pause() end
  end

  -- ---- pause -----------------------------------------------------------------------------------------------------------

  local PAUSE_ITEMS = { "Resume", "Restart race", "Quit to menu" }

  function Race:update_pause()
    local choice, action = ui.navigate(self.pause_choice, #PAUSE_ITEMS)
    self.pause_choice = choice
    if action == "back" or (action == "accept" and choice == 1) then
      if action == "accept" then audio.sfx("menu_accept") end
      self.paused = false
      nova.music.volume(state.music_volume)
    elseif action == "accept" then
      audio.sfx("menu_accept")
      if choice == 2 then
        nova.restart_scene()
      else
        audio.stop_music(0.4)
        nova.goto_scene("title", "select")
      end
    end
  end

  function Race:draw_pause()
    local w = nova.view()
    nova.ui.rect(0, 0, w, 540, { 0, 0, 0, 140 })
    ui.center("PAUSED", 120, 56, ui.color.white, { font = "comic" })
    ui.menu(PAUSE_ITEMS, self.pause_choice, 220)
  end

  -- ---- the end -----------------------------------------------------------------------------------------------------------

  function Race:to_results()
    local order = self:places()
    local info = state.current_track()
    local rows = {}
    if self.trial then
      -- a trial's table is the laps, fastest highlighted
      for i, t in ipairs(self.lap_times) do rows[i] = { name = "Lap " .. i, time = t, you = t == self.best_lap } end
    else
      for i, car in ipairs(order) do
        rows[i] = { name = car.name, car = car.model_id, place = i, time = car.finish_time, you = car.is_player }
      end
    end
    local me = self.player
    state.result = {
      track = info.id, track_name = info.name, laps = self.laps, rows = rows, place = me.place, time = me.finish_time,
      best_lap = self.best_lap, record_time = false, record_lap = false, trial = self.trial,
    }
    if me.finish_time then state.result.record_time = state.submit("race" .. self.laps, info.id, me.finish_time) end
    if self.best_lap then state.result.record_lap = state.submit("lap", info.id, self.best_lap) end
    nova.log(string.format("results: place %d of %d, time %s", me.place, #order, ui.time(me.finish_time)))
    nova.log(string.format("wear: tyres %.2f, body %.2f", me.tyres, 1 - me.damage))
    audio.stop_music(0.5)
    nova.goto_scene("results")
  end

  return Race
end

return race

-- The race: building a circuit's scene into a start grid, the countdown, laps and places, the chase camera, the HUD,
-- pause and the finish. A circuit's own scene file (scenes/pine_ridge.lua) just says which ground, sky and music it has.
local state = require("lib.state")
local track = require("lib.track")
local lamps = require("lib.lamps")
local grid = require("lib.grid")
local fx = require("lib.fx")
local roadside = require("lib.roadside")
local stage_lib = require("lib.stage")
local transition = require("lib.transition")
local pars = require("lib.pars")
local crowd = require("lib.crowd")
local foliage = require("lib.foliage")
local looks = require("lib.looks")
local horizon = require("lib.horizon")
local audio = require("lib.audio")
local ui = require("lib.ui")

local race = {}

local ROAD_OPTS = { shadow = false }
-- rally: how fast a class of car covers a stage, on average (m/s), for a section's par when no driven pars are recorded
local TYPICAL_SPEED = { formula = 31, sport = 25, everyday = 22 }
local RIVALS = {
  { name = "Mika", skill = 1.0, lane = -1.8 },
  { name = "Dax", skill = 0.96, lane = 2.2 },
  { name = "Rosa", skill = 0.92, lane = 0.4 },
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
  -- the car's own line (its lane) is for the straights: into a bend it comes to the middle, where there is room to slide
  -- how sharp the bend ahead is: the sharpest of the next 14 waypoints, about 140 m (it also sets how fast the car takes it)
  local bend = 0
  for j = 1, 14 do bend = math.max(bend, math.abs(track.point((car.waypoint or 1) + j).k)) end
  local lane = (car.lane or 0) * (1 - math.min(1, bend / 0.012))
  local kmax = bend
  local tx = target.x + target.tz * lane
  local tz = target.z - target.tx * lane
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
  -- how hard it dares to corner: what the tyres can hold on this surface, less a margin for the weaker drivers
  local hold = ({ road = 21, dirt = 12, rough = 11 })[car.surface] or 21
  local a_lat = hold * car:grip_now() * (car.skill or 0.9)
  local want_speed = math.min(car.vmax or 40, math.sqrt(a_lat / math.max(kmax, 0.0008)))
  want_speed = math.max(want_speed, 13)
  if urgency > 0.45 then want_speed = math.max(13, want_speed * (1.3 - urgency)) end
  local diff = want_speed - car.speed
  c.throttle = diff > 0 and math.min(1, diff / 3) or 0
  c.brake = diff < -2 and math.min(1, (-diff - 2) / 8) or 0
  c.handbrake = false
  if math.abs(err) > 1.0 then c.throttle = math.min(c.throttle, 0.4) end
  -- pinned against something (a barrier on the outside of a bend): back away from it, the wheel turned the other way, and try again
  if (car.reversing or 0) > 0 then
    c.throttle, c.brake, c.steer = 0, 1, -c.steer
  end
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
    nova.terrain(config.terrain) -- the hills (flat when the circuit has none)
    if config.weather then nova.weather(config.weather) end
    nova.sky(config.sky)
    if config.sky then nova.fog { color = config.sky.horizon, near = 70, far = 330 } end
    local info = state.current_track()
    self.stage = config.stage and true or false   -- a rally stage: from A to B, in sections
    self.laps = self.stage and 1 or state.laps
    track.open = self.stage
    track.ensure()
    assert(track.count() > 10, "this scene has no waypoints: place `waypoint` objects along the road")
    nova.log("rally: roadside " .. roadside.build(config.horizon) .. " props")
    nova.log("rally: crowd " .. crowd.build() .. " people")
    local look = looks[state.look_id()]
    state.apply_look(look)
    -- the circuit's look with a speed blur added each frame (see Race:update_camera)
    self.look_now = nil
    if state.effects and look.look then
      self.look_now = {}
      for k, v in pairs(look.look) do self.look_now[k] = v end
      self.look_now.fxaa = state.smooth and 1 or 0
      self.blur_now = 0
    end
    foliage.start(look, state.effects and 1 or 0)
    self.length = track.length
    if self.stage then self:build_stage() end
    self.phase = "countdown"
    self.clock = 0              -- time since the green light
    self.countdown = 3.9
    self.last_beep = 4
    self.paused, self.pause_choice = false, 1
    self.leaving = false
    transition.reveal(1.0) -- (coming from the wipe that the chooser started: stay covered a moment more, then wipe off; the countdown waits)
    -- a frame that takes more than 26 ms is written to the log with what was going on (read it with adb logcat after a play session)
    nova.hitch(26, function()
      local p = self.player
      return string.format("speed %.0f steer %.2f slip %.2f %s view %d", p.speed, p.ctl.steer, p.slip, tostring(p.surface), self.view_mode)
    end)
    self.view_mode = 2 -- the far chase view (C changes it)
    self.message, self.message_time = "", 0
    self.cars = {}
    self.lap_times = {}
    self.best_lap = nil
    self.camera = { x = 0, y = 4, z = 0, heading = 0, fov = 62, tx = 0, ty = 1, tz = 0 }
    self:build_cars()
    self:build_minimap()
    self.player.engine = audio.engine(1.0, self.player.model_id)
    self.trial = state.mode == "trial"
    self.ghost = self.trial and nova.save.get("ghost_" .. info.id, nil) or nil
    self.recording = { t = 0, pts = {} }
    audio.music(info.music or config.music, { volume = 0.95, fade = 0.8 })
    self.camera.heading = self.player.heading -- the chase camera starts behind the car, looking where it looks
    self:update_camera(1 / 60)
  end

  function Race:leave()
    for _, car in ipairs(self.cars) do if car.engine then car.engine:stop() end end
    nova.music.volume(state.music_volume)
    nova.hitch(0); nova.weather(); nova.sky(nil); nova.fog(nil); nova.shadows(nil); nova.terrain()
    crowd.clear(); stage_lib.clear(); lamps.clear(); track.clear(); grid.clear(); fx.clear(); foliage.clear()
    nova.look(); nova.wind()
  end

  -- The player and three rivals on the grid; the player starts third.
  function Race:build_cars()
    local mine = state.current_car().id
    -- the rivals drive the other cars of your class (a class with fewer than three others repeats them)
    local pool = {}
    local class = state.current_car().class
    for _, c in ipairs(state.cars) do if c.id ~= mine and c.class == class then pool[#pool + 1] = c.id end end
    if #pool == 0 then for _, c in ipairs(state.cars) do if c.id ~= mine then pool[#pool + 1] = c.id end end end
    -- which cars the rivals drive: a different three for each circuit and each car of yours (the same every time)
    local turn = (state.track * 3 + state.car * 5) % #pool
    for _ = 1, turn do
      local first = table.remove(pool, 1) -- (not `pool[#pool + 1] = table.remove(pool, 1)`: the index is worked out before the removal)
      pool[#pool + 1] = first
    end
    local slots = { 1, 2, 4 }  -- the rivals' places; the player has slot 3
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
    self.player = put(mine, 3)
    self.player.is_player = true
    self.player.oversteer = state.current_car().oversteer
    self.player.name = "You"
    self.cars[1] = self.player
    for i, r in ipairs(state.mode == "race" and RIVALS or {}) do
      local car = put(pool[(i - 1) % #pool + 1], slots[i])
      -- a rival drives its own car (its top speed, its grip) as hard as the difficulty and its own skill say
      local diff = state.current_difficulty()
      car.name, car.lane, car.base_lane = r.name, r.lane, r.lane
      car.skill = diff.corner * r.skill     -- the share of its tyres' grip it dares to use in a bend
      car.vmax_base = car.top * diff.pace * r.skill
      car.vmax = car.vmax_base
      car.band = diff.band
      car.engine = audio.engine(0.55, car.model_id, true)
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
    if not self.stage then
      if delta > self.length / 2 then delta = delta - self.length
      elseif delta < -self.length / 2 then delta = delta + self.length end
    end
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
      if not car.is_player and car.base_lane then
        -- a rival right behind a car, with the wake building, pulls out to the side to pass it, and comes back when it is clear
        local target = car.base_lane
        -- (not into a bend: the sharpest of the next 160 m or so must be gentle)
        local sharpest = 0
        for j = 1, 16 do sharpest = math.max(sharpest, math.abs(track.point((car.waypoint or 1) + j).k)) end
        if gap and gap < 10 and car.draft > 0.35 and sharpest < 0.02 then target = math.max(-3.4, math.min(3.4, car.base_lane - (lateral >= 0 and 1 or -1) * 2.6)) end
        car.lane = (car.lane or target) + (target - (car.lane or target)) * math.min(1, dt * 1.2)
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
      self.player_finished_at = self.clock
      self:say("FINISH!", 4)
      p.autopilot = true
      p.skill, p.vmax, p.lane = 0.8, 16, 0
    else
      self.section = self.section + 1
      audio.sfx(delta <= 0 and "best_lap" or "lap")
      self:say(string.format("SECTION %d\n%s   %s%.1f   %d pts", self.section - 1, ui.time(t), delta <= 0 and "-" or "+", math.abs(delta), score), 3)
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
      nova.log(string.format("rally: speed=%.1f slip=%.2f heading=%.2f yaw=%.2f x=%.1f z=%.1f orbit=%.2f lift=%.2f", c.speed, c.slip, c.heading, c.yaw_rate or 0, c.x, c.z, self.orbit and self.orbit.yaw or 0, self.orbit and self.orbit.lift or 0))
    end
    if nova.input.pressed("view") then self.view_mode = self.view_mode % 3 + 1 end
    -- F9 lets the computer drive for you (for demos, and for testing the circuits without a controller)
    if nova.input.pressed("autodrive") then
      self.player.autopilot = not self.player.autopilot
      self.player.skill, self.player.vmax, self.player.lane = 0.95, self.player.top * 0.97, 0
    end

    if self.phase == "countdown" and transition.covering() then
      -- (the countdown starts when the wipe starts to go)
    elseif self.phase == "countdown" then
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
    if self.phase == "racing" then self:update_draft(dt) end

    if self.phase == "racing" then
      -- rivals try a little harder when behind the player, and a little less when far ahead
      for _, car in ipairs(self.cars) do
        if not car.is_player and not car.finish_time then
          local gap = self.player.progress - car.progress        -- positive: the rival is behind
          car.vmax = math.min(car.top * (1 + 0.05 * (car.draft or 0)), car.vmax_base * (1 + 0.05 * (car.draft or 0)) * (1 + math.max(-car.band, math.min(car.band, gap * 0.0004))))
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
        if asked or car.off_middle > 60 or ((car ~= p or p.autopilot) and car.stuck > 4) then
          self:respawn(car)
          if car == p and self.stage and asked then
            self.clock = self.clock + 5 -- (a stage is timed: being put back costs five seconds)
            self:say("Back on the road   +5 s", 1.8)
          elseif car == p then self:say("Back on the road", 1.5) end
          if car ~= p or not p.autopilot then nova.log(string.format("%s put back on the road (at %.0f, %.0f; speed %.1f, %.0f m from the middle, waypoint %d)", car.name, car.x, car.z, car.speed, car.off_middle, car.waypoint or 0)) end
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
    nova.camera(cam.x, math.max(cam.y + ground_here, ground_there + 1.2), cam.z, cam.tx, cam.ty + ground_there, cam.tz, cam.fov)
    if config.night then self:night_lights(cam) end
    horizon.draw(cam.x, cam.z, config.horizon)
    -- the road: one ribbon along the whole circuit (scripts/rally/tracks.mjs), drawn from here (it casts no shadow)
    nova.model("road_" .. state.current_track().id, 0, 0, 0, ROAD_OPTS)
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

  -- a small triangle pointing left or right (the pace notes' arrows)
  local function arrow(x, y, left, size, colour)
    local half = (size - 1) / 2
    for row = 0, size - 1 do
      local w = math.max(1, math.floor((1 - math.abs(row - half) / half) * size * 0.75 + 0.5))
      nova.ui.rect(left and (x + size * 0.75 - w) or x, y + row, w, 1, colour)
    end
  end

  -- The rally's screen: the section and how the time is going against its par (top left), the times and the score (top right), and the
  -- pace notes (the next corners: which way, how hard, how far) under them.
  function Race:draw_stage_hud(w)
    local p = self.player
    local sec = self.sections[math.min(self.section, #self.sections)]
    ui.olabel(28, 14, "SECTION")
    local sn = ui.otext(26, 28, self.section .. "", 56, ui.color.gold, { font = "comic" })
    ui.otext(26 + sn + 4, 56, "/" .. #self.sections, 22, { 226, 232, 240 })
    -- against par: the time so far in this section, less the share of the par that the distance covered would have taken
    local through = math.max(0, math.min(1, (p.progress - sec.from) / math.max(1, sec.to - sec.from)))
    local delta = (self.clock - self.section_start) - sec.par * state.current_difficulty().allow * through
    if self.phase == "racing" and not p.finish_time then
      ui.olabel(150, 18, "VS PAR")
      ui.otext(150, 34, string.format("%s%.1f", delta <= 0 and "-" or "+", math.abs(delta)), 34, delta <= 0 and ui.color.green or ui.color.red, { font = "comic" })
    end
    ui.oright(ui.time(math.max(0, self.clock)), w - 26, 14, 34, ui.color.white, { font = "mono" })
    ui.olabel(w - 26 - 215, 60, "SECTION")
    ui.oright(ui.time(math.max(0, self.clock - self.section_start)), w - 26, 54, 22, { 226, 232, 240 }, { font = "mono" })
    ui.olabel(w - 26 - 215, 86, "SCORE")
    ui.oright(tostring(self.score), w - 26, 80, 22, ui.color.gold, { font = "mono" })
    -- the pace notes, top middle: the next corner big, the one after it small beneath (only while racing, and when a corner is near)
    if self.phase == "racing" and not p.finish_time then
      local shown = 0
      for _, note in ipairs(self.notes) do
        local away = note.s - p.progress
        if away > -20 and away < 450 and shown < 2 then
          local big = shown == 0
          local pw, ph = big and 230 or 150, big and 50 or 30
          local x, y = w / 2 - pw / 2, big and 16 or 70
          ui.panel(x, y, pw, ph, 150)
          local colour = note.grade <= 2 and ui.color.red or (note.grade <= 4 and ui.color.gold or ui.color.white)
          local text = note.grade == 1 and "HAIRPIN" or ("TURN " .. note.grade)
          if big then
            arrow(x + 14, y + 13, note.left, 24, colour)
            ui.text(x + 48, y + 6, text, 28, colour, { font = "comic" })
            ui.right(math.max(0, math.floor(away / 10 + 0.5) * 10) .. " m", x + pw - 12, y + 16, 18, ui.color.white)
          else
            arrow(x + 10, y + 7, note.left, 16, colour)
            ui.text(x + 34, y + 3, text, 20, colour, { font = "comic" })
            ui.right(math.floor(away / 10 + 0.5) * 10 .. " m", x + pw - 10, y + 8, 14, ui.color.dim)
          end
          shown = shown + 1
        end
      end
    end
  end

  function Race:draw_ui()
    -- (text is drawn over the wipe, so the HUD waits until the wipe has gone)
    if not transition.busy() then self:draw_hud() end
    transition.draw()
  end

  function Race:draw_hud()
    local w = nova.view()
    local p = self.player
    -- the car, bottom right, with no panel (outlined): the speed big, the gear beside it, a row of rev segments under them
    local right = w - 26
    local kmh = math.floor(math.abs(p.speed) * 3.6 + 0.5)
    local gear = p.speed < -0.5 and "R" or tostring(p.gear or 1)
    local sw = ui.oright(tostring(kmh), right, 408, 66, ui.color.white, { font = "comic" })
    ui.oright("KM/H", right, 478, 14, { 226, 232, 240 }, { font = "future_narrow" })
    local gx = right - math.max(sw, 110) - 18 -- (the gear sits left of the speed, whatever the number's width)
    local gw = ui.oright(gear, gx, 424, 44, p.shift_time > 0 and { 190, 200, 214 } or ui.color.gold, { font = "comic" })
    ui.oright("GEAR", gx, 478, 14, { 226, 232, 240 }, { font = "future_narrow" })
    -- the tachometer: the engine's revs from idle to the limiter (green, amber, red); at the limiter the red segments flash
    local rev = math.max(0, math.min(1, ((p.rev or 0.16) - 0.16) / 0.84))
    local segments, gap, tw = 24, 2, 220
    local seg_w = (tw - (segments - 1) * gap) / segments
    local limiter = rev > 0.985 and math.floor(nova.time() * 16) % 2 == 0
    local tx = right - tw
    for i = 1, segments do
      local sx = tx + (i - 1) * (seg_w + gap)
      nova.ui.rect(sx - 1, 501, seg_w + 2, 13, { 8, 12, 26, 170 })
      local on = (i - 0.5) / segments <= rev
      local colour = { 255, 255, 255, 40 }
      if on then
        local at = i / segments
        colour = at > 0.85 and (limiter and { 255, 255, 255 } or { 239, 68, 68 }) or at > 0.65 and { 245, 158, 11 } or { 74, 222, 128 }
      end
      nova.ui.rect(sx, 503, seg_w, 9, colour)
    end
    -- a word or two above it only when something needs saying
    local say = 384
    if (p.draft or 0) > 0.04 then ui.oright("SLIPSTREAM", right, say, 18, ui.color.sky, { font = "future_narrow" }); say = say - 22 end
    if p.damage > 0.5 then ui.oright("CAR DAMAGED", right, say, 18, ui.color.red, { font = "future_narrow" }); say = say - 22 end
    if p.tyres < 0.35 then ui.oright("TYRES WORN", right, say, 18, { 245, 158, 11 }, { font = "future_narrow" }) end

    if self.stage then
      self:draw_stage_hud(w)
    else
      -- place and lap, top left
      if self.trial then
        ui.otext(26, 16, "TRIAL", 44, ui.color.gold, { font = "comic" })
        local gap = self:ghost_gap()
        if gap then
          local ahead = gap <= 0
          ui.otext(170, 26, string.format("%s%.2f", ahead and "-" or "+", math.abs(gap)), 30, ahead and ui.color.green or ui.color.red, { font = "comic" })
        end
      else
        local place = p.place or 1
        local number, suffix = tostring(place), ui.ordinal(place):gsub("^%d+", "")
        local nw = ui.otext(26, 8, number, 66, ui.color.gold, { font = "comic" })
        ui.otext(26 + nw + 3, 18, suffix, 28, ui.color.gold, { font = "comic" })
        ui.otext(26 + nw + 3, 52, "/ " .. #self.cars, 20, { 226, 232, 240 })
      end
      local lap = math.max(1, math.min(self.laps, self:lap_of(p)))
      local lw = ui.olabel(28, 82, "LAP")
      ui.otext(28 + lw + 8, 76, lap .. " / " .. self.laps, 24, ui.color.white)

      -- the time, top right (and the best lap under it)
      ui.oright(ui.time(math.max(0, self.clock)), w - 26, 14, 34, ui.color.white, { font = "mono" })
      ui.olabel(w - 26 - 150, 58, "BEST")
      ui.oright(ui.time(self.best_lap), w - 26, 54, 22, ui.color.gold, { font = "mono" })
    end

    -- minimap, bottom left (this one keeps a soft panel: a map needs the contrast)
    local m = self.map
    local mx, my = 24, 540 - 24 - m.h - 10
    ui.panel(mx - 10, my - 8, m.w + 20, m.h + 26, 150, ui.color.green)
    for _, d in ipairs(m.dots) do nova.ui.rect(mx + d[1] - 1, my + d[2] - 1, 3, 3, { 255, 255, 255, 140 }) end
    for i = #self.cars, 1, -1 do
      local car = self.cars[i]
      local dx, dz = (m.hi_x - car.x) * m.scale, (m.hi_z - car.z) * m.scale
      local size = car.is_player and 7 or 5
      local colour = car.is_player and { 252, 211, 77 } or MAP_COLORS[(i - 2) % 3 + 1]
      nova.ui.rect(mx + dx - size / 2, my + dz - size / 2, size, size, colour)
    end

    -- countdown, messages, wrong way
    -- the start: three lights light one by one on a gantry at the top (red, then all green at GO!), and the number pops in big
    local n = self.phase == "countdown" and math.ceil(self.countdown) or 0
    local go = self.message == "GO!" and self.message_time > 0
    if self.phase == "countdown" or go then
      local wv = nova.view()
      local lit = go and 3 or math.max(0, 4 - n)
      nova.ui.panel("ui/panel_dark", wv / 2 - 120, 28, 240, 84, { slice = 18, scale = 0.8, color = { 255, 255, 255, 240 } })
      for i = 1, 3 do
        local image = (go and "ui/light_green") or (i <= lit and "ui/light_red") or "ui/light_off"
        nova.ui.sprite(image, wv / 2 + (i - 2) * 70, 70, { w = 56, h = 56 })
      end
    end
    if n >= 1 and n <= 3 then
      local frac = self.countdown - (n - 1) -- 1 as the number appears, falling to 0
      local pop = 1 + 0.35 * math.max(0, frac - 0.7) / 0.3
      ui.center(tostring(n), 130, 104 * pop, ui.color.gold, { font = "thick" })
    end
    if self.message_time > 0 then
      local go_message = self.message == "GO!"
      -- (a message may have a second line, in smaller type; both are fitted to the screen)
      local first, second = self.message:match("^(.-)\n(.*)$")
      first = first or self.message
      local width = nova.view() - 60
      local size = ui.fit(first, go_message and 92 or 38, width, go_message and "thick" or "bold")
      ui.center(first, 130, size, go_message and ui.color.green or ui.color.white, { font = go_message and "thick" or "bold" })
      if second then ui.center(second, 130 + size * 1.45, ui.fit(second, 24, width, "rounded"), ui.color.gold) end
    end
    local here = track.point(p.waypoint or 1)
    if self.phase == "racing" and math.abs(p.speed) > 4 then
      local facing = math.sin(p.heading) * here.tx + math.cos(p.heading) * here.tz
      if facing < -0.3 then ui.center("WRONG WAY", 190, 34, ui.color.red, { font = "bold" }) end
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
      nova.pause(false) -- (the wind blows again)
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
    ui.center("PAUSED", 120, 46, ui.color.white, { font = "bold" })
    ui.menu(PAUSE_ITEMS, self.pause_choice, 220)
    ui.hints({ { "pad_dpad", "choose" }, { "pad_a", "select" }, { "pad_plus", "resume" } })
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

  function Race:to_results()
    if not self.trial then self:estimate_finishes() end
    local order = self:places()
    local info = state.current_track()
    local rows = {}
    if self.stage then
      local total_time = self.player.finish_time
      local stars = (self.score >= 4500 and 3) or (self.score >= 3500 and 2) or (self.score >= 2250 and 1) or 0
      state.result = {
        track = info.id, track_name = info.name, laps = 1, rows = {}, place = 1, time = total_time, trial = false,
        rally = { sections = self.section_log, score = self.score, time = total_time, stars = stars, max = 1000 * #self.sections },
      }
      state.result.record_time = state.submit("rally", info.id, total_time)
      state.result.record_score = state.submit_score(info.id, self.score)
      nova.log(string.format("results: rally score %d of %d in %s, %d stars", self.score, 1000 * #self.sections, ui.time(total_time), stars))
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
    if self.best_lap then state.result.record_lap = state.submit("lap", info.id, self.best_lap) end
    if not self.trial then
      local timed, ids, times = 0, {}, {}
      for _, car in ipairs(order) do
        if car.finish_time then timed = timed + 1 end
        if not car.is_player then ids[#ids + 1] = car.model_id end
        times[#times + 1] = string.format("%s%s=%.1f", car.is_player and "*" or "", car.model_id, car.finish_time or 0)
      end
      nova.log("results: times " .. table.concat(times, " "))
      nova.log(string.format("results: a time for %d of %d cars; rivals: %s", timed, #order, table.concat(ids, " ")))
    end
    nova.log(string.format("results: place %d of %d, time %s", me.place, #order, ui.time(me.finish_time)))
    nova.log(string.format("wear: tyres %.2f, body %.2f", me.tyres, 1 - me.damage))
    audio.stop_music(0.5)
    nova.goto_scene("results")
  end

  return Race
end

return race

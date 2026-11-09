-- Free roam (2026-11-08): the open world, every course on one map round five region towns, joined by highways and a ring road
-- (scenes/roam.scene.json, made by scripts/rally/roam.ts). Drive anywhere; the road under the car comes from lib/roads.lua. Drive up to an event's marker and press Y to
-- see it, then start it: the race is the course's own scene, and coming back from it puts the car where it left.
local state = require("lib.state")
local roads = require("lib.roads")
local course = require("lib.course")
local foliage = require("lib.foliage")
local horizon = require("lib.horizon")
local fx = require("lib.fx")
local audio = require("lib.audio")
local haptics = require("lib.haptics")
local transition = require("lib.transition")
local ui = require("lib.ui")
local powerlines = require("lib.powerlines")
local regions = require("lib.regions")
local water = require("lib.water")
local woods = require("lib.woods")
local RoamFoliage = require("entities.roam_foliage")

local Roam = nova.scene {}
local C, F = ui.color, ui.font

local LOOK_FAR = 260
local ROAD_EDGE = 0.2          -- (as in a race: metres from the edge of the road to where the grass starts)
local RESCUE_FAR = 40          -- metres from the nearest road at which the car is put back by itself (roads are further apart than a course's bends)
local RESCUE_OUT, RESCUE_HOLD, RESCUE_IN = 0.45, 0.2, 0.45
local EVENT_REACH = 16         -- metres from a marker at which its prompt shows
local GRIP = { road_asphalt = 1, road_gravel = 0.88, road_dirt = 0.88, road_snow = 0.75 }
local MODE_NAMES = { race = "Circuit race", trial = "Time trial", rally = "Rally stage" }

local function index_of(list, id) for i, c in ipairs(list) do if c.id == id then return i, c end end end
local function course_info(id)
  local i, c = index_of(state.tracks, id)
  if c then return c, i, state.tracks end
  i, c = index_of(state.stages, id)
  return c, i, state.stages
end

local function read_controls(car)
  local c = car.ctl
  c.throttle = nova.input.axis("throttle")
  c.brake = nova.input.axis("brake")
  if c.brake <= 0 then car.brake_analog = nil
  elseif (car.brake_before or 0) <= 0 then car.brake_analog = c.brake < 0.95 end
  car.brake_before = c.brake
  c.brake_analog = car.brake_analog
  c.steer = nova.input.axis("steer")
  c.handbrake = nova.input.down("handbrake")
end

-- F9 (for testing on the device and for demos): the computer drives along the road the car is on, at an easy pace, and logs the frame
-- rate every five seconds.
local function drive_along(self, car)
  local c = car.ctl
  local n = roads.nearest(car.x, car.z)
  c.handbrake = false
  if not n then c.throttle, c.brake, c.steer = 0.3, 0, 0; return end
  local rt = roads.route(n.route)
  local pts = rt.pts
  -- the way along the road the car already faces
  local dir = math.cos(n.heading - car.heading) >= 0 and 1 or -1
  local ahead = 3 + math.floor(math.abs(car.speed) / 8)
  local j = n.i + dir * ahead
  if rt.loop then j = (j - 1) % #pts + 1 else j = math.max(1, math.min(#pts, j)) end
  local t = pts[j]
  local err = math.atan(t.x - car.x, t.z - car.z) - car.heading
  while err > math.pi do err = err - 2 * math.pi end
  while err < -math.pi do err = err + 2 * math.pi end
  c.steer = math.max(-1, math.min(1, -err * 2.4))
  local bend = 0
  for k = 1, 10 do
    local q = pts[rt.loop and ((n.i + dir * k - 1) % #pts + 1) or math.max(1, math.min(#pts, n.i + dir * k))]
    bend = math.max(bend, math.abs(q.k))
  end
  local want = math.max(10, math.min(24, math.sqrt(9 / math.max(bend, 0.004))))
  c.throttle = car.speed < want and 0.8 or 0
  c.brake = car.speed > want + 3 and 0.6 or 0
  -- at the end of an open road, turn round on the spot: back up and steer the other way
  if not rt.loop and (j == 1 or j == #pts) and math.abs(car.speed) < 2 then c.throttle, c.brake, c.steer = 0, 1, -c.steer end
end

function Roam:enter()
  local config = course.current()
  self.config = config
  local sun = config.sun
  nova.light { dir = sun.dir, color = sun.color, ambient = sun.ambient }
  nova.scenery.range = LOOK_FAR
  nova.shadows(state.shadows and { radius = 42, strength = 0.55 } or nil)
  nova.terrain(config.terrain)
  nova.sky(config.sky)
  if config.sky then nova.fog { color = config.sky.horizon, near = 110, far = 450 } end
  state.apply_look(config)
  roads.ensure()
  nova.log(string.format("roam: %d road points on %d roads, %d events", roads.count(), #roads.names(), #nova.all("event")))
  -- the grass beside the roads: each course's own beside its roads (the scene's roam_foliage objects)
  local sets = {}
  for _, set in ipairs(RoamFoliage.sets) do
    local pts = {}
    for _, name in ipairs(set.routes) do
      local rt = roads.route(name)
      if rt then for _, p in ipairs(rt.pts) do pts[#pts + 1] = p end end
    end
    if #pts > 0 and #set.plants > 0 then sets[#sets + 1] = { points = pts, plants = set.plants } end
  end
  RoamFoliage.sets = {}
  foliage.start_sets(state.effects and 1 or 0, sets)
  -- the car: where it left for an event, or where it was when free roam was last left (the save keeps it), or at the start of the map
  local saved = nova.save.get("roam_pos", nil)
  local at = state.roam_at or (saved and { x = saved[1], z = saved[2], heading = saved[3] }) or { x = self.spawn.x, z = self.spawn.z, heading = self.spawn.ry or 0 }
  state.roam_at = nil
  local car = nova.spawn(state.current_car().id, at.x, 0, { z = at.z })
  car:teleport(at.x, at.z, at.heading)
  car.is_player, car.enabled, car.name = true, true, "You"
  car.oversteer = state.current_car().oversteer
  car.dust_color = config.dust or { 170, 160, 130 }
  self.player = car
  car.engine = audio.engine(0.6, car.model_id)
  self:locate()
  woods.start(at.x, at.z)
  -- the region it starts in, its look at once
  self.region = regions.at(at.x, at.z)
  if self.region then self:set_look(self.region, 1) end
  self.camera = { x = at.x, y = 4, z = at.z, heading = at.heading, tx = at.x, ty = 1, tz = at.z, fov = 62 }
  self.orbit = { yaw = 0, lift = 0 }
  self:update_camera(1)
  self.t, self.panel, self.paused, self.rescue = 0, nil, false, nil
  haptics.reset()
  audio.music(config.music, { volume = 0.95, fade = 0.8 })
  transition.reveal(0.6)
end

function Roam:leave()
  -- (where the car is, for next time: on a road, facing along it)
  local p, r = self.player, self.road_here
  if r and p then nova.save.set("roam_pos", { math.floor(r.x * 10) / 10, math.floor(r.z * 10) / 10, math.floor(p.heading * 1000) / 1000 }) end
  if self.player and self.player.engine then self.player.engine:stop() end
  nova.music.volume(state.music_volume)
  nova.weather(); nova.sky(nil); nova.fog(nil); nova.shadows(nil); nova.terrain()
  roads.clear(); course.clear(); fx.clear(); foliage.clear(); powerlines.clear(); regions.clear(); water.clear(); woods.clear()
  nova.look(); nova.wind()
end

-- ---- regions: the look of where the car is --------------------------------------------------------------------------------------
-- Driving from one region into another, the sky, the fog, the sun and the ambient light blend over BLEND seconds; the ground and the
-- mountains round the edge, the weather and the picture's finish change half way.
local BLEND = 3
local function mix(a, b, t)
  if type(a) ~= "table" or type(b) ~= "table" then return t < 0.5 and a or b end
  local out = {}
  for i = 1, math.max(#a, #b) do out[i] = (a[i] or 0) + ((b[i] or 0) - (a[i] or 0)) * t end
  return out
end
function Roam:set_look(region, t)
  local to = course.of(region.look)
  local from = self.look_now or to
  t = math.max(0, math.min(1, t))
  local sky = {}
  for k, v in pairs(to.sky or {}) do sky[k] = v end
  sky.top, sky.horizon = mix(from.sky.top, to.sky.top, t), mix(from.sky.horizon, to.sky.horizon, t)
  nova.sky(sky)
  nova.fog { color = sky.horizon, near = 110, far = 450 }
  nova.light { dir = mix(from.sun.dir, to.sun.dir, t), color = mix(from.sun.color, to.sun.color, t), ambient = mix(from.sun.ambient, to.sun.ambient, t) }
  if t >= 0.5 and self.look_half ~= region then
    self.look_half = region
    self.config.horizon = to.horizon
    if to.weather then nova.weather(to.weather) else nova.weather() end
    state.apply_look(to)
    nova.log("roam: into " .. region.title)
  end
  if t >= 1 then self.look_now = to end
end

function Roam:update_region(dt)
  local p = self.player
  self.region_check = (self.region_check or 0) - dt
  if self.region_check <= 0 then
    self.region_check = 0.5
    local r = regions.at(p.x, p.z)
    if r and r ~= self.region then
      self.region, self.blend = r, 0
      self.title_time = 0
    end
  end
  if self.blend then
    self.blend = self.blend + dt / BLEND
    self:set_look(self.region, self.blend)
    if self.blend >= 1 then self.blend = nil end
  end
  self.title_time = (self.title_time or 0) + dt
end

-- The road under the car: its surface and grip, or the rough off it.
function Roam:locate()
  local p = self.player
  local n = roads.nearest(p.x, p.z)
  if n then
    self.road_here = { x = n.x, z = n.z, heading = n.heading }
    p.off_middle = n.dist
    local kind = n.road or "road_asphalt"
    p.surface = kind == "road_asphalt" and "road" or "dirt"
    p.loose = kind ~= "road_asphalt"
    p.grip_scale = n.grip or GRIP[kind] or 1
    if n.dist > n.w + ROAD_EDGE + 0.8 then p.surface = "rough" end
  else
    p.off_middle, p.surface = 999, "rough"
  end
end

function Roam:respawn()
  local p = self.player
  local r = self.road_here or { x = self.spawn.x, z = self.spawn.z, heading = self.spawn.ry or 0 }
  local n = roads.nearest(r.x, r.z)
  if n then r = { x = n.x, z = n.z, heading = n.heading } end
  -- facing along the road the way the car was going
  local h = r.heading
  if math.cos(h - p.heading) < 0 then h = h + math.pi end
  p:teleport(r.x, r.z, h)
  self.camera.heading = h
  self:update_camera(1)
  self:locate()
end

-- the event whose marker the car is at, if any
function Roam:event_here()
  local p = self.player
  local best, bd = nil, EVENT_REACH
  for _, e in ipairs(nova.all("event")) do
    local d = math.sqrt((e.x - p.x) ^ 2 + (e.z - p.z) ^ 2)
    if d < bd then best, bd = e, d end
  end
  return best
end

function Roam:start_event(e)
  local info, i, list = course_info(e.course)
  state.mode = e.mode
  if list == state.stages then state.stage = i else state.track = i; state.laps = info.laps end
  -- coming back: at the marker, facing the way its start faces
  state.roam_at = { x = e.x, z = e.z, heading = e.ry or 0 }
  state.from_roam = true
  state.save_options()
  audio.stop_music(0.6)
  nova.log(string.format("roam: start %s on %s in %s", e.mode, e.course, state.current_car().id))
  transition.cover(transition.race_spec(), function() nova.goto_scene(info.id) end)
  self.leaving = true
end

function Roam:update(dt)
  self.t = self.t + dt
  ui.tick(dt)
  transition.update(dt)
  if self.leaving then return end
  local p = self.player
  if not self.panel and nova.input.pressed("pause") then
    self.paused = not self.paused
    self.pause_screen = "menu"
    nova.pause(self.paused)
    nova.music.volume(state.music_volume * (self.paused and 0.35 or 1))
    audio.sfx("pause")
  end
  if self.paused then return end
  foliage.plant_some()
  woods.plant_some()

  -- driving: the pad, unless the details of an event are up (the car rolls to a stop)
  if nova.input.pressed("autodrive") then
    p.autopilot = not p.autopilot
    nova.log("roam: autodrive " .. (p.autopilot and "on" or "off"))
  end
  if self.panel then
    p.ctl.throttle, p.ctl.brake, p.ctl.steer, p.ctl.handbrake = 0, 0.6, 0, false
  elseif p.autopilot then
    drive_along(self, p)
  else
    read_controls(p)
  end
  if p.autopilot then
    self.perf_t = (self.perf_t or 0) + dt
    if self.perf_t > 5 then
      self.perf_t = 0
      local m = nova.perf()
      nova.log(string.format("roam: perf fps=%.1f gpu=%.2f p95=%.1f draws=%d triangles=%d at %.0f, %.0f", m.fps, m.gpu_ms, m.frame_p95_ms, m.draws, m.triangles, p.x, p.z))
    end
  end
  p:drive(dt)
  self:locate()

  -- Y at a marker: its details (and from there, the start)
  local e = self:event_here()
  self.near = e
  if e and not self.panel and not self.rescue and nova.input.pressed("event") then
    audio.sfx("menu_accept")
    self.panel = e
    nova.ui.forget("event")
    self.panel_opened = 0
  end
  if self.panel then self.panel_opened = self.panel_opened + dt end

  -- back on the road: asked for (Select), or far from every road
  if not self.rescue and not self.panel and (nova.input.pressed("reset") or (p.off_middle or 0) > RESCUE_FAR) then
    self.rescue = { t = 0 }
  end
  local r = self.rescue
  if r then
    r.t = r.t + dt
    if not r.done and r.t >= RESCUE_OUT then
      r.done = true
      self:respawn()
      nova.log("roam: put back on the road")
    end
    if r.t >= RESCUE_OUT + RESCUE_HOLD + RESCUE_IN then self.rescue = nil end
  end

  -- the engine, the knocks, and what the road feels like
  local rev = math.max(0, math.min(1, p.rev))
  if p.shifted then
    audio.sfx("shift", { volume = p.shifted == "up" and 0.5 or 0.3, pitch = p.shifted == "up" and 1.0 or 1.3 })
    p.shifted = nil
  end
  p.engine:update(dt, rev, p.ctl.throttle, p.surface == "rough" and math.abs(p.speed) > 3, p.slip)
  if p.hit then
    audio.sfx("bump", { volume = p.hit })
    haptics.event("hit", p.hit)
    p.hit = nil
  end
  haptics.drive(p, dt, not self.panel)
  if nova.input.pressed("view") then self.view_mode = ((self.view_mode or 2) % 3) + 1 end
  self:update_region(dt)
  self:update_camera(dt)
end

local function wrap(a)
  while a > math.pi do a = a - 2 * math.pi end
  while a < -math.pi do a = a + 2 * math.pi end
  return a
end

-- the chase camera, as in a race (lib/race.lua): trailing the car's heading, the right stick looks round, three views
function Roam:update_camera(dt)
  local p, cam, orbit = self.player, self.camera, self.orbit
  local speed = math.abs(p.speed)
  cam.heading = cam.heading + wrap(p.heading - cam.heading) * math.min(1, dt * 7)
  local lx, ly = nova.input.axis("look_x"), nova.input.axis("look_y")
  local push = math.sqrt(lx * lx + ly * ly)
  if push > 0.6 then orbit.held = math.atan(-lx, -ly) elseif push < 0.3 then orbit.held = nil end
  local want = orbit.held or 0
  if not orbit.held and nova.input.down("look_back") then want = math.pi end
  orbit.yaw = orbit.yaw + wrap(want - orbit.yaw) * math.min(1, dt * (want ~= 0 and 8 or 4))
  orbit.lift = orbit.lift + ((math.abs(want) > 2.5 and 0.3 or 0) - orbit.lift) * math.min(1, dt * 5)
  local mode = self.view_mode or 2
  if mode == 3 then
    local a = p.heading + orbit.yaw * 1.3
    local sinh, cosh = math.sin(p.heading), math.cos(p.heading)
    cam.x, cam.y, cam.z = p.x + sinh * 0.6, 1.25, p.z + cosh * 0.6
    cam.tx, cam.ty, cam.tz = cam.x + math.sin(a) * 20, 1.1 + orbit.lift * 4, cam.z + math.cos(a) * 20
    cam.fov, cam.bonnet = 70 + speed * 0.2, true
  else
    local near = mode == 1
    local back = (near and 6.4 or 9.5) + speed * 0.03
    local a = cam.heading + orbit.yaw
    cam.x, cam.y, cam.z = p.x - math.sin(a) * back, (near and 2.6 or 4.2) + orbit.lift * 3, p.z - math.cos(a) * back
    local ahead = 5 * math.max(0, 1 - math.abs(orbit.yaw) / 0.9)
    cam.tx, cam.ty, cam.tz = p.x + math.sin(cam.heading) * ahead, 1.1, p.z + math.cos(cam.heading) * ahead
    cam.fov, cam.bonnet = 62 + speed * 0.2, false
  end
end

function Roam:draw()
  local cam = self.camera
  local here, there = nova.terrain_height(cam.x, cam.z), nova.terrain_height(cam.tx, cam.tz)
  if cam.bonnet then
    local p = self.player
    nova.camera(cam.x, cam.y + (p.lift or 0) + nova.terrain_height(p.x, p.z), cam.z, cam.tx, cam.ty + there, cam.tz, cam.fov)
  else
    nova.camera(cam.x, math.max(cam.y + here, there + 1.2), cam.z, cam.tx, cam.ty + there, cam.tz, cam.fov)
  end
  horizon.draw(cam.x, cam.z, self.config.horizon)
  powerlines.draw(cam.x, cam.z, LOOK_FAR)
  water.draw(cam.x, math.max(cam.y + here, there + 1.2), cam.z, self.config.sun and self.config.sun.dir and -self.config.sun.dir[2] or 0.5)
  fx.draw_skids(cam.x, cam.z, 90)
end

-- ---- what is drawn over the picture --------------------------------------------------------------------------------------------
local EDGE = { 8, 12, 26, 235 }
local function hud_text(x, y, text, font, size, colour, opts)
  local o = { font = font, size = size, color = colour or C.white, outline = { color = EDGE, width = math.max(0.75, size / 34) }, shadow = { 0, 0, 0, 90 } }
  if opts then for k, v in pairs(opts) do o[k] = v end end
  return nova.ui.text(x, y, text, o)
end

function Roam:draw_ui()
  local w = nova.view()
  if not transition.busy() then
    if self.paused then self:draw_pause()
    elseif self.panel then self:draw_event()
    else self:draw_hud() end
  end
  local r = self.rescue
  if r then
    local dark = r.t < RESCUE_OUT and r.t / RESCUE_OUT or (r.t < RESCUE_OUT + RESCUE_HOLD and 1 or math.max(0, 1 - (r.t - RESCUE_OUT - RESCUE_HOLD) / RESCUE_IN))
    nova.ui.rect(0, 0, w, 540, { 0, 0, 0, math.floor(255 * dark) })
  end
  transition.draw()
end

-- The minimap, bottom left (Horizon-style): a disc showing the roads within MINI_RANGE metres, turned with the car so that straight ahead
-- is up, an N on its rim where north is, the events as orange pins (the nearest three further off held at the rim), the car an arrow in
-- the middle.
local MINI_R, MINI_RANGE = 74, 260
local MINI_ROAD = { tarmac = C.white, gravel = { 222, 190, 140 } }
local MINI_GROUND = { 24, 40, 30, 205 }
function Roam:draw_minimap()
  local p = self.player
  local cx, cy = 36 + MINI_R, 540 - 18 - MINI_R
  local R = MINI_R
  local k = R / MINI_RANGE
  local fx, fz = math.sin(p.heading), math.cos(p.heading)
  local lx, lz = fz, -fx -- (the car's left)
  local function at(x, z)
    local rx, rz = x - p.x, z - p.z
    return cx - (rx * lx + rz * lz) * k, cy - (rx * fx + rz * fz) * k
  end
  -- the disc: a rim, then the ground, a strip at a time
  for y = -R - 3, R + 3, 2 do
    local w = math.sqrt(math.max(0, (R + 3) ^ 2 - y * y))
    nova.ui.rect(cx - w, cy + y, w * 2, 2, { 0, 0, 0, 130 })
  end
  for y = -R, R, 2 do
    local w = math.sqrt(math.max(0, R * R - y * y))
    nova.ui.rect(cx - w, cy + y, w * 2, 2, MINI_GROUND)
  end
  local inside2 = (R - 2) ^ 2
  local reach2 = (MINI_RANGE * 1.1) ^ 2
  for pass = 1, 2 do
    for _, name in ipairs(roads.names()) do
      local rt = roads.route(name)
      local pts = rt.pts
      local colour = (pts[1] and pts[1].road == "road_asphalt") and MINI_ROAD.tarmac or MINI_ROAD.gravel
      for i = 1, #pts - (rt.loop and 0 or 1) do
        local a, b = pts[i], pts[i % #pts + 1]
        if (a.x - p.x) ^ 2 + (a.z - p.z) ^ 2 < reach2 then
          local x1, y1 = at(a.x, a.z)
          local x2, y2 = at(b.x, b.z)
          if (x1 - cx) ^ 2 + (y1 - cy) ^ 2 < inside2 and (x2 - cx) ^ 2 + (y2 - cy) ^ 2 < inside2 then
            if pass == 1 then nova.ui.line(x1, y1, x2, y2, 6, { 0, 0, 0, 140 })
            else nova.ui.line(x1, y1, x2, y2, 3, colour) end
          end
        end
      end
    end
  end
  local far = {}
  for _, e in ipairs(nova.all("event")) do
    local x, y = at(e.x, e.z)
    local ex, ey = x - cx, y - cy
    local m = math.sqrt(ex * ex + ey * ey)
    if m > R - 8 then
      far[#far + 1] = { d = (e.x - p.x) ^ 2 + (e.z - p.z) ^ 2, x = cx + ex * (R - 8) / m, y = cy + ey * (R - 8) / m }
    else
      nova.ui.rect(x - 6, y - 6, 12, 12, C.ink)
      nova.ui.rect(x - 4.5, y - 4.5, 9, 9, C.orange)
    end
  end
  table.sort(far, function(a, b) return a.d < b.d end)
  for i = 1, math.min(3, #far) do
    local f = far[i]
    nova.ui.rect(f.x - 5, f.y - 5, 10, 10, C.ink)
    nova.ui.rect(f.x - 3.5, f.y - 3.5, 7, 7, { C.orange[1], C.orange[2], C.orange[3], 170 })
  end
  -- north (+z, as on the big map) on the rim
  local nx, ny = at(p.x, p.z + MINI_RANGE)
  local dx, dy = nx - cx, ny - cy
  local dl = math.sqrt(dx * dx + dy * dy)
  local tx, ty = cx + dx / dl * (R + 1), cy + dy / dl * (R + 1)
  nova.ui.rect(tx - 10, ty - 10, 20, 20, C.ink)
  ui.say(tx, ty, "N", F.heavy, 16.5, C.white, { align = "center", valign = "middle" })
  -- the car
  nova.ui.line(cx - 6, cy + 7, cx, cy - 8, 4, C.green)
  nova.ui.line(cx + 6, cy + 7, cx, cy - 8, 4, C.green)
end

function Roam:draw_hud()
  local w = nova.view()
  local p = self.player
  self:draw_minimap()
  local right = w - 36
  local kmh = math.floor(math.abs(p.speed) * 3.6 + 0.5)
  local gear = p.speed < -0.5 and "R" or ("G" .. (p.gear or 1))
  local kw = nova.ui.text_width("km/h", { font = F.body, size = 16.5 })
  local base = 520 -- (the speed sits low, as the minimap does: the road ahead is in the middle of the screen)
  hud_text(right - kw, base, "km/h", F.body, 16.5, C.hud, { valign = "baseline" })
  local sw = nova.ui.text_width(tostring(kmh), { font = F.heavy, size = 54 })
  local sx = right - kw - 9 - math.max(sw, nova.ui.text_width("888", { font = F.heavy, size = 54 }))
  hud_text(right - kw - 9 - sw, base, tostring(kmh), F.heavy, 54, C.white, { valign = "baseline" })
  hud_text(sx - 9 - nova.ui.text_width(gear, { font = F.bold, size = 18 }), base, gear, F.bold, 18, C.hud, { valign = "baseline" })
  hud_text(36, 36, "FREE ROAM", F.bold, 18, C.orange, { spacing = 0.2 })
  hud_text(36, 58, self.region and self.region.title or "Pine Ridge", F.heavy, 27, C.white)
  -- at a marker: what it is, and Y to see it
  local e = self.near
  if e then
    local info = course_info(e.course)
    local words = info.name .. "  ·  " .. MODE_NAMES[e.mode]
    local tw = nova.ui.text_width(words, { font = F.heavy, size = 24 })
    local x = w / 2 - (tw + 40) / 2
    nova.ui.rect(x - 14, 404, tw + 68, 44, { C.ground[1], C.ground[2], C.ground[3], 210 })
    ui.pad("pad_y", x, 410, 32)
    hud_text(x + 40, 426, words, F.heavy, 24, C.white, { valign = "middle" })
  elseif (p.off_middle or 0) > 16 then
    local words = "Back on the road"
    local tw = nova.ui.text_width(words, { font = F.semi, size = 18 })
    ui.pad("pad_select", w / 2 - (tw + 34) / 2, 426, 26)
    hud_text(w / 2 - (tw + 34) / 2 + 34, 430, words, F.semi, 18, C.hud)
  end
end

local LEVEL_COLOR = { { 74, 222, 128 }, { 56, 189, 248 }, { 251, 146, 60 }, { 239, 68, 68 } }
local function line(label, value, colour)
  return { "row", h = 27, { "text", label, style = "muted", grow = 1 }, { "text", value, font = F.semi, size = 18, color = colour or C.white, align = "right", w = 220 } }
end

-- The event's details, Horizon-style: a card on the right with the course, the mode, how hard it is and what it pays; A starts it.
function Roam:draw_event()
  local e = self.panel
  local info, _, list = course_info(e.course)
  local open, why = state.course_open(e.mode == "trial" and state.tracks or list, info)
  local level = info.level or 1
  local prize
  if e.mode == "rally" then prize = state.money(state.reward(info, { stars = 3 })) .. " for 3 stars"
  elseif e.mode == "trial" then prize = state.money(state.reward(info, { trial = true })) .. ", more for a lap record"
  else prize = state.money(state.reward(info, { place = 1, laps = info.laps })) .. " for 1st" end
  local best = e.mode == "rally" and ui.time(state.best("rally", info.id)) or ui.time(state.best("lap", info.id))
  local card = { "panel", anchor = "topright", margin = 36, w = 380, pad = { 21, 16 }, gap = 3, id = "card",
    { "text", string.upper(MODE_NAMES[e.mode]), style = "kicker" },
    { "text", string.upper(info.name), font = F.title, size = 42 },
    { "text", e.mode == "trial" and "Alone on the circuit, against the ghost of your best lap." or info.blurb, style = "muted", wrap = true },
    { "space", h = 8 },
    line(info.km and "Length" or "Laps", info.km and (info.km .. " km") or tostring(info.laps)),
    line("Difficulty", state.levels[level], LEVEL_COLOR[level]),
    line("Your car", state.current_car().name),
    line(e.mode == "rally" and "Best time" or "Best lap", best, C.gold),
    line("Prize", prize, C.gold),
    { "space", h = 6 },
    open and { "space", h = 0 } or { "text", "Locked: " .. why, font = F.semi, size = 18, color = C.gold, wrap = true } }
  local rects = nova.ui.layout(card)
  nova.ui.rect(rects.card.x, rects.card.y, 6, rects.card.h, C.orange)
  local r = nova.ui.menu {
    id = "event", anchor = "topright", margin = 36, x = 0, y = rects.card.h + 12, w = 380, enter = false, active = self.panel_opened > 0.15,
    { "button", open and "START" or "LOCKED", id = "start", h = 54 },
  }
  ui.hints({ { "pad_a", "Start" }, { "pad_b", "Back" } })
  if r.back then
    self.panel = nil
  elseif r.pressed == "start" then
    if open then
      audio.sfx("menu_accept")
      self.panel = nil
      self:start_event(e)
    else
      audio.sfx("menu_back")
    end
  end
end

-- ---- pause, and the map ---------------------------------------------------------------------------------------------------------
function Roam:draw_pause()
  local w = nova.view()
  nova.ui.rect(0, 0, w, 540, { 8, 11, 15, 200 })
  if self.pause_screen == "map" then return self:draw_map() end
  ui.side_panel(420, 1)
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 42, ui.header("Free roam  ·  " .. (self.region and self.region.title or "Pine Ridge"), "Paused", 72) }
  local r = nova.ui.menu {
    id = "roam_pause", anchor = "topleft", margin = 0, x = 48, y = 183, w = 315, enter = false,
    { "button", "RESUME", id = "resume", h = 51 }, { "button", "MAP", id = "map", h = 51 },
    { "button", "QUIT TO MENU", id = "quit", h = 51, danger = true },
  }
  ui.hints({ { "pad_a", "Select" }, { "pad_start", "Resume" } })
  if r.back or r.pressed == "resume" then
    self.paused = false
    nova.pause(false)
    nova.music.volume(state.music_volume)
  elseif r.pressed == "map" then
    audio.sfx("menu_accept")
    self.pause_screen = "map"
  elseif r.pressed == "quit" then
    audio.sfx("menu_accept")
    nova.pause(false)
    state.from_roam = false
    audio.stop_music(0.4)
    nova.goto_scene("title", "menu")
  end
end

-- The map (pause > MAP): the whole world, north up. Highways bold and white, each course's road in its region's colour, the towns' names
-- large, the events as symbols by kind (a key along the bottom). The stick moves a cursor; the event nearest it is named beside it. L and R
-- zoom in and out (the view stays on the cursor).
local MAP_EVENT = { race = { 255, 106, 43 }, trial = { 79, 209, 197 }, rally = { 255, 210, 63 } }
local MAP_REGION = { pine_ridge = { 140, 210, 130 }, autumn_glen = { 235, 150, 70 }, dust_valley = { 232, 200, 120 }, frost_pass = { 215, 235, 255 }, harbour_lights = { 120, 170, 255 } }
function Roam:draw_map()
  local w = nova.view()
  local p = self.player
  if not self.map_box then
    local x0, z0, x1, z1 = 1e9, 1e9, -1e9, -1e9
    roads.each(function(q) x0, z0, x1, z1 = math.min(x0, q.x), math.min(z0, q.z), math.max(x1, q.x), math.max(z1, q.z) end)
    self.map_box = { x0 = x0, z0 = z0, x1 = x1, z1 = z1 }
    self.map_cursor = { x = p.x, z = p.z }
    self.map_zoom = 1
  end
  local b, cur = self.map_box, self.map_cursor
  -- the stick or the d-pad moves the cursor (faster when zoomed out); L and R zoom
  local dt = 1 / 60
  local mx = nova.input.axis("steer") + (nova.input.down("right") and 1 or 0) - (nova.input.down("left") and 1 or 0)
  local my = (nova.input.down("down") and 1 or 0) - (nova.input.down("up") and 1 or 0)
  if nova.input.pressed("tab_next") then self.map_zoom = math.min(4, self.map_zoom * 2); audio.sfx("menu_move") end
  if nova.input.pressed("tab_prev") then self.map_zoom = math.max(1, self.map_zoom / 2); audio.sfx("menu_move") end
  local top, bottom = 80, 448
  local fit = math.min((w - 120) / (b.x1 - b.x0), (bottom - top) / (b.z1 - b.z0))
  local k = fit * self.map_zoom
  local speed = 900 / k -- (metres a second the cursor moves: a screen width in about a second)
  cur.x = math.max(b.x0, math.min(b.x1, cur.x - mx * speed * dt)) -- (x runs right to left on the map: see `at`)
  cur.z = math.max(b.z0, math.min(b.z1, cur.z - my * speed * dt))
  -- the view: the whole map at zoom 1, else centred on the cursor
  local cx, cz = (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2
  if self.map_zoom > 1 then cx, cz = cur.x, cur.z end
  local sx, sy = w / 2, (top + bottom) / 2
  -- (north, +z, is up; a car facing north has +x on its left, so x runs right to left)
  local function at(x, z) return sx + (cx - x) * k, sy + (cz - z) * k end
  nova.ui.rect(0, 0, w, 540, { 16, 24, 20, 255 })
  for pass = 1, 2 do
    for _, name in ipairs(roads.names()) do
      local rt = roads.route(name)
      local pts = rt.pts
      local highway = name:match("^roam_hw") or name:match("^roam_ring") or name:match("^town_")
      local link = name:match("^roam_to_")
      local region = regions.at(pts[1].x, pts[1].z)
      local colour = highway and C.white or link and { 150, 150, 150 } or (MAP_REGION[region and region.look or ""] or C.white)
      local width = highway and (pass == 1 and 7 or 4) or (pass == 1 and 5 or 2.5)
      local step = self.map_zoom > 1 and 1 or 3
      for i = 1, #pts - (rt.loop and 0 or 1), step do
        local a, c = pts[i], pts[math.min(#pts, i + step)] or pts[1]
        if rt.loop and i + step > #pts then c = pts[1] end
        local x1, y1 = at(a.x, a.z)
        local x2, y2 = at(c.x, c.z)
        if not (math.max(x1, x2) < 0 or math.min(x1, x2) > w or math.max(y1, y2) < 0 or math.min(y1, y2) > 540) then
          nova.ui.line(x1, y1, x2, y2, width, pass == 1 and { 0, 0, 0, 170 } or colour)
        end
      end
    end
  end
  for _, r in ipairs(regions.all()) do
    local x, y = at(r.x, r.z)
    ui.say(x, y - 22, string.upper(r.title), F.heavy, 24, C.white, { align = "center", valign = "middle", spacing = 0.06 })
    nova.ui.rect(x - 7, y - 7, 14, 14, C.white)
  end
  -- the events, and the one nearest the cursor named
  local near, nd = nil, math.huge
  for _, e in ipairs(nova.all("event")) do
    local x, y = at(e.x, e.z)
    local c = MAP_EVENT[e.mode] or C.orange
    nova.ui.rect(x - 7, y - 7, 14, 14, C.ink)
    nova.ui.rect(x - 5, y - 5, 10, 10, c)
    local d = (e.x - cur.x) ^ 2 + (e.z - cur.z) ^ 2
    if d < nd then near, nd = e, d end
  end
  -- the car
  local x, y = at(p.x, p.z)
  local h = p.heading
  local fx_, fy = -math.sin(h), -math.cos(h)
  nova.ui.line(x - fx_ * 9 - fy * 7, y - fy * 9 + fx_ * 7, x + fx_ * 12, y + fy * 12, 5, C.green)
  nova.ui.line(x - fx_ * 9 + fy * 7, y - fy * 9 - fx_ * 7, x + fx_ * 12, y + fy * 12, 5, C.green)
  -- the cursor, and the nearest event's name beside it (when it is close to it on the screen)
  local qx, qy = at(cur.x, cur.z)
  nova.ui.line(qx - 12, qy, qx + 12, qy, 2, C.white)
  nova.ui.line(qx, qy - 12, qx, qy + 12, 2, C.white)
  if near then
    local ex, ey = at(near.x, near.z)
    if (ex - qx) ^ 2 + (ey - qy) ^ 2 < 40 * 40 then
      local info = course_info(near.course)
      local words = info.name .. "  ·  " .. MODE_NAMES[near.mode]
      local tw = nova.ui.text_width(words, { font = F.heavy, size = 20 })
      nova.ui.rect(ex + 12, ey - 15, tw + 20, 30, { C.ground[1], C.ground[2], C.ground[3], 230 })
      nova.ui.rect(ex + 12, ey - 15, 4, 30, MAP_EVENT[near.mode] or C.orange)
      ui.say(ex + 24, ey, words, F.heavy, 20, C.white, { valign = "middle" })
    end
  end
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 18, ui.header("Free roam", "Map", 40) }
  -- the key
  local kx = 48
  for _, kind in ipairs({ "race", "trial", "rally" }) do
    nova.ui.rect(kx, 460, 12, 12, MAP_EVENT[kind])
    kx = kx + 18 + ui.say(kx + 18, 466, MODE_NAMES[kind], F.medium, 16.5, C.white, { valign = "middle" }) + 22
  end
  ui.hints({ { "pad_stick_l", "Look" }, { "pad_l", "" }, { "pad_r", "Zoom" }, { "pad_b", "Back" } })
  if nova.input.pressed("b") or nova.input.pressed("menu_back") then audio.sfx("menu_back"); self.pause_screen = "menu" end
end

return Roam

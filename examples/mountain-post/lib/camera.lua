-- The cameras. Outdoors, on foot and in the van, one rule (the owner, after the second play: "I do still want to have the chase
-- camera while walking and driving ... like GTA V not Forza Horizon. So the player can orbit the camera but as the player drives it'll
-- drift back to the rear view"):
-- - The right stick orbits it freely (all the way round, and up and down between two limits). It stays where it was put while the
--   stick was used in the last moment, and for as long as the postmaster stands or the van is stopped.
-- - A moment (DELAY) after the stick was let go, and only while moving, it drifts back behind the way of travel: on foot slowly
--   (seconds for a half turn, slower still at a stroll, nothing at all standing), in the van quicker and more so the faster it goes.
--   The drift's turning speed eases up and down (never a snap) and is held under a limit (`rate`); walking towards the camera does not
--   swing it round (the drift dies away as the way of travel comes to face it), and turning on the spot leaves it nearly still (the
--   way of travel is the postmaster's smoothed velocity, which a turn on the spot hardly moves). Reversing the van turns it round
--   only after REVERSE seconds of reversing. The tilt eases back to the default with the drift.
-- - On foot the default is high and steep like a village diorama game (the owner's Animal Crossing picture): 42 degrees down, from
--   far back with a narrow lens, the postmaster small and a little below the middle. Driving it is lower and wider so the road ahead
--   shows. Nothing pushes the camera in: what stands between it and the postmaster or the van (tree crowns, a roof, the porch, the van's
--   body) is cut away round them (nova.see_through); only the ground lifts it, smoothly.
-- Whenever the stick becomes the postmaster's outdoors (the valley's start, out of the post office's door, out of the van, after a
-- conversation) the camera is put straight behind the way they face, at the default; getting in and out of the van glides between the
-- two views. Indoors: one fixed view from high over the cut-away front wall (unchanged). Going from one view to another the view glides
-- over a moment, along a straight line between the two.
-- The camera is placed by hand on the valley's hills (nova.terrain lifts what is drawn, not the camera).
local world = require("lib.world")

local camera = {}
local cam = { yaw = 0, eye = { 0, 0, 0 }, at = { 0, 0, 0 }, fov = 40, blend = 1, from = nil, ready = false }
camera.state = cam

-- On foot: the boom's length and tilt, its limits, the lens; what it looks at (metres above the ground, and ahead along the view so
-- the postmaster sits a little below the middle); the drift (`rate` rad/s at most at `full` m/s, `accel` rad/s^2 for easing its speed)
camera.FOOT = { dist = 14.5, pitch = math.rad(42), low = math.rad(20), high = math.rad(68), fov = 26, look = 0.45, ahead = 0.9,
  rate = 0.55, full = 2.3, gain = 1.1, accel = 0.6, still = 0.5 }
-- The van: further and lower, a wider lens, looking ahead down the road; a quicker drift that grows with speed
camera.VAN = { dist = 11.5, pitch = math.rad(21), low = math.rad(6), high = math.rad(60), fov = 40, look = 0.9, ahead = 2.5,
  rate = 0.5, per = 0.12, top_rate = 1.7, gain = 2.6, accel = 3.0, still = 0.6 }
camera.DELAY = 1.2         -- seconds after the right stick is let go before the drift begins (it then eases in over EASE more)
camera.EASE = 0.9
camera.ORBIT = 2.3         -- rad/s the stick turns it at a full push
camera.TILT = 1.1          -- rad/s the stick tilts it at a full push
camera.REVERSE = 2.5       -- seconds of reversing before the van's camera turns round to look the way it goes
-- The room: one fixed view from high over the cut-away front wall (+z) at the middle of the room
camera.ROOM = { eye = { 0, 8.4, 7.4 }, at = { 0, 0.15, -0.15 }, fov = 33 }

local function wrap(a) return (a + math.pi) % (2 * math.pi) - math.pi end
local function smooth(e0, e1, x) local t = math.max(0, math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) end

-- Behind `yaw`, at the default tilt, held there (the stick counts as just used, so nothing drifts for a moment).
function camera.reset(yaw)
  cam.yaw, cam.ready, cam.blend, cam.from = yaw or 0, false, 1, nil
  cam.pitch_off, cam.rate, cam.idle, cam.lift, cam.vx, cam.vz, cam.rev, cam.follow = 0, 0, 0, nil, 0, 0, 0, nil
  cam.px, cam.pz, cam.orbit, cam.tilt = nil, nil, 0, 0
end
camera.behind = camera.reset

-- The view glides from where it is now to the next one over `seconds`.
function camera.glide(seconds)
  cam.from = { eye = { cam.eye[1], cam.eye[2], cam.eye[3] }, at = { cam.at[1], cam.at[2], cam.at[3] }, fov = cam.fov }
  cam.blend, cam.glide_time = 0, seconds or 0.8
end

-- The right stick: orbit and tilt; it says whether it was touched (and how long ago it last was: cam.idle).
local function stick(dt, C)
  local lx, ly = nova.input.axis("look_x"), nova.input.axis("look_y")
  local used = math.abs(lx) > 0.15 or math.abs(ly) > 0.15
  -- (the orbit's own speed eases after the stick over a few frames: a push starts and stops the turn softly, never a jump)
  local k = math.min(1, dt * 12)
  cam.orbit = (cam.orbit or 0) + ((used and -lx * camera.ORBIT or 0) - (cam.orbit or 0)) * k
  cam.tilt = (cam.tilt or 0) + ((used and ly * camera.TILT or 0) - (cam.tilt or 0)) * k
  if not used and math.abs(cam.orbit) < 0.02 then cam.orbit = 0 end
  if not used and math.abs(cam.tilt) < 0.02 then cam.tilt = 0 end
  if used or math.abs(cam.orbit) > 0.02 or math.abs(cam.tilt) > 0.02 then
    cam.idle = 0
    cam.rate = 0
  else
    cam.idle = (cam.idle or 0) + dt
  end
  cam.yaw = wrap(cam.yaw + cam.orbit * dt)
  local p = C.pitch + (cam.pitch_off or 0) + cam.tilt * dt
  cam.pitch_off = math.max(C.low, math.min(C.high, p)) - C.pitch
  return used or math.abs(cam.orbit) > 0.02
end

-- The drift back behind the way of travel `travel` at `speed` m/s (on foot or in the van, by `C`): its turning speed eases towards
-- what it wants and never past the limit for that speed.
local function drift(dt, C, travel, speed, limit)
  local wait = smooth(camera.DELAY, camera.DELAY + camera.EASE, cam.idle or 0)
  local moving = smooth(C.still, C.still * 3, speed)
  local diff = wrap(travel - cam.yaw)
  -- (walking or backing straight at the camera: no swing round)
  local facing = C == camera.FOOT and smooth(2.95, 2.25, math.abs(diff)) or 1
  local want = math.max(-limit, math.min(limit, diff * C.gain)) * wait * moving * facing
  local step = C.accel * dt
  cam.rate = (cam.rate or 0) + math.max(-step, math.min(step, want - (cam.rate or 0)))
  cam.rate = math.max(-limit, math.min(limit, cam.rate))
  cam.yaw = wrap(cam.yaw + cam.rate * dt)
  -- the tilt eases back too
  cam.pitch_off = (cam.pitch_off or 0) * (1 - math.min(1, dt * 0.9 * wait * moving))
  cam.limit = limit
end

-- The boom from a point it looks at: eye and look point, the ground lifting the eye smoothly where a hill comes between.
local function place(dt, C, x, base, z, look_at)
  local pitch = C.pitch + (cam.pitch_off or 0)
  local s, c = math.sin(cam.yaw), math.cos(cam.yaw)
  -- (the point followed eases after the body a touch, so a bump in the path is not a bump in the picture)
  local f = cam.follow
  if not f or not cam.ready then f = { x, base, z }; cam.follow = f
  else
    local k = math.min(1, dt * 12)
    f[1], f[2], f[3] = f[1] + (x - f[1]) * k, f[2] + (base - f[2]) * math.min(1, dt * 6), f[3] + (z - f[3]) * k
  end
  local tx, ty, tz = f[1] + s * C.ahead, f[2] + C.look, f[3] + c * C.ahead
  local h, d = math.sin(pitch) * C.dist, math.cos(pitch) * C.dist
  local ex, ey, ez = tx - s * d, ty + h, tz - c * d
  local need = math.max(0, world.height(ex, ez) + 1.2 - ey)
  if not cam.lift or not cam.ready then cam.lift = need
  else cam.lift = cam.lift + (need - cam.lift) * math.min(1, dt * (need > cam.lift and 5 or 1.5)) end
  ey = ey + cam.lift
  camera.set(ex, ey, ez, tx, ty, tz, C.fov, dt)
  cam.see = look_at
end

-- On foot outdoors: the chase view behind the postmaster.
function camera.foot(p, dt)
  local C = camera.FOOT
  local used = stick(dt, C)
  -- the way of travel: the postmaster's velocity, smoothed (a turn on the spot hardly moves it)
  if cam.px and dt > 0 then
    local vx, vz = (p.x - cam.px) / dt, (p.z - cam.pz) / dt
    if vx * vx + vz * vz > 64 then vx, vz = 0, 0 end -- (a jump: through a door, out of the van)
    local k = math.min(1, dt * 2.5)
    cam.vx, cam.vz = (cam.vx or 0) + (vx - (cam.vx or 0)) * k, (cam.vz or 0) + (vz - (cam.vz or 0)) * k
  end
  cam.px, cam.pz = p.x, p.z
  local speed = math.sqrt((cam.vx or 0) ^ 2 + (cam.vz or 0) ^ 2)
  if not used then
    local limit = C.rate * math.min(1, speed / C.full)
    drift(dt, C, speed > 0.05 and math.atan(cam.vx, cam.vz) or cam.yaw, speed, limit)
  end
  local base = world.height(p.x, p.z) + (p.y or 0) - world.lift(p.x, p.z)
  place(dt, C, p.x, base, p.z, { p.x, base + 0.5, p.z, radius = 3.0, margin = 0.9, near = 3.5 })
end

-- Behind the van: the same rule, quicker.
function camera.van(v, dt)
  local C = camera.VAN
  local used = stick(dt, C)
  local speed = v.speed or 0
  -- (reversing turns the view round only after a while of it)
  if speed < -0.8 then cam.rev = (cam.rev or 0) + dt elseif speed > 0.3 then cam.rev = 0 end
  local travel = v.heading + ((cam.rev or 0) > camera.REVERSE and math.pi or 0)
  if not used then
    local limit = math.min(C.top_rate, C.rate + C.per * math.abs(speed))
    drift(dt, C, travel, math.abs(speed), limit)
  end
  cam.px, cam.pz, cam.vx, cam.vz = nil, nil, 0, 0
  local base = world.height(v.x, v.z)
  place(dt, C, v.x, base, v.z, { v.x, base + 1.0, v.z, radius = 2.6, margin = 2.4, near = 5 })
end

-- The office: the fixed view (the room is level, its floor at 0).
function camera.room(dt)
  local R = camera.ROOM
  cam.yaw = math.atan(R.at[1] - R.eye[1], R.at[3] - R.eye[3])
  camera.set(R.eye[1], R.eye[2], R.eye[3], R.at[1], R.at[2], R.at[3], R.fov, dt)
  cam.see = nil
end

-- Two people talking: over the postmaster's shoulder, close, on the resident's face (they face the postmaster, so nearly
-- straight at the camera: their expressions read), the postmaster at the frame's edge; from the side the camera already looks
-- from, so the cut is short. The words' box covers the lowest third: the faces sit above the middle.
function camera.talk(p, r, dt)
  local ax, az = r.x - p.x, r.z - p.z
  local l = math.sqrt(ax * ax + az * az)
  if l < 1e-3 then return camera.foot(p, dt) end
  ax, az = ax / l, az / l
  -- the two sides of the line between them; the one nearer the camera's present eye
  local nx, nz = -az, ax
  local e = cam.eye
  if (e[1] - p.x) * nx + (e[3] - p.z) * nz < 0 then nx, nz = -nx, -nz end
  -- (well out to the side and a little above: the postmaster's big round head stays at the frame's edge, clear of the speaker's)
  local ex, ez = p.x - ax * 1.0 + nx * 1.6, p.z - az * 1.0 + nz * 1.6
  local base = world.height(p.x, p.z)
  local ey = math.max(base + 1.4, world.height(ex, ez) + 1.0)
  local rb = world.height(r.x, r.z)
  camera.set(ex, ey, ez, r.x - ax * 0.2 + nx * 0.35, rb + 0.52, r.z - az * 0.2 + nz * 0.35, 40, dt)
  cam.see = nil
  cam.talking = true
end

-- A fixed view (the title, a view over the gorge).
function camera.set(ex, ey, ez, tx, ty, tz, fov, dt)
  cam.want = { ex, ey, ez, tx, ty, tz, fov }
  cam.ready = true
end

-- Puts the view on the screen (from draw): the glide between two views, eased; the hole round what the view follows.
local SEE = { at = { 0, 0, 0 }, radius = 1.9, margin = 0.9, above = 0.35, near = 2.5, amount = 1 }
function camera.apply(dt)
  -- (a view pinned by the gallery's routes, for the face sheets and film strips; the game never pins one)
  if camera.pinned then nova.see_through(); return nova.camera(table.unpack(camera.pinned)) end
  local w = cam.want
  if not w then return end
  local ex, ey, ez, tx, ty, tz, fov = w[1], w[2], w[3], w[4], w[5], w[6], w[7]
  local t = 1
  if cam.from and cam.blend < 1 then
    cam.blend = math.min(1, cam.blend + (dt or 0) / cam.glide_time)
    t = cam.blend * cam.blend * (3 - 2 * cam.blend)
    local f = cam.from
    ex, ey, ez = f.eye[1] + (ex - f.eye[1]) * t, f.eye[2] + (ey - f.eye[2]) * t, f.eye[3] + (ez - f.eye[3]) * t
    tx, ty, tz = f.at[1] + (tx - f.at[1]) * t, f.at[2] + (ty - f.at[2]) * t, f.at[3] + (tz - f.at[3]) * t
    fov = f.fov + (fov - f.fov) * t
  end
  cam.eye[1], cam.eye[2], cam.eye[3] = ex, ey, ez
  cam.at[1], cam.at[2], cam.at[3] = tx, ty, tz
  cam.fov = fov
  nova.camera(ex, ey, ez, tx, ty, tz, fov)
  local s = cam.see
  if s then
    SEE.at[1], SEE.at[2], SEE.at[3] = s[1], s[2], s[3]
    SEE.radius, SEE.margin, SEE.near, SEE.amount = s.radius, s.margin, s.near or 2.5, t
    nova.see_through(SEE)
  else
    nova.see_through()
  end
end

-- "Forward" and "right" on the ground as this camera sees it (for the stick).
function camera.forward() return math.sin(cam.yaw), math.cos(cam.yaw) end

return camera

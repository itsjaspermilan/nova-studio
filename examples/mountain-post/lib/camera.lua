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
-- - Low and behind (the owner, third play: "I think we can tilt the camera down a bit while walking out and driving", and asked, lower
--   and more behind, more level, with the road and the horizon ahead; not more top-down): on foot 26 degrees down from 8 m with a 38
--   degree lens, the postmaster about a fifth of the screen high in its lower middle, the sky and the far hills along the top; driving
--   15 degrees down, the van in the lower third and the road and the horizon ahead. What stands between the camera and the postmaster
--   or the van is cut away round them only while it really hides them (tree crowns, a roof, the porch: lib/occluders.lua, CUT below);
--   only the ground lifts the camera, smoothly.
-- - Nobody else is cut away either (residents, the driver): only scenery is. The van is never cut away either (the owner: "I don't
--   like that the van dithers away to make way for the player": it is drawn with see_through = false). The camera does not move for
--   them either (the owner, 2026-11-23: "We don't need the camera dodge when the player is behind the van or other characters"):
--   the postmaster is simply hidden for a moment behind the van or a resident, and the camera stays on its orbit and drift. The one
--   thing it still does is stay out of the van's body: an eye that would be inside the van is lifted just over it.
-- Whenever the stick becomes the postmaster's outdoors (the valley's start, out of the post office's door, out of the van, after a
-- conversation) the camera is put straight behind the way they face, at the default; getting in and out of the van glides between the
-- two views. Indoors: one fixed view from high over the cut-away front wall (unchanged). Going from one view to another the view glides
-- over a moment, along a straight line between the two.
-- The camera is placed by hand on the valley's hills (nova.terrain lifts what is drawn, not the camera).
local world = require("lib.world")
local occluders = require("lib.occluders")

local camera = {}
local cam = { yaw = 0, eye = { 0, 0, 0 }, at = { 0, 0, 0 }, fov = 40, blend = 1, from = nil, ready = false }
camera.state = cam

-- On foot: the boom (its length, and how high it rises from the point it hangs on: `pitch`, between `low` and `high` with the right
-- stick), the point it hangs on (`look` metres above the ground, `ahead` along the view), the lens, and how steeply the camera looks
-- down (`view`, less than the boom's rise: the postmaster sits in the lower middle and the horizon shows along the top); the drift
-- (`rate` rad/s at most at `full` m/s, `accel` rad/s^2 for easing its speed)
camera.FOOT = { dist = 8.0, pitch = math.rad(26), view = math.rad(15), low = math.rad(6), high = math.rad(52), fov = 42, look = 0.6, ahead = 0,
  rate = 0.55, full = 2.3, gain = 1.1, accel = 0.6, still = 0.5 }
-- The van: further and lower, a wider lens, looking out down the road; a quicker drift that grows with speed
camera.VAN = { dist = 9.6, pitch = math.rad(16), view = math.rad(7), low = math.rad(3), high = math.rad(45), fov = 44, look = 1.0, ahead = 0.4,
  rate = 0.5, per = 0.12, top_rate = 1.7, gain = 2.6, accel = 3.0, still = 0.6 }
-- Doors whose building stands behind the camera (the scene lists them in camera.NEAR as { x, z, r = , near = }): the post office's.
-- Coming out of it, the low camera straight behind the postmaster is in the building, and its porch roof would fill the lower half of
-- the picture. They step out to the foot of the porch (4 m: scenes/valley.lua), and within `r` metres of such a door everything within
-- `near` metres of the camera is cut away too (the porch roof, the posts), easing back to the usual 2.5 m as they walk out.
camera.PORCH = { r = 9, near = 6.0 }
camera.NEAR = {}
camera.VIEW_TILT = 0.85    -- the share of the boom's tilt (the stick, a lift over the van) the view takes
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
  cam.px, cam.pz, cam.orbit, cam.tilt, cam.view_yaw = nil, nil, 0, 0, nil
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

-- The boom from the point it hangs on: the eye, and the point looked at (down at `view`, tilted with the boom by VIEW_TILT of
-- its own tilt: the stick's tilt and a lift over the van tilt the view less, so the postmaster stays in the frame's lower middle).
local function boom(C, yaw, pitch, f)
  local s, c = math.sin(yaw), math.cos(yaw)
  local ax, ay, az = f[1] + s * C.ahead, f[2] + C.look, f[3] + c * C.ahead
  local h, d = math.sin(pitch) * C.dist, math.cos(pitch) * C.dist
  local ex, ey, ez = ax - s * d, ay + h, az - c * d
  local v = C.view + (pitch - C.pitch) * camera.VIEW_TILT
  local l = C.dist
  return ex, ey, ez, ex + s * math.cos(v) * l, ey - math.sin(v) * l, ez + c * math.cos(v) * l
end

-- Whether the van's body (a box round it: tools/van.mjs) is between the eye and a point.
local VAN_BOX = { hw = 0.72, z0 = -1.53, z1 = 1.54, h = 1.68 }
local function van_between(v, ex, ey, ez, px, py, pz)
  local sh, ch = math.sin(v.heading), math.cos(v.heading)
  local g = world.height(v.x, v.z)
  local function loc(x, y, z) local dx, dz = x - v.x, z - v.z; return dx * ch - dz * sh, y - g, dx * sh + dz * ch end
  local ax, ay, az = loc(ex, ey, ez)
  local bx, by, bz = loc(px, py, pz)
  local t0, t1 = 0, 1
  for _, k in ipairs({ { ax, bx, -VAN_BOX.hw, VAN_BOX.hw }, { ay, by, -1, VAN_BOX.h }, { az, bz, VAN_BOX.z0, VAN_BOX.z1 } }) do
    local a, b, lo, hi = k[1], k[2], k[3], k[4]
    local d = b - a
    if math.abs(d) < 1e-9 then
      if a < lo or a > hi then return false end
    else
      local u0, u1 = (lo - a) / d, (hi - a) / d
      if u0 > u1 then u0, u1 = u1, u0 end
      t0, t1 = math.max(t0, u0), math.min(t1, u1)
      if t0 > t1 then return false end
    end
  end
  return true
end
camera.van_between = van_between

-- Whether a point is inside the van's body (a box round it, a little fatter: tools/van.mjs), for keeping the eye out of it.
local function inside_van(v, x, y, z, pad)
  local sh, ch = math.sin(v.heading), math.cos(v.heading)
  local dx, dz = x - v.x, z - v.z
  local lx, lz = dx * ch - dz * sh, dx * sh + dz * ch
  local ly = y - world.height(v.x, v.z)
  return math.abs(lx) < VAN_BOX.hw + pad and lz > VAN_BOX.z0 - pad and lz < VAN_BOX.z1 + pad and ly > -1 and ly < VAN_BOX.h + pad
end

local function place(dt, C, x, base, z, look_at, van)
  local pitch = C.pitch + (cam.pitch_off or 0)
  local yaw = cam.yaw
  -- (the point followed eases after the body a touch, so a bump in the path is not a bump in the picture)
  local f = cam.follow
  if not f or not cam.ready then f = { x, base, z }; cam.follow = f
  else
    local k = math.min(1, dt * 12)
    f[1], f[2], f[3] = f[1] + (x - f[1]) * k, f[2] + (base - f[2]) * math.min(1, dt * 6), f[3] + (z - f[3]) * k
  end
  cam.view_yaw = yaw
  local ex, ey, ez, tx, ty, tz = boom(C, yaw, pitch, f)
  local need = math.max(0, world.height(ex, ez) + 1.2 - ey)
  -- (an eye that would be inside the van's body is lifted just over it: the one thing the van moves the camera for)
  if van and inside_van(van, ex, ey, ez, 0.3) then need = math.max(need, world.height(van.x, van.z) + VAN_BOX.h + 0.4 - ey) end
  if not cam.lift or not cam.ready then cam.lift = need
  else cam.lift = cam.lift + (need - cam.lift) * math.min(1, dt * (need > cam.lift and 5 or 1.5)) end
  ey = ey + cam.lift
  camera.set(ex, ey, ez, tx, ty, tz, C.fov, dt)
  cam.see = look_at
end

local FOOT_HEIGHTS = { 0.3, 0.7, 1.05 }
local VAN_HEIGHTS = { 0.5, 1.0, 1.5 }

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
  -- (what is near the eye is cut away too: more by the doors in camera.NEAR)
  local near = 2.5
  for _, n in ipairs(camera.NEAR) do
    local d = math.sqrt((p.x - n[1]) ^ 2 + (p.z - n[2]) ^ 2)
    near = math.max(near, 2.5 + (n.near - 2.5) * smooth(n.r, n.r * 0.5, d))
  end
  place(dt, C, p.x, base, p.z, { p.x, base + 0.5, p.z, radius = 0.85, margin = 0.6, near = near, base = base, heights = FOOT_HEIGHTS }, nova.first("van"))
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
  place(dt, C, v.x, base, v.z, { v.x, base + 1.0, v.z, radius = 1.3, margin = 1.2, near = 4, base = base, heights = VAN_HEIGHTS })
end

-- The office: the fixed view (the room is level, its floor at 0).
function camera.room(dt)
  local R = camera.ROOM
  cam.yaw = math.atan(R.at[1] - R.eye[1], R.at[3] - R.eye[3])
  cam.view_yaw = cam.yaw
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
local SEE = { at = { 0, 0, 0 }, radius = 0.85, margin = 0.6, above = 0.35, near = 2.5, amount = 1 }
-- The see-through cut (the owner, 2026-11-23: "the circle cutout comes on too aggressively. It should only be present when the camera is
-- really blocked by some item"): lines from the eye to three points on the postmaster (or the van) are walked through the scenery that
-- can hide someone (lib/occluders.lua: tree crowns, forest, roofs, the porch; never grass, ferns, bushes, people or the van). Only when
-- two of three are hidden, or the eye itself is inside a crown or a roof, is a small hole (about the postmaster's size on the screen)
-- cut, and only through what lies between: it fades in over CUT.up seconds, and, once the line is clear, holds for CUT.hold seconds
-- (a trunk's edge crossing the line does not flicker it) before fading out over CUT.down.
camera.CUT = { up = 0.2, down = 0.3, hold = 0.25 }
cam.cut, cam.cut_hold, cam.hidden = 0, 99, false
local function cut_amount(dt, s)
  local hidden = false
  if s then
    local e = cam.eye
    hidden = occluders.hides(e[1], e[2], e[3], s[1], s.base, s[3], s.heights) or occluders.inside(e[1], e[2], e[3])
  end
  cam.hidden = hidden
  local K = camera.CUT
  if hidden then cam.cut_hold = 0 else cam.cut_hold = (cam.cut_hold or 99) + dt end
  local want = (hidden or cam.cut_hold < K.hold) and 1 or 0
  if want > cam.cut then cam.cut = math.min(want, cam.cut + dt / K.up) else cam.cut = math.max(want, cam.cut - dt / K.down) end
  return cam.cut
end
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
  local cut = cut_amount(dt or 0, s)
  if s and cut > 0.01 then
    SEE.at[1], SEE.at[2], SEE.at[3] = s[1], s[2], s[3]
    SEE.radius, SEE.margin, SEE.near, SEE.amount = s.radius, s.margin, s.near or 2.5, t * cut
    nova.see_through(SEE)
  else
    nova.see_through()
  end
end

-- Where a world point is on the screen of a `w` x `h` view (the UI's units: nova.view("exact")), as this frame's camera sees it
-- (apply() has set it): x, y, and how far in front of the eye it is in metres; nil when it is behind the eye. A right-handed look-at, the
-- lens's field of view the vertical one.
function camera.project(x, y, z, w, h)
  local e, a = cam.eye, cam.at
  local fx, fy, fz = a[1] - e[1], a[2] - e[2], a[3] - e[3]
  local fl = math.sqrt(fx * fx + fy * fy + fz * fz)
  if fl < 1e-6 then return nil end
  fx, fy, fz = fx / fl, fy / fl, fz / fl
  -- right = forward x up(0, 1, 0), up = right x forward
  local rx, rz = -fz, fx
  local rl = math.sqrt(rx * rx + rz * rz)
  if rl < 1e-6 then return nil end
  rx, rz = rx / rl, rz / rl
  local ux, uy, uz = -rz * fy, rz * fx - rx * fz, rx * fy
  local dx, dy, dz = x - e[1], y - e[2], z - e[3]
  local depth = dx * fx + dy * fy + dz * fz
  if depth < 0.05 then return nil end
  local t = math.tan(math.rad(cam.fov) / 2)
  local sx = w / 2 + (dx * rx + dz * rz) / (depth * t * (w / h)) * (w / 2)
  local sy = h / 2 - (dx * ux + dy * uy + dz * uz) / (depth * t) * (h / 2)
  return sx, sy, depth
end

-- "Forward" and "right" on the ground as this camera sees it (for the stick).
-- (the yaw the picture is seen from)
function camera.forward() local y = cam.view_yaw or cam.yaw; return math.sin(y), math.cos(y) end

return camera

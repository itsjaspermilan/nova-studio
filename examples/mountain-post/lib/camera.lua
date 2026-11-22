-- The two cameras: behind and above the postmaster on foot (the right stick turns it; left alone it swings round behind the way
-- they walk; it comes in rather than go through a wall or a building), and the chase camera behind the van (from Pine Ridge Rally's
-- near view, lib/race.lua: a few metres back and a little above the roof, looking just over the van at the road; the right stick
-- looks round, anywhere it points, and lets go back behind). Going from one to the other the view glides over most of a second.
-- The camera is placed by hand on the valley's hills (nova.terrain lifts what is drawn, not the camera).
local world = require("lib.world")

local camera = {}
local cam = { yaw = 0, eye = { 0, 0, 0 }, at = { 0, 0, 0 }, fov = 58, blend = 1, from = nil, ready = false, boom = 4.6, look = 0, held = nil }
camera.state = cam

function camera.reset(yaw)
  cam.yaw, cam.ready, cam.blend, cam.from, cam.look, cam.held = yaw or 0, false, 1, nil, 0, nil
end

-- The view glides from where it is now to the next one over `seconds`.
function camera.glide(seconds)
  cam.from = { eye = { cam.eye[1], cam.eye[2], cam.eye[3] }, at = { cam.at[1], cam.at[2], cam.at[3] }, fov = cam.fov }
  cam.blend, cam.glide_time = 0, seconds or 0.8
end

local function ground(x, z, indoors) return indoors and 0 or world.height(x, z) end

-- (shortens a boom from the target out to the eye where it would pass through solid scenery: buildings, walls, trunks)
local function clear_boom(tx, tz, dx, dz, len)
  local step = 0.25
  local d = 0.6
  while d < len do
    if nova.scenery.push(tx + dx * d, tz + dz * d, 0.28) then return math.max(0.9, d - 0.3) end
    d = d + step
  end
  return len
end

-- Behind the postmaster. `indoors`: the office (no hills, a low ceiling, a short boom).
function camera.foot(p, dt, indoors)
  local look = nova.input.axis("look_x")
  if math.abs(look) > 0.15 then
    cam.yaw = cam.yaw - look * 2.2 * dt
  elseif p.speed > 0.4 then
    -- swing round behind the way it walks; walking towards the camera it waits a moment first (a step back towards it is not
    -- a turn), then comes round slowly
    local want = p.face
    local diff = (want - cam.yaw + math.pi) % (2 * math.pi) - math.pi
    if math.abs(diff) < 2.4 then
      cam.toward = 0
      cam.yaw = cam.yaw + diff * math.min(1, dt * 1.3)
    else
      cam.toward = (cam.toward or 0) + dt
      if cam.toward > 0.7 then cam.yaw = cam.yaw + (diff > 0 and 1 or -1) * math.min(math.abs(diff), dt * 1.6) end
    end
  end
  local dist = indoors and 2.9 or 3.8
  local height = indoors and 1.55 or 1.75
  local s, c = math.sin(cam.yaw), math.cos(cam.yaw)
  local len = clear_boom(p.x, p.z, -s, -c, dist)
  if indoors and len < 1.3 then height = height + (1.3 - len) * 0.5 end
  local ex, ez = p.x - s * len, p.z - c * len
  -- (in the office the eye stays in the room: through the doorway it would look in from the porch)
  if indoors then ex, ez = math.max(-3.2, math.min(3.2, ex)), math.max(-2.2, math.min(2.35, ez)) end
  local base = ground(p.x, p.z, indoors) + (p.y or 0)
  local ey = base + height * (0.6 + 0.4 * len / dist)
  if not indoors then ey = math.max(ey, ground(ex, ez) + 0.7) end
  if indoors then ey = math.min(ey, 2.3) end
  local tx, ty, tz = p.x + s * 0.6, base + (indoors and 0.65 or 0.8), p.z + c * 0.6
  camera.set(ex, ey, ez, tx, ty, tz, indoors and 66 or 58, dt)
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
  local base = ground(p.x, p.z) + (p.y or 0)
  local ey = math.max(base + 1.4, ground(ex, ez) + 1.0)
  local rb = ground(r.x, r.z) + (r.y or 0)
  camera.set(ex, ey, ez, r.x - ax * 0.2 + nx * 0.35, rb + 0.52, r.z - az * 0.2 + nz * 0.35, 40, dt)
  cam.yaw = math.atan(r.x - ex, r.z - ez)
end

-- Behind the van: the chase view.
function camera.van(v, dt)
  if not cam.ready then cam.heading = v.heading end
  -- the camera's heading trails the van's a little, so a bend is seen coming round
  local diff = (v.heading - (cam.heading or v.heading) + math.pi) % (2 * math.pi) - math.pi
  cam.heading = (cam.heading or v.heading) + diff * math.min(1, dt * 4.5)
  local lx, ly = nova.input.axis("look_x"), nova.input.axis("look_y")
  local push = math.sqrt(lx * lx + ly * ly)
  if push > 0.6 then cam.held = math.atan(-lx, -ly) elseif push < 0.3 then cam.held = nil end
  local want = cam.held or 0
  cam.look = cam.look + ((want - cam.look + math.pi) % (2 * math.pi) - math.pi) * math.min(1, dt * (want ~= 0 and 6 or 3))
  local speed = math.abs(v.speed)
  local back, height = 7.2 + speed * 0.05, 3.3
  local a = cam.heading + cam.look
  local s, c = math.sin(a), math.cos(a)
  local ex, ez = v.x - s * back, v.z - c * back
  local ahead = 6 * math.max(0, 1 - math.abs(cam.look) / 0.9)
  local tx, tz = v.x + math.sin(cam.heading) * ahead, v.z + math.cos(cam.heading) * ahead
  local gv = world.height(v.x, v.z)
  local ey = math.max(gv + height, ground(ex, ez) + 1.4)
  camera.set(ex, ey, ez, tx, world.height(tx, tz) + 1.5, tz, 60 + speed * 0.25, dt)
  cam.yaw = cam.heading
end

-- A fixed view (the title, a view over the gorge).
function camera.set(ex, ey, ez, tx, ty, tz, fov, dt)
  if cam.ready and cam.smooth_to then
    local k = math.min(1, (dt or 0) * 10)
    ex, ey, ez = cam.eye[1] + (ex - cam.eye[1]) * k, cam.eye[2] + (ey - cam.eye[2]) * k, cam.eye[3] + (ez - cam.eye[3]) * k
  end
  cam.want = { ex, ey, ez, tx, ty, tz, fov }
  cam.ready = true
end

-- Puts the view on the screen (from draw): the glide between two views, eased.
function camera.apply(dt)
  -- (a view pinned by the gallery's routes, for the face sheets and film strips; the game never pins one)
  if camera.pinned then return nova.camera(table.unpack(camera.pinned)) end
  local w = cam.want
  if not w then return end
  local ex, ey, ez, tx, ty, tz, fov = w[1], w[2], w[3], w[4], w[5], w[6], w[7]
  if cam.from and cam.blend < 1 then
    cam.blend = math.min(1, cam.blend + (dt or 0) / cam.glide_time)
    local t = cam.blend * cam.blend * (3 - 2 * cam.blend)
    local f = cam.from
    ex, ey, ez = f.eye[1] + (ex - f.eye[1]) * t, f.eye[2] + (ey - f.eye[2]) * t, f.eye[3] + (ez - f.eye[3]) * t
    tx, ty, tz = f.at[1] + (tx - f.at[1]) * t, f.at[2] + (ty - f.at[2]) * t, f.at[3] + (tz - f.at[3]) * t
    fov = f.fov + (fov - f.fov) * t
  end
  cam.eye[1], cam.eye[2], cam.eye[3] = ex, ey, ez
  cam.at[1], cam.at[2], cam.at[3] = tx, ty, tz
  cam.fov = fov
  nova.camera(ex, ey, ez, tx, ty, tz, fov)
end

-- "Forward" and "right" on the ground as this camera sees it (for the stick).
function camera.forward() return math.sin(cam.yaw), math.cos(cam.yaw) end

return camera

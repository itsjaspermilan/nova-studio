-- The cameras. On foot outdoors: high and well back behind the postmaster, looking down on a small character in a diorama (the
-- owner, after the second pictures: "zoom out the camera and raise a bit to make the world feel a little smaller"); the right stick
-- turns it; left alone it swings round behind the way they walk. Driving: the chase camera behind the van (from Pine Ridge Rally's
-- near view, lib/race.lua), raised a little in keeping. Indoors: one fixed view from high over the cut-away front wall, looking
-- down at the whole room ("when in a building, we should just have a simple top down view like Animal Crossing"); it never turns.
-- Nothing may come between a camera and what it looks at: the boom comes in where a building, a wall, a trunk, a tree's crown or
-- the hill is in the way (nova.solid.sightline), and where the van's body is (its three circles, up to its roof). Going from one
-- view to another the view glides over a moment, along a straight line between two places that are both clear.
-- The camera is placed by hand on the valley's hills (nova.terrain lifts what is drawn, not the camera).
local world = require("lib.world")

local camera = {}
local cam = { yaw = 0, eye = { 0, 0, 0 }, at = { 0, 0, 0 }, fov = 40, blend = 1, from = nil, ready = false, look = 0, held = nil, boom = nil }
camera.state = cam

-- On foot outdoors: how far back and how high (metres), what it looks at, its field of view
camera.FOOT = { back = 7.0, up = 4.9, look = 0.55, fov = 40, ahead = 0.4 }
-- The chase view behind the van
camera.VAN = { back = 6.4, up = 3.3, look = 1.05, ahead = 5, fov = 58 }
-- The office: one fixed view from high over the cut-away front wall (+z) at the middle of the room
camera.ROOM = { eye = { 0, 8.4, 7.4 }, at = { 0, 0.15, -0.15 }, fov = 33 }

function camera.reset(yaw)
  cam.yaw, cam.ready, cam.blend, cam.from, cam.look, cam.held, cam.boom = yaw or 0, false, 1, nil, 0, nil, nil
end

-- The view glides from where it is now to the next one over `seconds`.
function camera.glide(seconds)
  cam.from = { eye = { cam.eye[1], cam.eye[2], cam.eye[3] }, at = { cam.at[1], cam.at[2], cam.at[3] }, fov = cam.fov }
  cam.blend, cam.glide_time = 0, seconds or 0.8
end

-- How far along the line from (tx, ty, tz) by the unit (dx, dy, dz) the view is clear, up to `len`: the first solid thing
-- (buildings, walls, trunks, tree crowns, hills) or the van's body.
function camera.clear_to(tx, ty, tz, dx, dy, dz, len)
  local d = len
  -- (the solid scenery stands in the ground's own frame, its heights above the ground under it, as it is drawn lifted by the hills:
  -- the ray is cast there, from the same height above the ground as the point it starts from)
  local hit = nova.solid.sightline(tx, ty - nova.terrain_height(tx, tz), tz, dx, dy, dz, len)
  if hit and hit < d then d = hit end
  local v = nova.first("van")
  if v and v.BODY then
    local s, c = math.sin(v.heading), math.cos(v.heading)
    local top = world.height(v.x, v.z) + 2.15
    local t = 0.3
    while t < d do
      local x, y, z = tx + dx * t, ty + dy * t, tz + dz * t
      if y < top then
        for _, off in ipairs(v.BODY.offs) do
          local cx, cz = v.x + s * off, v.z + c * off
          if (x - cx) ^ 2 + (z - cz) ^ 2 < (v.BODY.r + 0.2) ^ 2 then d = t; break end
        end
      end
      t = t + 0.2
    end
  end
  return d
end

-- (the boom's length eases back out after something made it come in, and comes in at once)
local function ease_boom(want, dt)
  if not cam.boom or want < cam.boom or not cam.ready then cam.boom = want
  else cam.boom = cam.boom + (want - cam.boom) * math.min(1, (dt or 0) * 2.5) end
  return cam.boom
end

-- Behind and high over the postmaster, outdoors.
function camera.foot(p, dt)
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
      cam.yaw = cam.yaw + diff * math.min(1, dt * 1.1)
    else
      cam.toward = (cam.toward or 0) + dt
      if cam.toward > 0.7 then cam.yaw = cam.yaw + (diff > 0 and 1 or -1) * math.min(math.abs(diff), dt * 1.4) end
    end
  end
  local F = camera.FOOT
  local s, c = math.sin(cam.yaw), math.cos(cam.yaw)
  local base = world.height(p.x, p.z) + (p.y or 0) - world.lift(p.x, p.z)
  local tx, ty, tz = p.x + s * F.ahead, base + F.look, p.z + c * F.ahead
  -- the boom from what it looks at up and back to the eye
  local bx, by, bz = -s * F.back, F.up - F.look, -c * F.back
  local blen = math.sqrt(bx * bx + by * by + bz * bz)
  local len = ease_boom(math.max(1.6, camera.clear_to(tx, ty, tz, bx / blen, by / blen, bz / blen, blen) - 0.35), dt)
  local k = len / blen
  local ex, ey, ez = tx + bx * k, ty + by * k, tz + bz * k
  ey = math.max(ey, world.height(ex, ez) + 0.8)
  camera.set(ex, ey, ez, tx, ty, tz, F.fov, dt)
end

-- The office: the fixed view (the room is level, its floor at 0).
function camera.room(dt)
  local R = camera.ROOM
  cam.yaw = math.atan(R.at[1] - R.eye[1], R.at[3] - R.eye[3])
  camera.set(R.eye[1], R.eye[2], R.eye[3], R.at[1], R.at[2], R.at[3], R.fov, dt)
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
  cam.yaw = math.atan(r.x - ex, r.z - ez)
  cam.boom = nil
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
  local V = camera.VAN
  local back = V.back + speed * 0.05
  local a = cam.heading + cam.look
  local s, c = math.sin(a), math.cos(a)
  local gv = world.height(v.x, v.z)
  local ahead = V.ahead * math.max(0, 1 - math.abs(cam.look) / 0.9)
  local tx, tz = v.x + math.sin(cam.heading) * ahead, v.z + math.cos(cam.heading) * ahead
  local ty = world.height(tx, tz) + V.look
  -- (trees and buildings between the van and the eye bring the eye in; the van itself is what it looks past, not into)
  local ex0, ey0, ez0 = v.x - s * back, gv + V.up, v.z - c * back
  local ox, oy, oz = v.x, gv + 2.3, v.z
  local bx, by, bz = ex0 - ox, ey0 - oy, ez0 - oz
  local blen = math.sqrt(bx * bx + by * by + bz * bz)
  -- (what is solid brings it in; a tree's crown only when the eye would be in it: a crown wholly between, passing for a moment in a
  -- bend, is let be, rather than the view diving in behind the van)
  local oh = oy - nova.terrain_height(ox, oz)
  local hit = nova.solid.raycast(ox, oh, oz, bx / blen, by / blen, bz / blen, blen) or blen
  local crown = nova.solid.sightline(ox, oh, oz, bx / blen, by / blen, bz / blen, blen)
  if crown and crown < hit then
    -- (looking back from the eye: no crown, or one right at the eye, means the eye is in the foliage)
    local ex0h = ey0 - nova.terrain_height(ex0, ez0)
    local back = nova.solid.sightline(ex0, ex0h, ez0, -bx / blen, -by / blen, -bz / blen, blen)
    if not back or back < 1.0 then hit = crown end
  end
  local len = ease_boom(math.max(2.4, hit - 0.35), dt)
  local ex, ey, ez = ox + bx * len / blen, oy + by * len / blen, oz + bz * len / blen
  ey = math.max(ey, world.height(ex, ez) + 1.2)
  camera.set(ex, ey, ez, tx, ty, tz, V.fov + speed * 0.25, dt)
  cam.yaw = cam.heading
end

-- A fixed view (the title, a view over the gorge).
function camera.set(ex, ey, ez, tx, ty, tz, fov, dt)
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

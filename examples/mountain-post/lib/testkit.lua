-- Small helpers for the play routes and tests (crates/nova-runtime/tests/mountain_post.rs, tools/routes/*.json): they lead the
-- postmaster and drive the van the way a player would, by setting where the postmaster walks and giving the van the autopilot.
-- Nothing in the game uses them.
local testkit = {}

-- In the office: take a parcel from the shelf (walk to it, A, close the label).
function testkit.shelf_spot(item)
  local it = nova.named("parcel_" .. item) or nova.named("postmaster")
  return { it.x - 0.65, it.z }
end

-- In the valley: walk round the van to a resident, or to a spot by the van's back or door.
function testkit.lead(name) nova.scene_now():lead_to(name) end
function testkit.to_van(where)
  local s = nova.scene_now()
  local x, z = s:van_point(where == "back" and s.BACK or s.DOOR)
  local p = nova.named("postmaster")
  -- (round the van's nose or tail, whichever side the postmaster is on, then to the spot)
  local lx, lz = s:van_point({ 2.0, 0, -2.6 })
  p.walk_path = { { lx, lz }, { x, z } }
  p.walk_to = nil
  p.walk_pace = 2.8 -- (a run, or a trot with a parcel: the tests hurry)
end
-- In the valley: the postmaster straight into the van's seat or out beside it (a test's or a picture's shortcut; the game does the
-- same on B at the doorway).
function testkit.board() nova.scene_now():get_in() end
function testkit.walking() local p = nova.named("postmaster"); return p.walk_to ~= nil or #(p.walk_path or {}) > 0 end
function testkit.drive(place) nova.named("van").autopilot = require("lib.autopilot").to(place) end
function testkit.arrived() local v = nova.named("van"); return v.autopilot ~= nil and v.autopilot.done end

-- To the office's door from wherever the postmaster stands in the yard: up the porch steps.
function testkit.to_office()
  local d = nova.named("office_door")
  local fx, fz = math.sin(d.ry or 0), math.cos(d.ry or 0)
  local p = nova.named("postmaster")
  -- (round the back of the van first, if it is parked in the way)
  local bx, bz = nova.scene_now():van_point({ 0, 0, -2.9 })
  p.walk_path = { { bx, bz }, { d.x + fx * 4.5, d.z + fz * 4.5 }, { d.x + fx * 0.2, d.z + fz * 0.2 } }
  p.walk_to = nil
  p.walk_pace = 2.8 -- (a run, or a trot with a parcel: the tests hurry)
end

-- How fast (m/s, the clip played at its own pace) the ankles of a walk-like clip move back under the body, on average over a cycle:
-- the chibi's legs swing like pendulums (no foot is lifted), so in each half of the cycle one ankle goes back as far as the other comes
-- forward, and the one going back is the one standing. The sole rolls from heel to toe as well, so the speed at which the clip does not
-- slide is a little more than this (character3d_make's own walk, which it said was slide-free at 0.767 m/s, measures 0.629: 0.82 of it).
-- Also the clip's length.
function testkit.foot_speed(model, clip)
  local dur
  for _, c in ipairs(nova.model_clips(model)) do if c.name == clip then dur = c.duration end end
  local n, back, prev = 240, 0, nil
  for i = 0, n do
    local pose = nova.model_pose(model, { clip = clip, time = dur * i / n })
    local zl, zr = pose.foot_l.z, pose.foot_r.z
    if prev then back = back + math.max(0, prev[1] - zl) + math.max(0, prev[2] - zr) end
    prev = { zl, zr }
  end
  return back / dur, dur
end

-- Smoothness, frame to frame (the owner: "If I just walk around in a circle, there is quite a bit of stutter"): called after every
-- frame, it keeps the largest change of each step from the step before (the postmaster's position, the camera's eye, the camera's
-- heading) in testkit.worst, and says whether this frame stayed under `limits` ({ body = m, eye = m, yaw = rad }).
testkit.worst = { body = 0, eye = 0, yaw = 0 }
function testkit.smooth_step(limits)
  local p, c = nova.named("postmaster"), require("lib.camera").state
  local s = { p.x, p.z, c.eye[1], c.eye[2], c.eye[3], c.yaw }
  local o, ok = testkit.prev, true
  if o then
    local d = {}
    for i = 1, 6 do d[i] = s[i] - o[i] end
    d[6] = (d[6] + math.pi) % (2 * math.pi) - math.pi
    local e = testkit.step
    if e then
      local w = testkit.worst
      local body = math.sqrt((d[1] - e[1]) ^ 2 + (d[2] - e[2]) ^ 2)
      local eye = math.sqrt((d[3] - e[3]) ^ 2 + (d[4] - e[4]) ^ 2 + (d[5] - e[5]) ^ 2)
      local yaw = math.abs(d[6] - e[6])
      w.body, w.eye, w.yaw = math.max(w.body, body), math.max(w.eye, eye), math.max(w.yaw, yaw)
      ok = body <= limits.body and eye <= limits.eye and yaw <= limits.yaw
    end
    testkit.step = d
  end
  testkit.prev = s
  return ok
end

return testkit

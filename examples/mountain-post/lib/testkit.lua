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
  local x, z = s:van_point(where == "back" and { 0, 0, -2.75 } or { 1.35, 0, 0.55 })
  local p = nova.named("postmaster")
  -- (round the van's nose or tail, whichever side the postmaster is on, then to the spot)
  local lx, lz = s:van_point({ 2.8, 0, -3.4 })
  p.walk_path = { { lx, lz }, { x, z } }
  p.walk_to = nil
end
function testkit.walking() local p = nova.named("postmaster"); return p.walk_to ~= nil or #(p.walk_path or {}) > 0 end
function testkit.drive(place) nova.named("van").autopilot = require("lib.autopilot").to(place) end
function testkit.arrived() local v = nova.named("van"); return v.autopilot ~= nil and v.autopilot.done end

-- To the office's door from wherever the postmaster stands in the yard: up the porch steps.
function testkit.to_office()
  local d = nova.named("office_door")
  local fx, fz = math.sin(d.ry or 0), math.cos(d.ry or 0)
  local p = nova.named("postmaster")
  -- (round the back of the van first, if it is parked in the way)
  local bx, bz = nova.scene_now():van_point({ 0, 0, -3.8 })
  p.walk_path = { { bx, bz }, { d.x + fx * 4.5, d.z + fz * 4.5 }, { d.x + fx * 0.2, d.z + fz * 0.2 } }
  p.walk_to = nil
end

return testkit

-- A driver for tests and for taking pictures (never for the player): it follows the roads' middle lines from where the van is to
-- one of the slice's places, at an easy speed, and stops there. `autopilot.to("hazel")` gives one to set as `van.autopilot`; the
-- valley then takes its pedals and wheel from it instead of from the pad.
local world = require("lib.world")

local autopilot = {}

-- (the roads to each place, in order: a road's id and whether it is driven from its start to its end)
local ROUTES = {
  hazel = { { "post_road", 1 }, { "fern_lane", 1 } },
  pip = { { "post_road", 1 }, { "kettle_creek_road", 1 } },
  post_office = { { "post_road", -1 } },
  bridge_out = { { "post_road", 1 } },
}
local FROM = { hazel = { "kettle_creek_road", "fern_lane" }, pip = { "fern_lane", "kettle_creek_road" } }

local function road(id) for _, r in ipairs(world.roads) do if r.id == id then return r end end end

local function nearest_index(pts, x, z)
  local best, bi = math.huge, 1
  for i, p in ipairs(pts) do
    local d = (p[1] - x) ^ 2 + (p[2] - z) ^ 2
    if d < best then best, bi = d, i end
  end
  return bi
end

-- The path from the van to `place` along the roads (a list of { x, z }); when the van is on a lane, first back along it to Post Road.
function autopilot.path(van, place)
  local pts = {}
  local legs = {}
  -- on a lane: back down it first
  local r = world.nearest("road", van.x, van.z)
  if r and r.id ~= "post_road" then legs[#legs + 1] = { r.id, -1 } end
  for _, leg in ipairs(ROUTES[place]) do legs[#legs + 1] = leg end
  local x, z = van.x, van.z
  for k, leg in ipairs(legs) do
    local line = road(leg[1]).points
    local i0 = nearest_index(line, x, z)
    local i1
    if k < #legs and leg[2] < 0 then
      i1 = 1 -- (back down a lane to the road it leaves)
    elseif k < #legs then
      local next_line = road(legs[k + 1][1]).points
      -- where the next road leaves this one: its own start (or end, driven backwards)
      local join = legs[k + 1][2] > 0 and next_line[1] or next_line[#next_line]
      i1 = nearest_index(line, join[1], join[2])
    else
      i1 = leg[2] > 0 and #line or 1
      if place == "post_office" then i1 = nearest_index(line, 3.5, -181) end
    end
    local step = i1 >= i0 and 1 or -1
    for i = i0, i1, step do pts[#pts + 1] = line[i] end
    x, z = line[i1][1], line[i1][2]
  end
  return pts
end

function autopilot.to(place, opts)
  opts = opts or {}
  local ap = { place = place, done = false, i = 1, speed = opts.speed or 12 }
  function ap:steer(van, dt)
    if not self.pts then self.pts = autopilot.path(van, self.place) end
    local pts = self.pts
    -- the point a few metres ahead on the path
    while self.i < #pts and (pts[self.i][1] - van.x) ^ 2 + (pts[self.i][2] - van.z) ^ 2 < 7 * 7 do self.i = self.i + 1 end
    local t = pts[self.i]
    local dx, dz = t[1] - van.x, t[2] - van.z
    local want = math.atan(dx, dz)
    local diff = (want - van.heading + math.pi) % (2 * math.pi) - math.pi
    local last = pts[#pts]
    local left = math.sqrt((last[1] - van.x) ^ 2 + (last[2] - van.z) ^ 2)
    local target = math.min(self.speed, 3 + left * 0.45) * (1 - math.min(0.6, math.abs(diff)))
    if self.i >= #pts and left < 5 then target = 0 end
    -- facing away: a three-point turn, as a driver does on a lane: back with the wheel one way, forward with it the other, again,
    -- each leg until it has gone a little way or meets something, until the van faces along the road
    if math.abs(diff) > 1.7 or (self.turning and math.abs(diff) > 0.45) then
      if not self.turning then
        self.turning, self.phase, self.phase_t = true, "back", 0
        -- (which way round: backing with the wheel to the right swings the tail right; when the road lies straight behind, the tail
        -- goes to the side with more room: no wall, no water, no trees there)
        local function room(side)
          -- how far the tail can swing out to that side, back and across, before it meets a wall, a tree or the water (or would
          -- leave the road's verge for the grass beyond: a lane's own wall runs along it)
          local n = 0
          local sh, ch = math.sin(van.heading), math.cos(van.heading)
          for _, back in ipairs({ 1, 3, 5 }) do
            for d = 1, 7 do
              local x, z = van.x - sh * back - ch * side * d, van.z - ch * back + sh * side * d
              local r, dr = world.nearest("road", x, z)
              if world.blocked(x, z, 0.6) or nova.scenery.push(x, z, 0.6) or not r or dr > r.width / 2 + 4 then break end
              n = n + 1
            end
          end
          return n
        end
        self.way = math.abs(diff) > 2.5 and (room(1) >= room(-1) and 1 or -1) or (diff > 0 and 1 or -1)
      end
      self.phase_t = self.phase_t + (dt or 1 / 60)
      local s = self.way
      if self.phase == "back" then
        van.ctl.steer = s
        if van.speed > 0.3 then van.ctl.go, van.ctl.brake, van.ctl.steer = 0, 1, 0 else van.ctl.go, van.ctl.brake = 0, van.speed < -2 and 0 or 0.6 end
      else
        van.ctl.steer = -s
        if van.speed < -0.3 then van.ctl.go, van.ctl.brake, van.ctl.steer = 1, 0, 0 else van.ctl.go, van.ctl.brake = van.speed > 2 and 0 or 0.5, 0 end
      end
      if self.phase_t > 2.4 or (self.phase_t > 0.7 and math.abs(van.speed) < 0.15) then
        self.phase, self.phase_t = self.phase == "back" and "fwd" or "back", 0
      end
      return
    end
    self.turning = false
    van.ctl.steer = math.max(-1, math.min(1, -diff * 2.2))
    if van.speed < target - 0.3 then van.ctl.go, van.ctl.brake = math.min(1, (target - van.speed) * 0.6 + 0.2), 0
    elseif van.speed > target + 0.5 then van.ctl.go, van.ctl.brake = 0, math.min(1, (van.speed - target) * 0.4)
    else van.ctl.go, van.ctl.brake = 0.15, 0 end
    if target == 0 and van:stopped() then
      van.ctl.go, van.ctl.brake, van.ctl.steer = 0, 0, 0
      self.done = true
    end
  end
  return ap
end

return autopilot

-- The race. The course is scenes/race.scene.json (scene_write): the land, the road, the car on the start line, the props, and
-- the `checkpoint` markers the road was made through (road_make's control points), each with its `order`. This file follows the
-- car with the camera, finds the road from the markers, counts laps and draws the lap times.
local Race = nova.scene {}

-- The road's middle line: the same curve road_make laid the road along (a Catmull-Rom spline through the markers in order),
-- as a point every 2 m.
local function catmull(p0, p1, p2, p3, t)
  local t2, t3 = t * t, t * t * t
  local function k(a, b, c, d) return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3) end
  return k(p0.x, p1.x, p2.x, p3.x), k(p0.z, p1.z, p2.z, p3.z)
end

function Race:enter()
  nova.light { dir = { -0.5, -1, 0.35 }, color = { 255, 246, 228 }, ambient = { 104, 116, 140 } }
  nova.shadows { radius = 30, strength = 0.75 }
  nova.sky { top = { 74, 132, 214 }, horizon = { 200, 222, 238 } }
  nova.fog { color = { 200, 222, 238 }, near = 90, far = 260 }
  nova.look { ao = 0.4, saturation = 1.05, vignette = 0.12 }
  local marks = nova.all("checkpoint")
  table.sort(marks, function(a, b) return a.order < b.order end)
  self.line, self.length = {}, 0
  local n = #marks
  for i = 1, n do
    local p0, p1, p2, p3 = marks[(i - 2) % n + 1], marks[i], marks[i % n + 1], marks[(i + 1) % n + 1]
    for s = 0, 39 do
      local x, z = catmull(p0, p1, p2, p3, s / 40)
      local last = self.line[#self.line]
      if last then self.length = self.length + math.sqrt((x - last.x) ^ 2 + (z - last.z) ^ 2) end
      self.line[#self.line + 1] = { x = x, z = z, s = self.length }
    end
  end
  local first, last = self.line[1], self.line[#self.line]
  self.length = self.length + math.sqrt((first.x - last.x) ^ 2 + (first.z - last.z) ^ 2)
  self.car = nova.named("car")
  self.laps, self.lap_time, self.best, self.last_s, self.halfway = 0, 0, nil, 0, false
end

--- The point of the middle line nearest x, z: its index and how far it is.
function Race:nearest(x, z)
  local best, at = math.huge, 1
  for i, p in ipairs(self.line) do
    local d = (p.x - x) ^ 2 + (p.z - z) ^ 2
    if d < best then best, at = d, i end
  end
  return at, math.sqrt(best)
end

--- On the road: within 6 m of its middle (the road is 12 m across, its verges included).
function Race:on_road(x, z)
  local _, d = self:nearest(x, z)
  return d < 6
end

--- The point of the middle line `metres` further along from where x, z is nearest.
function Race:ahead(x, z, metres)
  local i = self:nearest(x, z)
  local n = #self.line
  local p = self.line[(i - 1 + math.floor(metres / (self.length / n))) % n + 1]
  return p.x, p.z
end

function Race:update(dt)
  local car = self.car
  if not car then return end
  nova.cam3.follow(car, { distance = 7.5, height = 2.6, look_height = 1.0, fov = 60, smooth = self.started and 6 or 0, behind = 2.5, dt = dt })
  self.started = true
  -- laps: once round the middle line, past half way and back over the start
  self.lap_time = self.lap_time + dt
  local s = self.line[self:nearest(car.x, car.z)].s
  if s > self.length * 0.45 and s < self.length * 0.55 then self.halfway = true end
  if self.halfway and self.last_s > self.length * 0.8 and s < self.length * 0.2 then
    self.laps = self.laps + 1
    if not self.best or self.lap_time < self.best then self.best = self.lap_time end
    nova.log(string.format("lap %d in %.2f s", self.laps, self.lap_time))
    self.lap_time, self.halfway = 0, false
  end
  self.last_s = s
end

function Race:draw_ui()
  local w = nova.view()
  local car = self.car
  nova.ui.text(24, 20, string.format("Lap %d   %.1f s", self.laps + 1, self.lap_time), { size = 26, shadow = true, color = { 240, 248, 255 } })
  if self.best then nova.ui.text(24, 52, string.format("Best %.2f s", self.best), { size = 22, shadow = true, color = { 255, 230, 150 } }) end
  if car then nova.ui.text(w - 220, 20, string.format("%3d km/h  %d", math.floor(car.speed * 3.6), car.gear), { size = 26, shadow = true, color = { 240, 248, 255 } }) end
end

return Race

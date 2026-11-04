local Scene = nova.scene {}

local TILE = 6 -- metres a city tile is across (the kit's tile is one unit)
local PHASE_SECONDS = 6
local WARMUP = 3 -- seconds before the numbers are read

-- what each phase draws: a city of n by n tiles, cars, animated characters, point lights, the sun's shadows
local PHASES = {
  { name = "sky only", n = 0 },
  { name = "city 12x12", n = 12 },
  { name = "city 24x24", n = 24 },
  { name = "city 48x48", n = 48 },
  { name = "city 24 + 200 cars", n = 24, cars = 200 },
  { name = "city 24 + 100 characters", n = 24, chars = 100 },
  { name = "city 24 + 16 lights", n = 24, lights = 16 },
  { name = "city 24 + shadows", n = 24, shadows = true },
  { name = "street level, city 48", n = 48, street = true },
  { name = "worst: 48 + 300 cars + 200 chars + lights + shadows", n = 48, cars = 300, chars = 200, lights = 16, shadows = true },
}

local BUILDINGS = { "building-a", "building-b", "building-c", "building-d", "building-skyscraper-a", "building-skyscraper-b" }
local CARS = { "sedan", "taxi", "suv", "van" }

-- a small deterministic random, so that every run draws the same city
local function lcg(seed)
  local s = seed
  return function(n)
    s = (s * 1103515245 + 12345) % 2147483648
    return s % n + 1
  end
end

function Scene:enter()
  self.phase_i, self.t = 0, 0
  self.results = {}
  self:next_phase()
end

function Scene:next_phase()
  self.phase_i = self.phase_i + 1
  self.phase = PHASES[self.phase_i]
  self.t = 0
  if not self.phase then
    self.done = true
    local worst_fps = 1e9
    for _, r in ipairs(self.results) do worst_fps = math.min(worst_fps, r.fps) end
    nova.log(string.format("bench: done phases=%d worst_fps=%.1f", #self.results, worst_fps))
    return
  end
  local p = self.phase
  local n = p.n
  -- the city: roads on every third line, a building on every other tile
  local rnd = lcg(7)
  self.tiles = {}
  for i = 0, n - 1 do
    for j = 0, n - 1 do
      local x, z = (i - n / 2) * TILE, (j - n / 2) * TILE
      if i % 3 == 0 or j % 3 == 0 then
        self.tiles[#self.tiles + 1] = { (i % 3 == 0 and j % 3 == 0) and "road-crossroad" or "road-straight", x, z, (i % 3 == 0 and j % 3 ~= 0) and math.pi / 2 or 0, 1 }
      else
        self.tiles[#self.tiles + 1] = { BUILDINGS[rnd(#BUILDINGS)], x, z, (rnd(4) - 1) * math.pi / 2, 1 }
      end
    end
  end
  self.cars = {}
  for c = 1, p.cars or 0 do
    local lane = (rnd(math.max(1, n // 3)) - 1) * 3
    self.cars[c] = { CARS[rnd(#CARS)], lane, rnd(1000) / 1000, rnd(2) == 1 }
  end
  self.chars = p.chars or 0
  nova.light { dir = { -0.4, -0.8, -0.3 }, color = { 255, 245, 225 }, ambient = { 95, 100, 120 } }
  nova.sky { top = { 70, 130, 220 }, horizon = { 190, 220, 245 }, clouds = 0.4 }
  nova.fog { color = { 190, 220, 245 }, near = 70, far = 200 }
  if p.shadows then nova.shadows { radius = 40, strength = 0.5 } else nova.shadows(nil) end
end

function Scene:update(dt)
  if self.done then return end
  self.t = self.t + dt
  if self.t >= WARMUP and not self.read and nova.perf().fps > 0 then
    self.read = true
    local m = nova.perf()
    local r = { name = self.phase.name, fps = m.fps }
    self.results[#self.results + 1] = r
    nova.log(string.format("bench: phase=%s fps=%.1f p95=%.2f max=%.2f lua=%.2f render=%.2f gpu=%.2f draws=%d tris=%d culled=%d", self.phase.name, m.fps, m.frame_p95_ms, m.frame_max_ms, m.lua_ms, m.render_ms, m.gpu_ms, m.draws, m.triangles, m.culled))
  end
  if self.t >= PHASE_SECONDS then
    self.read = false
    self:next_phase()
  end
end

function Scene:draw()
  if self.done then
    nova.camera(0, 30, 60, 0, 0, 0, 60)
    return
  end
  local p, t = self.phase, self.t
  local n = p.n
  -- the camera: round the city, or along a road at street level
  if p.street then
    nova.camera(-n * TILE / 2 + t * 12, 2.2, 0.6, -n * TILE / 2 + t * 12 + 20, 2, 0.6, 70)
  else
    local a = t * 0.3
    local radius = math.max(30, n * TILE * 0.3)
    nova.camera(math.sin(a) * radius, 28, math.cos(a) * radius, 0, 0, 0, 60)
  end
  for _, tile in ipairs(self.tiles) do nova.model(tile[1], tile[2], 0, tile[3], { scale = TILE, ry = tile[4] }) end
  for _, c in ipairs(self.cars) do
    local along = ((c[3] + t * 0.02 * (c[4] and 1 or -1)) % 1) * n * TILE - n * TILE / 2
    nova.model(c[1], (c[2] - n / 2) * TILE + (c[4] and 1.2 or -1.2), 0.3, along, { scale = TILE * 0.4, ry = c[4] and 0 or math.pi })
  end
  for i = 1, self.chars do
    local a = i * 0.7
    nova.model("character-oobi", math.sin(a) * (6 + i * 0.3), 0, math.cos(a) * (6 + i * 0.3), { scale = 1.8, clip = "walk", time = t + i * 0.13, ry = a })
  end
  for i = 1, (p.lights or 0) do
    local a = i * 0.4 + t * 0.2
    nova.point_light(math.sin(a) * 18, 4, math.cos(a) * 18, { radius = 12, color = { 255, 200 - i * 6, 120 } })
  end
end

function Scene:draw_ui()
  local w = nova.view()
  local m = nova.perf()
  local text = self.done and "benchmark done: see the log" or string.format("%s   %.0f fps", self.phase.name, m.fps)
  nova.ui.text(16, 28, text, { size = 22, color = { 255, 255, 255 }, shadow = true })
end

return Scene

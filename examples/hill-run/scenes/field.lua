local state = require("lib.state")
local level = require("lib.level")
local max, min = math.max, math.min

local Scene = nova.scene {}

GOAL_GEMS = 3 -- gems the flag asks for

function Scene:enter()
  state.reset()
  self.paused = false
  nova.solid.clear()
  local t0 = nova.clock()
  nova.solid.add("hills", 0, 0, 0)
  nova.log(string.format("hill: %d solid triangles made in %.0f ms", nova.solid.count(), (nova.clock() - t0) * 1000))
  nova.sky { top = { 80, 140, 225 }, horizon = { 200, 225, 245 }, sun = { 0.4, 0.8, 0.3 }, clouds = 0.5 }
  nova.light { dir = { -0.45, -0.8, -0.35 }, color = { 255, 245, 225 }, ambient = { 100, 106, 125 } }
  nova.fog { color = { 200, 225, 245 }, near = 90, far = 230 }
  state.shadows = true
  nova.shadows { radius = 42, strength = 0.55 } -- the sun'"'"'s shadows round the player (grass and flowers cast none)
  nova.wind { direction = 25, strength = 1.0 }
  self.look_mode = state.look_mode or 3
  self:apply_look()
  self:plant()
  for _, g in ipairs(level.gems) do nova.spawn("gem", g.x, 0, { z = g.z, gy = g.y }) end
  state.total = #level.gems
  nova.spawn("flag", level.flag.x, level.flag.y, { z = level.flag.z })
  nova.spawn("player", level.start.x, level.start.y, { z = level.start.z })
  state.say("X jump (again in the air: glide)   hold B: sprint   walk into a steep wall: climb", 6)
end

-- Grass, flowers, bushes and trees over the field: kept in Rust by nova.scenery, drawn near the camera, bent by the wind. None of it
-- is solid (the capsule walks through it; a tree would need a trunk collider of its own).
function Scene:plant()
  self.plant_t0, self.planted, self.jobs = nova.clock(), {}, {}
  local function clear(x, z) -- not on the stairs, the platform, the blocks or the tower
    for _, b in ipairs(level.boxes) do
      if x > b[1] - 0.8 and x < b[3] + 0.8 and z > b[2] - 0.8 and z < b[4] + 0.8 then return false end
    end
    return true
  end
  local function job(model, count, opts)
    for i = 1, math.ceil(count / 2500) do
      local o = {}
      for k, v in pairs(opts) do o[k] = v end
      o.count, o.seed = math.min(2500, count - (i - 1) * 2500), (opts.seed or 1) * 100 + i
      self.jobs[#self.jobs + 1] = { model, o }
    end
  end
  job("grass", 30000, { area = { -78, -78, 78, 78 }, seed = 3, scale = { 0.8, 1.5 }, min_normal_y = 0.82,
    sway = 0.55, max_distance = 55, shadow = false, filter = clear, tints = { { 255, 255, 255 }, { 232, 255, 220 }, { 255, 246, 205 } } })
  job("flowers", 2500, { area = { -78, -78, 78, 78 }, seed = 5, scale = { 0.9, 1.3 }, min_normal_y = 0.85,
    sway = 0.4, max_distance = 45, shadow = false, filter = clear })
  job("bush", 260, { area = { -78, -78, 78, 78 }, seed = 7, scale = { 0.9, 1.8 }, min_normal_y = 0.8,
    sway = 0.04, max_distance = 120, filter = function(x, z, y) return clear(x, z) and (x * x + z * z) > 36 end })
  job("pine", 170, { area = { -78, -78, 78, 78 }, seed = 9, scale = { 0.9, 1.7 }, min_normal_y = 0.9,
    sway = 0.03, filter = function(x, z, y) return clear(x, z) and (x * x + z * z) > 100 and y < 26 end })
  job("birch", 90, { area = { -78, -78, 78, 78 }, seed = 13, scale = { 0.9, 1.5 }, min_normal_y = 0.9,
    sway = 0.035, filter = function(x, z, y) return clear(x, z) and (x * x + z * z) > 100 and y < 14 end })
end

-- (a script that runs too long in one frame is stopped, so the planting is done a little each frame: the field fills in over a quarter of a second)
function Scene:plant_some()
  local job = table.remove(self.jobs, 1)
  while job do
    self.planted[job[1]] = (self.planted[job[1]] or 0) + nova.scenery.scatter(job[1], job[2])
    if nova.clock() - self.chunk_t0 > 0.03 then break end
    job = table.remove(self.jobs, 1)
  end
  if #self.jobs == 0 and not self.plant_done then
    self.plant_done = true
    nova.log(string.format("hill: planted %d grass, %d flowers, %d bushes, %d pines, %d birches in %.0f ms over several frames", self.planted.grass or 0, self.planted.flowers or 0, self.planted.bush or 0, self.planted.pine or 0, self.planted.birch or 0, (nova.clock() - self.plant_t0) * 1000))
  end
end

-- F11 cycles the finish: 0 plain, 1 ambient occlusion, 2 bloom, 3 both
function Scene:apply_look()
  local m = self.look_mode
  state.look_mode = m
  nova.look {
    ao = (m == 1 or m == 3) and 0.7 or 0, ao_radius = 0.9,
    bloom = (m == 2 or m == 3) and 0.5 or 0, bloom_threshold = 0.75,
  }
end

function Scene:update(dt)
  if nova.input.pressed("look") then
    self.look_mode = (self.look_mode + 1) % 4
    self:apply_look()
    nova.log("hill: look " .. self.look_mode)
  end
  if self.jobs and #self.jobs > 0 then self.chunk_t0 = nova.clock(); self:plant_some() end
  if nova.input.pressed("stats") then
    local p = nova.first("player")
    nova.log(string.format("hill: x=%.1f y=%.1f z=%.1f gems=%d falls=%d slide=%d hops=%d max_height=%.1f won=%s time=%.1f mode=%s stamina=%.1f climb=%.1f glide_dist=%.1f glide_time=%.1f mantles=%d jumps=%d", p and p.x or 0, p and p.y or 0, p and p.z or 0, state.gems, state.falls, state.slide_frames, state.hops, state.max_height, tostring(state.won), state.time, p and p.mode or "-", p and p.stamina or 0, state.climb_time or 0, state.glide_dist or 0, state.glide_time or 0, state.mantles or 0, state.jumps or 0))
  end
  if nova.input.pressed("pause") and not state.won then
    self.paused = not self.paused
    nova.pause(self.paused)
  end
  if state.won and nova.input.pressed("jump") then nova.goto_scene("field") end
end

function Scene:draw() nova.model("hills", 0, 0, 0) end

local function text(x, y, s, size, color, align)
  nova.ui.text(x, y, s, { size = size or 18, color = color or { 255, 255, 255 }, shadow = true, align = align })
end

function Scene:draw_ui()
  local w, h = nova.view()
  nova.ui.rect(16, 16, 330, 34, { 0, 0, 0, 130 })
  nova.ui.rect(24, 25, 14, 14, { 80, 100, 200 })
  text(46, 33, string.format("%d / %d gems   %.0f s", state.gems, state.total, state.time), 20)
  local p = nova.first("player")
  if p then
    text(w - 16, 33, string.format("height %.0f m", p.y), 18, { 220, 230, 255 }, "right")
    -- stamina: it runs down while climbing and gliding and comes back on the ground
    local f = max(0, min(1, p.stamina / 6))
    local bw = 240
    nova.ui.rect(w / 2 - bw / 2 - 3, h - 44, bw + 6, 18, { 0, 0, 0, 130 })
    nova.ui.rect(w / 2 - bw / 2, h - 41, bw * f, 12, f > 0.5 and { 90, 220, 120 } or (f > 0.25 and { 240, 200, 70 } or { 235, 80, 70 }))
    text(w / 2, h - 54, p.mode == "climb" and "climbing" or (p.mode == "glide" and "gliding" or "stamina"), 14, { 230, 235, 245 }, "center")
  end
  if state.message_for > 0 then text(w / 2, 70, state.message, 22, nil, "center") end
  if state.won then
    nova.ui.rect(0, 0, w, h, { 10, 60, 30, 170 })
    text(w / 2, h / 2 - 20, "You made it!", 40, nil, "center")
    text(w / 2, h / 2 + 24, string.format("%d gems, %.0f seconds. Jump to play again.", state.gems, state.time), 20, nil, "center")
  end
end

return Scene

-- Ferns, grass and flowers on the valley floor, planted by the rule in the scene file (`plants`: how many of each model, near which
-- road, the creek or any of them, and within how far of it), over the first frames of the scene, a few milliseconds a frame. Kept
-- in Rust by nova.scenery (drawn only near the camera, bent by the wind); never on a road, in the water or in a house's yard.
-- The spots come from the scene's own seed, so the valley is planted the same every time.
local world = require("lib.world")

local Groundcover = nova.entity { tags = { "groundcover" } }

local seed = 1
local function rand()
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
end

function Groundcover:create()
  seed = self.seed or 5
  self.jobs = {}
  for _, p in ipairs(self.plants or {}) do
    self.jobs[#self.jobs + 1] = { model = p.model, left = p.count or 0, near = p.near or "any", within = p.within or 20, tints = p.tints or {},
      opts = { ry = 0, scale = 1, sway = p.model == "grass" and 0.45 or 0.22, max_distance = p.model == "grass" and 38 or 50, shadow = false } }
  end
  self.planted, self.job = 0, 1
  self.houses = {}
  for _, n in ipairs({ "post_office", "cabin_hazel", "cabin_pip", "workshop", "mast", "picnic" }) do
    local e = nova.named(n)
    if e then self.houses[#self.houses + 1] = { e.x, e.z } end
  end
end

-- a spot near a road (or the creek): along a random point of a random line, out to the side
function Groundcover:spot(job)
  local list
  if job.near == "creek" then
    for _, w in ipairs(world.water) do if w.id == "creek" then list = w.points end end
  elseif job.near == "any" then
    local r = world.roads[1 + math.floor(rand() * #world.roads)]
    list = r and r.points
  else
    for _, r in ipairs(world.roads) do if r.id == job.near then list = r.points end end
  end
  if not list or #list < 2 then return nil end
  local i = 1 + math.floor(rand() * (#list - 1))
  local a, b = list[i], list[i + 1]
  local t = rand()
  local px, pz = a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t
  local dx, dz = b[1] - a[1], b[2] - a[2]
  local l = math.sqrt(dx * dx + dz * dz)
  local side = rand() < 0.5 and -1 or 1
  local off = (3.2 + rand() ^ 1.4 * job.within) * side
  return px - dz / l * off, pz + dx / l * off
end

function Groundcover:update()
  if not self.jobs then return end
  local t0 = nova.clock()
  while self.job <= #self.jobs do
    local j = self.jobs[self.job]
    while j.left > 0 do
      j.left = j.left - 1
      local x, z = self:spot(j)
      local ok = x ~= nil
      if ok then
        local r, d = world.nearest("road", x, z)
        if r and d < r.width / 2 + 1.4 then ok = false end
        if ok and world.junction_surface(x, z) then ok = false end -- (nor on a junction's corners)
        local w, dw = world.nearest("water", x, z)
        if ok and w and dw < w.width / 2 + 0.6 then ok = false end
        if ok and world.blocked(x, z, 0.2) then ok = false end
        if ok then for _, h in ipairs(self.houses) do if (h[1] - x) ^ 2 + (h[2] - z) ^ 2 < 64 then ok = false break end end end
        if ok and nova.scenery.push(x, z, 0.4) then ok = false end
      end
      if ok then
        local o = j.opts
        o.ry, o.scale = rand() * 6.28, 0.75 + rand() * 0.6
        o.tint = #j.tints > 0 and j.tints[1 + math.floor(rand() * #j.tints)] or nil
        nova.scenery.add(j.model, x, 0, z, o)
        self.planted = self.planted + 1
      end
      if nova.clock() - t0 > 0.006 then return end
    end
    self.job = self.job + 1
  end
  nova.log("groundcover: planted " .. self.planted)
  self.jobs = nil
end

return Groundcover

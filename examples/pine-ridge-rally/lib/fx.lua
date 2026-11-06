-- Puffs of dust and gravel behind the cars: one 3D particle emitter (nova.particles with a model) shared by every car.
-- All the puffs of a circuit have the same colour, so the emitter's colour is simply set when a puff is made.
local fx = {}

local emitter

-- Skid marks: each tyre lays one continuous dark ribbon (a run of short strips, each from the last point to the next, so a bend is
-- smooth); the last 500 strips are kept (a ring), drawn flat on the road.
local MARKS = 500
local marks, next_mark = {}, 1
local last = setmetatable({}, { __mode = "k" }) -- where each tyre's ribbon ended: last[car][side] = { x, z }
local SKID_COLOR = { 14, 14, 17, 150 }
local STEP, WIDTH = 0.6, 0.3

function fx.clear()
  if emitter then emitter:destroy() end
  emitter = nil
  marks, next_mark = {}, 1
  last = setmetatable({}, { __mode = "k" })
end

-- The tyre `side` (1 or 2) of `owner` (the car) is at (x, z) and sliding: the ribbon grows to here.
function fx.skid(owner, side, x, z)
  local mine = last[owner]
  if not mine then mine = {}; last[owner] = mine end
  local p = mine[side]
  if not p then mine[side] = { x, z }; return end
  local dx, dz = x - p[1], z - p[2]
  local len = math.sqrt(dx * dx + dz * dz)
  if len < STEP then return end
  local m = marks[next_mark]
  if not m then m = {}; marks[next_mark] = m end
  m.x, m.z, m.ry, m.len = (x + p[1]) / 2, (z + p[2]) / 2, math.atan(dx, dz), len + 0.04
  next_mark = next_mark % MARKS + 1
  p[1], p[2] = x, z
end

-- The tyre has stopped sliding: its next mark starts a new ribbon.
function fx.skid_end(owner)
  last[owner] = nil
end

function fx.draw_skids(cx, cz, range)
  local r2 = range * range
  for i = 1, #marks do
    local m = marks[i]
    local dx, dz = m.x - cx, m.z - cz
    if dx * dx + dz * dz < r2 then
      nova.quad3(m.x, 0.04, m.z, 0, 1, 0, 1, { w = m.len, h = WIDTH, rot = m.ry, color = SKID_COLOR })
    end
  end
end

-- A puff at (x, z) drifting with (vx, vz) and rising; `size` in metres, `color` an {r, g, b} table.
function fx.puff(x, z, vx, vz, size, color, lift)
  if not emitter then
    emitter = nova.particles(0, 0.25, 0, {
      model = "dust", rate = 0, max = 70, life = { 0.5, 0.9 }, size_end = 3.2, drag = 3, gravity = 0, spread = 0.5,
      color = { 200, 190, 160, 210 }, color_end = { 200, 190, 160, 0 },
    })
  end
  local spec = emitter.spec
  spec.color[1], spec.color[2], spec.color[3] = color[1], color[2], color[3]
  spec.color_end[1], spec.color_end[2], spec.color_end[3] = color[1], color[2], color[3]
  spec.size = { size * 0.5, size * 0.5 }
  local up = (lift or 1) * (1.2 + math.random() * 0.8)
  spec.dir = { vx, up, vz }
  local speed = math.sqrt(vx * vx + up * up + vz * vz)
  spec.speed = { speed, speed }
  emitter.x, emitter.y, emitter.z = x, 0.25, z
  emitter:burst(1)
end

return fx

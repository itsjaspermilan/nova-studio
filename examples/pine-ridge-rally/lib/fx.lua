-- Puffs of dust and gravel behind the cars: one 3D particle emitter (nova.particles with a model) shared by every car.
-- All the puffs of a circuit have the same colour, so the emitter's colour is simply set when a puff is made.
local fx = {}

local emitter

function fx.clear()
  if emitter then emitter:destroy() end
  emitter = nil
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

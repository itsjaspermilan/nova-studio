-- Puffs of dust and gravel behind the cars: a small pool of dust models that grow and fade.
local fx = {}

local MAX = 70
local puffs = {}
local next_slot = 1

function fx.clear() puffs, next_slot = {}, 1 end

function fx.puff(x, z, vx, vz, size, color)
  local p = puffs[next_slot]
  if not p then p = { opts = { scale = 1, tint = { 255, 255, 255, 255 } } }; puffs[next_slot] = p end
  next_slot = next_slot % MAX + 1
  p.x, p.y, p.z, p.vx, p.vy, p.vz = x, 0.25, z, vx, 1.2 + math.random() * 0.8, vz
  p.age, p.life, p.size = 0, 0.5 + math.random() * 0.4, size or 1
  p.color = color
end

function fx.update(dt)
  for i = 1, #puffs do
    local p = puffs[i]
    if p.age < p.life then
      p.age = p.age + dt
      p.x, p.y, p.z = p.x + p.vx * dt, p.y + p.vy * dt, p.z + p.vz * dt
      p.vx, p.vz, p.vy = p.vx * 0.94, p.vz * 0.94, p.vy * 0.96
    end
  end
end

function fx.draw()
  for i = 1, #puffs do
    local p = puffs[i]
    if p.age < p.life then
      local t = p.age / p.life
      local o = p.opts
      o.scale = p.size * (0.5 + t * 1.6)
      local c = p.color
      o.tint[1], o.tint[2], o.tint[3], o.tint[4] = c[1], c[2], c[3], math.floor(210 * (1 - t))
      nova.model("dust", p.x, p.y, p.z, o)
    end
  end
end

return fx

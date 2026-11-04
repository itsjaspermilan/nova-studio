-- Marks and flashes: bullet holes, sparks, tracers, and the lights that muzzle flashes and explosions want.
local fx = {}
local cos, sin, sqrt, max = math.cos, math.sin, math.sqrt, math.max

local decals, DECALS, next_decal = {}, 90, 1
local bits, tracers, flashes = {}, {}, {}

function fx.reset()
  decals, bits, tracers, flashes, next_decal = {}, {}, {}, {}, 1
end

-- a mark on a surface (the newest ninety stay)
function fx.decal(x, y, z, nx, ny, nz, size, color)
  decals[next_decal] = { x, y, z, nx, ny, nz, size or 0.09, color or { 12, 12, 14 } }
  next_decal = next_decal % DECALS + 1
end

function fx.sparks(x, y, z, color, n, speed)
  for _ = 1, n do
    if #bits > 220 then table.remove(bits, 1) end
    local a, b = math.random() * 6.283, math.random() * 2 - 0.4
    local s = (speed or 3) * (0.4 + math.random())
    bits[#bits + 1] = { x = x, y = y, z = z, vx = cos(a) * s, vy = b * s, vz = sin(a) * s, life = 0.25 + math.random() * 0.35, color = color or { 255, 200, 90 } }
  end
end

function fx.tracer(x1, y1, z1, x2, y2, z2, color)
  tracers[#tracers + 1] = { x1, y1, z1, x2, y2, z2, 0.07, color or { 255, 230, 160 } }
end

-- a light that lasts a moment
function fx.flash(x, y, z, color, seconds, radius)
  flashes[#flashes + 1] = { x = x, y = y, z = z, color = color or { 255, 220, 150 }, life = seconds or 0.06, radius = radius or 9 }
end

function fx.update(dt)
  for i = #bits, 1, -1 do
    local b = bits[i]
    b.life = b.life - dt
    b.vy = b.vy - 14 * dt
    b.x, b.y, b.z = b.x + b.vx * dt, max(0.02, b.y + b.vy * dt), b.z + b.vz * dt
    if b.life <= 0 then table.remove(bits, i) end
  end
  for i = #tracers, 1, -1 do
    tracers[i][7] = tracers[i][7] - dt
    if tracers[i][7] <= 0 then table.remove(tracers, i) end
  end
  for i = #flashes, 1, -1 do
    flashes[i].life = flashes[i].life - dt
    if flashes[i].life <= 0 then table.remove(flashes, i) end
  end
end

function fx.draw()
  for _, d in pairs(decals) do nova.quad3(d[1], d[2], d[3], d[4], d[5], d[6], d[7], { color = d[8] }) end
  for _, b in ipairs(bits) do nova.cuboid_at(b.x, b.y, b.z, 0.06, 0.06, 0.06, { color = b.color, glow = true }) end
  for _, t in ipairs(tracers) do nova.line3(t[1], t[2], t[3], t[4], t[5], t[6], { color = t[8], width = 0.025 }) end
end

-- The lights wanted this frame. The engine takes sixteen at most (it took eight; see docs/probes.md), so the nearest to the player win;
-- what was wanted and what was dropped are counted for the F3 screen.
local wanted = {}
fx.max_lights = 12
fx.lights = { wanted = 0, used = 0, dropped = 0, worst = 0 }

function fx.want_light(x, y, z, radius, color, boost)
  wanted[#wanted + 1] = { x, y, z, radius, color, boost or 0 }
end

function fx.commit_lights(px, pz)
  for _, f in ipairs(flashes) do fx.want_light(f.x, f.y, f.z, f.radius, f.color, 1000) end
  for _, l in ipairs(wanted) do
    local dx, dz = l[1] - px, l[3] - pz
    l.d = dx * dx + dz * dz - l[6]
  end
  table.sort(wanted, function(a, b) return a.d < b.d end)
  local used = math.min(#wanted, fx.max_lights)
  for i = 1, used do
    local l = wanted[i]
    nova.point_light(l[1], l[2], l[3], { radius = l[4], color = l[5] })
  end
  local L = fx.lights
  L.wanted, L.used, L.dropped = #wanted, used, #wanted - used
  L.worst = max(L.worst, L.dropped)
  wanted = {}
end

-- a part of something built from boxes, placed in its own frame: ox to the right, oy up, oz forward (toward -z at turn 0),
-- turned with it
function fx.part(e, ox, oy, oz, w, h, d, color, glow, extra)
  local c, s = cos(e.ry), sin(e.ry)
  local o = { ry = e.ry, color = color, glow = glow }
  if extra then for k, v in pairs(extra) do o[k] = v end end
  nova.cuboid_at(e.x + ox * c + oz * s, (e.y or 0) + oy, e.z - ox * s + oz * c, w, h, d, o)
end

return fx

-- The effects' toolbox: particles (sparks, chunks, embers, smoke, dust, glass), explosions, the baton's hit sparks, scorch marks,
-- and lightning. The pictures are drawn by tools/art_fx.mjs (sprites/fx_*). Nothing here changes how the game plays: hit areas and
-- damage live in the entities and in data/*.lua; these only show them.
--
-- Quality: `nova.effects("low" | "off")` (the pause screen's "Effects", lib/look.lua) makes every effect cheaper: "low" has about half
-- the particles and no scorch marks or glows; "off" keeps the main picture and a few particles.
local J = require("lib.juice")
local Look = require("lib.look")

local V = {}

-- 1 on high, 0.5 on low, 0.25 on off: the share of particles and layers an effect draws
function V.q() return Look.quality end
function V.share() local q = Look.quality; return q == "low" and 0.5 or q == "off" and 0.25 or 1 end
function V.count(n) return math.max(1, math.floor(n * V.share() + 0.5)) end
function V.glow() return Look.quality == "high" end

local function rnd(a, b) return a + (b - a) * math.random() end

-- the frames of sprites/fx_bits
V.bits = { spark_white = 0, spark_yellow = 1, spark_red = 2, spark_cyan = 3, chunk_grey = 4, chunk_rust = 5, ember = 6, puff = 7, glass = 8, star = 9, star_m = 10, drop = 11 }

-- The one entity that holds every particle (made when the first is added; it ends with the scene).
local function host()
  local h = nova.first("vfx")
  if not h then h = nova.spawn("vfx", 0, 0, {}) end
  return h
end

-- A particle: x, y on the ground, z above it (all world units); vx, vy, vz per second; g pulls z down (units/s^2, negative lifts);
-- life (s); frame of `spr` (default fx_bits); w, h size on screen; rot (radians) and spin; `along` turns the picture to its flight;
-- alpha and `fade` (the share of its life it fades over, at the end); grow (size multiplier per second); drag (share lost per second);
-- bounce (a share of its fall it keeps on the ground); `add` draws light; color tints.
function V.add(p)
  local h = host()
  p.t = 0
  p.z, p.vx, p.vy, p.vz = p.z or 0, p.vx or 0, p.vy or 0, p.vz or 0
  p.g, p.life, p.alpha = p.g or 0, p.life or 0.6, p.alpha or 1
  p.w = p.w or 16
  p.h = p.h or p.w
  p.spr = p.spr or "fx_bits"
  h.list[#h.list + 1] = p
  return p
end

function V.cap() return Look.quality == "high" and 260 or 120 end

-- Sparks flying from (x, y): n of them, `speed` the top speed, `up` how high they are thrown. colors: a list of fx_bits names.
function V.sparks(x, y, n, o)
  o = o or {}
  local colors = o.colors or { "spark_white", "spark_yellow", "spark_red" }
  local z = o.z or 12
  for i = 1, V.count(n) do
    local a = o.angle and (o.angle + rnd(-(o.spread or math.pi), o.spread or math.pi)) or rnd(0, math.pi * 2)
    local sp = rnd((o.speed or 300) * 0.4, o.speed or 300)
    V.add { x = x, y = y, z = z, vx = math.cos(a) * sp, vy = math.sin(a) * sp * 0.8, vz = rnd(40, o.up or 240), g = o.g or 900, life = rnd(0.25, o.life or 0.7), frame = V.bits[colors[math.random(#colors)]],
      w = o.size or 20, h = o.size or 20, along = true, add = true, fade = 0.5, drag = 0.6, bounce = 0.25 }
  end
end

-- Chunks of the thing that blew up, thrown up and falling, bouncing once or twice. kind: "rust" | "grey" | "glass"
function V.debris(x, y, n, o)
  o = o or {}
  local frame = o.kind == "glass" and V.bits.glass or o.kind == "grey" and V.bits.chunk_grey or V.bits.chunk_rust
  for i = 1, V.count(n) do
    local a, sp = rnd(0, math.pi * 2), rnd(60, o.speed or 280)
    V.add { x = x, y = y, z = o.z or 10, vx = math.cos(a) * sp, vy = math.sin(a) * sp * 0.8, vz = rnd(160, o.up or 380), g = 1100, life = rnd(0.9, 1.5),
      frame = o.kind == "mixed" and (math.random() < 0.5 and V.bits.chunk_grey or V.bits.chunk_rust) or frame, w = rnd(11, o.size or 18), rot = rnd(0, 6.28), spin = rnd(-12, 12), bounce = 0.4, fade = 0.3, drag = 0.4 }
  end
end

-- Embers drifting up and going out.
function V.embers(x, y, n, o)
  o = o or {}
  for i = 1, V.count(n) do
    local a, d = rnd(0, math.pi * 2), rnd(0, o.radius or 40)
    V.add { x = x + math.cos(a) * d, y = y + math.sin(a) * d * 0.8, z = rnd(6, 20), vx = rnd(-30, 30), vy = rnd(-20, 20), vz = rnd(50, o.up or 140), g = -20, life = rnd(0.7, o.life or 1.6), frame = V.bits.ember, w = rnd(8, 12), add = true, fade = 0.6, flicker = true }
  end
end

-- Smoke: soft grey puffs that grow, rise and thin.
function V.smoke(x, y, n, o)
  o = o or {}
  for i = 1, V.count(n) do
    local a, d = rnd(0, math.pi * 2), rnd(0, o.radius or 20)
    V.add { x = x + math.cos(a) * d, y = y + math.sin(a) * d * 0.8, z = rnd(8, 24), vx = rnd(-18, 18), vy = rnd(-10, 10), vz = rnd(30, o.up or 70), life = rnd(0.9, o.life or 1.5), frame = V.bits.puff, w = rnd(22, o.size or 34), grow = 0.9, alpha = o.alpha or 0.75, fade = 1, rot = rnd(0, 6.28), spin = rnd(-1, 1), color = o.color }
  end
end

-- A puff of dust at the runner's feet (fx_dust): `dx, dy` is the way he runs (the puff is thrown the other way).
function V.dust(x, y, n, dx, dy, size)
  n = Look.quality == "off" and 1 or n or 2
  for i = 1, n do
    V.add { x = x + rnd(-8, 8), y = y + rnd(-3, 3), z = rnd(2, 8), vx = -(dx or 0) * rnd(30, 90) + rnd(-26, 26), vy = -(dy or 0) * rnd(30, 90) * 0.8 + rnd(-14, 14), vz = rnd(20, 60), g = -10, life = 0.42, spr = "fx_dust", anim = { 0, 5 }, w = (size or 40) * rnd(0.8, 1.2), alpha = 0.85, drag = 1.5, lit = true }
  end
end

-- The sparks of a hit: a flash star where the blow landed and a short spray along the blow's direction.
function V.hit(x, y, dx, dy, o)
  o = o or {}
  local m = o.magenta
  V.add { x = x, y = y, z = o.z or 26, life = 0.14, frame = m and V.bits.star_m or V.bits.star, w = (o.size or 44), add = true, fade = 0.8, grow = 0.6, rot = rnd(0, 1) }
  local ang = math.atan(dy or 0, dx or 1)
  V.sparks(x, y, o.n or 9, { z = o.z or 26, angle = ang, spread = 0.9, speed = o.speed or 340, up = 140, life = 0.45, colors = m and { "spark_white", "spark_red" } or { "spark_white", "spark_cyan", "spark_cyan" }, size = 18 })
end

-- A scorch mark on the ground that cools and fades. radius: world units.
function V.scorch(x, y, radius)
  if Look.quality ~= "high" then return end
  local old = nova.all("scorch")
  if #old >= 8 then old[1]:destroy() end
  nova.spawn("scorch", x, y, { radius = radius })
end

-- An explosion that fits `radius` (the blast's own hit radius): flash, fireball, shock ring, sparks, chunks, smoke, scorch, light, shake.
-- opts: shake (units), quiet (no scorch), color ("fire", the default).
function V.boom(x, y, radius, opts)
  opts = opts or {}
  nova.spawn("boom", x, y, { radius = radius, quiet = opts.quiet, big = opts.big })
  local s = radius / 96
  J.shake(opts.shake or math.max(3, math.min(14, radius / 12)), math.floor(8 + radius / 16))
  V.sparks(x, y, 16 * s, { z = 18, speed = 300 + 160 * s, up = 300, life = 0.9 })
  V.debris(x, y, 8 * s, { kind = "mixed", speed = 180 + 120 * s })
  V.embers(x, y, 10 * s, { radius = radius * 0.5 })
  if not opts.quiet then V.scorch(x, y, radius) end
end

-- A small pop (an enemy dying, a shot ending): a flash, a few sparks and a puff.
function V.pop(x, y, size, magenta)
  size = size or 1
  V.add { x = x, y = y, z = 24, life = 0.16, frame = magenta and V.bits.star_m or V.bits.star, w = 56 * size, add = true, fade = 0.8, grow = 0.5 }
  V.sparks(x, y, 8 * size, { z = 24, speed = 260 * size, up = 200, life = 0.5, colors = magenta and { "spark_white", "spark_red" } or { "spark_white", "spark_cyan" } })
  V.smoke(x, y, 2 * size, { size = 28 * size, life = 0.8, alpha = 0.5 })
end

-- The box an entity hurts with (its hitbox in the world: a rectangle), as the centre, the length along its facing and the width across,
-- and the angle that turns a picture facing right to face the way it points. Taken from the hitbox itself, so a picture drawn from it
-- is exactly what hurts.
function V.rect_of(e)
  local b = e.hitbox
  local x0, y0, w, h = e.x + b[1] * e.sx, e.y + b[2] * e.sy, b[3] * e.sx, b[4] * e.sy
  local horizontal = e.dir == "left" or e.dir == "right" or e.dir == nil
  return { cx = x0 + w / 2, cy = y0 + h / 2, along = horizontal and w or h, across = horizontal and h or w,
    rot = ({ right = 0, down = math.pi / 2, left = math.pi, up = -math.pi / 2 })[e.dir or "right"], x0 = x0, y0 = y0, w = w, h = h }
end

-- A crescent that fills `r` (V.rect_of), from sprites/<sheet> (fx_swing: the player's cyan, fx_eswing: the enemies' magenta): the sweep
-- for 3 frames, then the afterimage fading over 6 more. `heavy`: the thick one; `rev`: sweeping the other way; `age`: frames since it began.
function V.crescent(r, sheet, heavy, rev, age)
  local i = age < 3 and age or 3 + math.min(3, math.floor((age - 3) / 1.5))
  local base = ((heavy and 2 or 0) + (rev and 1 or 0)) * 14
  local sx, sy = nova.cam.to_screen(r.cx, r.cy)
  if V.glow() then nova.sprite(sheet, sx, sy, { frame = base + 7 + i, w = r.along * 1.2, h = r.across * 1.2, rotation = r.rot, blend = "add", lit = false, alpha = 0.85 }) end
  nova.sprite(sheet, sx, sy, { frame = base + i, w = r.along, h = r.across, rotation = r.rot, lit = false })
end

-- A line in the world, `w` thick, from (x1, y1) to (x2, y2), added to the light (z lifts both ends).
function V.line(x1, y1, x2, y2, w, color, z)
  local ax, ay = nova.cam.to_screen(x1, y1)
  local bx, by = nova.cam.to_screen(x2, y2)
  ay, by = ay - (z or 0), by - (z or 0)
  local len = math.sqrt((bx - ax) ^ 2 + (by - ay) ^ 2)
  nova.sprite("solid", (ax + bx) / 2, (ay + by) / 2, { w = len, h = w, rotation = math.atan(by - ay, bx - ax), color = color, blend = "add", lit = false })
end

-- Lightning from (x1, y1) to (x2, y2) in the world: a jagged bolt with a wide glow, a bright core, forks and a flash at each end.
-- k: 0..1 how much of it is left (fades), seed: the same bolt for the same number, tick: how fast it re-jags.
function V.bolt(x1, y1, x2, y2, k, color, seed, z, jag)
  color = color or { 6, 240, 255 }
  z = z or 0
  local n = 7
  local len = math.sqrt((x2 - x1) ^ 2 + (y2 - y1) ^ 2)
  if len < 1 then return end
  local nx, ny = -(y2 - y1) / len, (x2 - x1) / len
  local pts = { { x1, y1 } }
  local s = (seed or 0) * 7.13
  for i = 1, n - 1 do
    local f = i / n
    local off = (math.sin(s + i * 12.9898) * 43758.5453 % 1 - 0.5) * (jag or 26) * math.min(1, len / 140)
    pts[#pts + 1] = { x1 + (x2 - x1) * f + nx * off, y1 + (y2 - y1) * f + ny * off }
  end
  pts[#pts + 1] = { x2, y2 }
  local a = 255 * k
  for i = 1, #pts - 1 do
    local p, q = pts[i], pts[i + 1]
    if V.glow() then V.line(p[1], p[2], q[1], q[2], 14, { color[1], color[2], color[3], 70 * k }, z) end
    V.line(p[1], p[2], q[1], q[2], 6, { color[1], color[2], color[3], a * 0.8 }, z)
    V.line(p[1], p[2], q[1], q[2], 2.5, { 255, 255, 255, a }, z)
  end
  -- two forks
  for f = 1, 2 do
    local i = 1 + (f * 2 + math.floor((seed or 0) * 3)) % (n - 2)
    local p = pts[i + 1]
    local ang = math.atan(y2 - y1, x2 - x1) + (f == 1 and 0.7 or -0.8)
    local ex, ey = p[1] + math.cos(ang) * len * 0.16, p[2] + math.sin(ang) * len * 0.16
    V.line(p[1], p[2], ex, ey, 3, { color[1], color[2], color[3], a * 0.7 }, z)
    V.line(p[1], p[2], ex, ey, 1.2, { 255, 255, 255, a * 0.8 }, z)
  end
  for _, e in ipairs({ pts[1], pts[#pts] }) do
    local sx, sy = nova.cam.to_screen(e[1], e[2])
    nova.sprite("fx_bits", sx, sy - z, { frame = V.bits.star, w = 34 * k + 10, h = 34 * k + 10, blend = "add", lit = false, alpha = k })
  end
end

return V

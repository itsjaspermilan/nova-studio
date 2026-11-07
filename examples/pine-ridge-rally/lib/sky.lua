-- The time of day: where the sun is decides the sky's colours, the sunlight and the ambient light (and, in the engine, the sun's disc and
-- glow, the clouds' lighting, the stars and the moon: see nova.sky). A circuit's look gives `sun_to`, the direction towards the sun
-- (a sun under the horizon, y < 0, is night: the moon then lights the scene, as `sun` in the look says).
local sky = {}

-- the sky at the top and at the horizon, by the sun's height (y of the direction towards it): night, dusk, sunset, golden hour, morning, noon
local KEYS = {
  { -0.30, { 4, 7, 20 }, { 16, 24, 50 } },
  { -0.08, { 20, 26, 60 }, { 86, 66, 96 } },
  { 0.03, { 56, 74, 136 }, { 255, 142, 84 } },
  { 0.16, { 82, 124, 198 }, { 255, 196, 140 } },
  { 0.40, { 92, 146, 224 }, { 204, 224, 240 } },
  { 1.00, { 64, 126, 224 }, { 184, 216, 240 } },
}
-- the sunlight and the ambient light under it (linear blends of these)
local LIGHT = {
  { 0.00, { 255, 140, 80 }, 0.7 },
  { 0.20, { 255, 205, 150 }, 0.9 },
  { 0.50, { 238, 228, 206 }, 1.0 },
  { 1.00, { 235, 230, 214 }, 1.0 },
}

local function mix(a, b, t) return a + (b - a) * t end
local function mix3(a, b, t) return { mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t) } end

local function between(keys, e)
  if e <= keys[1][1] then return 1, 1, 0 end
  for i = 2, #keys do
    if e <= keys[i][1] then return i - 1, i, (e - keys[i - 1][1]) / (keys[i][1] - keys[i - 1][1]) end
  end
  return #keys, #keys, 0
end

-- The sky's top and horizon colours with the sun at height `e`.
function sky.palette(e)
  local a, b, t = between(KEYS, e)
  return mix3(KEYS[a][2], KEYS[b][2], t), mix3(KEYS[a][3], KEYS[b][3], t)
end

-- The colour of the sunlight and how bright it is (0 to 1) with the sun at height `e`.
function sky.sunlight(e)
  local a, b, t = between(LIGHT, math.max(e, 0))
  return mix3(LIGHT[a][2], LIGHT[b][2], t), mix(LIGHT[a][3], LIGHT[b][3], t)
end

local function scaled(c, k) return { c[1] * (k[1] or 1), c[2] * (k[2] or 1), c[3] * (k[3] or 1) } end

-- Fills in a look's `sky` (for nova.sky and the fog) and, in the day, its `sun` (for nova.light) from its `sun_to`. A look's `tint`
-- ({ top = {r, g, b}, horizon = {r, g, b} }, multipliers) gives a place its own air: red desert dust, the blue of snow.
function sky.make(look)
  local to = look.sun_to
  local len = math.sqrt(to[1] ^ 2 + to[2] ^ 2 + to[3] ^ 2)
  to = { to[1] / len, to[2] / len, to[3] / len }
  local e = to[2]
  local top, horizon = sky.palette(e)
  local tint = look.tint or {}
  if tint.top then top = scaled(top, tint.top) end
  if tint.horizon then horizon = scaled(horizon, tint.horizon) end
  look.sky = { top = top, horizon = horizon, sun = to, clouds = look.clouds or 0.35, stars = e < 0.1 and 1 or 0 }
  if e > 0 then
    local colour, strength = sky.sunlight(e)
    local ambient = mix3(top, horizon, 0.5)
    look.sun = {
      dir = { -to[1], -to[2], -to[3] },
      color = scaled(colour, { strength, strength, strength }),
      ambient = { ambient[1] * 0.42 + 18, ambient[2] * 0.42 + 18, ambient[3] * 0.42 + 22 },
    }
  end
end

return sky

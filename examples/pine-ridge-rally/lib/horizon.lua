-- The far scenery that never gets closer: a ring of mountains, the ground under everything and slow clouds.
-- It is drawn around the camera, so the world seems endless.
local horizon = {}

local RING = 12
local mountains = {}
for i = 1, RING do
  local a = (i - 1) / RING * math.pi * 2 + 0.3
  -- the same numbers every run (a pretty skyline, not a random one)
  local wobble = ((i * 7919) % 13) / 13
  mountains[i] = { a = a, r = 285 + wobble * 30, scale = 0.55 + ((i * 31) % 7) / 7 * 0.45, turn = a + wobble * 2, opts = { ry = 0, scale = 1, shadow = false } }
end
local clouds = {}
for i = 1, 7 do
  clouds[i] = { a = i / 7 * math.pi * 2, r = 120 + (i * 53) % 150, h = 70 + (i * 37) % 40, opts = { ry = i, scale = 1.4 + (i % 3) * 0.5, shadow = false } }
end
local ground_opts = { scale = 1, shadow = false } -- (the far scenery casts no shadows)

-- `kind`: "forest", "desert", "snow" or "night".
function horizon.draw(cx, cz, kind)
  local ground = (kind == "desert" and "land_sand") or (kind == "snow" and "land_snow") or (kind == "night" and "land_night") or "land_grass"
  -- (the ground is a grid of squares that the hills lift by their vertices: it moves a whole square at a time, so that they do not slide over the hills)
  local sx, sz = math.floor(cx / 16 + 0.5) * 16, math.floor(cz / 16 + 0.5) * 16
  nova.model(ground, sx, 0, sz, ground_opts)
  local peak = (kind == "desert" and "mountain_red") or (kind == "snow" and "mountain_ice") or (kind == "night" and "mountain_night") or "mountain"
  for i = 1, RING do
    local m = mountains[i]
    m.opts.ry, m.opts.scale = m.turn, m.scale
    nova.model(peak, cx + math.cos(m.a) * m.r, -3, cz + math.sin(m.a) * m.r, m.opts)
  end
  local t = nova.time() * 0.012
  for i = 1, #clouds do
    local c = clouds[i]
    local a = c.a + t
    nova.model("cloud", cx + math.cos(a) * c.r, c.h, cz + math.sin(a) * c.r, c.opts)
  end
end

return horizon

-- The far scenery that never gets closer: a ring of mountains, the ground under everything and slow clouds.
-- It is drawn around the camera, so the world seems endless.
local horizon = {}

local RING = 12
local mountains = {}
for i = 1, RING do
  local a = (i - 1) / RING * math.pi * 2 + 0.3
  -- the same numbers every run (a pretty skyline, not a random one)
  local wobble = ((i * 7919) % 13) / 13
  mountains[i] = { a = a, r = 285 + wobble * 30, scale = 0.55 + ((i * 31) % 7) / 7 * 0.45, turn = a + wobble * 2, opts = { ry = 0, scale = 1 } }
end
local clouds = {}
for i = 1, 7 do
  clouds[i] = { a = i / 7 * math.pi * 2, r = 120 + (i * 53) % 150, h = 70 + (i * 37) % 40, opts = { ry = i, scale = 1.4 + (i % 3) * 0.5 } }
end
local ground_opts = { scale = 1 }

-- `kind`: "forest" or "desert".
function horizon.draw(cx, cz, kind)
  local ground = kind == "desert" and "ground_sand" or "ground_grass"
  nova.model(ground, cx, 0, cz, ground_opts)
  local peak = kind == "desert" and "mountain_red" or "mountain"
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

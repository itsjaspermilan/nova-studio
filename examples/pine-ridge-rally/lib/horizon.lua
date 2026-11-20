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

-- `kind`: "forest", "autumn", "desert", "snow" or "night".
function horizon.draw(cx, cz, kind)
  local ground = (kind == "desert" and "land_sand") or (kind == "snow" and "land_snow") or (kind == "night" and "land_night") or (kind == "autumn" and "land_autumn") or "land_grass"
  -- (the ground is a grid of 16 m squares that the hills lift by their vertices, with a picture 64 m across (scripts/rally/land.mjs): it
  -- moves a whole picture at a time, so that neither the squares nor the picture slide over the hills)
  local sx, sz = math.floor(cx / 64 + 0.5) * 64, math.floor(cz / 64 + 0.5) * 64
  nova.model(ground, sx, 0, sz, ground_opts)
  -- the mountains: two rings of faceted ridges round the camera (scripts/rally/skyline.mjs), a different range for each country
  -- (built 1000 m down and drawn 1000 m up, above the engine's lift line, so the ring is not lifted point by point by the hills it slides
  -- over as the camera moves, which made its faces shimmer; the whole ring sits on the ground under the camera instead, eased)
  local ground_y = nova.terrain_height(cx, cz)
  horizon.y = (horizon.y and math.abs(ground_y - horizon.y) < 40) and horizon.y + (ground_y - horizon.y) * 0.05 or ground_y
  nova.model("skyline_" .. (kind == "desert" and "desert" or kind == "snow" and "snow" or kind == "night" and "night" or "forest"), cx, horizon.y - 2 + 1000, cz, ground_opts)
  local t = nova.time() * 0.012
  for i = 1, #clouds do
    local c = clouds[i]
    local a = c.a + t
    nova.model("cloud", cx + math.cos(a) * c.r, c.h, cz + math.sin(a) * c.r, c.opts)
  end
end

return horizon

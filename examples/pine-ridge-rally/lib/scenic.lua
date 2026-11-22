-- A picture of a rally stage's place that does not show its route: the sky of its time of day, the sun or the moon, two lines of hills in the
-- colours of its country, and a straight road running to the horizon. (A stage's bends are for the pace notes to tell: the menus show
-- no map of them. Circuits keep their map.) Drawn from the course's own look (lib/course.lua), so a new stage gets its picture with no work.
local course = require("lib.course")

local scenic = {}

local function mix(a, b, t) return { a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t } end
local function rgb(c, a) return { math.floor(c[1] + 0.5), math.floor(c[2] + 0.5), math.floor(c[3] + 0.5), a or 255 } end

-- a number from a name, for hills that are the same every time but different for each stage
local function seed_of(id)
  local h = 7
  for i = 1, #id do h = (h * 31 + id:byte(i)) % 100003 end
  return h
end

-- Draws the picture into the rectangle `r` ({ x, y, w, h }) for course `id`.
function scenic.draw(id, r)
  local ok, look = pcall(course.of, id)
  if not ok or not look.sky then return end
  local sky = look.sky
  local seed = seed_of(id)
  local horizon_y = r.y + r.h * 0.62
  -- the sky, in bands from its top to its horizon
  local bands = 28
  for i = 0, bands - 1 do
    local y0 = r.y + (horizon_y - r.y) * i / bands
    local y1 = r.y + (horizon_y - r.y) * (i + 1) / bands
    nova.ui.rect(r.x, y0, r.w, y1 - y0 + 0.75, rgb(mix(sky.top, sky.horizon, (i + 0.5) / bands)))
  end
  -- the stars at night, the sun's disc by day
  local sun_y = look.sun_to and (look.sun_to[2] / math.sqrt(look.sun_to[1] ^ 2 + look.sun_to[2] ^ 2 + look.sun_to[3] ^ 2)) or 0.5
  if look.night or sun_y < 0.05 then
    for i = 1, 38 do
      local sx = r.x + ((seed * (i * 7 + 3)) % 1000) / 1000 * r.w
      local sy = r.y + ((seed * (i * 13 + 5)) % 1000) / 1000 * (horizon_y - r.y) * 0.8
      local big = i % 7 == 0 and 2.25 or 1.5
      nova.ui.rect(sx, sy, big, big, { 255, 255, 255, 120 + (i * 17) % 110 })
    end
    local mx, my = r.x + r.w * 0.76, r.y + (horizon_y - r.y) * 0.3
    nova.ui.rect(mx - 11, my - 11, 22, 22, { 238, 242, 255, 235 })
  else
    local sx, sy = r.x + r.w * 0.72, horizon_y - math.max(0.12, sun_y) * (horizon_y - r.y) * 0.85
    nova.ui.rect(sx - 24, sy - 24, 48, 48, { 255, 236, 190, 36 })
    nova.ui.rect(sx - 15, sy - 15, 30, 30, { 255, 244, 214, 255 })
  end
  -- the land: far hills, near hills (a skyline made of columns)
  local ground = sky.ground or { 84, 112, 58 }
  local snow = look.weather and look.weather.kind == "snow"
  if snow then ground = { 226, 232, 240 } end
  local far = mix(ground, sky.horizon, 0.45)
  local near = mix(ground, { 12, 16, 22 }, 0.25)
  if look.night then far, near = mix(far, { 6, 8, 18 }, 0.6), mix(near, { 6, 8, 18 }, 0.6) end
  local step = 3
  local columns = math.floor(r.w / step)
  for c = 0, columns - 1 do
    local x = r.x + c * step
    local u = c / columns
    local h1 = (r.h * 0.13) * (0.55 + 0.45 * math.sin(u * 7.1 + seed % 17) * math.cos(u * 3.3 + seed % 5)) + r.h * 0.02
    nova.ui.rect(x, horizon_y - h1, step + 0.5, h1 + (r.y + r.h - horizon_y), rgb(far))
  end
  nova.ui.rect(r.x, horizon_y, r.w, r.y + r.h - horizon_y, rgb(near))
  for c = 0, columns - 1 do
    local x = r.x + c * step
    local u = c / columns
    -- (low and rolling, lower still in the middle where the road runs)
    local m = 0.35 + 0.65 * math.min(1, math.abs(u - 0.5) * 3.2)
    local h2 = r.h * 0.07 * m * (0.6 + 0.4 * math.sin(u * 11.3 + seed % 13))
    if h2 > 0.5 then nova.ui.rect(x, horizon_y - h2, step + 0.5, h2 + 0.5, rgb(near)) end
  end
  -- the road, straight, to the horizon: tarmac dark, gravel and dirt the colour of the dust, snow packed grey-white
  local road
  if look.surface == "dirt" then
    road = snow and { 196, 204, 214 } or (look.dust and mix(look.dust, { 150, 140, 125 }, 0.4)) or { 170, 150, 120 }
  else
    road = { 52, 55, 62 }
  end
  if look.night then road = mix(road, { 6, 8, 18 }, 0.5) end
  local rows = math.floor(r.y + r.h - horizon_y)
  for i = 0, rows - 1 do
    local y = horizon_y + i
    local half = 2 + (r.w * 0.2) * (i / rows) ^ 1.1
    nova.ui.rect(r.x + r.w / 2 - half, y, half * 2, 1.5, rgb(road))
  end
  -- the snow falls where it is snowing
  if snow then
    for i = 1, 46 do
      local fx = r.x + ((seed * (i * 11 + 1)) % 1000) / 1000 * r.w
      local fy = r.y + ((seed * (i * 17 + 9)) % 1000) / 1000 * r.h
      nova.ui.rect(fx, fy, 2.25, 2.25, { 255, 255, 255, 190 })
    end
  end
end

return scenic

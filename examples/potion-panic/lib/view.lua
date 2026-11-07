-- Draws a workshop (lib/kitchen.lua) in 3D with Kenney's models: a floor of tinted tiles, worktops, crates, a mortar, a cauldron, the apprentice with what they
-- carry, the scenery of the biome outside, and the sky, light and fog of its place. Also projects a place in the workshop onto the screen (for the floating text).
local data = require("lib.data")

local View = {}

local COUNTER_H, TOP_H = 0.52, 0.6

-- the colour of an ingredient once it is ground to a powder
local POWDER = {
  glowcap = { 214, 150, 240 }, embergourd = { 250, 150, 60 }, frostroot = { 170, 226, 255 }, moonberry = { 130, 100, 210 }, sunpetal = { 255, 226, 110 }, bogbulb = { 120, 196, 110 },
}

local function mul(c, k) return { math.min(255, c[1] * k), math.min(255, c[2] * k), math.min(255, c[3] * k) } end
local function mix(a, b, t) return { a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t } end

-- ---- the scene's light, sky and look, by biome -----------------------------------------------------------------------------------------

function View.setup(biome, smooth)
  nova.light { dir = { -0.35, -1, -0.55 }, color = biome.sun, ambient = biome.ambient }
  nova.sky { top = mul(biome.sky, 0.9), horizon = biome.fog }
  nova.fog { color = biome.fog, near = 28, far = 80 }
  nova.shadows { radius = 26, strength = 0.5 }
  -- a cartoon look: soft bands of light, a thin dark line round things, ambient occlusion in the corners, a little glow
  nova.look { toon = 4, outline = { color = { 40, 28, 44 }, strength = 0.55, width = 1 }, saturation = 1.18, vignette = 0.18, bloom = 0.25, bloom_threshold = 0.85, ao = 0.55, ao_radius = 0.7, fxaa = smooth and 1 or 0 }
  if biome.snow then nova.weather({ kind = "snow", count = 260, fall = 2.2, drift = 1.2 }) else nova.weather() end
end

function View.leave()
  nova.weather(); nova.sky(nil); nova.fog(nil); nova.shadows(nil)
end

-- ---- the camera -------------------------------------------------------------------------------------------------------------------

local cam = { ex = 0, ey = 10, ez = 8, tx = 0, ty = 0, tz = 0, fov = 36 }

-- `lower` moves the picture down the screen (room for the orders along the top)
function View.camera(k, lower, w, h, shiftx, orbit, zoom)
  local cx, cz = k.cols / 2 - (shiftx or 0), k.rows / 2
  local aspect = (w or 960) / (h or 540)
  local half = math.tan(math.rad(cam.fov / 2))
  -- far enough away that the whole workshop fits across and up the screen
  local need_w = (k.cols + 1.4) / (2 * half * aspect)
  local need_h = (k.rows + 0.4) / (2 * half) * 1.1
  local d = math.max(need_w, need_h, 9) * (zoom or 1)
  cam.ex, cam.ey, cam.ez = cx + (orbit or 0), d * 0.93, cz + d * 0.46
  cam.tx, cam.ty, cam.tz = cx, 0, cz - (lower or 0.8)
  nova.camera(cam.ex, cam.ey, cam.ez, cam.tx, cam.ty, cam.tz, cam.fov)
  cam.aspect = aspect
end

-- the screen place (in the game's 960 x 540 or wider units) of a place in the workshop
function View.project(x, y, z, w, h)
  local fx, fy, fz = cam.tx - cam.ex, cam.ty - cam.ey, cam.tz - cam.ez
  local fl = math.sqrt(fx * fx + fy * fy + fz * fz)
  fx, fy, fz = fx / fl, fy / fl, fz / fl
  -- right = f x up (0, 1, 0)
  local rx, ry, rz = -fz, 0, fx
  local rl = math.sqrt(rx * rx + rz * rz)
  rx, rz = rx / rl, rz / rl
  -- up' = right x f
  local ux, uy, uz = ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx
  local dx, dy, dz = x - cam.ex, y - cam.ey, z - cam.ez
  local xc, yc, zc = dx * rx + dy * ry + dz * rz, dx * ux + dy * uy + dz * uz, dx * fx + dy * fy + dz * fz
  local half = math.tan(math.rad(cam.fov / 2))
  local nx, ny = xc / (zc * half * cam.aspect), yc / (zc * half)
  return (nx * 0.5 + 0.5) * w, (0.5 - ny * 0.5) * h
end

-- ---- items ------------------------------------------------------------------------------------------------------------------------

local function flask(x, y, z, color, s, glow)
  s = (s or 1) * 1.5
  nova.cuboid(x - 0.1 * s, y, z - 0.1 * s, x + 0.1 * s, y + 0.15 * s, z + 0.1 * s, { color = color, glow = glow })
  nova.cuboid(x - 0.045 * s, y + 0.15 * s, z - 0.045 * s, x + 0.045 * s, y + 0.25 * s, z + 0.045 * s, { color = mul(color, 0.85) })
  nova.cuboid(x - 0.055 * s, y + 0.25 * s, z - 0.055 * s, x + 0.055 * s, y + 0.3 * s, z + 0.055 * s, { color = { 176, 122, 70 } })
end

function View.item(item, x, y, z, t)
  if not item then return end
  if item.k == "ing" then
    if item.ground then
      local c = POWDER[item.id] or { 220, 220, 220 }
      nova.cuboid(x - 0.24, y, z - 0.24, x + 0.24, y + 0.09, z + 0.24, { color = mul(c, 0.8) })
      nova.cuboid(x - 0.15, y + 0.09, z - 0.15, x + 0.15, y + 0.2, z + 0.15, { color = c })
    else
      nova.model(data.ingredients[item.id].model, x, y, z, { scale = 1.8 })
    end
  elseif item.k == "bottle" then
    nova.model("potion", x, y, z, { scale = 1.4 })
  elseif item.k == "potion" then
    local c = (item.recipe == "sludge") and { 70, 64, 40 } or data.recipes[item.recipe].color
    flask(x, y, z, c, 1.2)
  end
end

-- ---- the workshop -----------------------------------------------------------------------------------------------------------------

local function counter(st, biome)
  local x, z = st.cx, st.cz
  nova.cuboid(x - 0.48, 0, z - 0.48, x + 0.48, 0.08, z + 0.48, { color = mul(biome.counter, 0.55) }) -- a plinth
  nova.cuboid(x - 0.5, 0.08, z - 0.5, x + 0.5, COUNTER_H, z + 0.5, { color = biome.counter })
  nova.cuboid(x - 0.53, COUNTER_H, z - 0.53, x + 0.53, TOP_H, z + 0.53, { color = biome.top }) -- the top, a little proud of the body
  -- two drawers on the face that looks at the camera
  for i = -1, 1, 2 do
    nova.cuboid(x + i * 0.25 - 0.18, 0.18, z + 0.5, x + i * 0.25 + 0.18, 0.44, z + 0.515, { color = mul(biome.counter, 0.8) })
    nova.cuboid(x + i * 0.25 - 0.07, 0.3, z + 0.515, x + i * 0.25 + 0.07, 0.34, z + 0.54, { color = { 220, 210, 190 } })
  end
end

-- a thin bar floating over a station, for a grind or a brew
local function bar(x, y, z, frac, color)
  nova.cuboid(x - 0.34, y, z - 0.02, x + 0.34, y + 0.1, z + 0.02, { color = { 30, 22, 20 } })
  nova.cuboid(x - 0.31, y + 0.02, z - 0.03, x - 0.31 + 0.62 * math.max(0.02, math.min(1, frac)), y + 0.08, z + 0.03, { color = color })
end

function View.draw_station(st, k, biome, t)
  local x, z = st.cx, st.cz
  local kind = st.kind
  if kind == "counter" then
    counter(st, biome)
    View.item(st.item, x, TOP_H, z, t)
  elseif kind == "crate" then
    counter(st, biome)
    nova.model("chest", x, TOP_H - 0.04, z, { scale = 1.6 })
    local m = data.ingredients[st.ing].model
    nova.model(m, x - 0.22, TOP_H + 0.5, z + 0.02, { scale = 2.0 })
    nova.model(m, x + 0.22, TOP_H + 0.5, z - 0.08, { scale = 2.0 })
    nova.model(m, x, TOP_H + 0.62, z + 0.12, { scale = 2.0 })
  elseif kind == "bottles" then
    counter(st, biome)
    for i = -1, 1 do nova.model("potion", x + i * 0.3, TOP_H, z + (i % 2) * 0.1, { scale = 1.5 }) end
  elseif kind == "mortar" then
    counter(st, biome)
    nova.cuboid(x - 0.2, TOP_H, z - 0.2, x + 0.2, TOP_H + 0.08, z + 0.2, { color = { 150, 146, 156 } })
    nova.cuboid(x - 0.3, TOP_H + 0.08, z - 0.3, x + 0.3, TOP_H + 0.24, z + 0.3, { color = { 176, 172, 184 } })
    nova.cuboid(x - 0.24, TOP_H + 0.24, z - 0.24, x + 0.24, TOP_H + 0.26, z + 0.24, { color = { 70, 64, 78 } })
    if st.item then
      if st.item.ground then
        local c = POWDER[st.item.id]
        nova.cuboid(x - 0.17, TOP_H + 0.22, z - 0.17, x + 0.17, TOP_H + 0.3, z + 0.17, { color = c })
      else
        nova.model(data.ingredients[st.item.id].model, x, TOP_H + 0.2, z, { scale = 1.4 })
        if st.progress > 0 then
          local wobble = math.sin(t * 30) * 0.06
          nova.model("mortar", x + wobble, TOP_H + 0.16, z, { scale = 0.9, rz = wobble * 2 })
        end
      end
    end
  elseif kind == "cauldron" then
    counter(st, biome)
    nova.model("cauldron", x, TOP_H, z, { scale = 1.2 })
    local top = TOP_H + 0.45
    local liquid = { 96, 128, 110 }
    local glow = false
    local recipe = st.recipe and data.recipes[st.recipe]
    if st.state == "brewing" or st.state == "done" then
      liquid = recipe and recipe.color or { 90, 80, 50 }
      glow = st.state == "done"
    elseif st.state == "burnt" then
      liquid = { 24, 20, 20 }
    elseif #st.items > 0 then
      liquid = { 150, 160, 140 }
    end
    local pulse = 0.5 + 0.5 * math.sin(t * (st.state == "brewing" and 9 or 3))
    nova.cuboid(x - 0.27, top - 0.04, z - 0.33, x + 0.27, top + 0.0 + 0.02 * pulse, z + 0.33, { color = liquid, glow = glow or st.state == "brewing" })
    if st.state == "idle" then
      -- (what is in it is shown on the screen)
    elseif st.state == "brewing" then
      if st.stirred and k.t - st.stirred < 0.15 then
        local a = k.t * 14
        nova.cuboid(x + math.cos(a) * 0.12 - 0.03, top - 0.05, z + math.sin(a) * 0.12 - 0.03, x + math.cos(a) * 0.12 + 0.03, top + 0.5, z + math.sin(a) * 0.12 + 0.03, { color = { 190, 140, 90 } })
      end
      -- bubbles
      for i = 1, 3 do
        local ph = (t * 0.9 + i * 0.33) % 1
        local c = mul(liquid, 1.3)
        nova.billboard("fx/bubble", x + (i - 2) * 0.14, top + 0.08 + ph * 0.3, z + 0.05 * i, 0.12 + 0.04 * ph, { color = { c[1], c[2], c[3], math.floor(255 * (1 - ph * 0.6)) } })
      end
    elseif st.state == "done" then
      for i = 1, 3 do
        local ph = (t * 0.7 + i * 0.33) % 1
        nova.billboard("fx/puff", x + (i - 2) * 0.12, TOP_H + 0.45 + ph * 0.4, z, 0.3 + 0.2 * ph, { color = { 250, 250, 255, math.floor(200 * (1 - ph)) } })
      end
    elseif st.state == "burnt" then
      for i = 1, 3 do
        local ph = (t * 0.6 + i * 0.3) % 1
        nova.cuboid(x - 0.1 + (i - 2) * 0.1, top + 0.1 + ph * 0.8, z - 0.1, x + 0.1 + (i - 2) * 0.1, top + 0.3 + ph * 0.8, z + 0.1, { color = { 60, 56, 56 } })
      end
    end
  elseif kind == "hatch" then
    counter(st, biome)
    nova.model("hatch", x, TOP_H - 0.04, z, { scale = 1.0, ry = math.pi })
    nova.cuboid(x - 0.46, TOP_H, z - 0.46, x + 0.46, TOP_H + 0.03, z + 0.46, { color = { 250, 222, 130 }, glow = true })
  elseif kind == "bin" then
    counter(st, biome)
    nova.model("barrel", x, TOP_H - 0.04, z, { scale = 1.6, tint = { 120, 110, 120 } })
  end
end

-- the people waiting for their potions: one stands behind each hatch, in a different coat, waves when served and shakes a head when an order runs out
local COATS = { { 255, 150, 150 }, { 150, 200, 255 }, { 190, 255, 160 }, { 255, 225, 140 }, { 220, 170, 255 } }
function View.draw_customers(k, t)
  for hi, st in ipairs(k.stations) do
    if st.kind == "hatch" then
      if not st.out then
        -- outward: the neighbour cell that is not part of the kitchen
        for _, d in ipairs({ { 0, -1 }, { 0, 1 }, { -1, 0 }, { 1, 0 } }) do
          local row = k.floor[st.z + d[2]]
          if not (row and row[st.x + d[1]]) then st.out = d; break end
        end
        st.out = st.out or { 0, -1 }
      end
      local d = st.out
      local n = #k.orders
      local mood = k.customer_mood or 0
      local clip, time = "idle", t + hi
      if k.t - (k.last_serve or -9) < 1.0 then clip, time = "emote-yes", k.t - k.last_serve
      elseif k.t - (k.last_expire or -9) < 0.8 then clip, time = "emote-no", k.t - k.last_expire end
      if n > 0 or clip ~= "idle" then
        local who = (k.stats.served + hi) % #COATS + 1
        nova.model("character-human", st.cx + d[1] * 1.15, 0, st.cz + d[2] * 1.15, { ry = math.atan(-d[1], -d[2]), scale = 1.5, clip = clip, time = time, tint = COATS[who] })
      end
    end
  end
end

-- the apprentice
function View.draw_chef(k, t)
  local c = k.chef
  if c.dead > 0 then
    -- the burn: down they go
    local act = c.act
    if act and act.clip == "die" then nova.model("character-human", c.x, 0, c.z, { ry = math.atan(c.fx, c.fz), scale = 1.6, clip = "die", time = math.min(1.2, k.t - act.t0), loop = false }) end
    return
  end
  local ry = math.atan(c.fx, c.fz)
  -- Kenney's character has clips for idle, walk, sprint, pick-up, holding, interact, die and the emotes
  local speed = math.sqrt(c.vx * c.vx + c.vz * c.vz)
  local base = (c.dash_t > 0) and "sprint" or ((speed > 0.5) and "walk" or "idle")
  local layers = { { clip = base, time = t * ((c.dash_t > 0) and 1.2 or math.max(0.7, speed / 3)), weight = 1 } }
  -- a one-off action (taking, serving, a no) replaces the walk; carrying keeps the arms out in front; grinding and stirring work the right hand
  local act = c.act
  if act and k.t - act.t0 < act.dur then
    layers = { { clip = act.clip, time = k.t - act.t0, weight = 1 } }
  elseif c.work and c.work >= 1 then
    layers = { { clip = "interact-right", time = t * 1.5, weight = 1 } }
  elseif c.held then
    layers[#layers + 1] = { clip = "holding-both", time = 0, weight = 1, mask = { "arm-left", "arm-right" } }
  end
  nova.model("character-human", c.x, 0, c.z, { ry = ry, scale = 1.6, layers = layers })
  -- the ring that says who is who, and the hat
  local n = 32
  for i = 0, n - 1 do
    local a, b = i / n * math.pi * 2, (i + 1) / n * math.pi * 2
    nova.line3(c.x + math.cos(a) * 0.55, 0.03, c.z + math.sin(a) * 0.55, c.x + math.cos(b) * 0.55, 0.03, c.z + math.sin(b) * 0.55, { color = { 90, 170, 255 }, width = 0.08 })
  end
  local bob = (c.moving and math.abs(math.sin(t * 14)) * 0.04 or 0)
  nova.cuboid(c.x - 0.16, 1.0 + bob, c.z - 0.16, c.x + 0.16, 1.08 + bob, c.z + 0.16, { color = { 250, 250, 252 } })
  nova.cuboid(c.x - 0.21, 1.08 + bob, c.z - 0.21, c.x + 0.21, 1.3 + bob, c.z + 0.21, { color = { 255, 255, 255 } })
  if c.held then View.item(c.held, c.x + c.fx * 0.5, 0.82, c.z + c.fz * 0.5, t) end
  -- which station they face: a bright frame round its top
  local st = c.target_st
  if st and k.playing then
    local a, b = 0.5, 0.44
    local col = { color = { 255, 240, 170 }, glow = true }
    nova.cuboid(st.cx - a, TOP_H, st.cz - a, st.cx + a, TOP_H + 0.03, st.cz - b, col)
    nova.cuboid(st.cx - a, TOP_H, st.cz + b, st.cx + a, TOP_H + 0.03, st.cz + a, col)
    nova.cuboid(st.cx - a, TOP_H, st.cz - b, st.cx - b, TOP_H + 0.03, st.cz + b, col)
    nova.cuboid(st.cx + b, TOP_H, st.cz - b, st.cx + a, TOP_H + 0.03, st.cz + b, col)
  end
  -- the dash needs a moment to come back: a short bar at their feet
  if c.dash_cd > 0 then
    nova.cuboid(c.x - 0.25, 0.02, c.z + 0.42, c.x + 0.25, 0.05, c.z + 0.48, { color = { 40, 30, 28 } })
    nova.cuboid(c.x - 0.25, 0.03, c.z + 0.42, c.x - 0.25 + 0.5 * (1 - c.dash_cd / 0.9), 0.06, c.z + 0.48, { color = { 250, 214, 90 } })
  end
  -- a dash leaves a puff behind
  if c.dash_t > 0 then
    nova.cuboid(c.x - c.fx * 0.4 - 0.12, 0.05, c.z - c.fz * 0.4 - 0.12, c.x - c.fx * 0.4 + 0.12, 0.3, c.z - c.fz * 0.4 + 0.12, { color = { 250, 250, 255 } })
  end
end

local function tint_of(floor, biome, cx, cz, k, t)
  local base = ((cx + cz) % 2 == 0) and biome.floor or biome.floor2
  local shade = 1
  if floor == "ice" then return mix({ 150, 206, 250 }, { 214, 238, 255 }, ((cx + cz) % 2) * 0.5) end
  if floor == "mud" then return { 96, 74, 52 } end
  if floor == "pulse" then
    local burning, soon = k:pulse_burning(cx, cz, t)
    if burning then return { 255, 120, 40 } end
    if soon then return (math.floor(t * 8) % 2 == 0) and { 255, 170, 60 } or { 120, 70, 50 } end
    return { 110, 76, 64 }
  end
  return mul(base, shade)
end

-- everything: `t` is the time in seconds
function View.draw(k, biome, t)
  local cols, rows = k.cols, k.rows
  View.environment(k, biome, t)
  for z = 1, rows do
    for x = 1, cols do
      local floor = k.floor[z][x]
      local cx, cz = x - 0.5, z - 0.5
      if floor then
        if floor == "lava" then
          nova.cuboid(x - 1, -0.12, z - 1, x, 0.0, z, { color = { 255, 110 + 40 * math.sin(t * 3 + x), 30 }, glow = true })
        else
          local tn = tint_of(floor, biome, x, z, k, t)
          -- a stone tile: a darker body, a lighter face a little smaller, a few chips in it
          nova.cuboid(x - 1, -0.06, z - 1, x, -0.005, z, { color = mul(tn, 0.68) })
          nova.cuboid(x - 0.965, -0.01, z - 0.965, x - 0.035, 0.012, z - 0.035, { color = mul(tn, 1 + (((x * 5 + z * 11) % 5) - 2) * 0.012) })
          local h = (x * 31 + z * 17) % 7
          if h < 3 and floor == "floor" then
            local ox, oz = 0.2 + h * 0.18, 0.25 + ((x + z) % 3) * 0.2
            nova.cuboid(x - 1 + ox, 0.012, z - 1 + oz, x - 1 + ox + 0.12, 0.02, z - 1 + oz + 0.09, { color = mul(tn, 0.86) })
          end
          if floor == "ice" then nova.cuboid(x - 0.9, 0.013, z - 0.9, x - 0.1, 0.02, z - 0.1, { color = { 196, 230, 255 }, glow = true }) end
          if floor:sub(1, 5) == "belt:" then
            local dir = ({ [">"] = { 1, 0 }, ["<"] = { -1, 0 }, ["^"] = { 0, -1 }, w = { 0, 1 } })[floor:sub(6)]
            for i = 0, 2 do
              local ph = ((t * 0.9 + i / 3) % 1) - 0.5
              local px, pz = cx + dir[1] * ph * 0.9, cz + dir[2] * ph * 0.9
              nova.cuboid(px - 0.2 + math.abs(dir[2]) * 0.0, 0.005, pz - 0.2, px + 0.2, 0.03, pz + 0.2, { color = { 250, 214, 90 } })
            end
          end
        end
      elseif k.solid[z][x] and not k.station[z][x] then
        local line = k.level.map[z]
        local ch = line:sub(x, x)
        if ch == "#" then
          local wc = biome.wall
          if z == rows then
            nova.cuboid(x - 1, 0, z - 0.64, x, 0.22, z - 0.36, { color = mul(wc, 0.9) })
          else
            nova.cuboid(x - 1, 0, z - 1, x, 0.78, z, { color = mul(wc, 0.9) })
            nova.cuboid(x - 1.02, 0.78, z - 1.02, x + 0.02, 0.9, z + 0.02, { color = mul(wc, 1.15) })
            for hgt = 0.26, 0.52, 0.26 do nova.cuboid(x - 1, hgt, z, x, hgt + 0.025, z + 0.012, { color = mul(wc, 0.62) }) end
            nova.cuboid(x - 0.5, 0, z, x - 0.475, 0.26, z + 0.012, { color = mul(wc, 0.62) })
            nova.cuboid(x - 0.25, 0.26, z, x - 0.225, 0.52, z + 0.012, { color = mul(wc, 0.62) })
            nova.cuboid(x - 0.75, 0.26, z, x - 0.725, 0.52, z + 0.012, { color = mul(wc, 0.62) })
          end
        end
      end
    end
  end
  for _, st in ipairs(k.stations) do View.draw_station(st, k, biome, t) end
  for st in pairs(k.marks or {}) do
    local pulse = 0.5 + 0.5 * math.sin(t * 6)
    local a, b = 0.52, 0.44 - 0.02 * pulse
    local col = { color = { 255, 214, 90 }, glow = true }
    nova.cuboid(st.cx - a, TOP_H, st.cz - a, st.cx + a, TOP_H + 0.05, st.cz - b, col)
    nova.cuboid(st.cx - a, TOP_H, st.cz + b, st.cx + a, TOP_H + 0.05, st.cz + a, col)
    nova.cuboid(st.cx - a, TOP_H, st.cz - b, st.cx - b, TOP_H + 0.05, st.cz + b, col)
    nova.cuboid(st.cx + b, TOP_H, st.cz - b, st.cx + a, TOP_H + 0.05, st.cz + b, col)
    nova.cuboid(st.cx - 0.07, TOP_H + 1.1 + 0.1 * pulse, st.cz - 0.07, st.cx + 0.07, TOP_H + 1.5 + 0.1 * pulse, st.cz + 0.07, col)
  end
  for _, d in ipairs(k.drops) do
    nova.cuboid(d.x - 0.16, 0.0, d.z - 0.16, d.x + 0.16, 0.02, d.z + 0.16, { color = { 30, 24, 20 } })
    View.item(d.item, d.x, 0.04 + 0.03 * math.sin(t * 4 + d.x), d.z, t)
  end
  for _, s in ipairs(k.shots) do
    local u = s.travel / s.range
    nova.cuboid(s.x - 0.12, 0.0, s.z - 0.12, s.x + 0.12, 0.02, s.z + 0.12, { color = { 30, 24, 20 } })
    View.item(s.item, s.x, 0.55 + math.sin(math.pi * math.min(1, u)) * 0.8, s.z, t)
  end
  k.chef.target_st = k:target()
  View.draw_chef(k, t)
end

-- ---- the place round the kitchen: a platform in water, a house behind it, bridges, lily pads (and the other biomes' versions) -----------------------------------

local WATER = { meadow = { 58, 128, 204 }, frost = { 150, 204, 238 }, ember = { 255, 104, 30 }, mire = { 46, 84, 70 } }

local function rand_for(seed)
  return function(n)
    seed = (seed * 48271) % 2147483647
    return seed % n + 1
  end
end

-- a row of house along the north edge: two storeys of Kenney's town walls, a roof, a chimney
local function house(x0, x1, z, tint, roof_tint, t)
  local panels = { "wall-window-shutters", "wall-wood", "wall-window-glass", "wall-door", "wall-wood", "wall-window-shutters" }
  local i = 0
  for x = math.floor(x0), math.ceil(x1) do
    i = i + 1
    local p = panels[(i + 1) % #panels + 1]
    nova.model(p, x + 0.5, 0, z, { ry = math.pi / 2, tint = tint, shadow = false })
    nova.model(i % 3 == 0 and "wall-window-shutters" or "wall-wood", x + 0.5, 1, z, { ry = math.pi / 2, tint = tint, shadow = false })
    nova.model("roof", x + 0.5, 2, z, { ry = 0, tint = roof_tint, shadow = false })
  end
  nova.model("chimney", x0 + 2.5, 2.4, z - 0.2, { scale = 1.4, tint = { 150, 120, 110 }, shadow = false })
end

function View.environment(k, biome, t)
  local cols, rows = k.cols, k.rows
  local id = biome.id
  local rand = rand_for(#id * 977 + cols * 31 + rows)
  local water = WATER[id]
  -- the water, a little alive
  nova.cuboid(-60, -1.2, -60, cols + 60, -0.42, rows + 60, { color = mul(water, 0.7) })
  nova.cuboid(-60, -0.42, -60, cols + 60, -0.38, rows + 60, { color = water, glow = id == "ember" })
  for i = 1, 18 do
    local x = (i * 3.7 + t * 0.15 * (i % 3 + 1)) % (cols + 24) - 12
    local z = rand(rows + 18) - 9
    nova.cuboid(x, -0.37, z, x + 0.9 + (i % 3) * 0.4, -0.355, z + 0.05, { color = mix(water, { 255, 255, 255 }, 0.35) })
  end
  -- the platform the kitchen stands on: a stone rim all round
  nova.cuboid(-0.35, -0.7, -0.35, cols + 0.35, -0.03, rows + 0.35, { color = mul(biome.wall, 1.1) })
  nova.cuboid(-0.3, -0.08, -0.3, cols + 0.3, -0.03, rows + 0.3, { color = mul(biome.wall, 1.3) })
  if id == "meadow" or id == "frost" then
    local snow = id == "frost"
    local wall_tint = snow and { 225, 232, 245 } or { 255, 240, 220 }
    local roof_tint = snow and { 240, 244, 255 } or { 214, 120, 90 }
    house(-3, cols + 3, -1.4, wall_tint, roof_tint, t)
    -- two bridges leading away on the sides
    for side = -1, 1, 2 do
      for i = 1, 5 do
        local x = side < 0 and (-0.5 - i) or (cols + 0.5 + i)
        nova.model(snow and "bridge_stone" or "bridge_wood", x, -0.05, rows / 2, { ry = math.pi / 2 })
      end
    end
  elseif id == "ember" then
    for i = -4, cols + 4 do
      nova.model((i % 2 == 0) and "rock_tallA" or "stone_tallB", i + 0.5, -0.1, -1.6 - (i % 3) * 0.4, { scale = 1.8, ry = i, shadow = false })
    end
  else
    nova.model("crypt-small", cols / 2, -0.1, -2.4, { scale = 1.6, shadow = false })
    for i = -3, cols + 3, 2 do nova.model("iron-fence", i + 0.5, -0.1, -0.7, { shadow = false }) end
    nova.model("lantern-candle", -0.5, -0.1, -0.5, { scale = 2.2 })
    nova.model("lantern-candle", cols + 0.5, -0.1, -0.5, { scale = 2.2 })
  end
  -- lily pads and flowers (or whatever floats), and the scenery round about
  for i = 1, 22 do
    local x, z = rand(cols + 26) - 13, rand(rows + 20) - 8
    local inside = x > -1 and x < cols + 1 and z > -1.5 and z < rows + 1
    if not inside then
      if id == "meadow" or id == "mire" then
        nova.model(rand(2) == 1 and "lily_large" or "lily_small", x, -0.38, z, { scale = 2.4, ry = rand(628) / 100, shadow = false })
      else
        nova.cuboid(x - 0.4, -0.4, z - 0.4, x + 0.4, -0.3, z + 0.4, { color = id == "frost" and { 240, 246, 255 } or { 90, 60, 50 } })
      end
    end
  end
  local list = biome.decor
  for i = 1, 26 do
    local x, z = rand(cols + 30) - 15, rand(rows + 26) - 12
    local inside = x > -3 and x < cols + 3 and z > -4 and z < rows + 2
    if not inside then
      nova.model(list[rand(#list)], x, -0.4, z, { ry = rand(628) / 100, scale = 1.4 + rand(60) / 100, shadow = false })
    end
  end
end

-- (the old ring of scenery is gone: View.environment draws the place now)
function View.scenery() end

-- ---- the scenery outside ------------------------------------------------------------------------------------------------------------

-- a ring of trees, rocks and the like round the workshop, the same every time for a biome and a size
function View.scenery(k, biome, t)
  local cols, rows = k.cols, k.rows
  local seed = (#biome.id * 7919 + cols * 31 + rows) % 2147483647
  local function rand(n)
    seed = (seed * 48271) % 2147483647
    return seed % n + 1
  end
  local list = biome.decor
  for i = 1, 70 do
    local side = rand(4)
    local x, z
    if side == 1 then x, z = -rand(70) / 8 - 0.5, rand(rows + 24) - 12
    elseif side == 2 then x, z = cols + rand(70) / 8 + 0.5, rand(rows + 24) - 12
    elseif side == 3 then x, z = rand(cols + 24) - 12, -rand(70) / 8 - 0.5
    else x, z = rand(cols + 24) - 12, rows + rand(40) / 8 + 0.6 end
    local m = list[rand(#list)]
    nova.model(m, x, 0, z, { ry = rand(628) / 100, scale = 0.8 + rand(50) / 100, shadow = false })
  end
end

-- ---- the apothecary: the backdrop of the menus, the title and the book ------------------------------------------------------------------

function View.setup_apothecary(smooth)
  nova.light { dir = { -0.35, -0.8, -0.5 }, color = { 150, 130, 200 }, ambient = { 84, 70, 120 } }
  nova.sky { top = { 22, 16, 46 }, horizon = { 58, 38, 78 } }
  nova.fog { color = { 40, 28, 62 }, near = 16, far = 46 }
  nova.shadows { radius = 14, strength = 0.5 }
  nova.look { toon = 3, outline = { color = { 20, 12, 30 }, strength = 0.6, width = 1 }, saturation = 1.05, vignette = 0.38, bloom = 0.45, bloom_threshold = 0.7, fxaa = smooth and 1 or 0 }
  nova.weather()
end

local SHELF_COLOURS = { "heal", "night", "swift", "frost", "fire", "bog", "ember", "mire", "panacea" }

-- a wizard's workbench at night: the cauldron bubbling over in the middle, shelves of glowing potions, books, a candle, the moon in the window.
-- shift moves the whole picture sideways on the screen (room for the menus).
function View.apothecary(t, shift, w, h)
  nova.point_light(-1.6, 2.4, -0.4, { radius = 8, color = { 255, 186, 110 } })
  nova.point_light(0, 2.9, 0.8, { radius = 6, color = { 170, 110, 255 } })
  nova.point_light(4.2, 4.6, -1.0, { radius = 9, color = { 130, 160, 255 } })
  local wood, dark = { 148, 98, 74 }, { 96, 62, 52 }
  -- the room
  nova.cuboid(-14, -0.1, -4, 14, 0.0, 9, { color = { 66, 46, 56 } })
  nova.cuboid(-14, 0, -2.3, 14, 8, -2.1, { color = { 62, 46, 92 } })
  for i = -10, 10 do nova.cuboid(i * 1.3 - 0.03, 0, -2.08, i * 1.3 + 0.03, 8, -2.05, { color = { 44, 32, 70 } }) end
  -- the window and the moon
  nova.cuboid(3.4, 3.6, -2.08, 5.2, 5.6, -2.0, { color = { 190, 204, 255 }, glow = true })
  nova.cuboid(4.25, 3.6, -2.0, 4.35, 5.6, -1.95, { color = dark })
  nova.cuboid(3.4, 4.55, -2.0, 5.2, 4.65, -1.95, { color = dark })
  nova.cuboid(3.3, 3.5, -2.0, 5.3, 3.6, -1.9, { color = wood })
  nova.cuboid(3.3, 5.6, -2.0, 5.3, 5.7, -1.9, { color = wood })
  -- the shelves with the potions
  nova.cuboid(-6.4, 3.0, -2.1, 3.0, 3.12, -1.3, { color = wood })
  for i, id in ipairs(SHELF_COLOURS) do
    local c = data.recipes[id].color
    local x = -5.6 + (i - 1) * 0.95
    flask(x, 3.12, -1.7, c, 2.2, true)
  end
  nova.cuboid(-6.4, 4.5, -2.1, 3.0, 4.62, -1.3, { color = wood })
  local spines = { { 150, 60, 80 }, { 70, 100, 150 }, { 90, 130, 90 }, { 180, 140, 60 }, { 110, 80, 150 } }
  for i = 0, 17 do
    local c = spines[i % #spines + 1]
    local hgt = 0.7 + (i * 37 % 5) * 0.08
    nova.cuboid(-6.2 + i * 0.3, 4.62, -2.0, -5.95 + i * 0.3, 4.62 + hgt, -1.5, { color = c })
  end
  -- herbs hanging on the wall
  for i, id in ipairs({ "glowcap", "moonberry", "sunpetal", "frostroot", "embergourd", "bogbulb" }) do
    nova.model(data.ingredients[id].model, -5.6 + (i - 1) * 1.1, 5.4 + 0.08 * math.sin(t * 1.5 + i), -2.0, { scale = 2.4, ry = 0.3 * math.sin(t + i) })
  end
  -- the table
  nova.cuboid(-8, 0.82, -1.5, 8, 1.0, 1.9, { color = wood })
  nova.cuboid(-8, 0, 1.7, 8, 0.82, 1.9, { color = dark })
  nova.cuboid(-8, 0, -1.5, -7.8, 0.82, 1.7, { color = dark })
  -- the cauldron, bubbling
  nova.model("cauldron", 0, 1.0, 0, { scale = 2.7 })
  -- the apprentice, waving from the table, and a plume over the pot
  nova.model("character-human", -1.7, 1.0, 0.7, { scale = 2.6, ry = 0.5, clip = "emote-yes", time = t % 1.4 })
  local tick = math.floor(t * 7)
  if tick ~= View.plume_tick then
    View.plume_tick = tick
    nova.burst(0, 2.1, 0, { sprite = "fx/puff", count = 1, life = { 1.2, 2.0 }, speed = { 0.5, 1.0 }, spread = 0.5, gravity = 0.2, size = 0.5, size_end = 2.4, color = { 200, 150, 255, 140 }, color_end = { 200, 150, 255, 0 }, max = 24 })
    if tick % 3 == 0 then nova.burst(math.sin(t) * 0.5, 2.0, 0, { sprite = "fx/spark", count = 1, life = { 1.0, 1.8 }, speed = { 0.8, 1.6 }, spread = 0.6, gravity = 0, size = 0.3, size_end = 0.05, color = { 255, 240, 160, 255 }, color_end = { 255, 240, 160, 0 }, max = 16 }) end
  end
  local top = 1.0 + 0.36 * 2.7
  local pulse = 0.5 + 0.5 * math.sin(t * 2.2)
  nova.cuboid(-0.5, top - 0.06, -0.64, 0.5, top + 0.02 + 0.03 * pulse, 0.64, { color = { 130 + 60 * pulse, 70, 230 }, glow = true })
  for i = 1, 7 do
    local ph = (t * 0.45 + i * 0.143) % 1
    local bx = math.sin(i * 2.3) * 0.38
    local bz = math.cos(i * 1.7) * 0.4
    local s = 0.07 + 0.05 * math.sin(i)
    nova.billboard("fx/bubble", bx, top + 0.1 + ph * 1.6, bz, s * 3, { color = { 210, 170, 255, math.floor(255 * (1 - ph)) } })
  end
  -- sparkles drifting round it
  for i = 1, 16 do
    local a = t * (0.3 + (i % 4) * 0.08) + i * 0.7
    local r = 1.2 + 0.5 * math.sin(i)
    local y = 1.8 + ((t * 0.25 + i * 0.13) % 1) * 2.4
    local x, z = math.cos(a) * r, math.sin(a) * r * 0.6
    local s = 0.035 + 0.02 * ((i % 3) / 2)
    local c = (i % 2 == 0) and { 255, 230, 140 } or { 210, 180, 255 }
    nova.billboard("fx/spark", x, y, z, s * 7, { color = { c[1], c[2], c[3], math.floor(200 + 55 * math.sin(t * 5 + i)) } })
  end
  -- the things on the table
  nova.cuboid(-3.4, 1.0, 0.2, -2.0, 1.12, 0.9, { color = { 150, 60, 80 } })
  nova.cuboid(-3.3, 1.12, 0.25, -2.1, 1.24, 0.85, { color = { 70, 100, 150 } })
  nova.cuboid(-3.2, 1.24, 0.3, -2.2, 1.36, 0.8, { color = { 90, 130, 90 } })
  nova.cuboid(-2.0, 1.0, -0.7, -1.2, 1.12, 0.1, { color = { 176, 172, 184 } })
  nova.cuboid(-1.9, 1.12, -0.6, -1.3, 1.34, 0.0, { color = { 150, 146, 156 } })
  nova.model("candle-multiple", -1.6, 1.0, -0.95, { scale = 2.2 })
  for i, id in ipairs({ "heal", "frost", "panacea", "mire" }) do
    flask(2.0 + (i - 1) * 0.62, 1.0, 0.5 + (i % 2) * 0.35, data.recipes[id].color, 2.4, true)
  end
  nova.model("mushroom_redGroup", 3.5, 1.0, -0.6, { scale = 2.2, shadow = true })
  nova.model("lantern-candle", 4.6, 1.0, 0.2, { scale = 1.8 })
  -- the camera
  nova.camera(-(shift or 0) + math.sin(t * 0.25) * 0.35, 4.3, 7.0, -(shift or 0) * 0.9, 1.7, 0.2, 40)
end

-- ---- the pictures for the store (icon and box art) ------------------------------------------------------------------------------

-- a long worktop with a crate, the mortar, a cauldron bubbling over and a row of finished potions, the apprentice holding one up in front, trees behind
function View.showcase(biome, t, kind, w, h)
  local k = { rules = { burn = false }, cols = 11, rows = 2, solid = {}, floor = {}, station = {}, level = { map = {} }, stations = {} }
  local function st(kind_, x, extra)
    local s = { kind = kind_, x = x, z = 1, cx = x - 0.5, cz = 0.5 }
    for key, v in pairs(extra or {}) do s[key] = v end
    return s
  end
  local list = {
    st("crate", 1, { ing = "glowcap" }), st("crate", 2, { ing = "moonberry" }), st("mortar", 3, { progress = 0 }),
    st("cauldron", 4, { items = {}, state = "brewing", recipe = "night", timer = 2.5, total = 6 }),
    st("cauldron", 5, { items = {}, state = "done", recipe = "heal", timer = 1, total = 6 }),
    st("counter", 6, { item = { k = "potion", recipe = "frost" } }), st("counter", 7, { item = { k = "potion", recipe = "fire" } }),
    st("counter", 8, { item = { k = "potion", recipe = "swift" } }), st("counter", 9, { item = { k = "potion", recipe = "panacea" } }),
    st("bottles", 10), st("hatch", 11),
  }
  nova.cuboid(-40, -0.3, -40, 60, -0.02, 40, { color = biome.ground })
  nova.cuboid(0, -0.06, 1.0, 11, 0.0, 4, { color = biome.floor })
  for _, s in ipairs(list) do View.draw_station(s, k, biome, t) end
  nova.model("character-human", 5.5, 0, 2.3, { ry = 0.15, scale = 1.7 })
  View.item({ k = "potion", recipe = "heal" }, 5.62, 1.05, 2.2, t)
  -- trees and flowers behind and about
  local seed = 5
  local function rand(n) seed = (seed * 48271) % 2147483647; return seed % n + 1 end
  for i = 1, 40 do
    local x, z = rand(220) / 10 - 5.5, -rand(60) / 10 - 0.8
    nova.model(biome.decor[rand(#biome.decor)], x, 0, z, { ry = rand(628) / 100, scale = 0.9 + rand(60) / 100, shadow = false })
  end
  if kind == "icon" then nova.camera(4.9, 2.7, 5.6, 4.9, 0.7, 1.0, 46)
  elseif kind == "portrait" then nova.camera(5.5, 5.4, 11.5, 5.5, 0.2, 1.2, 46)
  else nova.camera(5.4, 3.9, 8.8, 5.4, 0.5, -0.9, 38) end
end

return View

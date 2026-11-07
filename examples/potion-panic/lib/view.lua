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
  nova.shadows { radius = 22, strength = 0.55 }
  -- a storybook look: three bands of light, a warm brown line round things, a little glow, a soft vignette
  nova.look { toon = 3, outline = { color = { 36, 26, 40 }, strength = 0.7, width = 1 }, saturation = 1.0, vignette = 0.3, bloom = 0.3, bloom_threshold = 0.82, fxaa = smooth and 1 or 0 }
  if biome.snow then nova.weather({ kind = "snow", count = 260, fall = 2.2, drift = 1.2 }) else nova.weather() end
end

function View.leave()
  nova.weather(); nova.sky(nil); nova.fog(nil); nova.shadows(nil)
end

-- ---- the camera -------------------------------------------------------------------------------------------------------------------

local cam = { ex = 0, ey = 10, ez = 8, tx = 0, ty = 0, tz = 0, fov = 40 }

-- `lower` moves the picture down the screen (room for the orders along the top)
function View.camera(k, lower, w, h, shiftx, orbit, zoom)
  local cx, cz = k.cols / 2 - (shiftx or 0), k.rows / 2
  local aspect = (w or 960) / (h or 540)
  local half = math.tan(math.rad(cam.fov / 2))
  -- far enough away that the whole workshop fits across and up the screen
  local need_w = (k.cols + 0.5) / (2 * half * aspect)
  local need_h = (k.rows + 0.4) / (2 * half) * 1.1
  local d = math.max(need_w, need_h, 9) * (zoom or 1)
  cam.ex, cam.ey, cam.ez = cx + (orbit or 0), d * 0.84, cz + d * 0.66
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
  s = s or 1
  nova.cuboid(x - 0.1 * s, y, z - 0.1 * s, x + 0.1 * s, y + 0.15 * s, z + 0.1 * s, { color = color, glow = glow })
  nova.cuboid(x - 0.045 * s, y + 0.15 * s, z - 0.045 * s, x + 0.045 * s, y + 0.25 * s, z + 0.045 * s, { color = mul(color, 0.85) })
  nova.cuboid(x - 0.055 * s, y + 0.25 * s, z - 0.055 * s, x + 0.055 * s, y + 0.3 * s, z + 0.055 * s, { color = { 176, 122, 70 } })
end

function View.item(item, x, y, z, t)
  if not item then return end
  if item.k == "ing" then
    if item.ground then
      local c = POWDER[item.id] or { 220, 220, 220 }
      nova.cuboid(x - 0.15, y, z - 0.15, x + 0.15, y + 0.06, z + 0.15, { color = mul(c, 0.8) })
      nova.cuboid(x - 0.09, y + 0.06, z - 0.09, x + 0.09, y + 0.13, z + 0.09, { color = c })
    else
      nova.model(data.ingredients[item.id].model, x, y, z, { ry = (t or 0) * 0.0 })
    end
  elseif item.k == "bottle" then
    nova.model("potion", x, y, z, { scale = 0.8 })
  elseif item.k == "potion" then
    local c = (item.recipe == "sludge") and { 70, 64, 40 } or data.recipes[item.recipe].color
    flask(x, y, z, c, 1.2)
  end
end

-- ---- the workshop -----------------------------------------------------------------------------------------------------------------

local function counter(st, biome)
  nova.cuboid(st.cx - 0.5, 0, st.cz - 0.5, st.cx + 0.5, COUNTER_H, st.cz + 0.5, { color = biome.counter })
  nova.cuboid(st.cx - 0.5, COUNTER_H, st.cz - 0.5, st.cx + 0.5, TOP_H, st.cz + 0.5, { color = biome.top })
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
    nova.model("chest", x, TOP_H - 0.04, z, { scale = 1.2 })
    local m = data.ingredients[st.ing].model
    nova.model(m, x - 0.16, TOP_H + 0.36, z + 0.02)
    nova.model(m, x + 0.16, TOP_H + 0.36, z - 0.06)
  elseif kind == "bottles" then
    counter(st, biome)
    for i = -1, 1 do nova.model("potion", x + i * 0.27, TOP_H, z + (i % 2) * 0.1, { scale = 0.9 }) end
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
        nova.model(data.ingredients[st.item.id].model, x, TOP_H + 0.2, z, { scale = 0.8 })
        if st.progress > 0 then
          local wobble = math.sin(t * 30) * 0.06
          nova.model("mortar", x + wobble, TOP_H + 0.16, z, { scale = 0.55, rz = wobble * 2 })
          bar(x, TOP_H + 0.95, z, st.progress, { 250, 214, 90 })
        end
      end
    end
  elseif kind == "cauldron" then
    counter(st, biome)
    nova.model("cauldron", x, TOP_H, z, { scale = 0.95 })
    local top = TOP_H + 0.36
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
    nova.cuboid(x - 0.2, top - 0.03, z - 0.25, x + 0.2, top + 0.0 + 0.02 * pulse, z + 0.25, { color = liquid, glow = glow or st.state == "brewing" })
    if st.state == "idle" then
      for i, it in ipairs(st.items) do
        View.item(it, x + (i - 2) * 0.22, TOP_H + 0.62 + 0.04 * math.sin(t * 3 + i), z, t)
      end
    elseif st.state == "brewing" then
      bar(x, TOP_H + 0.85, z, st.timer / st.total, recipe and recipe.color or { 200, 200, 200 })
      if st.stirred and k.t - st.stirred < 0.15 then
        local a = k.t * 14
        nova.cuboid(x + math.cos(a) * 0.12 - 0.03, top - 0.05, z + math.sin(a) * 0.12 - 0.03, x + math.cos(a) * 0.12 + 0.03, top + 0.5, z + math.sin(a) * 0.12 + 0.03, { color = { 190, 140, 90 } })
      end
      -- bubbles
      for i = 1, 3 do
        local ph = (t * 0.9 + i * 0.33) % 1
        nova.cuboid(x + (i - 2) * 0.14 - 0.035, top + 0.05 + ph * 0.28, z - 0.035 + 0.05 * i, x + (i - 2) * 0.14 + 0.035, top + 0.11 + ph * 0.28, z + 0.035 + 0.05 * i, { color = mul(liquid, 1.25), glow = true })
      end
    elseif st.state == "done" then
      -- ready: a bouncing flask over it, and a shrinking bar of time before it burns
      flask(x, TOP_H + 0.75 + 0.06 * math.sin(t * 6), z, recipe and recipe.color or { 200, 200, 200 }, 1.1)
      if k.rules.burn then
        local left = 1 - st.timer / k.burn_after
        local hot = left < 0.34 and math.floor(t * 8) % 2 == 0
        bar(x, TOP_H + 1.2, z, left, hot and { 255, 255, 255 } or { 235, 96, 70 })
      end
      for i = 1, 3 do
        local ph = (t * 0.7 + i * 0.33) % 1
        nova.cuboid(x - 0.08 + (i - 2) * 0.12, TOP_H + 0.4 + ph * 0.3, z - 0.08, x + 0.08 + (i - 2) * 0.12, TOP_H + 0.5 + ph * 0.3, z + 0.08, { color = { 245, 245, 250 }, glow = true })
      end
    elseif st.state == "burnt" then
      for i = 1, 3 do
        local ph = (t * 0.6 + i * 0.3) % 1
        nova.cuboid(x - 0.1 + (i - 2) * 0.1, top + 0.1 + ph * 0.8, z - 0.1, x + 0.1 + (i - 2) * 0.1, top + 0.3 + ph * 0.8, z + 0.1, { color = { 60, 56, 56 } })
      end
    end
  elseif kind == "hatch" then
    counter(st, biome)
    nova.model("hatch", x, TOP_H - 0.04, z, { scale = 0.8, ry = math.pi })
    nova.cuboid(x - 0.46, TOP_H, z - 0.46, x + 0.46, TOP_H + 0.03, z + 0.46, { color = { 250, 222, 130 }, glow = true })
  elseif kind == "bin" then
    counter(st, biome)
    nova.model("barrel", x, TOP_H - 0.04, z, { scale = 1.3, tint = { 120, 110, 120 } })
  end
end

-- the apprentice
function View.draw_chef(k, t)
  local c = k.chef
  if c.dead > 0 then
    -- the burn: down they go
    local act = c.act
    if act and act.clip == "die" then nova.model("character-human", c.x, 0, c.z, { ry = math.atan(c.fx, c.fz), scale = 1.35, clip = "die", time = math.min(1.2, k.t - act.t0), loop = false }) end
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
  nova.model("character-human", c.x, 0, c.z, { ry = ry, scale = 1.35, layers = layers })
  if c.held then View.item(c.held, c.x + c.fx * 0.42, 0.62, c.z + c.fz * 0.42, t) end
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
  -- the ground under and round it all
  nova.cuboid(-40, -0.3, -40, cols + 40, -0.02, rows + 40, { color = biome.ground })
  for z = 1, rows do
    for x = 1, cols do
      local floor = k.floor[z][x]
      local cx, cz = x - 0.5, z - 0.5
      if floor then
        if floor == "lava" then
          nova.cuboid(x - 1, -0.12, z - 1, x, 0.0, z, { color = { 255, 110 + 40 * math.sin(t * 3 + x), 30 }, glow = true })
        else
          nova.cuboid(x - 1, -0.06, z - 1, x, 0.0, z, { color = mul(tint_of(floor, biome, x, z, k, t), 0.7) })
          nova.cuboid(x - 0.97, -0.01, z - 0.97, x - 0.03, 0.012, z - 0.03, { color = tint_of(floor, biome, x, z, k, t) })
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
          local wc = mul(biome.wall, 0.78)
          if z == rows then
            nova.cuboid(x - 1, 0, z - 0.62, x, 0.16, z - 0.38, { color = wc })
          else
            nova.cuboid(x - 1, 0, z - 1, x, 0.62, z, { color = wc })
            nova.cuboid(x - 1, 0.62, z - 1, x, 0.7, z, { color = mul(biome.wall, 0.95) })
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
  local top = 1.0 + 0.36 * 2.7
  local pulse = 0.5 + 0.5 * math.sin(t * 2.2)
  nova.cuboid(-0.5, top - 0.06, -0.64, 0.5, top + 0.02 + 0.03 * pulse, 0.64, { color = { 130 + 60 * pulse, 70, 230 }, glow = true })
  for i = 1, 7 do
    local ph = (t * 0.45 + i * 0.143) % 1
    local bx = math.sin(i * 2.3) * 0.38
    local bz = math.cos(i * 1.7) * 0.4
    local s = 0.07 + 0.05 * math.sin(i)
    nova.cuboid(bx - s, top + 0.1 + ph * 1.6, bz - s, bx + s, top + 0.1 + ph * 1.6 + s * 2, bz + s, { color = { 190, 150, 255 }, glow = true })
  end
  -- sparkles drifting round it
  for i = 1, 16 do
    local a = t * (0.3 + (i % 4) * 0.08) + i * 0.7
    local r = 1.2 + 0.5 * math.sin(i)
    local y = 1.8 + ((t * 0.25 + i * 0.13) % 1) * 2.4
    local x, z = math.cos(a) * r, math.sin(a) * r * 0.6
    local s = 0.035 + 0.02 * ((i % 3) / 2)
    nova.cuboid(x - s, y, z - s, x + s, y + s * 2, z + s, { color = (i % 2 == 0) and { 255, 230, 140 } or { 200, 170, 255 }, glow = true })
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
  nova.camera(-(shift or 0) + math.sin(t * 0.25) * 0.35, 4.1, 5.6, -(shift or 0) * 0.9, 1.5, 0.2, 40)
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

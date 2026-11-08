-- Draws a flat in 3D with Kenney's Furniture Kit: the floor tiles, rugs and walls (as static scenery), the walls nearest the camera cut down to a
-- skirting so nothing hides behind them (a doll's-house view), the furniture with its slides, turns, bumps and squashes, the mover, the client by the
-- front door and the garden outside. Also projects a place in the flat onto the screen, for the hearts and labels drawn over it.
local Rules = require("lib.rules")

local View = {}
View.__index = View

local Q = math.pi / 2
local MOVER = "character-male-e"
local MOVER_SCALE, CLIENT_SCALE = 1.12, 1.12

local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end
local function ease_back(x)
  x = math.max(0, math.min(1, x))
  local c1 = 1.4
  return 1 + (c1 + 1) * (x - 1) ^ 3 + c1 * (x - 1) ^ 2
end
local function rot(x, z, a) return x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a) end
local function angle_to(a, b) local d = (b - a) % (2 * math.pi); if d > math.pi then d = d - 2 * math.pi end; return d end

function View.new(L)
  local v = setmetatable({ L = L, pieces = {}, t = 0, marks = {}, glow = {} }, View)
  v.cx, v.cz = (L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2
  v.wide, v.deep = L.x1 - L.x0 + 1, L.z1 - L.z0 + 1
  -- the walls nearest the camera: a wall along x with floor on its north side would hide that floor, so it is drawn as a skirting
  v.low = {}
  for _, w in ipairs(L.walls) do
    local north_z = w.dz == -1 and w.z - 1 or w.z
    w.low = w.dx == 0 and L.floor[Rules.ckey(w.x, north_z)] ~= nil
  end
  return v
end

-- ---- light, sky and the look ----

function View.setup(smooth)
  nova.light { dir = { -0.45, -1, -0.6 }, color = { 255, 244, 226 }, ambient = { 150, 140, 150 } }
  nova.sky { top = { 150, 196, 226 }, horizon = { 236, 226, 206 } }
  nova.fog { color = { 236, 226, 206 }, near = 30, far = 70 }
  nova.shadows { radius = 14, strength = 0.42 }
  nova.look { toon = 4, outline = { color = { 60, 44, 52 }, strength = 0.5, width = 1 }, saturation = 1.12, vignette = 0.16, bloom = 0.18, bloom_threshold = 0.88, ao = 0.6, ao_radius = 0.6, fxaa = smooth and 1 or 0 }
end

function View.leave()
  nova.sky(nil); nova.fog(nil); nova.shadows(nil); nova.scenery.clear()
end

-- ---- the static parts: floors, rugs, full walls (scenery: drawn with no script running for them) ----

function View:build()
  nova.scenery.clear()
  local L = self.L
  -- (every other tile a shade darker: the grid the furniture moves on reads at a glance)
  for _, f in ipairs(L.floors) do nova.scenery.add(f.kind, f.x, 0, f.z, { shadow = false, tint = (f.x + f.z) % 2 == 0 and { 255, 255, 255 } or { 232, 226, 222 } }) end
  for _, r in ipairs(L.rugs) do nova.scenery.add(r.kind, r.x, 0.012, r.z, { ry = r.q * Q, shadow = false }) end
  for _, w in ipairs(L.walls) do
    if not w.low then nova.scenery.add(w.kind, w.x, 0, w.z, { ry = w.q * Q }) end
  end
end

-- ---- the furniture's places, as drawn ----

-- jumps to a state (the start, an undo, a restart): with a little hop so the change is seen
function View:sync(s, hop)
  for i, p in ipairs(s.pieces) do
    local vp = self.pieces[i] or {}
    vp.kind, vp.x, vp.z, vp.ry, vp.anim = p.kind, p.x, p.z, p.q * Q, nil
    if hop then vp.hop = { t = 0, len = 0.28 } end
    self.pieces[i] = vp
  end
  local m = self.mover or {}
  m.x, m.z, m.ry, m.anim = s.px, s.pz, math.atan(Rules.DIRS[s.f][1], Rules.DIRS[s.f][2]), nil
  m.walk = 0
  self.mover = m
end

-- a step or a push: the mover walks one cell, a pushed piece slides with them
function View:step(old, new, what, d)
  local m = self.mover
  local dx, dz = Rules.DIRS[d][1], Rules.DIRS[d][2]
  m.face = math.atan(dx, dz)
  if what.moved then
    m.anim = { t = 0, len = what.pushed and 0.17 or 0.13, x0 = old.px, z0 = old.pz, x1 = new.px, z1 = new.pz, push = what.pushed ~= nil }
    m.walk = 0.3
  end
  if what.pushed then
    local vp = self.pieces[what.pushed]
    local p0, p1 = old.pieces[what.pushed], new.pieces[what.pushed]
    vp.anim = { kind = "slide", t = 0, len = 0.17, x0 = p0.x, z0 = p0.z, x1 = p1.x, z1 = p1.z, ry = p0.q * Q }
  elseif what.bump == "piece" then
    local vp = self.pieces[what.piece]
    vp.shake = { t = 0, len = 0.24, dx = dx, dz = dz }
    m.recoil = { t = 0, len = 0.2, dx = dx, dz = dz }
  elseif what.bump == "wall" then
    m.recoil = { t = 0, len = 0.18, dx = dx, dz = dz }
  end
end

-- a turn of piece i about the cell in front of the mover (dir -1 clockwise, +1 anticlockwise seen from above)
function View:rotate(old, new, i, dir)
  local p0, p1 = old.pieces[i], new.pieces[i]
  local fx, fz = Rules.DIRS[old.f][1], Rules.DIRS[old.f][2]
  local vp = self.pieces[i]
  vp.anim = { kind = "turn", t = 0, len = 0.24, px = old.px + fx, pz = old.pz + fz, x0 = p0.x, z0 = p0.z, ry0 = p0.q * Q, da = dir * Q, x1 = p1.x, z1 = p1.z }
  self.mover.nudge = { t = 0, len = 0.25 }
end

-- a piece that could not turn: it rocks a little
function View:wobble(i)
  if self.pieces[i] then self.pieces[i].wobble = { t = 0, len = 0.3 } end
end

-- a piece whose wish just came true: it pops
function View:pop(i)
  if self.pieces[i] then self.pieces[i].pop = { t = 0, len = 0.4 } end
end

function View:update(dt)
  self.t = self.t + dt
  for _, vp in ipairs(self.pieces) do
    for _, k in ipairs({ "anim", "shake", "hop", "wobble", "pop" }) do
      local a = vp[k]
      if a then
        a.t = a.t + dt
        if a.t >= a.len then
          if k == "anim" then
            vp.x, vp.z = a.x1, a.z1
            if a.kind == "turn" then vp.ry = a.ry0 + a.da end
            vp.land = { t = 0, len = 0.22 } -- a squash when it arrives
          end
          vp[k] = nil
        end
      end
    end
    if vp.land then vp.land.t = vp.land.t + dt; if vp.land.t >= vp.land.len then vp.land = nil end end
  end
  local m = self.mover
  if m then
    for _, k in ipairs({ "anim", "recoil", "nudge" }) do
      local a = m[k]
      if a then
        a.t = a.t + dt
        if a.t >= a.len then
          if k == "anim" then m.x, m.z = a.x1, a.z1 end
          m[k] = nil
        end
      end
    end
    m.ry = m.ry + angle_to(m.ry, m.face or m.ry) * math.min(1, dt * 18)
    m.walk = math.max(0, (m.walk or 0) - dt)
    m.phase = (m.phase or 0) + dt * (m.walk > 0 and 1 or 0)
  end
  if self.client then
    local c = self.client
    if c.react then c.react.t = c.react.t + dt; if c.react.t > c.react.len then c.react = nil end end
  end
end

-- where a piece is drawn now: x, y, z, ry and its squash (sx, sy)
function View:piece_pose(vp)
  local x, z, ry, y = vp.x, vp.z, vp.ry, 0
  local a = vp.anim
  if a and a.kind == "slide" then
    local k = ease_out(a.t / a.len)
    x, z = a.x0 + (a.x1 - a.x0) * k, a.z0 + (a.z1 - a.z0) * k
  elseif a and a.kind == "turn" then
    local k = ease_back(a.t / a.len)
    local th = a.da * k
    local ox, oz = rot(a.x0 - a.px, a.z0 - a.pz, th)
    x, z, ry = a.px + ox, a.pz + oz, a.ry0 + th
    y = math.sin(math.min(1, a.t / a.len) * math.pi) * 0.16
  end
  if vp.shake then
    local k = vp.shake.t / vp.shake.len
    local s = math.sin(k * math.pi * 5) * (1 - k) * 0.06
    x, z = x + vp.shake.dx * s, z + vp.shake.dz * s
  end
  if vp.wobble then
    local k = vp.wobble.t / vp.wobble.len
    ry = ry + math.sin(k * math.pi * 4) * (1 - k) * 0.12
  end
  if vp.hop then
    local k = vp.hop.t / vp.hop.len
    y = y + math.sin(k * math.pi) * 0.22
  end
  local sx, sy = 1, 1
  if vp.land then
    local k = vp.land.t / vp.land.len
    local q = math.sin(k * math.pi) * (1 - k) * 0.16
    sx, sy = 1 + q, 1 - q
  end
  if vp.pop then
    local k = vp.pop.t / vp.pop.len
    local q = math.sin(k * math.pi) * 0.14
    sx, sy = sx + q, sy + q
  end
  return x, y, z, ry, sx, sy
end

-- ---- drawing ----

local WALL = { 246, 240, 230 }
local TRIM = { 214, 168, 120 }
local GLASS = { 160, 214, 236 }

local function skirting(w)
  -- the edge's middle, and its run along x
  local ex, ez = w.x + w.dx * 0.47, w.z + w.dz * 0.47
  if w.kind == "doorway" then
    nova.cuboid(ex - 0.5, 0, ez - 0.04, ex + 0.5, 0.06, ez + 0.04, { color = TRIM })
    return
  end
  nova.cuboid(ex - 0.5, 0, ez - 0.035, ex + 0.5, 0.2, ez + 0.035, { color = WALL })
  nova.cuboid(ex - 0.5, 0.2, ez - 0.045, ex + 0.5, 0.24, ez + 0.045, { color = TRIM })
  if w.kind == "window" then nova.cuboid(ex - 0.3, 0.24, ez - 0.02, ex + 0.3, 0.27, ez + 0.02, { color = GLASS }) end
end

function View:draw_flat()
  local L, t = self.L, self.t
  -- the garden round the flat, a paved path to the front door and the street
  local x0, z0, x1, z1 = L.x0 - 0.5, L.z0 - 0.5, L.x1 + 0.5, L.z1 + 0.5
  nova.cuboid(x0 - 30, -0.08, z0 - 30, x1 + 30, -0.02, z1 + 30, { color = { 150, 196, 120 } })
  nova.cuboid(x0 - 0.12, -0.04, z0 - 0.12, x1 + 0.12, 0.0, z1 + 0.12, { color = { 196, 176, 150 } })
  local c = L.client
  if c then
    nova.cuboid(c.x - 0.42, -0.04, c.z - 0.5, c.x + 0.42, -0.005, z1 + 30, { color = { 222, 210, 190 } })
  end
  for _, w in ipairs(L.walls) do if w.low then skirting(w) end end
  -- marks on the floor: the piece the mover faces (what A and Y would turn) and the tutorial's places
  for _, mk in ipairs(self.marks) do
    local pulse = 0.85 + 0.15 * math.sin(t * 6)
    if mk.chevron then
      nova.billboard("fx/chevron", mk.x, 0.075, mk.z, 0.42, { face = { 0, 1, 0 }, rot = mk.chevron, color = { 255, 236, 170, math.floor(150 + 90 * math.sin(t * 6)) } })
    else
      nova.billboard("fx/ring", mk.x, 0.07, mk.z, 0.95 * pulse, { face = { 0, 1, 0 }, color = mk.color or { 255, 220, 120, 220 } })
    end
  end
  -- moving boxes stacked by the path, where the client came from
  if c then
    nova.model("box", c.x + 1.3, 0, c.z - 0.05, { ry = 0.2, scale = 0.5 })
    nova.model("box", c.x + 1.32, 0.27, c.z - 0.08, { ry = -0.25, scale = 0.42 })
    nova.model("box", c.x - 1.25, 0, c.z + 0.05, { ry = 0.5, scale = 0.5 })
  end
end

function View:draw_pieces()
  for i, vp in ipairs(self.pieces) do
    local x, y, z, ry, sx, sy = self:piece_pose(vp)
    local glow = self.glow[i]
    -- (squash: the model is drawn a little wider and lower; the engine scales evenly, so the height is the squash's mean)
    nova.model(vp.kind, x, y, z, { ry = ry, scale = (sx + sy) / 2, tint = glow and { 255, 250, 236 } or nil })
  end
end

function View:mover_pose()
  local m = self.mover
  local x, z = m.x, m.z
  if m.anim then
    local k = m.anim.t / m.anim.len
    x, z = m.anim.x0 + (m.anim.x1 - m.anim.x0) * k, m.anim.z0 + (m.anim.z1 - m.anim.z0) * k
  end
  if m.recoil then
    local k = m.recoil.t / m.recoil.len
    local s = math.sin(k * math.pi) * 0.12
    x, z = x + m.recoil.dx * s, z + m.recoil.dz * s
  end
  return x, z
end

function View:draw_mover()
  local m = self.mover
  local x, z = self:mover_pose()
  local layers
  if m.walk > 0 or m.anim then
    layers = { { clip = "walk", time = self.t * 1.6, weight = 1 } }
    if m.anim and m.anim.push then layers[#layers + 1] = { clip = "holding-both", time = 0, weight = 1, mask = { "arm-left", "arm-right" } } end
  elseif m.nudge then
    layers = { { clip = "interact-right", time = m.nudge.t * 2, weight = 1 } }
  elseif m.cheer then
    layers = { { clip = "emote-yes", time = m.cheer, weight = 1 } }
  else
    layers = { { clip = "idle", time = self.t, weight = 1 } }
  end
  nova.model(MOVER, x, 0, z, { ry = m.ry, scale = MOVER_SCALE, layers = layers })
end

-- the client by the door: idle, or a nod or a shake of the head for a wish granted or undone, or a happy dance when the flat is done
function View:react(kind)
  self.client = self.client or {}
  self.client.react = { kind = kind, t = 0, len = kind == "yes" and 1.1 or 0.9 }
end
function View:celebrate() self.client = self.client or {}; self.client.happy = true end

function View:draw_client()
  local c = self.L.client
  if not c then return end
  local st = self.client or {}
  local clip, time, y = "idle", self.t, 0
  if st.happy then
    clip, time = "emote-yes", self.t % 1.1
    y = math.abs(math.sin(self.t * 5)) * 0.18
  elseif st.react then
    clip, time = st.react.kind == "yes" and "emote-yes" or "emote-no", st.react.t
  end
  -- (the client turns half towards the camera, so their face and their nods are seen)
  nova.model(c.who or "character-female-a", c.x, y, c.z, { ry = 0.45, scale = CLIENT_SCALE, clip = clip, time = time })
end

function View:draw()
  self:draw_flat()
  self:draw_pieces()
  self:draw_mover()
  self:draw_client()
end

-- ---- the camera: the whole flat on the screen, right of the wish card ----

local cam = { ex = 0, ey = 10, ez = 8, tx = 0, ty = 0, tz = 0, fov = 30, aspect = 16 / 9 }

-- Places the camera so the whole flat (its floor, the walls standing on it and the client at the door) fits the screen right of the card, below the
-- moves panel and above the button strap. `left` is the share of the screen's width the card takes; `zoom` > 1 stands further back; `orbit` turns the
-- view about the flat (radians). The distance is found by halving: the nearest at which every corner of the flat lands inside the free part of the screen.
local TILT = math.rad(56)
local function place(d, aspect, orbit, tx, tz)
  local o = orbit or 0
  cam.ex, cam.ey, cam.ez = tx + math.sin(o) * d * math.cos(TILT), d * math.sin(TILT), tz + math.cos(o) * d * math.cos(TILT)
  cam.tx, cam.ty, cam.tz = tx, 0, tz
  cam.aspect = aspect
end

function View:camera(w, h, left, zoom, orbit)
  left = left or 0.3
  local aspect = w / h
  local half = math.tan(math.rad(cam.fov / 2))
  local top, bottom, x0 = (left > 0 and 112 or 24), h - 62, w * left + 16
  local key = w .. "," .. h .. "," .. left .. "," .. math.floor((orbit or 0) * 20)
  if self.fit_key ~= key then
    local L = self.L
    local pts = {}
    for _, x in ipairs({ L.x0 - 0.55, L.x1 + 0.55 }) do
      for _, z in ipairs({ L.z0 - 0.55, L.z1 + 0.55 }) do
        pts[#pts + 1] = { x, 0, z }; pts[#pts + 1] = { x, 1.3, z }
      end
    end
    if L.client then pts[#pts + 1] = { L.client.x, 1.1, L.client.z + 0.3 } end
    -- the bounds of the flat on the screen with the camera d away, looking at (tx, tz)
    local function bounds(d, tx, tz)
      place(d, aspect, orbit, tx, tz)
      local a, b, c, e = math.huge, math.huge, -math.huge, -math.huge
      for _, p in ipairs(pts) do
        local sx, sy = View.project(p[1], p[2], p[3], w, h)
        a, b, c, e = math.min(a, sx), math.min(b, sy), math.max(c, sx), math.max(e, sy)
      end
      return a, b, c, e
    end
    local lo, hi = 3, 80
    for _ = 1, 22 do
      local d = (lo + hi) / 2
      local a, b, c, e = bounds(d, self.cx, self.cz)
      if c - a <= (w - 16) - x0 and e - b <= bottom - top then hi = d else lo = d end
    end
    -- then move the camera so the flat sits in the middle of the free space (twice: perspective moves it a little)
    local tx, tz = self.cx, self.cz
    for _ = 1, 3 do
      local a, b, c, e = bounds(hi, tx, tz)
      local per = 2 * hi * half / h -- metres a unit at the flat
      tx = tx - (((x0 + w - 16) / 2) - (a + c) / 2) * per
      tz = tz - (((top + bottom) / 2) - (b + e) / 2) * per / math.sin(TILT)
    end
    self.fit_key, self.fit_d, self.fit_x, self.fit_z = key, hi, tx, tz
  end
  local d = self.fit_d * (zoom or 1)
  place(d, aspect, orbit, self.fit_x, self.fit_z)
  nova.camera(cam.ex, cam.ey, cam.ez, cam.tx, cam.ty, cam.tz, cam.fov)
end

-- the screen place (in the game's 540-high units) of a place in the flat
function View.project(x, y, z, w, h)
  local fx, fy, fz = cam.tx - cam.ex, cam.ty - cam.ey, cam.tz - cam.ez
  local fl = math.sqrt(fx * fx + fy * fy + fz * fz)
  fx, fy, fz = fx / fl, fy / fl, fz / fl
  local rx, rz = -fz, fx
  local rl = math.sqrt(rx * rx + rz * rz)
  rx, rz = rx / rl, rz / rl
  local ux, uy, uz = -rz * fy, rz * fx - rx * fz, rx * fy
  local dx, dy, dz = x - cam.ex, y - cam.ey, z - cam.ez
  local xc, yc, zc = dx * rx + dz * rz, dx * ux + dy * uy + dz * uz, dx * fx + dy * fy + dz * fz
  local half = math.tan(math.rad(cam.fov / 2))
  local nx, ny = xc / (zc * half * cam.aspect), yc / (zc * half)
  return (nx * 0.5 + 0.5) * w, (0.5 - ny * 0.5) * h
end

return View

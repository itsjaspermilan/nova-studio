local blocks = require("lib.blocks")
local recipes = require("lib.recipes")
local mobs = require("lib.mobs")
local gen = require("lib.worldgen")
local B, P = blocks.B, blocks.P

local World = nova.scene {}

local floor, sin, cos, sqrt, max, min, abs = math.floor, math.sin, math.cos, math.sqrt, math.max, math.min, math.abs
local voxel, cam3 = nova.voxel, nova.cam3

local VIEW = 5            -- chunks drawn around the player
local LOAD = VIEW + 1     -- chunks kept (one more ring, so that the edge can be lit and shaded)
local DAY = 1200          -- seconds from one sunrise to the next
local REACH = 5.2
local SHEET = "textures/blocks.sprite.json"
local FRAGILE = { [B.sapling] = true, [B.tall_grass] = true, [B.dandelion] = true, [B.rose] = true, [B.torch] = true }
local FALLS = { [B.sand] = true, [B.gravel] = true }
local REPLACEABLE = { [0] = true, [B.water] = true, [B.lava] = true, [B.tall_grass] = true }

local function lerp(a, b, t) return a + (b - a) * t end
local function mixc(a, b, t) return { lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t) } end
local function approach(v, target, step)
  if v < target then return min(v + step, target) end
  return max(v - step, target)
end

-- ---- chunks: made as the player moves, dropped when far, edits kept for saving ----

local function key(cx, cz) return cx .. "," .. cz end

function World:load_chunk(cx, cz)
  gen.generate(cx, cz)
  voxel.apply_saved(cx, cz)
  voxel.finish_chunk(cx, cz)
  self.loaded[key(cx, cz)] = { cx, cz }
end

-- makes the nearest missing chunk, as many as the time allows; returns whether the ring around (pcx, pcz) is complete
function World:stream(pcx, pcz, budget)
  local t0 = nova.clock()
  while true do
    local best, bd = nil, 1e9
    for dz = -LOAD, LOAD do
      for dx = -LOAD, LOAD do
        local d = dx * dx + dz * dz
        if d <= LOAD * LOAD and d < bd and not voxel.has_chunk(pcx + dx, pcz + dz) then best, bd = { pcx + dx, pcz + dz }, d end
      end
    end
    if not best then return true end
    self:load_chunk(best[1], best[2])
    if nova.clock() - t0 > budget then return false end
  end
end

function World:drop_far_chunks(pcx, pcz)
  for k, c in pairs(self.loaded) do
    local dx, dz = c[1] - pcx, c[2] - pcz
    if dx * dx + dz * dz > (LOAD + 2) * (LOAD + 2) then
      voxel.unload_chunk(c[1], c[2])
      self.loaded[k] = nil
    end
  end
end

-- ---- the player ----

local function add_to(inv, id, n, dur)
  local stack = (P[id].item and P[id].tool_kind) and 1 or 64
  for _, s in ipairs(inv) do
    if s.id == id and s.n < stack and n > 0 then
      local put = min(n, stack - s.n)
      s.n, n = s.n + put, n - put
    end
  end
  for i = 1, 36 do
    if n <= 0 then break end
    if not inv[i] then
      local put = min(n, stack)
      inv[i] = { id = id, n = put, dur = dur }
      n = n - put
    end
  end
  return n -- what did not fit
end

function World:hurt(amount, why)
  local p = self.p
  if self.creative or p.hurt_cool > 0 then return end
  p.hurt_cool = 0.5
  p.hp = p.hp - amount
  self.flash = 0.35
  nova.sound.play("hurt", { volume = 0.6 })
  if p.hp <= 0 then self:die(why) end
end

function World:die(why)
  self.dead = why or "died"
  nova.input.grab_mouse(false)
end

function World:respawn()
  local p = self.p
  self.dead = nil
  p.hp, p.food, p.air = 20, 20, 15
  p.x, p.z = self.spawn[1], self.spawn[2]
  p.y = voxel.top(p.x, p.z) + 1.01
  p.vx, p.vy, p.vz = 0, 0, 0
  nova.input.grab_mouse(true)
end

local function find_spawn()
  for r = 0, 40 do
    for a = 0, 7 do
      local x, z = floor(cos(a * 0.785) * r * 12), floor(sin(a * 0.785) * r * 12)
      if gen.height(x, z) > gen.SEA + 2 then return { x + 0.5, z + 0.5 } end
    end
  end
  return { 0.5, 0.5 }
end

function World:enter()
  voxel.daylight(1)
  -- what the player changed lives in its own file (the engine keeps the changes of chunks that are dropped, too)
  voxel.load_world("world")
  self.loaded = {}
  self.drops, self.bits, self.falling = {}, {}, {}
  mobs.reset(self)
  self.clock = nova.save.get("clock", DAY * 0.08)
  self.creative = nova.save.get("creative", false)
  self.sel = nova.save.get("sel", 1)
  self.mine = { progress = 0 }
  self.swing, self.flash, self.save_in = 0, 0, 8
  gen.seed = nova.save.get("seed", 20161)
  self.spawn = nova.save.get("spawn") or find_spawn()
  local p = { x = self.spawn[1], y = 80, z = self.spawn[2], vx = 0, vy = 0, vz = 0, hp = 20, food = 20, air = 15, hurt_cool = 0, ground = false, peak = 0, steps = 0, eat = 0 }
  local saved = nova.save.get("player")
  if saved then for k, v in pairs(saved) do p[k] = v end end
  self.p = p
  self.inv = {}
  for i, s in pairs(nova.save.get("inventory", {})) do self.inv[tonumber(i)] = s end
  self.ready = false
  self.t_start = nova.clock()
  self.loading_frames = 0
  self.hint = 6
  cam3.yaw, cam3.pitch = nova.save.get("yaw", 0), nova.save.get("pitch", 0)
  nova.input.grab_mouse(true)
  nova.fog { color = { 190, 215, 255 }, near = 40, far = 90 }
end

function World:save()
  voxel.save_world("world")
  local p = self.p
  nova.save.set("player", { x = p.x, y = p.y, z = p.z, hp = p.hp, food = p.food })
  local inv = {}
  for i, s in pairs(self.inv) do inv[tostring(i)] = s end
  nova.save.set("inventory", inv)
  nova.save.set("clock", self.clock)
  nova.save.set("creative", self.creative)
  nova.save.set("sel", self.sel)
  nova.save.set("seed", gen.seed)
  nova.save.set("spawn", self.spawn)
  nova.save.set("yaw", cam3.yaw)
  nova.save.set("pitch", cam3.pitch)
end

local function creative_kit(inv)
  local kit = { "stone", "cobblestone", "planks", "glass", "dirt", "sand", "log", "torch", "crafting_table" }
  for i, name in ipairs(kit) do inv[i] = { id = B[name], n = 64 } end
end

-- ---- sky ----

function World:sky(eye_water)
  local phase = (self.clock / DAY) % 1
  local elev = sin(phase * math.pi * 2)
  local day = max(0.1, min(1, 0.12 + (elev + 0.2) * 1.4))
  local t = max(0, min(1, elev * 1.6 + 0.5))
  local top = mixc({ 6, 8, 22 }, { 110, 166, 255 }, t)
  local horizon = mixc({ 12, 14, 30 }, { 190, 215, 255 }, t)
  local glow = max(0, 1 - abs(elev) / 0.28) * 0.65
  horizon = mixc(horizon, { 255, 140, 70 }, glow)
  voxel.daylight(day)
  local far = VIEW * 16
  local a = phase * math.pi * 2
  local sun = { cos(a), sin(a), -0.35 }
  nova.sky { top = top, horizon = horizon, sun = sun, stars = max(0, min(1, (0.45 - day) * 3)), clouds = 0.5 }
  if eye_water then
    nova.fog { color = { 18, 44, 100 }, near = 0.5, far = 16 }
  else
    nova.fog { color = horizon, near = far * 0.55, far = far * 0.98 }
  end
  nova.light { dir = { -0.4, -1, -0.3 }, color = { 255 * day, 240 * day, 220 * day }, ambient = { 50 + 110 * day, 55 + 110 * day, 70 + 100 * day } }
  self.day = day
end

-- ---- particles and drops ----

function World:burst(x, y, z, id, n)
  for _ = 1, n do
    if #self.bits > 160 then table.remove(self.bits, 1) end
    self.bits[#self.bits + 1] = {
      id = id, x = x + (math.random() - 0.5) * 0.8, y = y + (math.random() - 0.5) * 0.8, z = z + (math.random() - 0.5) * 0.8,
      vx = (math.random() - 0.5) * 3, vy = math.random() * 3, vz = (math.random() - 0.5) * 3, life = 0.5 + math.random() * 0.4,
    }
  end
end

function World:drop(id, n, x, y, z)
  if not id or n <= 0 then return end
  self.drops[#self.drops + 1] = { id = id, n = n, x = x, y = y, z = z, vx = (math.random() - 0.5) * 2.5, vy = 3.5, vz = (math.random() - 0.5) * 2.5, age = 0 }
end

function World:update_loose(dt)
  for i = #self.bits, 1, -1 do
    local b = self.bits[i]
    b.life = b.life - dt
    b.vy = b.vy - 18 * dt
    b.x, b.y, b.z = b.x + b.vx * dt, b.y + b.vy * dt, b.z + b.vz * dt
    if b.life <= 0 then table.remove(self.bits, i) end
  end
  local p = self.p
  for i = #self.drops, 1, -1 do
    local d = self.drops[i]
    d.age = d.age + dt
    d.vy = max(d.vy - 24 * dt, -30)
    d.vx, d.vz = d.vx * (1 - 3 * dt), d.vz * (1 - 3 * dt)
    local x, y, z, hx, hy, hz, ground = voxel.move(d.x, d.y, d.z, 0.125, 0.25, d.vx * dt, d.vy * dt, d.vz * dt)
    d.x, d.y, d.z = x, y, z
    if hy then d.vy = 0 end
    if hx then d.vx = 0 end
    if hz then d.vz = 0 end
    -- pulled in when the player is close
    local dx, dy, dz = p.x - d.x, p.y + 0.8 - d.y, p.z - d.z
    local dist = sqrt(dx * dx + dy * dy + dz * dz)
    if d.age > 0.6 and dist < 2.2 then
      d.vx, d.vy, d.vz = d.vx + dx / dist * 20 * dt, d.vy + dy / dist * 20 * dt, d.vz + dz / dist * 20 * dt
    end
    local left = d.n
    if d.age > 0.6 and dist < 1.0 then left = add_to(self.inv, d.id, d.n, d.dur) end
    if left ~= d.n then
      nova.sound.play("pickup", { volume = 0.3, pitch = 0.9 + math.random() * 0.4, limit = 3 })
      d.n = left
    end
    if d.n <= 0 or d.age > 300 or d.y < -20 then table.remove(self.drops, i) end
  end
end

-- ---- sand and gravel fall ----

function World:check_fall(x, y, z)
  self.falling[#self.falling + 1] = { x, y, z }
end

function World:update_falls(dt)
  self.fall_wait = (self.fall_wait or 0) - dt
  if self.fall_wait > 0 or #self.falling == 0 then return end
  self.fall_wait = 0.1
  local work = self.falling
  self.falling = {}
  for _, c in ipairs(work) do
    local x, y, z = c[1], c[2], c[3]
    local id = voxel.get(x, y, z)
    if FALLS[id] then
      local below = voxel.get(x, y - 1, z)
      if y > 1 and (REPLACEABLE[below] or FRAGILE[below]) then
        voxel.edit(x, y, z, 0)
        voxel.edit(x, y - 1, z, id)
        self.falling[#self.falling + 1] = { x, y - 1, z }
        self.falling[#self.falling + 1] = { x, y + 1, z }
      end
    end
  end
end

-- ---- breaking and placing ----

function World:tool()
  local s = self.inv[self.sel]
  if s and P[s.id].tool_kind then return s, P[s.id] end
end

-- seconds to break a block with what is in hand, and whether it drops anything
function World:break_time(id)
  local pr = P[id]
  if pr.hard < 0 then return nil end
  if self.creative then return 0.12, true end
  local slot, tool = self:tool()
  local right_tool = tool and tool.tool_kind == pr.tool
  local harvest = true
  if pr.level then harvest = right_tool and tool.level >= pr.level end
  local t = pr.hard * (harvest and 1.5 or 5)
  if right_tool then t = t / tool.speed end
  return max(t, 0.04), harvest
end

function World:break_block(x, y, z)
  local id = voxel.get(x, y, z)
  local pr = P[id]
  local _, harvest = self:break_time(id)
  voxel.edit(x, y, z, 0)
  self:burst(x + 0.5, y + 0.5, z + 0.5, id, 10)
  nova.sound.play("dig_" .. (pr.sound or "stone"), { volume = 0.6, pitch = 0.9 + math.random() * 0.2, limit = 4 })
  if harvest and not self.creative then
    local drop = pr.drop
    if pr.chance then
      if math.random() < pr.chance then self:drop(drop, 1, x + 0.5, y + 0.5, z + 0.5) end
      if (id == B.leaves or id == B.birch_leaves) and math.random() < 0.02 then self:drop(B.apple, 1, x + 0.5, y + 0.5, z + 0.5) end
    elseif drop then
      self:drop(drop, 1, x + 0.5, y + 0.5, z + 0.5)
    end
  end
  -- the tool wears
  local slot, tool = self:tool()
  if slot and not self.creative and pr.hard > 0 then
    slot.dur = (slot.dur or tool.uses) - 1
    if slot.dur <= 0 then self.inv[self.sel] = nil; nova.sound.play("pop", { volume = 0.5 }) end
  end
  -- what stood on it
  local above = voxel.get(x, y + 1, z)
  if FRAGILE[above] then self:break_block(x, y + 1, z) end
  if FALLS[above] then self:check_fall(x, y + 1, z) end
end

local function overlaps_player(p, x, y, z)
  return p.x + 0.3 > x and p.x - 0.3 < x + 1 and p.y + 1.8 > y and p.y < y + 1 and p.z + 0.3 > z and p.z - 0.3 < z + 1
end

function World:place(t)
  local s = self.inv[self.sel]
  if not s or P[s.id].item then return false end
  local x, y, z = t[1] + t[4], t[2] + t[5], t[3] + t[6]
  -- aiming at grass or a flower puts the block in its place
  if REPLACEABLE[voxel.get(t[1], t[2], t[3])] and not (voxel.get(t[1], t[2], t[3]) == B.water) then x, y, z = t[1], t[2], t[3] end
  if y < 1 or y > 126 or not REPLACEABLE[voxel.get(x, y, z)] then return false end
  local info = nova.voxel.info(s.id)
  if info.solid and overlaps_player(self.p, x, y, z) then return false end
  voxel.edit(x, y, z, s.id)
  nova.sound.play("dig_" .. (P[s.id].sound or "stone"), { volume = 0.5, pitch = 0.7, limit = 4 })
  if FALLS[s.id] then self:check_fall(x, y, z) end
  if not self.creative then
    s.n = s.n - 1
    if s.n <= 0 then self.inv[self.sel] = nil end
  end
  self.swing = 0.25
  return true
end

-- ---- the frame ----

function World:update(dt)
  dt = min(dt, 0.05)
  self.dt = dt
  if self.dead then
    if nova.input.pressed("jump") or nova.input.pressed("mine") then self:respawn() end
    return
  end
  local p = self.p
  local pcx, pcz = floor(p.x / 16), floor(p.z / 16)

  -- before there is ground under the player, only make the world
  if not self.ready then
    self.loading_frames = self.loading_frames + 1
    local done = self:stream(pcx, pcz, 0.012)
    if done then
      self.ready = true
      local st = voxel.stats()
      nova.log(string.format("blockfield-load: %d chunks made in %.0f ms over %d frames (%.1f ms each); light %.0f ms in total", st.chunks, (nova.clock() - self.t_start) * 1000, self.loading_frames, (nova.clock() - self.t_start) * 1000 / st.chunks, st.light_ms))
      if p.y == 80 then p.y = voxel.top(p.x, p.z) + 1.01 end
      if self.creative then creative_kit(self.inv) end
    end
    cam3.first_person(p, { height = 1.62, fov = 75 })
    return
  end
  self:stream(pcx, pcz, 0.004)
  self:drop_far_chunks(pcx, pcz)

  if nova.input.pressed("pause") then
    self.paused = not self.paused
    nova.input.grab_mouse(not self.paused)
    nova.pause(self.paused)
    if self.paused then self:save() end
  end
  if self.paused then
    if nova.input.pointer().pressed then self.paused = false; nova.input.grab_mouse(true); nova.pause(false) end
    return
  end
  if nova.input.pressed("stats") then
    self.show_stats = not self.show_stats
    -- (the tests read this line)
    nova.log(string.format("blockfield: chunks=%d edited=%d mobs=%d x=%.1f z=%.1f y=%.2f ground=%s hp=%d pitch=%.2f target=%s progress=%.2f creative=%s", voxel.stats().chunks, #voxel.modified_chunks(), #self.mobs, p.x, p.z, p.y, tostring(p.ground), p.hp, cam3.pitch, tostring(self.target ~= nil), self.mine.progress, tostring(self.creative)))
  end
  if self.menu then
    self:menu_update()
    self:sky(false)
    return
  end
  if nova.input.pressed("inventory") then
    self:open_menu()
    return
  end
  if nova.input.pressed("fly") then
    self.creative = not self.creative
    if self.creative then creative_kit(self.inv) else self.inv = {} end
    self.hint = 3
  end

  self.clock = self.clock + dt
  self.hint = max(0, self.hint - dt)
  self.flash = max(0, self.flash - dt)
  self.swing = max(0, self.swing - dt)
  p.hurt_cool = max(0, p.hurt_cool - dt)
  self.save_in = self.save_in - dt
  if self.save_in <= 0 then self.save_in = 15; self:save() end

  -- looking
  local ptr = nova.input.pointer()
  cam3.look(-nova.input.axis("look_x") * 2.6 * dt - ptr.dx * 0.0025, -nova.input.axis("look_y") * 1.8 * dt - ptr.dy * 0.0025)

  -- the hotbar
  for i = 1, 9 do if nova.input.pressed("slot_" .. i) then self.sel = i end end
  if nova.input.pressed("next_slot") or ptr.wheel < 0 then self.sel = self.sel % 9 + 1 end
  if nova.input.pressed("prev_slot") or ptr.wheel > 0 then self.sel = (self.sel - 2) % 9 + 1 end

  -- water, lava and the air to breathe
  local feet, body, head = voxel.get(p.x, p.y + 0.1, p.z), voxel.get(p.x, p.y + 0.9, p.z), voxel.get(p.x, p.y + 1.62, p.z)
  local swimming = feet == B.water or body == B.water
  local in_lava = feet == B.lava or body == B.lava
  local underwater = head == B.water
  if underwater and not self.creative then
    p.air = p.air - dt
    if p.air < 0 then p.air = 0.1; self:hurt(2, "drowned") end
  else
    p.air = min(15, p.air + dt * 5)
  end
  if in_lava then self:hurt(4, "burned in lava"); p.vy = max(p.vy, -1) end

  -- moving
  local sneak = nova.input.down("sneak")
  local sprint = nova.input.down("sprint") and not sneak and p.food > 6
  local fx, fz = cam3.forward()
  local rx, rz = cam3.right()
  local mx, mz = nova.input.axis("move_x"), nova.input.axis("move_y")
  local wx, wz = rx * mx - fx * mz, rz * mx - fz * mz
  local wl = sqrt(wx * wx + wz * wz)
  if wl > 1 then wx, wz = wx / wl, wz / wl end
  local flying = self.creative and (p.flying or false)
  if self.creative and nova.input.pressed("jump") then
    if self.last_jump and nova.time() - self.last_jump < 0.3 then p.flying = not p.flying end
    self.last_jump = nova.time()
  end
  flying = self.creative and p.flying
  local speed = sneak and 1.3 or sprint and 5.6 or 4.3
  if swimming then speed = speed * 0.55 end
  if flying then speed = speed * (sprint and 3 or 2.2) end
  local acc = (p.ground and 50 or (flying and 30 or 10)) * dt
  if swimming then acc = 12 * dt end
  p.vx, p.vz = approach(p.vx, wx * speed, acc), approach(p.vz, wz * speed, acc)
  if flying then
    p.vy = approach(p.vy, ((nova.input.down("jump") and 1 or 0) - (sneak and 1 or 0)) * 8, 40 * dt)
  elseif swimming then
    p.vy = approach(p.vy, nova.input.down("jump") and 3.2 or -2.2, 14 * dt)
  else
    if nova.input.down("jump") and p.ground then p.vy = 8.6; p.food = p.food - 0.02 end
    p.vy = max(p.vy - 32 * dt, -60)
  end
  local height = sneak and 1.65 or 1.8
  local was_ground = p.ground
  local nx, ny, nz, hx, hy, hz, ground = voxel.move(p.x, p.y, p.z, 0.3, height, p.vx * dt, p.vy * dt, p.vz * dt, (not flying and 0.6) or 0)
  p.x, p.y, p.z = nx, ny, nz
  if hx then p.vx = 0 end
  if hz then p.vz = 0 end
  if hy then p.vy = 0 end
  p.ground = ground
  if flying and ground then p.flying = false end
  -- falling hurts
  if not ground and not swimming and not flying then
    p.peak = max(p.peak or p.y, p.y)
  else
    if ground and not was_ground and (p.peak or p.y) - p.y > 3.2 then self:hurt(floor((p.peak - p.y) - 3), "fell from a high place") end
    p.peak = p.y
  end
  if p.y < -20 then self:hurt(20, "fell out of the world") end

  -- footsteps and hunger
  local moved = sqrt(p.vx * p.vx + p.vz * p.vz)
  if ground and moved > 0.5 then
    p.steps = p.steps + moved * dt
    p.food = p.food - moved * dt * 0.0025
    if p.steps > 1.9 then
      p.steps = 0
      local under = voxel.get(p.x, p.y - 0.2, p.z)
      nova.sound.play("step_" .. (P[under] and P[under].sound or "stone"), { volume = 0.35, pitch = 0.85 + math.random() * 0.3, limit = 2 })
    end
  end
  if p.food > 18 and p.hp < 20 then p.hp = min(20, p.hp + dt * 0.8); p.food = p.food - dt * 0.03 end
  if p.food <= 0 then p.food = 0; self.starve = (self.starve or 0) + dt; if self.starve > 4 then self.starve = 0; if p.hp > 2 then self:hurt(1, "starved") end end end

  -- the camera
  local eye_h = sneak and 1.45 or 1.62
  cam3.first_person(p, { height = eye_h, fov = sprint and 82 or 75 })
  self.eye = { p.x, p.y + eye_h, p.z }

  -- aiming: a ray from the eye along the view
  local cp = cos(cam3.pitch)
  local dx, dy, dz = -sin(cam3.yaw) * cp, sin(cam3.pitch), -cos(cam3.yaw) * cp
  local bx, by, bz, nx2, ny2, nz2, dist, blk = voxel.raycast(self.eye[1], self.eye[2], self.eye[3], dx, dy, dz, self.creative and 6.5 or REACH)
  self.target = bx and { bx, by, bz, nx2, ny2, nz2, blk } or nil

  -- mining
  -- a creature in reach and in front of the block is hit instead (one blow a click)
  local mob, mob_t = mobs.aim(self, self.eye, { dx, dy, dz }, 3.6)
  self.aimed_mob = nil
  if mob and mob_t < (dist or 99) then
    self.aimed_mob = mob
    if nova.input.pressed("mine") then mobs.hit(self, mob, dx, dz) end
  end
  local m = self.mine
  local t = (not self.aimed_mob) and self.target or nil
  if nova.input.down("mine") and t and P[t[7]].hard >= 0 then
    if m.x ~= t[1] or m.y ~= t[2] or m.z ~= t[3] then m.x, m.y, m.z, m.progress = t[1], t[2], t[3], 0 end
    local secs = self:break_time(t[7])
    m.progress = m.progress + dt / secs
    self.swing = max(self.swing, 0.12)
    m.sound = (m.sound or 0) - dt
    if m.sound <= 0 and P[t[7]].hard > 0 then
      m.sound = 0.22
      nova.sound.play("dig_" .. (P[t[7]].sound or "stone"), { volume = 0.35, pitch = 0.75, limit = 2 })
    end
    if m.progress >= 1 then
      self:break_block(t[1], t[2], t[3])
      m.progress, m.x = 0, nil
      if self.creative then m.wait = 0.2 end
    end
  else
    m.progress, m.x = 0, nil
  end

  -- placing, and eating when the thing in hand is food
  local held = self.inv[self.sel]
  if nova.input.pressed("place") or (nova.input.down("place") and (self.place_wait or 0) <= 0 and self.creative) then
    self.place_wait = 0.22
    if held and P[held.id].food and p.food < 20 then
      self.eating = 0
    elseif t and t[7] == B.crafting_table then
      self:open_menu()
    elseif t then
      self:place(t)
    end
  end
  self.place_wait = max(0, (self.place_wait or 0) - dt)
  if self.eating then
    if nova.input.down("place") and held and P[held.id].food then
      self.eating = self.eating + dt
      self.swing = 0.12
      if self.eating > 1.4 then
        p.food = min(20, p.food + P[held.id].food)
        held.n = held.n - 1
        if held.n <= 0 then self.inv[self.sel] = nil end
        self.eating = nil
        nova.sound.play("pickup", { volume = 0.4, pitch = 0.6 })
      end
    else
      self.eating = nil
    end
  end

  mobs.update(self, dt)
  self:update_loose(dt)
  self:update_falls(dt)
  self:sky(underwater)
end

-- ---- drawing ----

function World:draw()
  if not self.ready then return end
  voxel.draw { distance = VIEW + 0.5, budget = 3 }
  mobs.draw(self)
  local t = (not self.aimed_mob) and self.target or nil
  if t and not self.dead then
    local cx, cy, cz = t[1] + 0.5, t[2] + 0.5, t[3] + 0.5
    local e = 0.003
    nova.box3(t[1] - e, t[2] - e, t[3] - e, t[1] + 1 + e, t[2] + 1 + e, t[3] + 1 + e, { color = { 10, 10, 10 }, width = 0.015 })
    local m = self.mine
    if m.progress > 0.02 then voxel.cube(B["crack_" .. min(9, floor(m.progress * 10))], cx, cy, cz, { scale = 1.006 }) end
  end
  for _, d in ipairs(self.drops) do
    local bob = sin(d.age * 3) * 0.05
    voxel.cube(d.id, d.x, d.y + 0.18 + bob, d.z, { scale = 0.3, ry = d.age * 1.6 })
  end
  for _, b in ipairs(self.bits) do voxel.cube(b.id, b.x, b.y, b.z, { scale = 0.09, ry = b.life * 5 }) end
  -- the thing in hand, low at the right of the view
  local held = self.inv[self.sel]
  if held and not self.dead then
    local fx, fz = cam3.forward()
    local rx, rz = cam3.right()
    local cp = cos(cam3.pitch)
    local e = self.eye
    local sw = self.swing > 0 and sin(self.swing * 12) or 0
    local ox = fx * cp * 0.62 + rx * 0.34
    local oz = fz * cp * 0.62 + rz * 0.34
    local oy = sin(cam3.pitch) * 0.62 - 0.3 - sw * 0.1
    voxel.cube(held.id, e[1] + ox, e[2] + oy, e[3] + oz, { scale = P[held.id].item and 0.3 or 0.26, ry = cam3.yaw + 0.5, rx = -cam3.pitch * 0.5 - sw * 0.9 })
  end
end

local function text(x, y, s, size, color, align)
  -- (aligned text sits in a box: the point is its middle or its right edge)
  local box = 900
  if align == "center" then x = x - box / 2 elseif align == "right" then x = x - box end
  nova.ui.text(x, y, s, { size = size or 16, color = color or { 255, 255, 255 }, shadow = true, align = align, width = align and box or nil })
end

-- ---- the making menu ----

function World:nearby_stations()
  local p, near = self.p, {}
  for dy = -3, 3 do
    for dz = -4, 4 do
      for dx = -4, 4 do
        local id = voxel.get(p.x + dx, p.y + dy + 0.5, p.z + dz)
        if id == B.crafting_table then near.crafting_table = true elseif id == B.furnace then near.furnace = true end
      end
    end
  end
  return near
end

function World:refresh_menu()
  local m = self.menu
  m.near = self:nearby_stations()
  m.rows = {}
  for i, r in ipairs(recipes.list) do
    local ok, why = recipes.can_make(self.inv, r, m.near, self.p.fuel or 0)
    m.rows[#m.rows + 1] = { r = r, ok = ok, why = why, order = i }
  end
  table.sort(m.rows, function(a, b)
    if a.ok ~= b.ok then return a.ok end
    return a.order < b.order
  end)
  m.sel = max(1, min(m.sel, #m.rows))
end

function World:open_menu()
  self.menu = { sel = 1, top = 1 }
  self:refresh_menu()
  nova.input.grab_mouse(false)
end

local MENU_ROWS, ROW_H = 9, 38

local function menu_rect(w, i)
  return { x = w / 2 - 344, y = 96 + (i - 1) * ROW_H, w = 380, h = ROW_H - 4 }
end

function World:menu_update()
  local m = self.menu
  if nova.input.pressed("inventory") or nova.input.pressed("pause") then
    self.menu = nil
    nova.input.grab_mouse(true)
    return
  end
  local w = nova.view()
  local ptr = nova.input.pointer()
  local ay = nova.input.axis("move_y")
  if abs(ay) > 0.6 then
    if not m.held then m.sel, m.held = max(1, min(#m.rows, m.sel + (ay > 0 and 1 or -1))), true end
  else
    m.held = false
  end
  if ptr.wheel ~= 0 then m.sel = max(1, min(#m.rows, m.sel - (ptr.wheel > 0 and 1 or -1))) end
  m.top = max(1, min(m.top, m.sel))
  if m.sel > m.top + MENU_ROWS - 1 then m.top = m.sel - MENU_ROWS + 1 end
  local clicked
  if ptr.present then
    for i = 1, MENU_ROWS do
      local r = menu_rect(w, i)
      if ptr.x >= r.x and ptr.x <= r.x + r.w and ptr.y >= r.y and ptr.y <= r.y + r.h and m.top + i - 1 <= #m.rows then
        if ptr.dx ~= 0 or ptr.dy ~= 0 then m.sel = m.top + i - 1 end
        if ptr.pressed then m.sel, clicked = m.top + i - 1, true end
      end
    end
  end
  if clicked or nova.input.pressed("jump") then
    local row = m.rows[m.sel]
    if row and row.ok then
      local left, fuel = recipes.make(self.inv, row.r, self.p.fuel or 0, add_to)
      self.p.fuel = fuel
      if left > 0 then self:drop(row.r.out, left, self.p.x, self.p.y + 1, self.p.z) end
      nova.sound.play(row.r.kind == "smelt" and "pop" or "pickup", { volume = 0.5, pitch = 1.1 })
      self:refresh_menu()
    else
      nova.sound.play("hurt", { volume = 0.15, pitch = 1.6 })
    end
  end
end

function World:draw_menu(w, h)
  local m = self.menu
  nova.ui.rect(0, 0, w, h, { 0, 0, 0, 150 })
  local x0 = w / 2 - 344
  text(x0, 56, "Make", 24)
  local stations = {}
  for k in pairs(m.near) do stations[#stations + 1] = k:gsub("_", " ") end
  text(x0 + 90, 62, #stations > 0 and ("near: " .. table.concat(stations, ", ")) or "no crafting table or furnace near", 14, { 200, 200, 200 })
  for i = 1, MENU_ROWS do
    local row = m.rows[m.top + i - 1]
    if not row then break end
    local r = menu_rect(w, i)
    local selected = m.top + i - 1 == m.sel
    nova.ui.rect(r.x, r.y, r.w, r.h, selected and { 255, 255, 255, 70 } or { 20, 20, 20, 150 })
    if selected then nova.ui.rect(r.x, r.y, 3, r.h, { 255, 220, 120 }) end
    local dim = row.ok and 255 or 120
    nova.ui.sprite(SHEET, r.x + 20, r.y + r.h / 2, { frame = (blocks.icon(row.r.out)), scale = 1.7, color = { dim, dim, dim, 255 } })
    local label = (row.r.n > 1 and (row.r.n .. " ") or "") .. P[row.r.out].name .. (row.r.kind == "smelt" and "  (smelt)" or "")
    text(r.x + 44, r.y + 2, label, 15, { dim, dim, dim })
    local parts = {}
    for _, n in ipairs(recipes.needs(self.inv, row.r)) do parts[#parts + 1] = n.name:gsub("_", " ") .. " " .. n.have .. "/" .. n.want end
    text(r.x + 44, r.y + 18, row.ok and table.concat(parts, "   ") or (row.why or ""), 12, row.ok and { 170, 220, 170 } or { 220, 150, 130 })
  end
  if #m.rows > MENU_ROWS then text(x0 + 190, 96 + MENU_ROWS * ROW_H, (m.top + MENU_ROWS - 1 < #m.rows) and "more below" or "", 12, { 200, 200, 200 }, "center") end
  -- what is carried
  local gx, gy = x0 + 400, 96
  text(gx, 66, "Carried", 16)
  for i = 1, 36 do
    local col, row = (i - 1) % 9, floor((i - 1) / 9)
    local x, y = gx + col * 32, gy + row * 32
    nova.ui.rect(x, y, 30, 30, { 20, 20, 20, 170 })
    local s = self.inv[i]
    if s then
      nova.ui.sprite(SHEET, x + 15, y + 15, { frame = (blocks.icon(s.id)), scale = 1.6 })
      if s.n > 1 then text(x + 29, y + 15, tostring(s.n), 11, nil, "right") end
    end
  end
  text(gx, gy + 4 * 32 + 8, string.format("fuel stored: %.0f", self.p.fuel or 0), 14, { 220, 200, 160 })
  text(gx, gy + 4 * 32 + 28, "up/down: choose   jump or click: make   E: close", 12, { 200, 200, 200 })
end

function World:draw_ui()
  local w, h = nova.view()
  if not self.ready then
    nova.ui.rect(0, 0, w, h, { 20, 24, 34 })
    text(w / 2, h / 2 - 20, "Making the world...", 22, nil, "center")
    return
  end
  local p = self.p
  -- crosshair
  nova.ui.rect(w / 2 - 8, h / 2 - 1, 16, 2, { 255, 255, 255, 200 })
  nova.ui.rect(w / 2 - 1, h / 2 - 8, 2, 16, { 255, 255, 255, 200 })
  if self.flash > 0 then nova.ui.rect(0, 0, w, h, { 200, 30, 30, floor(self.flash * 220) }) end
  if self.dead then
    nova.ui.rect(0, 0, w, h, { 90, 10, 10, 170 })
    text(w / 2, h / 2 - 50, "You died", 34, nil, "center")
    text(w / 2, h / 2, "(" .. self.dead .. ")", 18, { 230, 200, 200 }, "center")
    text(w / 2, h / 2 + 40, "press jump to respawn", 16, nil, "center")
    return
  end
  local underwater = voxel.get(p.x, p.y + 1.62, p.z) == B.water
  if underwater then nova.ui.rect(0, 0, w, h, { 30, 70, 160, 90 }) end
  -- hotbar
  local slot, gap = 44, 4
  local x0 = w / 2 - (9 * slot + 8 * gap) / 2
  local y0 = h - slot - 14
  for i = 1, 9 do
    local x = x0 + (i - 1) * (slot + gap)
    nova.ui.rect(x, y0, slot, slot, { 20, 20, 20, 150 })
    if i == self.sel then
      nova.ui.rect(x - 3, y0 - 3, slot + 6, 3, { 255, 255, 255, 230 })
      nova.ui.rect(x - 3, y0 + slot, slot + 6, 3, { 255, 255, 255, 230 })
      nova.ui.rect(x - 3, y0, 3, slot, { 255, 255, 255, 230 })
      nova.ui.rect(x + slot, y0, 3, slot, { 255, 255, 255, 230 })
    end
    local s = self.inv[i]
    if s then
      local tile = blocks.icon(s.id)
      nova.ui.sprite(SHEET, x + slot / 2, y0 + slot / 2, { frame = tile, scale = 2.3 })
      if s.n > 1 then text(x + slot - 3, y0 + slot - 17, tostring(s.n), 14, nil, "right") end
      if s.dur then
        local frac = s.dur / P[s.id].uses
        nova.ui.rect(x + 4, y0 + slot - 6, (slot - 8), 3, { 20, 20, 20, 220 })
        nova.ui.rect(x + 4, y0 + slot - 6, (slot - 8) * frac, 3, { 255 * (1 - frac), 220 * frac + 30, 30, 255 })
      end
    end
  end
  -- name of what is in hand, for a moment after changing it
  local held = self.inv[self.sel]
  if held and self.shown ~= self.sel then self.shown, self.name_for = self.sel, 1.6 end
  self.name_for = max(0, (self.name_for or 0) - (self.dt or 0))
  if held and self.name_for > 0 then text(w / 2, y0 - 52, P[held.id].name, 16, { 255, 255, 255, floor(min(1, self.name_for) * 255) }, "center") end
  -- hearts and food: ten of each, a half is one point
  local function icons(x, right, value, full, half, empty)
    for i = 0, 9 do
      local px = right and (x + (9 - i) * 17) or (x + i * 17)
      local v = value - i * 2
      local c = v >= 2 and full or v == 1 and half or empty
      nova.ui.rect(px, y0 - 24, 14, 14, { 20, 20, 20, 160 })
      nova.ui.rect(px + 2, y0 - 22, 10, 10, c)
    end
  end
  icons(x0, false, floor(p.hp + 0.5), { 220, 30, 40 }, { 150, 40, 50 }, { 60, 20, 24 })
  icons(x0 + (9 * slot + 8 * gap) - 9 * 17 - 14, true, floor(p.food + 0.5), { 200, 130, 40 }, { 140, 90, 40 }, { 60, 40, 24 })
  if underwater or p.air < 15 then
    for i = 0, 9 do
      if p.air > i * 1.5 then nova.ui.rect(x0 + (9 * slot + 8 * gap) - 9 * 17 - 14 + (9 - i) * 17 + 3, y0 - 44, 8, 8, { 160, 210, 255 }) end
    end
  end
  if self.hint > 0 then
    text(w / 2, 40, self.creative and "creative: double-tap jump to fly, F to switch back" or "survival: F for creative mode", 16, nil, "center")
  end
  if self.menu then self:draw_menu(w, h) end
  if self.paused then
    nova.ui.rect(0, 0, w, h, { 0, 0, 0, 140 })
    text(w / 2, h / 2 - 30, "Paused", 30, nil, "center")
    text(w / 2, h / 2 + 10, "click or press Escape to go on (the world is saved)", 16, nil, "center")
  end
  if self.show_stats then
    local s = nova.stats()
    local v = voxel.stats()
    local phase = floor(((self.clock / DAY) % 1) * 24)
    local lines = {
      string.format("%.0f fps   lua %.1f ms   draw %.1f ms", s.fps, s.lua_ms, s.render_ms),
      string.format("xyz %.1f %.1f %.1f   chunk %d %d   %s", p.x, p.y, p.z, floor(p.x / 16), floor(p.z / 16), gen.biome(p.x, p.z)),
      string.format("chunks %d (%d waiting)   drawn %d   built %d: %.0f ms, light %.0f ms", v.chunks, v.dirty, v.drawn, v.meshed, v.mesh_ms, v.light_ms),
      string.format("draws %d   triangles %d   lua memory %.1f MB   hour %d   light %.0f%%", s.draws, s.triangles, s.memory_kb / 1024, phase, (self.day or 1) * 100),
    }
    nova.ui.rect(6, 6, 560, 22 * #lines + 8, { 0, 0, 0, 150 })
    for i, l in ipairs(lines) do text(12, 8 + (i - 1) * 22, l, 15) end
  end
end

return World

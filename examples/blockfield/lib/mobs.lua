-- Creatures: zombies and creepers come out where it is dark (at night, and in caves), pigs wander in the daylight.
-- Plain tables, not framework entities: the voxel world is the only thing they touch.
local blocks = require("lib.blocks")
local B, P = blocks.B, blocks.P
local voxel = nova.voxel
local sqrt, max, min, abs, sin, cos, floor = math.sqrt, math.max, math.min, math.abs, math.sin, math.cos, math.floor

local M = {}

local SPEC = {
  zombie = { hp = 20, speed = 2.4, hw = 0.3, h = 1.9, hostile = true },
  creeper = { hp = 20, speed = 2.5, hw = 0.3, h = 1.7, hostile = true },
  pig = { hp = 10, speed = 1.1, hw = 0.4, h = 0.9 },
}
local CAP = { zombie = 6, creeper = 3, pig = 6 }

local function approach(v, target, step)
  if v < target then return min(v + step, target) end
  return max(v - step, target)
end

function M.reset(world) world.mobs = {} end

local function count(world, kind)
  local n = 0
  for _, m in ipairs(world.mobs) do if m.kind == kind then n = n + 1 end end
  return n
end

local function spawn(world, kind, x, y, z)
  local s = SPEC[kind]
  world.mobs[#world.mobs + 1] = { kind = kind, x = x, y = y, z = z, vx = 0, vy = 0, vz = 0, yaw = math.random() * 6.28, hp = s.hp, hurt = 0, cool = 1, age = 0, phase = 0, wait = 0, burn = 0 }
end

local function free(x, y, z) return voxel.get(x, y, z) == 0 or not nova.voxel.info(voxel.get(x, y, z)).solid end

-- a dark spot near the player for the hostile ones, a lit grassy one for pigs
local function try_spawn(world)
  local p, day = world.p, world.day or 1
  for _ = 1, 6 do
    local a, r = math.random() * 6.283, 16 + math.random() * 14
    local x, z = floor(p.x + cos(a) * r), floor(p.z + sin(a) * r)
    if voxel.has_chunk(floor(x / 16), floor(z / 16)) then
      local pass_through = math.random() < 0.5
      local y = pass_through and floor(p.y) + math.random(-8, 8) or voxel.top(x, z) + 1
      if y > 1 and free(x, y, z) and free(x, y + 1, z) and nova.voxel.info(voxel.get(x, y - 1, z)).solid then
        local sky, glow = voxel.light(x, y, z)
        local light = max(sky / 15 * day, glow / 15)
        local under = voxel.get(x, y - 1, z)
        if light < 0.35 and not world.creative then
          local kind = math.random() < 0.7 and "zombie" or "creeper"
          if count(world, kind) < CAP[kind] then spawn(world, kind, x + 0.5, y, z + 0.5) return end
        elseif light > 0.7 and under == B.grass and count(world, "pig") < CAP.pig then
          spawn(world, "pig", x + 0.5, y, z + 0.5)
          return
        end
      end
    end
  end
end

local function explode(world, m)
  local R = 3
  local cx, cy, cz = floor(m.x), floor(m.y + 0.8), floor(m.z)
  for dx = -R, R do
    for dy = -R, R do
      for dz = -R, R do
        if dx * dx + dy * dy + dz * dz <= R * R + 1 then
          local id = voxel.get(cx + dx, cy + dy, cz + dz)
          if id ~= 0 and P[id].hard >= 0 then
            voxel.edit(cx + dx, cy + dy, cz + dz, 0)
            if math.random() < 0.12 then world:burst(cx + dx + 0.5, cy + dy + 0.5, cz + dz + 0.5, id, 1) end
          end
        end
      end
    end
  end
  nova.sound.play("explode", { volume = 1.4, range = 64, at = { m.x, m.y + 0.8, m.z } })
  local p = world.p
  local d = sqrt((p.x - m.x) ^ 2 + (p.y + 0.9 - m.y) ^ 2 + (p.z - m.z) ^ 2)
  if d < 7 then
    world:hurt(floor((7 - d) * 1.6), "blew up")
    p.vx, p.vz, p.vy = p.vx + (p.x - m.x) / max(d, 0.5) * 8, p.vz + (p.z - m.z) / max(d, 0.5) * 8, 6
  end
  m.dead = true
end

local function step(world, m, dt)
  local s = SPEC[m.kind]
  local p = world.p
  m.age, m.hurt, m.cool = m.age + dt, max(0, m.hurt - dt), m.cool - dt
  local dx, dz = p.x - m.x, p.z - m.z
  local d = sqrt(dx * dx + dz * dz)
  local wx, wz, speed = 0, 0, s.speed
  if s.hostile and d < 26 and not world.creative and not world.dead then
    wx, wz = dx / max(d, 0.01), dz / max(d, 0.01)
    m.yaw = math.atan(wx, wz)
    if m.kind == "zombie" then
      if d < 1.4 and abs(p.y - m.y) < 1.6 and m.cool <= 0 then
        m.cool = 1
        world:hurt(3, "was slain by a zombie")
        p.vx, p.vz = p.vx + wx * 4, p.vz + wz * 4
      end
      if m.age % 7 < dt then nova.sound.play("groan", { volume = 0.8, pitch = 0.8 + math.random() * 0.3, limit = 2, at = { m.x, m.y + 1.6, m.z } }) end
    else
      if d < 3.2 then
        if not m.fuse then nova.sound.play("hiss", { volume = 0.9, at = { m.x, m.y + 1, m.z } }) end
        m.fuse = (m.fuse or 0) + dt
        speed = 0
        if m.fuse > 1.5 then explode(world, m) return end
      elseif m.fuse and d > 6 then
        m.fuse = nil
      end
    end
  elseif not s.hostile then
    m.wait = m.wait - dt
    if m.wait <= 0 then
      m.wait = 1 + math.random() * 3
      m.walking = math.random() < 0.6
      m.yaw = math.random() * 6.283
      if math.random() < 0.15 then nova.sound.play("oink", { volume = 0.7, pitch = 0.8 + math.random() * 0.4, limit = 1, at = { m.x, m.y + 0.5, m.z } }) end
    end
    if m.walking then wx, wz = sin(m.yaw), cos(m.yaw) end
  end
  -- daylight burns zombies
  if m.kind == "zombie" and (world.day or 1) > 0.8 then
    local sky = voxel.light(m.x, m.y + 1.8, m.z)
    if sky >= 14 and voxel.get(m.x, m.y + 0.5, m.z) ~= B.water then
      m.burn = m.burn + dt
      if m.burn > 1 then m.burn, m.hp = 0, m.hp - 2; m.hurt = 0.3; if m.hp <= 0 then m.dead = true end end
    end
  end
  local swimming = voxel.get(m.x, m.y + 0.4, m.z) == B.water
  m.vx, m.vz = approach(m.vx, wx * speed, 30 * dt), approach(m.vz, wz * speed, 30 * dt)
  if swimming then m.vy = approach(m.vy, 1.5, 20 * dt) else m.vy = max(m.vy - 32 * dt, -50) end
  local x, y, z, hx, hy, hz, ground = voxel.move(m.x, m.y, m.z, s.hw, s.h, m.vx * dt, m.vy * dt, m.vz * dt, 0.6)
  m.x, m.y, m.z = x, y, z
  if hy then m.vy = 0 end
  if (hx or hz) and ground and (wx ~= 0 or wz ~= 0) then m.vy = 8.2 end
  m.phase = m.phase + sqrt(m.vx * m.vx + m.vz * m.vz) * dt * 2.2
  if m.y < -10 then m.dead = true end
end

function M.update(world, dt)
  world.spawn_wait = (world.spawn_wait or 0) - dt
  if world.spawn_wait <= 0 then
    world.spawn_wait = 1.2
    try_spawn(world)
  end
  local p = world.p
  for i = #world.mobs, 1, -1 do
    local m = world.mobs[i]
    step(world, m, dt)
    local far = (m.x - p.x) ^ 2 + (m.z - p.z) ^ 2 > 60 * 60
    if m.dead or far then table.remove(world.mobs, i) end
  end
end

-- the nearest mob on a ray from the eye, within reach, and how far along it
function M.aim(world, eye, dir, reach)
  local best, bt = nil, reach
  for _, m in ipairs(world.mobs) do
    local s = SPEC[m.kind]
    local cx, cy, cz = m.x - eye[1], m.y + s.h * 0.5 - eye[2], m.z - eye[3]
    local t = cx * dir[1] + cy * dir[2] + cz * dir[3]
    if t > 0 and t < bt then
      local px, py, pz = eye[1] + dir[1] * t - m.x, eye[2] + dir[2] * t - (m.y + s.h * 0.5), eye[3] + dir[3] * t - m.z
      if sqrt(px * px + pz * pz) < s.hw + 0.25 and abs(py) < s.h * 0.5 + 0.15 then best, bt = m, t end
    end
  end
  return best, bt
end

function M.hit(world, m, dx, dz)
  local slot = world.inv[world.sel]
  local tool = slot and P[slot.id].tool_kind and P[slot.id]
  local damage = tool and tool.damage or 1
  if world.creative then damage = 20 end
  m.hp = m.hp - damage
  m.hurt = 0.35
  m.vx, m.vz, m.vy = m.vx + dx * 7, m.vz + dz * 7, 4
  nova.sound.play("hurt", { volume = 0.35, pitch = 1.3, limit = 2 })
  world.swing = 0.25
  if tool and not world.creative then
    slot.dur = (slot.dur or tool.uses) - 1
    if slot.dur <= 0 then world.inv[world.sel] = nil end
  end
  if m.hp <= 0 then
    m.dead = true
    if m.kind == "pig" then world:drop(B.pork, math.random(1, 3), m.x, m.y + 0.5, m.z) end
    if m.kind == "creeper" then world:drop(B.gunpowder, math.random(0, 2), m.x, m.y + 0.5, m.z) end
    world:burst(m.x, m.y + 0.8, m.z, B.cobblestone, 8)
  end
end

function M.draw(world)
  for _, m in ipairs(world.mobs) do
    local sw = sin(m.phase) * 0.9
    local parts
    if m.kind == "zombie" then
      parts = { arm_l = { rx = -1.45 }, arm_r = { rx = -1.45 }, leg_l = { rx = sw }, leg_r = { rx = -sw } }
    elseif m.kind == "creeper" then
      parts = { leg_fl = { rx = sw }, leg_br = { rx = sw }, leg_fr = { rx = -sw }, leg_bl = { rx = -sw } }
    else
      parts = { leg_fl = { rx = sw }, leg_br = { rx = sw }, leg_fr = { rx = -sw }, leg_bl = { rx = -sw } }
    end
    local swell = m.fuse and (1 + m.fuse * 0.18) or 1
    local tint = m.hurt > 0 and { 255, 110, 110 } or (m.fuse and floor(m.fuse * 8) % 2 == 0 and { 255, 255, 255 }) or nil
    nova.model(m.kind, m.x, m.y, m.z, { ry = m.yaw, parts = parts, scale = swell, tint = tint, shadow = false })
  end
end

return M

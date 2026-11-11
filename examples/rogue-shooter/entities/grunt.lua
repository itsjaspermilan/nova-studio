-- A grunt. By default it stands still and faces the hero, like a target on a range: it falls when shot enough and gets up again after a few seconds.
-- With "chase" on it walks at the hero (round walls, by the path grid) and hits it when close.
local sin, cos, sqrt, atan = math.sin, math.cos, math.sqrt, math.atan

local Grunt = nova.entity {
  tags = { "enemy" },
  velocity = false,
  radius = 0.42,
  height = 1.7,
  settings = {
    hp = { 6, min = 1, max = 100, step = 1, help = "How many shots it takes" },
    speed = { 3.2, min = 0.5, max = 8, step = 0.1, help = "Walking speed (metres a second)" },
    chase = { false, help = "Walks at the hero and hits it (off: stands still, a target)" },
    respawn = { 3, min = 0, max = 60, step = 0.5, help = "Seconds before a shot down grunt stands up again (0: stays down)" },
    damage = { 1, min = 1, max = 10, step = 1, help = "How much a hit hurts the hero" },
  },
}

function Grunt:create()
  self.t = math.random() * 10
  self.repath = math.random() * 0.3
  self.hit_t, self.cool = 0, 0
  self.face = 0
  self.way = nil
  self.down = false
  self.max_hp = self.hp
  self.down_t = 0
end

-- shot by a bullet (or anything): takes damage, is pushed a little, flashes, and dies at 0
function Grunt:hurt(n, dx, dz)
  self.hp = self.hp - n
  self.hit_t = 0.09
  if self.chase then self.x, self.z = nova.walls.move(self.x, self.z, (dx or 0) * 0.12, (dz or 0) * 0.12, self.radius) end
  if self.hp <= 0 then
    for _ = 1, 16 do
      nova.spawn("spark", self.x, self.y + 0.3 + math.random() * 1.2, { z = self.z, nx = 0, nz = 0, color = { 200, 60, 50 }, size = 0.16, fast = 2.2 })
    end
    local hero = nova.first("hero")
    if hero then hero.hits = (hero.hits or 0) + 1 end
    if self.respawn > 0 then
      self.down, self.down_t = true, self.respawn
    else
      self:destroy()
    end
  end
end

function Grunt:update(dt)
  if self.down then
    self.down_t = self.down_t - dt
    if self.down_t <= 0 then self.down, self.hp = false, self.max_hp end
    return
  end
  self.t = self.t + dt
  self.hit_t = math.max(0, self.hit_t - dt)
  self.cool = math.max(0, self.cool - dt)
  local hero = nova.first("hero")
  if not hero or hero.dead then return end
  local tx, tz = hero.x - self.x, hero.z - self.z
  local dist = sqrt(tx * tx + tz * tz)
  if not self.chase then
    self.pace = 0
    if dist > 0.01 then self.face = atan(tx, tz) end
    return
  end

  -- where to walk: straight at the hero when it can be seen, else by the path (looked for a few times a second)
  local gx, gz
  if dist > 0.01 and nova.walls.line_clear(self.x, self.z, hero.x, hero.z, 1, 1) then
    gx, gz = hero.x, hero.z
    self.way = nil
  else
    self.repath = self.repath - dt
    if self.repath <= 0 or not self.way then
      self.repath = 0.3
      local path = nova.nav.path(self.x, self.z, hero.x, hero.z)
      self.way = path and path[1] or nil
      -- skip a corner that is already reached
      if self.way and path[2] and (self.way.x - self.x) ^ 2 + (self.way.z - self.z) ^ 2 < 0.36 then self.way = path[2] end
    end
    if self.way then gx, gz = self.way.x, self.way.z end
  end

  local mx, mz = 0, 0
  if gx and dist > 1.0 then
    local dx, dz = gx - self.x, gz - self.z
    local d = sqrt(dx * dx + dz * dz)
    if d > 0.05 then mx, mz = dx / d, dz / d end
  end
  -- keep a little apart from the others
  for _, o in ipairs(nova.all("enemy")) do
    if o ~= self then
      local ox, oz = self.x - o.x, self.z - o.z
      local od = sqrt(ox * ox + oz * oz)
      if od < 0.9 and od > 0.001 then mx, mz = mx + ox / od * (0.9 - od), mz + oz / od * (0.9 - od) end
    end
  end
  local ml = sqrt(mx * mx + mz * mz)
  if ml > 1 then mx, mz, ml = mx / ml, mz / ml, 1 end
  self.pace = ml * self.speed
  self.x, self.z = nova.walls.move(self.x, self.z, mx * self.speed * dt, mz * self.speed * dt, self.radius)
  if dist > 0.01 then self.face = atan(tx, tz) end

  -- close enough: hit
  if dist < 1.25 and math.abs(hero.y - self.y) < 1.2 and self.cool == 0 then
    self.cool = 0.9
    hero:hurt(self.damage, tx / dist, tz / dist)
  end
end

local function part(self, ox, oy, oz, w, h, d, color)
  local c, s = cos(self.face), sin(self.face)
  if self.hit_t > 0 then color = { 255, 255, 255 } end
  nova.cuboid_at(self.x + ox * c + oz * s, self.y + oy, self.z - ox * s + oz * c, w, h, d, { ry = self.face, color = color, glow = self.hit_t > 0 })
end

function Grunt:draw()
  if self.down then return end
  local walk = math.min(1, (self.pace or 0) / 2)
  local swing = sin(self.t * 9) * 0.14 * walk
  local bob = math.abs(sin(self.t * 9)) * 0.05 * walk
  part(self, -0.14, 0.4 + bob, swing, 0.22, 0.8, 0.24, { 70, 40, 40 }) -- legs
  part(self, 0.14, 0.4 + bob, -swing, 0.22, 0.8, 0.24, { 70, 40, 40 })
  part(self, 0, 1.15 + bob, 0, 0.62, 0.7, 0.34, { 150, 50, 50 }) -- body
  part(self, -0.42, 1.2 + bob, 0.25 + swing, 0.16, 0.16, 0.6, { 150, 50, 50 }) -- arms held out in front
  part(self, 0.42, 1.2 + bob, 0.25 - swing, 0.16, 0.16, 0.6, { 150, 50, 50 })
  part(self, 0, 1.7 + bob, 0, 0.34, 0.34, 0.34, { 190, 140, 110 }) -- head
  part(self, -0.08, 1.74 + bob, 0.18, 0.07, 0.05, 0.03, { 255, 230, 80 }) -- eyes
  part(self, 0.08, 1.74 + bob, 0.18, 0.07, 0.05, 0.03, { 255, 230, 80 })
  nova.quad3(self.x, 0.02, self.z, 0, 1, 0, 1.1, { color = { 0, 0, 0, 90 }, round = true })
end

return Grunt

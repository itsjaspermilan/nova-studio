local state = require("lib.state")

-- The base of the swarm: walks at the player, pushes the others apart, hurts on touch, drops a gem. Written the obvious way,
-- which is the point: the probe is about what that costs.
local Enemy = nova.entity { tags = { "enemy" }, hp = 3, speed = 3, radius = 0.6, damage = 8, gem = 1 }

local near = {} -- (reused: who is close)

function Enemy:create()
  self.flash = 0
  self.ry = 0
end

function Enemy:update(dt)
  local p = nova.first("player")
  if not p then return end
  local dx, dz = p.x - self.x, p.z - self.z
  local d = math.sqrt(dx * dx + dz * dz)
  local vx, vz = 0, 0
  if d > 0.01 then vx, vz = dx / d * self.speed, dz / d * self.speed end
  -- push away from the enemies that are too close (the engine's grid finds them without looking at all the others)
  local crowd = nova.in_radius(self.x, self.z, self.radius * 2, "enemy", near)
  for i = 1, #crowd do
    local o = crowd[i]
    if o ~= self then
      local ox, oz = self.x - o.x, self.z - o.z
      local od2 = ox * ox + oz * oz
      local reach = self.radius + o.radius
      if od2 < reach * reach and od2 > 0.0001 then
        local od = math.sqrt(od2)
        vx, vz = vx + ox / od * 3, vz + oz / od * 3
      end
    end
  end
  self.x, self.z = self.x + vx * dt, self.z + vz * dt
  self.ry = math.atan(dx, dz)
  self.flash = math.max(0, self.flash - dt)
  self.tint = self.flash > 0 and { 255, 190, 190 } or nil
end

-- Touching the player (the engine's collisions, on the ground plane).
function Enemy:on_collide_player(p) p:hurt(self.damage) end

function Enemy:hurt(amount)
  self.hp = self.hp - amount
  self.flash = 0.08
  if self.hp > 0 then
    nova.sound.play("hit", { volume = 0.25, pitch = 0.9 + math.random() * 0.3, limit = 5 })
    return
  end
  state.kills = state.kills + 1
  nova.sound.play("pop", { volume = 0.3, pitch = 0.9 + math.random() * 0.3, limit = 6 })
  nova.burst(self.x, 0.8, self.z, { model = "bullet", count = 5, life = { 0.25, 0.5 }, speed = { 2, 6 }, size = { 0.5, 1 }, size_end = 0, gravity = -9, spread = 2.6, color = { 255, 190, 90, 255 }, color_end = { 255, 90, 40, 0 } })
  nova.spawn("gem", self.x, 0.5, { z = self.z, value = self.gem })
  self:destroy()
end

return Enemy

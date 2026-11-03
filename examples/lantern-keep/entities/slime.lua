local state = require("lib.state")

-- A green blob: it wanders, and creeps after the hero when he is close. Two hits.
local Slime = nova.entity {
  sprite = "slime",
  anim = "wobble",
  tags = { "enemy" },
  hitbox = { -12, -2, 24, 14 },
  depth = 20,
}

function Slime:create()
  self.hp = 2
  self.kx = 0
  self.heading = math.random() * math.pi * 2
  self.turn_at = 0
  self.flash = 0
  self.anim_speed = 0.6 + math.random() * 0.4
end

function Slime:update(dt)
  local hero = nova.first("hero")
  local speed = 34
  if hero and self:distance_to(hero.x, hero.y) < 210 then
    self.heading = math.atan(hero.y - self.y, hero.x - self.x)
    speed = 58
  elseif nova.time() > self.turn_at then
    self.heading = self.heading + (math.random() - 0.5) * 3
    self.turn_at = nova.time() + 0.8 + math.random()
  end
  local bx, by = self:slide(math.cos(self.heading) * speed * dt + self.kx * dt, math.sin(self.heading) * speed * dt)
  if bx or by then self.heading = self.heading + math.pi * 0.7 end
  self.kx = self.kx * 0.85
  self.flash = math.max(0, self.flash - dt)
  self.tint = self.flash > 0 and { 255, 150, 150 } or { 255, 255, 255 }
end

function Slime:hurt(damage, from_side)
  self.hp = self.hp - damage
  self.kx = (from_side or 1) * 260
  self.flash = 0.18
  if self.hp <= 0 then
    nova.sound.play("enemy_die")
    nova.burst(self.x, self.y, { count = 14, speed = { 40, 150 }, life = { 0.3, 0.6 }, size = 5, size_end = 0, color = { 92, 207, 108, 255 }, color_end = { 40, 120, 60, 0 }, gravity = 120 })
    state.slain = state.slain + 1
    if math.random() < 0.3 then nova.spawn("heart", self.x, self.y) end
    self:destroy()
  else
    nova.sound.play("hit_enemy")
  end
end

function Slime:on_collide_hero(hero) hero:hurt(self.x) end

return Slime

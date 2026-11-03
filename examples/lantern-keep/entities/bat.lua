local state = require("lib.state")

-- A bat flutters straight at the hero, over the pillars. One hit.
local Bat = nova.entity {
  sprite = "bat",
  anim = "flap",
  tags = { "enemy" },
  hitbox = { -10, -8, 20, 16 },
  depth = 5,
}

function Bat:create()
  self.hp = 1
  self.phase = math.random() * 6
  self.flash = 0
  self.kx = 0
end

function Bat:update(dt)
  local hero = nova.first("hero")
  if hero then
    local a = math.atan(hero.y - self.y, hero.x - self.x) + math.sin(nova.time() * 3 + self.phase) * 0.9
    self.x = self.x + (math.cos(a) * 92 + self.kx) * dt
    self.y = self.y + math.sin(a) * 92 * dt
  end
  self.kx = self.kx * 0.85
  self.x = math.max(40, math.min(920, self.x))
  self.y = math.max(40, math.min(504, self.y))
end

function Bat:hurt(damage, from_side)
  nova.sound.play("enemy_die", { pitch = 1.5 })
  nova.burst(self.x, self.y, { count = 10, speed = { 40, 130 }, life = { 0.25, 0.5 }, size = 4, size_end = 0, color = { 125, 86, 160, 255 }, color_end = { 80, 40, 110, 0 } })
  state.slain = state.slain + 1
  if math.random() < 0.2 then nova.spawn("heart", self.x, self.y) end
  self:destroy()
end

function Bat:on_collide_hero(hero) hero:hurt(self.x) end

return Bat

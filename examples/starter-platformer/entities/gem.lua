-- A pickup: one frame of the "items" sheet (made with items_make; frame 8 is the gem). It bobs, and is taken on touch.
local Gem = nova.entity {
  sprite = "items", frame = 8,
  tags = { "gem" },
  sx = 3, sy = 3,
  hitbox = { -5, -5, 10, 10 },
}

function Gem:create()
  self.home = self.y
  self.age = 0
end

function Gem:update(dt)
  self.age = self.age + dt
  self.y = self.home + math.sin(self.age * 4) * 4
end

function Gem:on_collide_hero()
  nova.sound.play("pickup", { volume = 0.7 })
  local level = require("lib.level")
  level.gems = level.gems + 1 -- kept in the module, so the count lives on through a door
  nova.log("gem " .. level.gems)
  self:destroy()
end

return Gem

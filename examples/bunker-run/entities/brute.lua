local state = require("lib.state")
local fx = require("lib.fx")

-- A brute: big, slow to turn up and hard to stop, and it hits like a door.
local Brute = nova.entity(require("entities.enemy"), {
  hitbox = { r = 0.75, base = 0, height = 2.3 }, hp = 160, speed = 3.0, radius = 0.75, height = 2.3, eye_h = 1.9,
  damage = 22, drop = "health", close = 40, sight = 22,
})

function Brute:wanted_speed(sees, d)
  if d < 1.6 then return 0.3 end
  return sees and d < 14 and 5.0 or self.speed -- charges when it sees you
end

function Brute:think(p, sees, d, dt)
  if d < 1.9 and sees and self.cool <= 0 then
    self.cool = 1.1
    p:hurt(self.damage)
    nova.sound.play("hurt", { volume = 0.5, pitch = 0.6, at = { self.x, 1, self.z } })
  end
end

function Brute:on_wake()
  nova.sound.play("boss_roar", { volume = 0.5, pitch = 1.6, at = { self.x, 1.5, self.z }, range = 35 })
end

function Brute:draw()
  self:figure("brute", 2.64, { 255, 200, 170 })
end

return Brute

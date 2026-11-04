local state = require("lib.state")
local fx = require("lib.fx")

-- A drone: floats, fast, weak, and rams you.
local Drone = nova.entity(require("entities.enemy"), {
  hitbox = { r = 0.4, base = -0.15, height = 0.85 }, hp = 20, speed = 5.2, radius = 0.4, height = 0.8, eye_h = 1.4, y = 1.0,
  damage = 10, drop = "ammo", close = 40, die_sound = "drone_die", blood = { 120, 200, 255 },
})

function Drone:think(p, sees, d, dt)
  self.y = 1.0 + math.sin(nova.time() * 5 + self.x) * 0.15
  if d < 1.0 and self.cool <= 0 then
    self.cool = 0.8
    p:hurt(self.damage)
    nova.sound.play("enemy_hit", { volume = 0.8, pitch = 1.6, at = { self.x, self.y, self.z } })
  end
end

function Drone:draw()
  self:box(0, 0.2, 0, 0.6, 0.3, 0.6, { 90, 100, 120 })
  self:box(0, 0.2, -0.32, 0.2, 0.12, 0.05, { 120, 220, 255 }, true)
  local t = nova.time() * 30
  self:box(0, 0.4, 0, 0.9 + math.sin(t) * 0.08, 0.03, 0.12, { 60, 60, 70 })
  self:box(0, 0.4, 0, 0.12, 0.03, 0.9 + math.cos(t) * 0.08, { 60, 60, 70 })
  fx.want_light(self.x, self.y + 0.3, self.z, 4, { 0.3, 0.7, 1 }, -20)
end

return Drone

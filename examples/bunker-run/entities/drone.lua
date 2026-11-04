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
  -- the blaster kit's grenade, spinning, with the light it has always had
  nova.model("drone", self.x, self.y, self.z, { ry = nova.time() * 9, rz = math.sin(nova.time() * 3 + self.x) * 0.25, tint = self.flash > 0 and { 255, 120, 90 } or nil })
  fx.want_light(self.x, self.y + 0.3, self.z, 4, { 0.3, 0.7, 1 }, -20)
end

return Drone

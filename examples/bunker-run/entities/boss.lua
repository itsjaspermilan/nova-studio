local state = require("lib.state")
local fx = require("lib.fx")

-- The boss of the arena: bursts of fire, and drones when it is hurt. When it falls the exit lights up.
local Boss = nova.entity(require("entities.enemy"), {
  hitbox = { r = 1.0, base = 0, height = 3.2 }, hp = 600, speed = 2.4, radius = 1.0, height = 3.2, eye_h = 2.6,
  damage = 9, close = 40, sight = 60, drop = "health", blood = { 255, 200, 80 },
})

function Boss:create()
  require("entities.enemy").create(self)
  self.burst = 0
  self.summoned = 0
end

function Boss:wanted_speed(sees, d)
  return (sees and d < 14) and 0 or self.speed
end

function Boss:on_wake()
  state.say("the arena's keeper wakes", 3)
  nova.sound.play("boss_roar", { volume = 1, at = { self.x, 2, self.z }, range = 60 })
end

function Boss:think(p, sees, d, dt)
  -- drones at two thirds and one third of its health
  local third = self.max_hp / 3
  if self.summoned < 2 and self.hp < self.max_hp - third * (self.summoned + 1) then
    self.summoned = self.summoned + 1
    for i = 1, 2 do nova.spawn("drone", self.x + (i == 1 and -2 or 2), 1, { z = self.z + 1.5, mode = "chase" }) end
    nova.sound.play("boss_roar", { volume = 1, pitch = 1.3, at = { self.x, 2, self.z }, range = 60 })
  end
  if not sees or self.cool > 0 then return end
  -- three shots in a burst, then a pause
  self.burst = self.burst + 1
  self.cool = self.burst % 3 == 0 and 1.6 or 0.18
  local sy = self.y + 2.2
  local ex, ez = self.x - math.sin(self.ry) * 1.0, self.z - math.cos(self.ry) * 1.0
  nova.sound.play("enemy_shot", { volume = 1, limit = 4, pitch = 0.6, at = { self.x, sy, self.z }, range = 60 })
  fx.flash(ex, sy, ez, { 255, 120, 80 }, 0.06, 9)
  local hit = math.random() < math.max(0.25, 0.8 - d * 0.02)
  fx.tracer(ex, sy, ez, p.x + (hit and 0 or (math.random() - 0.5) * 3), p:eye_height() - 0.3, p.z + (hit and 0 or (math.random() - 0.5) * 3), { 255, 90, 60 })
  if hit then p:hurt(self.damage) end
end

function Boss:on_death()
  state.exit_open = true
  state.say("the exit is open", 5)
  nova.sound.play("win", { volume = 0.7, pitch = 0.6 })
end

function Boss:draw()
  self:figure("boss", 3.74, { 230, 170, 255 })
  fx.want_light(self.x, 2.5, self.z, 7, { 1, 0.3, 0.9 }, -10)
end

return Boss

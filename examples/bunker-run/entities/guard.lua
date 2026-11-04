local state = require("lib.state")
local fx = require("lib.fx")

-- A guard: keeps its distance and shoots when it can see you, less truly the further you are.
local Guard = nova.entity(require("entities.enemy"), {
  hitbox = { r = 0.45, base = 0, height = 1.8 }, hp = 40, speed = 3.2, radius = 0.45, height = 1.8, eye_h = 1.5,
  damage = 8, drop = "ammo", close = 14, shots = 1,
})

function Guard:wanted_speed(sees, d)
  if sees and d < 10 then return 0 end -- stands and shoots
  return self.speed
end

function Guard:think(p, sees, d, dt)
  if not sees or self.cool > 0 or d > 26 then return end
  self.cool = 0.9 + math.random() * 0.5
  local sy = self.y + self.eye_h
  local ex, ez = self.x - math.sin(self.ry) * 0.5, self.z - math.cos(self.ry) * 0.5
  nova.sound.play("enemy_shot", { volume = 0.9, limit = 4, at = { self.x, sy, self.z }, range = 40 })
  fx.flash(ex, sy, ez, { 255, 120, 80 }, 0.05, 7)
  -- hits more often the nearer he is and the less he is moving
  local chance = math.max(0.15, 0.85 - d * 0.03 - p.walk_x * p.walk_x * 0.002 - p.walk_z * p.walk_z * 0.002)
  local hit = math.random() < chance
  local ty = p:eye_height() - 0.3
  fx.tracer(ex, sy, ez, p.x + (hit and 0 or (math.random() - 0.5) * 2), ty, p.z + (hit and 0 or (math.random() - 0.5) * 2), { 255, 110, 80 })
  if hit then p:hurt(self.damage) end
end

function Guard:draw()
  self:humanoid({ 70, 110, 80 }, { 200, 170, 140 }, 1, true)
end

return Guard

-- A gem (models/gem.glb, prop3d_make): it turns and bobs, glows a little, and is taken when the hero comes within reach.
local Gem = nova.entity { model = "gem", tags = { "gem" }, velocity = false }

function Gem:create()
  self.base_y = self.y
  self.t = (self.x * 0.37 + self.z * 0.61) % 6.28   -- so they do not all bob together
end

function Gem:update(dt)
  self.t = self.t + dt
  self.ry = self.t * 2
  self.y = self.base_y + math.sin(self.t * 2.4) * 0.1
  local hero = nova.named("hero")
  if hero and math.abs(hero.x - self.x) < 0.8 and math.abs(hero.z - self.z) < 0.8 and math.abs(hero.y + 0.8 - self.y) < 1.1 then
    nova.sound.play("pickup", { volume = 0.5 })
    nova.scene_now():gem_taken(self)
    self:destroy()
  end
end

function Gem:draw()
  nova.point_light(self.x, self.y, self.z, { radius = 2.4, color = { 90, 220, 150 } })
  nova.Entity.draw(self)
end

return Gem

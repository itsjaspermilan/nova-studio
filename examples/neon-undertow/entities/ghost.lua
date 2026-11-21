-- A fading copy of whoever made it (the roll's and the dash attack's after-image). It hurts and blocks nothing: no hitbox.
local Ghost = nova.entity { tags = { "ghost" }, velocity = false, tint = { 80, 230, 255 }, life = 0.22, t = 0, hitbox = { 0, 0, 0, 0 } }
function Ghost:update(dt)
  self.t = self.t + dt
  self.alpha = 0.8 * (1 - self.t / self.life)
  if self.t >= self.life then self:destroy() end
end
return Ghost

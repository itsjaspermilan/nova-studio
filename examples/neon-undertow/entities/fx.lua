-- A one-shot picture (a spark, the death burst): plays its animation and goes. Props: sprite, anim, scale.
local Fx = nova.entity { velocity = false, sx = 3, sy = 3 }
function Fx:create()
  if self.scale then self.sx, self.sy = self.scale, self.scale end
  self.depth = -self.y - 20
  self:play(self.anim, { restart = true })
end
function Fx:on_animation_end() self:destroy() end
return Fx

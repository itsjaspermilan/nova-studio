-- A one-shot picture (a spark, the death burst): plays its animation and goes. Props: sprite, anim, scale.
-- (the effects' sheets are drawn at twice the old size and added to the light: `scale` keeps the old meaning, so a caller's numbers did not change)
local Fx = nova.entity { velocity = false, sx = 1.5, sy = 1.5, blend = "add", lit = false }
function Fx:create()
  if self.scale then self.sx, self.sy = self.scale * 0.5, self.scale * 0.5 end
  self.depth = -self.y - 20
  self:play(self.anim, { restart = true })
end
function Fx:on_animation_end() self:destroy() end
return Fx

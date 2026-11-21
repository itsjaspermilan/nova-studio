-- A one-shot picture (a spark, the death burst): plays its animation and goes. Props: sprite, anim, scale (and magenta = true for an
-- enemy's colour). The old names stay: a "fx_spark" is now an impact (a flash, a ring, rays: sprites/fx_impact) with sparks flying from it,
-- a "fx_burst" a bigger one with smoke and chunks; `scale` keeps its old meaning, so no caller changed.
local V = require("lib.vfx")

local Fx = nova.entity { velocity = false, sx = 1.5, sy = 1.5, blend = "add", lit = false }

function Fx:create()
  local s = self.scale or 2
  if self.sprite == "fx_spark" or self.sprite == "fx_burst" then
    local burst = self.sprite == "fx_burst"
    local m = self.magenta == true
    self.sprite, self.anim = m and "fx_eimpact" or "fx_impact", "burst"
    self.sx, self.sy = s * (burst and 0.34 or 0.4), s * (burst and 0.34 or 0.4)
    local z = burst and 22 or 8
    V.sparks(self.x, self.y + z * 0.5, (burst and 3 or 1.6) + s, { z = z, speed = 160 + 36 * s, up = 140 + 20 * s, life = 0.5, colors = m and { "spark_white", "spark_red", "spark_red" } or { "spark_white", "spark_cyan", "spark_cyan" } })
    if burst then
      V.smoke(self.x, self.y, 1 + s / 3, { size = 16 + 5 * s, life = 0.9, alpha = 0.5 })
      V.debris(self.x, self.y, s / 2, { kind = "grey", speed = 110 + 14 * s, up = 220, size = 14 })
    end
  elseif self.scale then
    self.sx, self.sy = self.scale * 0.5, self.scale * 0.5
  end
  self.depth = -self.y - 20
  self:play(self.anim, { restart = true })
end
function Fx:on_animation_end() self:destroy() end
return Fx

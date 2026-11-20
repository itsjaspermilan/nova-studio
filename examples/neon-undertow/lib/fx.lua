-- One-shot pictures (entities/fx.lua): the burst of a spawn or a death, the spark of a hit.
local F = {}
function F.burst(x, y, scale) nova.spawn("fx", x, y, { sprite = "fx_burst", anim = "burst", scale = scale or 3 }) end
function F.spark(x, y, scale) nova.spawn("fx", x, y, { sprite = "fx_spark", anim = "spark", scale = scale or 2 }) end
return F

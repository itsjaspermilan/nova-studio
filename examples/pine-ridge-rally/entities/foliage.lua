-- The grass and flowers along the verges, as a scene object: its `plants` are a list of { model, count, sway, tints }, where `count` is how
-- many tufts of that model along the whole course, `sway` how much the wind bends them and `tints` the colours they are picked from
-- (multipliers, 255 is the model's own colour). lib/foliage.lua plants them at the start of a race; nothing else about them is in code.
local foliage = require("lib.foliage")

local Foliage = nova.entity { visible = false }

function Foliage:create()
  foliage.set(self.plants)
  self:destroy()
end

return Foliage

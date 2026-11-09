-- The grass beside some of free roam's roads: `routes` names the roads (roam_point routes), `plants` what grows beside them (as a course's
-- foliage object has it: { model, count, sway, tints }, the count spread along those roads). scenes/roam.lua plants them.
local RoamFoliage = nova.entity { visible = false }

RoamFoliage.sets = {}

function RoamFoliage:create()
  RoamFoliage.sets[#RoamFoliage.sets + 1] = { routes = self.routes or {}, plants = self.plants or {} }
  self:destroy()
end

return RoamFoliage

-- A little health bar over an enemy, shown once it has been hit (an enemy sets `hit_seen` when it is hurt) and for as long as it is alive.
local rect = require("lib.view").rect
local hpbar = {}

-- `top` is the y of the top of the enemy; the bar floats a little above it.
function hpbar.draw(e, top)
  if not e.hit_seen or not e.max_hp or e.hp <= 0 then return end
  local w = 24
  local f = math.max(0, math.min(1, e.hp / e.max_hp))
  local x, y = math.floor(e.x - w / 2), math.floor(top - 9)
  rect(x - 1, y - 1, w + 2, 5, { 12, 12, 22, 235 })
  rect(x, y, w, 3, { 80, 30, 30 })
  rect(x, y, math.max(1, math.floor(w * f)), 3, f > 0.5 and { 235, 80, 70 } or { 255, 150, 60 })
end

return hpbar

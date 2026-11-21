-- The thin sight line from the runner while ranged is held: a cyan line along the aim, and a dot where a shot would end.
local P = require("data.player")
local J = require("lib.juice")

local Sight = nova.entity { velocity = false, tags = { "ui" } }

function Sight:update(dt)
  if self.owner and not self.owner:is_alive() then self:destroy() end
end

function Sight:draw()
  local o = self.owner
  if not o or not o.aiming then return end
  local hx, hy = o:hips()
  local len = P.aim.sight_length
  local x1, y1 = nova.cam.to_screen(hx + o.aim_dx * 24, hy + o.aim_dy * 24)
  local x2, y2 = nova.cam.to_screen(hx + o.aim_dx * len, hy + o.aim_dy * len)
  local ready = o.charge + 1e-6 >= P.charge.shot_cost
  local col = ready and { 6, 240, 255, 150 } or { 255, 43, 214, 110 }
  local width = 2
  if o.slug_ready then col, width = { 255, 228, 94, 235 }, 5 end        -- (Overpressure: held long enough, the slug is ready)
  nova.ui.line(x1, y1, x2, y2, width, col)
  nova.ui.sprite("fx_dot", x2, y2, { scale = o.slug_ready and 1.75 or 1, blend = "add" })
end

return Sight

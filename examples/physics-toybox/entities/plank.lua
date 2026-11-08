-- A plank, stretched from a block picture to its w by h; `pin = true` puts it on a hinge at its middle (a seesaw).
local hud = require("lib.hud")
local Plank = nova.entity { sprite = "items/block_red", body = "dynamic", w = 200, h = 14, friction = 0.8, tags = { "thing" } }

function Plank:create()
  self.sx, self.sy = self.w / 96, self.h / 96
  if self.pin then self:join(nil, "hinge", { x = self.x, y = self.y }) end
  self.px, self.py = self.x, self.y
end

function Plank:on_hit(other, hit) hud.knock(hit.speed, 500) end

function Plank:draw()
  nova.Entity.draw(self)
  if self.pin then
    local w, h = nova.view()
    local cx, cy = nova.cam.position()
    nova.sprite("items/block_blue", self.px - (cx - w / 2), self.py + 26 - (cy - h / 2), { sx = 0.3, sy = 0.5 })
  end
end

return Plank

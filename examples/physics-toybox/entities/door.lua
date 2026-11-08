-- A door on a hinge at its left edge: walk into it or throw a ball at it and it swings.
local hud = require("lib.hud")
local Door = nova.entity { dim = 3, body = "dynamic", w = 1.2, h = 2, d = 0.12, density = 200, color = { 170, 110, 70 } }

function Door:create()
  self.y = self.y + self.h / 2
  -- (a hinge about the upright axis through its left edge, held to the world)
  self:join(nil, "hinge", { x = self.x - self.w / 2, y = self.y, z = self.z, axis = { 0, 1, 0 } })
  self.post = { self.x - self.w / 2 - 0.08, self.y, self.z }
end

function Door:on_hit(other, hit) hud.knock(hit.speed, 6) end
function Door:update() if nova.input.pressed("stats") then nova.log(string.format("door %.2f %.2f %.2f", self.x, self.y, self.z)) end end

function Door:draw()
  nova.cuboid_at(self.x, self.y, self.z, self.w, self.h, self.d, { quat = rawget(self, "quat"), color = self.color })
  local p = self.post
  nova.cuboid_at(p[1], p[2], p[3], 0.12, self.h + 0.2, 0.2, { color = { 90, 90, 100 } })
end

return Door

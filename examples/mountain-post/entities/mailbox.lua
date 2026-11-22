-- A mailbox at a gate, with the house's number painted on both sides of it (sprites/fx/num_<n>.png): the only thing in the world,
-- besides the signposts, that says where you are.
local Mailbox = nova.entity { tags = { "mailbox" } }

function Mailbox:create()
  nova.scenery.add("mailbox", self.x, 0, self.z, { ry = self.ry or 0, lift = "upright" })
  local ry = self.ry or 0
  -- the box's sides face its own +x and -x: (cos ry, -sin ry) in x, z
  local sx, sz = math.cos(ry), -math.sin(ry)
  local fx, fz = math.sin(ry), math.cos(ry)
  self.sprite = "num_" .. tostring(self.number or 0)
  self.sides = {
    { x = self.x + sx * 0.19 + fx * 0.05, z = self.z + sz * 0.19 + fz * 0.05, o = { face = { sx, 0, sz }, w = 0.26, h = 0.24 } },
    { x = self.x - sx * 0.19 + fx * 0.05, z = self.z - sz * 0.19 + fz * 0.05, o = { face = { -sx, 0, -sz }, w = 0.26, h = 0.24 } },
  }
end

function Mailbox:draw()
  for _, s in ipairs(self.sides) do nova.billboard(self.sprite, s.x, 0.92, s.z, 0.26, s.o) end
end

return Mailbox

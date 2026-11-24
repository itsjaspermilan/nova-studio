-- A mailbox at a gate, with the house's number painted on both sides of it and on its door (sprites/fx/num_<n>.png): the only thing in
-- the world, besides the signposts, that says where you are. (The owner's fifth play: the numbers are bigger now, dark on a cream plate
-- filling each side, and the door has one too, so the number shows coming up the lane as well as driving past.)
local Mailbox = nova.entity { tags = { "mailbox" } }

function Mailbox:create()
  nova.scenery.add(self.flag_up and "mailbox_up" or "mailbox", self.x, 0, self.z, { ry = self.ry or 0, lift = "upright" })
  local ry = self.ry or 0
  -- the box's sides face its own +x and -x: (cos ry, -sin ry) in x, z; its door faces its own +z
  local sx, sz = math.cos(ry), -math.sin(ry)
  local fx, fz = math.sin(ry), math.cos(ry)
  self.sprite = "num_" .. tostring(self.number or 0)
  self.sides = {
    { x = self.x + sx * 0.2 + fx * 0.05, z = self.z + sz * 0.2 + fz * 0.05, y = 0.92, size = 0.32, o = { face = { sx, 0, sz }, w = 0.32, h = 0.29 } },
    { x = self.x - sx * 0.2 + fx * 0.05, z = self.z - sz * 0.2 + fz * 0.05, y = 0.92, size = 0.32, o = { face = { -sx, 0, -sz }, w = 0.32, h = 0.29 } },
    -- (on the door: tools/models.mjs puts its face 0.34 m out along +z)
    { x = self.x + fx * 0.355, z = self.z + fz * 0.355, y = 0.9, size = 0.22, o = { face = { fx, 0, fz }, w = 0.22, h = 0.2 } },
  }
end

function Mailbox:draw()
  for _, s in ipairs(self.sides) do nova.billboard(self.sprite, s.x, s.y, s.z, s.size, s.o) end
end

return Mailbox

-- A box drawn as a cuboid: the ground, a ramp, a slab. Static unless its props say otherwise (`body`).
local Block = nova.entity { dim = 3, body = "static", w = 1, h = 1, d = 1, color = { 120, 180, 90 }, friction = 0.8 }

function Block:draw()
  nova.cuboid_at(self.x, self.y, self.z, self.w, self.h, self.d, { quat = rawget(self, "quat"), rx = self.rx, ry = self.ry, rz = self.rz, color = self.color })
end

return Block

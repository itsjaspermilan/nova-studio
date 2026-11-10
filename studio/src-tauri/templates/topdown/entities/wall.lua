-- A wall: solid, and drawn as a plain block. Its size is set per object in the scene editor (w and h).
local Wall = nova.entity {
  tags = { "solid" },
  settings = {
    w = { 40, min = 8, max = 960, step = 4, help = "How wide it is" },
    h = { 40, min = 8, max = 540, step = 4, help = "How tall it is" },
  },
}

function Wall:draw()
  nova.rect(self.x, self.y, self.w, self.h, { 78, 86, 110 })
end

return Wall

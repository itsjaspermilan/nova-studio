-- Something solid to stand on. Its size is set per object in the scene editor (w and h); the player stops at anything with the "solid" tag.
local Platform = nova.entity {
  tags = { "solid" },
  settings = {
    w = { 160, min = 8, max = 960, step = 4, help = "How wide it is" },
    h = { 24, min = 8, max = 540, step = 4, help = "How tall it is" },
  },
}

function Platform:draw()
  nova.rect(self.x, self.y, self.w, self.h, { 70, 110, 60 })
  nova.rect(self.x, self.y, self.w, 6, { 110, 170, 80 })
end

return Platform

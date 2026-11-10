-- The goal: touch it with every coin collected (or without) and the level is won; press jump to play it again.
local Flag = nova.entity { tags = { "flag" } }

function Flag:draw()
  nova.rect(self.x - 2, self.y - 70, 4, 70, { 235, 235, 235 })
  nova.rect(self.x + 2, self.y - 70, 30, 20, { 230, 80, 70 })
end

return Flag

-- A background strip drawn with a custom draw(): any entity can draw however it likes.
local Ground = nova.entity { depth = 100 }

function Ground:draw()
  local w = nova.view()
  nova.rect(0, self.y - self.top, w, 540 - (self.y - self.top), { 70, 110, 80 })
  nova.rect(0, self.y - self.top, w, 6, { 110, 160, 100 })
end

Ground.top = 16 -- how far the grass line sits above y (the player's feet)
return Ground

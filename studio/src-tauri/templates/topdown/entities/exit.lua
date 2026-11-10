-- The way out: it opens when every gem is collected.
local Exit = nova.entity { tags = { "exit" } }

function Exit:draw()
  local open = #nova.all("gem") == 0
  nova.rect(self.x - 18, self.y - 18, 36, 36, open and { 120, 230, 140 } or { 90, 90, 100 })
end

return Exit

-- A gem: collected by touching it.
local Gem = nova.entity { tags = { "gem" }, size = 16 }

function Gem:draw()
  local pulse = 2 + math.sin(nova.time() * 5 + self.x) * 2
  nova.rect(self.x - self.size / 2 - pulse / 2, self.y - self.size / 2 - pulse / 2, self.size + pulse, self.size + pulse, { 110, 220, 255 })
end

return Gem

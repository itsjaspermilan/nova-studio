-- A coin: the player collects it by touching it.
local Coin = nova.entity { tags = { "coin" }, size = 14 }

function Coin:draw()
  local bob = math.sin(nova.time() * 4 + self.x * 0.05) * 3
  nova.rect(self.x - self.size / 2, self.y - self.size / 2 + bob, self.size, self.size, { 255, 205, 60 })
end

return Coin

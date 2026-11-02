-- file: entities/coin.lua
-- A coin: touch it with the player and it vanishes and adds a point.
local Coin = nova.entity {
  tags = { "coin" },
  hitbox = { -8, -8, 16, 16 }, -- x, y, width, height, measured from the coin's position
}

function Coin:draw()
  nova.rect(self.x - 8, self.y - 8, 16, 16, { 255, 210, 60 })
end

function Coin:on_collide_player(player)
  nova.send("score", "add", 1)
  self:destroy()
end

return Coin

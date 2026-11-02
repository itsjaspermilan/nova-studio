-- file: entities/coin.lua
-- The same coin, now with a sound. "coin" is the sound you made (sounds/coin.wav).
local Coin = nova.entity {
  tags = { "coin" },
  hitbox = { -8, -8, 16, 16 },
}

function Coin:draw()
  nova.rect(self.x - 8, self.y - 8, 16, 16, { 255, 210, 60 })
end

function Coin:on_collide_player(player)
  nova.sound.play("coin")
  nova.send("score", "add", 1)
  self:destroy()
end

return Coin

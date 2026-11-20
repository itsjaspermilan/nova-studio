-- A coin: the "coin" animation of the items sheet (items_make), taken on touch.
local game = require("lib.game")

local Coin = nova.entity {
  sprite = "items", anim = "coin",
  tags = { "coin" },
  sx = 3, sy = 3,
  hitbox = { -5, -5, 10, 10 },
}

function Coin:create() self.depth = -self.y end

function Coin:on_collide_hero()
  game.coins = game.coins + 1
  nova.sound.play("coin", { volume = 0.6 })
  nova.log("coin " .. game.coins)
  self:destroy()
end

return Coin

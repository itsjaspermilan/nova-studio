-- A chest: frames 9 (closed) and 10 (open) of the items sheet, tagged "chest". It is solid, so the hero never overlaps it:
-- it notices him with `near`, and opens when he swings beside it.
local game = require("lib.game")

local Chest = nova.entity {
  sprite = "items", frame = 9,
  tags = { "solid" },
  pivot = { 0.5, 1 },
  hitbox = { -6, -8, 12, 8 },
  sx = 3, sy = 3,
}

function Chest:create()
  self.depth = -self.y
  self.open = false
end

function Chest:update()
  if not self.open and self:near("hero", 10) and nova.input.pressed("attack") then
    self.open = true
    self:play("chest")
    game.coins = game.coins + 5
    nova.sound.play("chest_open", { volume = 0.7 })
    nova.log("chest opened, coins " .. game.coins)
  end
end

return Chest

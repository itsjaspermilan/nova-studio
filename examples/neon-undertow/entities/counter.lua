-- A counter in the walk-through room: the shop's three stalls and the bank. Solid. Props: item ("heal", "reroll", "jinx", "bank"), tiles.
-- The room shows what it sells (data/shop.lua) when the runner stands by it.
local H = require("data.hazards")

local FRAMES = { heal = 0, reroll = 1, jinx = 2, bank = 3 }

local Counter = nova.entity { tags = { "counter", "solid" }, velocity = false, sx = 1, sy = 1, item = "heal", tiles = 2 }

function Counter:create()
  self.w, self.h = self.tiles * H.tile, H.tile
  self.hitbox = { -self.w / 2, -self.h / 2, self.w, self.h }
  self.depth = -self.y
end

function Counter:draw()
  local x, y = nova.cam.to_screen(self.x, self.y)
  nova.sprite("counter", x, y - 10, { w = self.w, h = self.h + 20, frame = FRAMES[self.item] or 0 })
end

return Counter

-- A counter in the walk-through room: the shop's three stalls and the bank. Solid. Props: item ("heal", "reroll", "jinx", "bank"), tiles.
-- The room shows what it sells (data/shop.lua) when the runner stands by it.
local H = require("data.hazards")
local Art = require("data.art")
local Look = require("data.look")
local LK = require("lib.look")

-- what each counter shows over its awning (sprites/ui.png)
local ICON = { heal = Art.ui.heart_full, reroll = Art.ui.card_back, jinx = Art.ui.jinx, bank = Art.ui.keycard }
local TINT = { heal = Look.accent.magenta, reroll = Look.accent.cyan, jinx = { 255, 228, 94 }, bank = Look.accent.warm }

local Counter = nova.entity { tags = { "counter", "solid" }, velocity = false, sx = 1, sy = 1, item = "heal", tiles = 2 }

function Counter:create()
  self.w, self.h = self.tiles * H.tile, H.tile
  self.hitbox = { -self.w / 2, -self.h / 2, self.w, self.h }
  self.depth = -self.y
end

function Counter:draw()
  local x, y = nova.cam.to_screen(self.x, self.y)
  for i = 0, self.tiles - 1 do
    local cx = x - self.w / 2 + (i + 0.5) * H.tile
    local k = i % 2 + 1
    nova.sprite(Art.tiles, cx, y - 24, { w = H.tile, h = H.tile, frame = Art.stall.base[k] })
    nova.sprite(Art.tiles, cx, y - 24 - H.tile, { w = H.tile, h = H.tile, frame = Art.stall.awning[k] })
  end
  local col = TINT[self.item] or Look.accent.cyan
  local bob = math.sin(nova.time() * 3 + self.x) * 3
  LK.halo(self.x, self.y - 90, 44, col, 90)
  nova.sprite("ui", x, y - 92 + bob, { w = 40, h = 40, frame = ICON[self.item] or 0 })
  nova.light2d(self.x, self.y - 40, { radius = 150, radius_y = 100, color = col, intensity = 1.6 })
end

return Counter

-- A coin. Placed coins spin; the hero picks them up by touching them.
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")

local Coin = nova.entity { sprite = "items/coin_gold", sx = 0.5, sy = 0.5, tags = { "pickup" }, depth = 10, r = 20, popped = false, life = 0 }

function Coin:create() self.t = (self.x * 0.0071) % 1; self.base_y = self.y end
function Coin:update(dt)
  self.t = self.t + dt
  if self.popped then
    -- out of a block: up, then into the counter
    self.life = self.life + dt
    self.y = self.base_y - math.sin(math.min(1, self.life / 0.45) * math.pi) * 70 - 20
    if self.life > 0.45 then fx.sparkle(self.x, self.y, 4); self:destroy() end
  end
end
function Coin:draw()
  local spin = math.cos(self.t * 5)
  local side = math.abs(spin) < 0.35
  fx.draw(side and "items/coin_gold_side" or "items/coin_gold", self.x, self.y + math.sin(self.t * 3) * 2, { sx = 0.5 * (side and 1 or math.abs(spin)), sy = 0.5 })
end
function Coin:collect(hero)
  if self.popped then return end
  run.add_coins(1)
  local combo = run.coin_combo(nova.time())
  audio.sfx("coin", { pitch = 1 + math.min(combo, 8) * 0.04 })
  fx.sparkle(self.x, self.y, 5)
  self:destroy()
end
-- a coin knocked out of a block
function Coin:pop()
  self.popped, self.life = true, 0
  run.add_coins(1)
  audio.sfx("coin")
end
return Coin

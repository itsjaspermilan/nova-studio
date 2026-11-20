-- The walk-through room's shop and bank: the sums. (data/shop.lua has the prices.) Returns ok and a line to show.
local Data = require("data.shop")
local Run = require("lib.run")
local J = require("lib.juice")

local S = {}

function S.buy(item, runner)
  local d = Data[item]
  if item == "heal" then
    if runner.hp >= runner.max_hp then return false, "You are at full health." end
    if J.scrap < d.price then return false, string.format("Not enough scrap (%d).", d.price) end
    Run.spend(d.price)
    local before = runner.hp
    runner.hp = math.min(runner.max_hp, runner.hp + d.points)
    Run.hp = runner.hp
    nova.log(string.format("shop: heal %d for %d (health %d to %d)", d.points, d.price, before, runner.hp))
    return true, string.format("+%d health", runner.hp - before)
  elseif item == "reroll" then
    if Run.reroll_next then return false, "The next offer is already rerolled." end
    if J.scrap < d.price then return false, string.format("Not enough scrap (%d).", d.price) end
    Run.spend(d.price)
    Run.reroll_next = true
    nova.log(string.format("shop: reroll the next offer for %d", d.price))
    return true, "The next offer will be drawn again."
  elseif item == "jinx" then
    return false, d.shut
  elseif item == "bank" then
    local keys, taken = Run.bank(d.rate)
    if keys == 0 then return false, string.format("%d scrap makes a key.", d.rate) end
    return true, string.format("%d scrap into %d keys", taken, keys)
  end
  return false, "?"
end

return S

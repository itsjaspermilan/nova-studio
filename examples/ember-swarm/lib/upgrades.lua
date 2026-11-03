-- The upgrades offered at each level-up: three at random.
local state = require("lib.state")

local upgrades = {
  { name = "Rapid fire", text = "+25% shots a second", apply = function() state.fire_rate = state.fire_rate * 1.25 end },
  { name = "Heavy rounds", text = "+1 damage", apply = function() state.damage = state.damage + 1 end },
  { name = "Twin shot", text = "+1 bullet a shot", apply = function() state.shots = state.shots + 1 end },
  { name = "Fleet feet", text = "+12% speed", apply = function() state.speed = state.speed * 1.12 end },
  { name = "Magnet", text = "gems come from further", apply = function() state.magnet = state.magnet * 1.5 end },
  { name = "Repair", text = "heal 40", apply = function() state.hp = math.min(state.max_hp, state.hp + 40) end },
}

function upgrades.offer()
  local pool, chosen = {}, {}
  for i = 1, #upgrades do pool[i] = upgrades[i] end
  for _ = 1, 3 do chosen[#chosen + 1] = table.remove(pool, math.random(#pool)) end
  return chosen
end

return upgrades

-- A blast: hurts everyone within `radius` of its centre (the runner, enemies, stalls, barrels), by distance on the ground.
-- `spec` = { radius, runner, enemy, prop } (damage to the runner, to enemies, to stalls and barrels). Barrels and Volatile elites use it.
local P = require("data.player")
local J = require("lib.juice")
local F = require("lib.fx")

local B = {}

function B.dist(x, y, e) return math.sqrt((e.x - x) ^ 2 + (e.y - y) ^ 2) end

function B.at(x, y, spec, source)
  nova.sound.play("blast", { volume = P.sfx.blast })
  F.burst(x, y - 16, spec.radius / 24)
  J.shake(8, 10)
  local hurt = {}
  local p = nova.first("player")
  if p and p.state ~= "dead" and spec.runner > 0 and B.dist(x, y, p) <= spec.radius then
    if p:take_damage(spec.runner) then hurt[#hurt + 1] = "runner" end
  end
  for _, e in ipairs(nova.all("hurtable")) do
    if e ~= source and e.state ~= "dead" and B.dist(x, y, e) <= spec.radius then
      local dmg = e.prop and spec.prop or spec.enemy
      if e:take_hit(dmg, 0, 0, 0) then hurt[#hurt + 1] = e.kind_name or e.name or "prop" end
    end
  end
  nova.log(string.format("blast at %.0f,%.0f hurts %s", x, y, #hurt > 0 and table.concat(hurt, ",") or "no one"))
  return hurt
end

return B

-- What a baton hit or a shot does besides damage, read from the run's modifiers (lib/run.lua). The runner and the shot call these.
local Run = require("lib.run")
local Status = require("lib.status")
local P = require("data.player")

local H = {}

-- Where the damage being dealt now comes from ("shot" while a shot hits; nil for the baton, fire and the rest): a Shielded elite and a
-- neon sign only mind shots.
H.from = nil

local CHAIN_RANGE = 144 -- Live Wire jumps to enemies within 3 tiles of the one hit

-- The damage a baton hit does to `e`: more when a shot marked it (Tracer).
function H.baton_damage(e, base)
  if (e.mark_t or 0) > 0 and (e.mark_bonus or 0) > 0 then return math.floor(base * (1 + e.mark_bonus) + 0.5) end
  return base
end

-- Live Wire: lightning from the enemy that was hit to the nearest others, 2 damage each.
function H.live_wire(runner, target)
  local m = Run.mods.live_wire
  if m <= 0 then return end
  local others = {}
  for _, e in ipairs(nova.all("hurtable")) do
    if e ~= target and not e.prop then
      local d = target:distance_to(e)
      if d <= CHAIN_RANGE then others[#others + 1] = { e = e, d = d } end
    end
  end
  table.sort(others, function(a, b) return a.d < b.d end)
  local hit = 0
  for i = 1, math.min(1 + m, #others) do
    local e = others[i].e
    nova.spawn("zap", target.x, target.y - 30, { x2 = e.x, y2 = e.y - 30 })
    e:take_hit(2, 0, 0, 0)
    hit = hit + 1
  end
  if hit > 0 then
    nova.sound.play("zap", { volume = P.sfx.zap })
    nova.log("live wire hits " .. hit)
  end
end

-- After a baton hit landed on `target` (chain: 1, 2 or 3 in the combo; `knocked`: it was the knock-back hit).
function H.after_baton(runner, target, chain, knocked)
  if not target:is_alive() then
    if chain == 3 then H.live_wire(runner, target) end
    return
  end
  local m = Run.mods
  if m.burn > 0 then Status.burn(target, 3, m.burn) end
  if chain == 3 then
    if m.stun > 0 then
      Status.stun(target, m.stun)
      nova.sound.play("stun", { volume = P.sfx.stun })
      nova.log("riot stock stuns " .. (target.kind_name or "target") .. " for " .. m.stun)
    end
    H.live_wire(runner, target)
  end
end

-- After a shot hit `target`.
function H.after_shot(target)
  if Run.mods.tracer > 0 and target:is_alive() then Status.mark(target, 3, Run.mods.tracer) end
end

return H

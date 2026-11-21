-- The Workbench's sums: what each permanent upgrade is worth, what the next tier costs, buying, and what a new run starts with.
-- The numbers are data/upgrades.lua; nothing else here knows an upgrade except by its id.
local Data = require("data.upgrades")
local Meta = require("lib.meta")

local W = { list = Data.list }
local by_id = {}
for i, u in ipairs(Data.list) do by_id[u.id] = u; u.index = i end
W.by_id = by_id

function W.tier(id) return Meta.tier(id) end
function W.max_tier(id) return #by_id[id].costs end
function W.maxed(id) return W.tier(id) >= W.max_tier(id) end
function W.next_cost(id)
  local u = by_id[id]
  return u.costs[W.tier(id) + 1]
end

-- Can it be bought? ok, then why not.
function W.can_buy(id)
  local u = by_id[id]
  if u.locked then return false, "Locked: " .. u.locked end
  if W.maxed(id) then return false, "Fully upgraded." end
  local cost = W.next_cost(id)
  if Meta.keys < cost then return false, string.format("%d keys needed (you have %d).", cost, Meta.keys) end
  return true
end

-- Buy the next tier: keys go, the tier goes up, the save is written. Never below zero keys, never past the last tier.
function W.buy(id)
  local ok, why = W.can_buy(id)
  if not ok then return false, why end
  local cost = W.next_cost(id)
  Meta.keys = Meta.keys - cost
  Meta.upgrades[id] = W.tier(id) + 1
  Meta.save()
  nova.log(string.format("workbench: %s tier %d for %d keys (keys left %d)", id, Meta.upgrades[id], cost, Meta.keys))
  return true, by_id[id].name .. ": " .. by_id[id].tier_text[Meta.upgrades[id]]
end

-- The cards a player may meet: the first `pool_size` of the card list (Deeper Deck adds `deck_step` cards a tier).
function W.pool_size() return Data.deck_base + Data.deck_step * W.tier("deeper_deck") end

-- Warm Start's cards for a run of `seed`: tier 1 a common, tier 2 and an uncommon, tier 3 and the chosen one. Ids.
function W.warm_cards(seed, mix)
  local Cards = require("data.cards")
  local out, tier = {}, W.tier("warm_start")
  if tier <= 0 then return out end
  local function pick(rarity, salt)
    local list = {}
    for _, c in ipairs(Cards.list) do if c.rarity == rarity and not c.jinx and c.index <= W.pool_size() then list[#list + 1] = c end end
    if #list == 0 then return nil end
    return list[mix(seed, salt) % #list + 1].id
  end
  out[#out + 1] = pick("common", 9001)
  if tier >= 2 then out[#out + 1] = pick("uncommon", 9002) end
  if tier >= 3 then
    local id = Meta.warm_pick
    if not Cards.by_id[id] then id = pick("rare", 9003) or pick("common", 9004) end
    out[#out + 1] = id
  end
  return out
end

-- Everything a new run starts with because of the Workbench and who lives in the Den. `run` is lib/run.lua's module.
function W.apply(run)
  local m = run.mods
  m.hp = m.hp + W.tier("thicker_print") * by_id.thicker_print.per.hp
  m.pips = m.pips + W.tier("bigger_magazine") * by_id.bigger_magazine.per.pips
  m.solder = W.tier("good_solder") * by_id.good_solder.per.share
  run.rerolls = W.tier("familiar_streets") * by_id.familiar_streets.per.rerolls
  run.revives = W.tier("second_chance")
  run.eye = W.tier("lullaby_eye")
  run.loose = 0
  run.den_notes = {}
  for _, id in ipairs(W.warm_cards(run.seed, run.mix)) do run.grant(id) end
  if Meta.moved_in.patch then m.hp = m.hp + 2; run.den_notes[#run.den_notes + 1] = "Patch: +2 health" end
  if Meta.moved_in.old_sal then run.perks.bowl = true; run.den_notes[#run.den_notes + 1] = "Old Sal: the first hit is ignored" end
end

-- LULLABY's Eye: what the HUD says about the next room.
local KIND = { fight = "A fight", elite = "An elite", stranger = "A stranger", gauntlet = "A gauntlet", boss = "Mother Coil", walk = "The shop and the bank" }
function W.eye_text(run)
  if (run.eye or 0) <= 0 or not run.chain then return nil end
  local e = run.chain[run.room + 2]
  if not e then return nil end
  local s = KIND[e.kind] or e.kind
  if run.eye >= 2 and e.kind == "elite" and e.mark then s = s .. ": " .. require("data.elites").marks[e.mark].name end
  return "NEXT: " .. s
end

return W

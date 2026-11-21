-- The run: its seed, the chain of rooms, the cards held, the modifiers they change, scrap and the health and charge carried from room
-- to room, the perks strangers gave, the clock. A module (it lives as long as the game does); a run begins with `Run.begin` (the
-- slice-2 rooms) or `Run.begin_chain` (the Gutter Market's eight rooms from a seed).
-- Entities read `Run.mods`; cards (data/cards.lua) change them with `apply(Run)`. Nothing here knows a card by name.
local P = require("data.player")
local Cards = require("data.cards")
local Layouts = require("data.layouts")
local Waves = require("data.gutter_waves")
local Elites = require("data.elites")
local Meta = require("lib.meta")
local J = require("lib.juice")
local Work = require("lib.workbench")
local Rooms = require("data.rooms")

local Run = { active = false }

local function fresh_mods()
  return {
    reach = 1, live_wire = 0, knock = 1, stun = 0, burn = 0, bounces = 0, pellets = 1, tracer = 0, shock = 0, rolls = 1,
    hp = 0, pips = 0, scrap = 1, solder = 0,
    -- slice 4
    metro = 0, skim = 0, backhand = 0, slug = 0, incendiary = 0, siphon = 0, smart = 0, afterimage = 0, slipstream = 0, rubber = 0, phase = 0,
    clot = 0, adrenal = 0, ghost = 0, friendly = 0, brownout = 0, wiring = 0, bounty = 0, loop = 0, open = 0,
    overclock = 0, regen = 0, choices = 0, crowd = 0, debt = 0,
  }
end

-- A repeatable integer hash (splitmix-like) of two numbers: the draws depend on the seed and a number only.
local function mix(a, b)
  local z = (a * 0x9E3779B97F4A7C15 + b * 0xBF58476D1CE4E5B9 + 0x94D049BB133111EB) & 0x7FFFFFFFFFFFFFFF
  z = ((z ~ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0x7FFFFFFFFFFFFFFF
  z = ((z ~ (z >> 27)) * 0x94D049BB133111EB) & 0x7FFFFFFFFFFFFFFF
  return z ~ (z >> 31)
end
Run.mix = mix

local function start(seed)
  Run.active = true
  Run.seed = seed or math.random(1, 1000000)
  Run.cards, Run.counts = {}, {}
  Run.mods = fresh_mods()
  Run.scrap, Run.frac = 0, 0
  Run.hp, Run.charge = nil, nil
  Run.offers = 0
  Run.room = 0            -- doors gone through so far
  Run.chain = nil         -- the rooms of a district run (Run.begin_chain)
  Run.perks = {}          -- what strangers gave (truce: the first hit in each room is ignored)
  Run.reroll_next = false -- the shop sold a reroll of the next offer
  Run.time = 0            -- seconds played in rooms
  Run.cleared = 0         -- rooms of the chain left by their door
  Run.banked = 0          -- keys banked this run
  Run.won = false
  Run.summary = nil
  Run.solder_frac = 0     -- Good Solder's fractions of a point, carried to the next hit
  Run.rerolls, Run.revives, Run.eye, Run.loose = 0, 0, 0, 0
  Run.den_notes = {}
  Run.from_den = false    -- the Den's door began this run (the summary then leads back to the Den)
  Run.moved = {}          -- strangers who moved into the Den during this run
  Run.room_keys = 0       -- keys the cleared rooms paid this run (kept even on death)
  Run.room_kills = 0      -- enemies killed in the room now (Bounty Board, Loop Trap)
  Run.room_hit = false    -- the runner was hurt in the room now (Clot)
  Run.ghost_used = false  -- Ghost in the Shell was spent
  Run.hp_cap = nil        -- Red Line's ceiling on the maximum health
  Run.leak_acc = 0        -- scrap picked up towards the Leak set's next point of health
  Run.tagc, Run.sets_on = {}, {}
  Run.set_flash = nil     -- { tag, t }: a set was just completed (the HUD shows the banner while t runs down)
end

function Run.begin(seed)
  start(seed)
  Work.apply(Run)
  nova.log("run begins, seed " .. Run.seed)
end

-- ---------------------------------------------------------------- the chain
-- The eight rooms of the district from the run's seed: for each slot one of its layouts and one of its wave tables; the stranger
-- of room 6, the elite's mark and kind. The same seed always builds the same chain.
function Run.build_chain(seed)
  local chain = {}
  for i, slot in ipairs(Layouts.slots) do
    local k = mix(seed, i * 11 + 1) % #slot.layouts + 1
    local tables = Waves[i]
    local entry = { index = i, slot = i, kind = slot.kind, hazard = slot.hazard, layout = k, scene = slot.layouts[k] }
    if tables then
      entry.table = mix(seed, i * 11 + 2) % #tables + 1
      entry.def = tables[entry.table]
    end
    if slot.kind == "elite" then
      entry.mark = Elites.order[mix(seed, 401) % #Elites.order + 1]
      entry.elite_kind = Elites.kinds[mix(seed, 402) % #Elites.kinds + 1]
    elseif slot.kind == "stranger" then
      entry.who = Layouts.strangers[mix(seed, 403) % #Layouts.strangers + 1]
    end
    chain[i] = entry
  end
  chain[#chain + 1] = { index = #chain + 1, slot = #chain + 1, kind = "walk", scene = Layouts.walk, layout = 1 }
  return chain
end

-- Begins a district run: a new run with its chain.
function Run.begin_chain(seed)
  start(seed)
  Run.chain = Run.build_chain(Run.seed)
  Meta.runs = Meta.runs + 1
  Meta.started = true
  Work.apply(Run)
  Meta.save()
  local names = {}
  for i, e in ipairs(Run.chain) do names[i] = e.scene end
  nova.log("run begins, seed " .. Run.seed .. ": " .. table.concat(names, " "))
end

-- Where a scene sits: slot and kind, found by its name (a layout scene started directly, for tests and the editor).
local function find_layout(scene)
  for i, slot in ipairs(Layouts.slots) do
    for k, name in ipairs(slot.layouts) do
      if name == scene then return i, k, slot end
    end
  end
  if scene == Layouts.walk then return #Layouts.slots + 1, 1, { kind = "walk" } end
end
Run.find_layout = find_layout

-- The chain's entry for the room the runner is in now: the next of the chain if it is this scene, else one made from the scene's
-- name (the first wave table of its slot, the seed's stranger, mark and kind).
function Run.entry_for(scene)
  if not Run.chain then return nil end
  local e = Run.chain[Run.room + 1]
  if e and e.scene == scene then return e end
  local i, k, slot = find_layout(scene)
  if not i then return nil end
  local entry = { index = i, slot = i, kind = slot.kind, hazard = slot.hazard, layout = k, scene = scene, table = 1, def = Waves[i] and Waves[i][1] }
  for _, c in ipairs(Run.chain) do
    if c.kind == "elite" then entry.mark, entry.elite_kind = c.mark, c.elite_kind end
    if c.kind == "stranger" then entry.who = c.who end
  end
  return entry
end

-- The scene after the room the runner is in (the summary after the last room).
function Run.next_scene()
  local e = Run.chain and Run.chain[Run.room + 2]
  return e and e.scene or "summary"
end

-- The runner went through a room's exit door.
function Run.exit_room()
  local here = Run.chain and Run.chain[Run.room + 1]
  local dest = Run.next_scene()
  Run.room = Run.room + 1
  if here and here.kind ~= "walk" then Run.cleared = Run.cleared + 1 end
  if here and here.kind == "boss" then
    Run.won = true
    Meta.wins = Meta.wins + 1
    Meta.save()
    nova.log("the boss door: the run is won")
  end
  if dest == "summary" then Run.finish(Run.won and "win" or "dead") end
  return dest
end

-- The run ends (a win at the last door, or the runner died): the summary's numbers.
function Run.finish(result)
  local names = {}
  for _, id in ipairs(Run.cards) do names[#names + 1] = Cards.by_id[id].name end
  local loose = 0
  if result == "dead" then
    -- Loose Change: a share of the scrap that was not banked comes through the print as keys
    local share = Work.tier("loose_change") * Work.by_id.loose_change.per.share
    loose = math.floor(J.scrap * share + 1e-9)
    Meta.keys = Meta.keys + loose
    Meta.prints = Meta.prints + 1
    if loose > 0 then nova.log(string.format("loose change: %d of %d unbanked scrap kept as %d keys", loose, J.scrap, loose)) end
  elseif result == "win" and (Meta.best == 0 or Run.time < Meta.best) then
    Meta.best = math.floor(Run.time * 10) / 10
  end
  Run.loose = loose
  Meta.last = result
  Meta.save()
  Run.summary = {
    result = result, loose = loose, moved = Run.moved, best = Meta.best, den_notes = Run.den_notes, seed = Run.seed, cleared = Run.cleared, time = Run.time, keys = Run.banked, room_keys = Run.room_keys, scrap_left = J.scrap,
    cards = #Run.cards, card_names = names, rooms = Run.chain and 8 or nil,
  }
  Run.active = false
  nova.log(string.format("run ends: %s, %d rooms, %.1f s, %d keys banked, %d keys from rooms, %d cards", result, Run.cleared, Run.time, Run.banked, Run.room_keys, #Run.cards))
end

start(1) -- (a run exists before any room begins one: the test rooms and routes use it as is)
Run.active = false

function Run.max_hp()
  local m = P.health + Run.mods.hp
  if Run.hp_cap then m = math.min(m, Run.hp_cap) end
  return m
end
function Run.set_hp_cap(cap)
  Run.hp_cap = cap
  if cap and Run.hp then Run.hp = math.min(Run.hp, cap) end
end
function Run.max_charge() return P.charge.pips + Run.mods.pips end
function Run.count(id) return Run.counts[id] or 0 end

-- Tags and sets: how many DIFFERENT held cards carry each tag, and which sets are on (three of a tag; copies of one card count once).
function Run.recount()
  local seen, out, on = {}, {}, {}
  for _, id in ipairs(Run.cards) do
    if not seen[id] then
      seen[id] = true
      for _, t in ipairs(Cards.by_id[id].tags) do out[t] = (out[t] or 0) + 1 end
    end
  end
  for t, n in pairs(out) do on[t] = n >= Cards.set_size end
  Run.tagc, Run.sets_on = out, on
end
function Run.set_count(tag) return Run.tagc[tag] or 0 end
function Run.set_on(tag) return Run.sets_on[tag] == true end

-- Cards call these (health and charge move with the maximum, so a card that adds a point also heals it).
function Run.add_max_hp(n)
  Run.mods.hp = Run.mods.hp + n
  if Run.hp then Run.hp = Run.hp + n end
end
function Run.add_pips(n)
  Run.mods.pips = Run.mods.pips + n
  if Run.charge then Run.charge = Run.charge + n end
end

-- Scrap through the run's multiplier, whole units (the part left over is kept for the next pickup).
function Run.add_scrap(n)
  local total = n * Run.mods.scrap + Run.frac
  local whole = math.floor(total + 1e-9)
  Run.frac = total - whole
  J.scrap = J.scrap + whole
  return whole
end

-- Spend scrap (the shop): false, and nothing taken, when there is not enough.
function Run.spend(n)
  if J.scrap < n then return false end
  J.scrap = J.scrap - n
  Run.scrap = J.scrap
  return true
end

-- The bank: scrap into keys at `rate` to 1 (whole keys; the rest stays scrap). Returns the keys made and the scrap taken.
function Run.bank(rate)
  local keys = J.scrap // rate
  local taken = keys * rate
  keys = keys * (1 + Run.mods.debt)       -- (Debt Spiral)
  J.scrap = J.scrap - taken
  Run.scrap = J.scrap
  Meta.keys = Meta.keys + keys
  Run.banked = Run.banked + keys
  if keys > 0 then Meta.save() end
  if keys > 0 then nova.log(string.format("bank: %d scrap into %d keys (keys held %d)", taken, keys, Meta.keys)) end
  return keys, taken
end

-- The runner's numbers and the scene's scrap go into the run (before a card changes them, and at a door)...
function Run.take_from(runner)
  if runner then Run.hp, Run.charge = runner.hp, runner.charge end
  Run.scrap = J.scrap
end

-- ...and come back out of it (after a card changed the maximums).
function Run.give_to(runner)
  if not runner then return end
  runner.max_hp, runner.max_charge = Run.max_hp(), Run.max_charge()
  runner.hp = math.min(runner.max_hp, Run.hp or runner.max_hp)
  runner.charge = math.min(runner.max_charge, Run.charge or runner.max_charge)
end

-- A card the run simply holds (Warm Start): no runner, no offer.
function Run.grant(id)
  local c = Cards.by_id[id]
  if not c or Run.count(id) >= c.max then return false end
  Run.counts[id] = Run.count(id) + 1
  Run.cards[#Run.cards + 1] = id
  c.apply(Run)
  Run.recount()
  Meta.see(id)
  nova.log("card held from the start: " .. id)
  return true
end

function Run.can_take(id)
  local c = Cards.by_id[id]
  return c ~= nil and Run.count(id) < c.max
end

-- Take a card: it changes the run (and the live runner, if one is given).
function Run.add_card(id, runner)
  if not Run.can_take(id) then return false end
  local c = Cards.by_id[id]
  Run.take_from(runner)
  local before = {}
  for t, v in pairs(Run.sets_on) do before[t] = v end
  Run.counts[id] = Run.count(id) + 1
  Run.cards[#Run.cards + 1] = id
  c.apply(Run)
  Run.give_to(runner)
  Run.recount()
  Meta.see(id)
  nova.log("card taken: " .. id .. " (" .. Run.count(id) .. ")")
  for _, t in ipairs(Cards.set_order) do
    if Run.sets_on[t] and not before[t] then
      Run.set_flash = { tag = t, t = 3.2 }
      nova.sound.play("set_done", { volume = P.sfx.set_done })
      nova.log("set complete: " .. t .. " (" .. Cards.sets[t].text .. ")")
    end
  end
  return true
end

-- The jinxes the run holds, in the order they were taken.
function Run.held_jinxes()
  local out = {}
  for _, id in ipairs(Run.cards) do if Cards.by_id[id].jinx then out[#out + 1] = id end end
  return out
end

-- Take a card back out of the run (the shop's jinx removal): its `remove` undoes what `apply` did. False when the run does not hold it.
function Run.remove_card(id, runner)
  local c = Cards.by_id[id]
  if not c or Run.count(id) <= 0 or not c.remove then return false end
  Run.take_from(runner)
  for i = #Run.cards, 1, -1 do if Run.cards[i] == id then table.remove(Run.cards, i); break end end
  Run.counts[id] = Run.count(id) - 1
  c.remove(Run)
  Run.give_to(runner)
  Run.recount()
  nova.log("card removed: " .. id)
  return true
end

-- The keys a cleared room pays at once, kept even if the run ends in the next room (Debt Spiral doubles them).
function Run.pay_keys(kind)
  local n = Rooms.keys[kind] or 0
  if n <= 0 then return 0 end
  n = n * (1 + Run.mods.debt)
  Meta.keys = Meta.keys + n
  Run.room_keys = Run.room_keys + n
  Meta.save()
  nova.log(string.format("room pays %d keys (%s): keys held %d", n, kind, Meta.keys))
  return n
end

-- The cards a room offers: `n` different ones from the pool the run's seed picks, never past a card's maximum.
-- THE FAMILY RULE: an offer never holds two cards of the same family, unless the pool cannot fill it otherwise (the design's "never
-- two from the same family twice running" is read as this: within an offer, not across offers).
-- `opts.guarantee` is a rarity: one card of the offer has it (the elite's uncommon). The same seed and the same offer number always
-- give the same cards; a reroll (bought in the shop) draws the next offer again with another salt. Returns a list of ids.
function Run.offer(n, opts)
  n = n or 3
  opts = opts or {}
  Run.offers = Run.offers + 1
  local salt = Run.offers
  if Run.reroll_next then
    salt = salt + 1000
    Run.reroll_next = false
    nova.log("the offer is rerolled")
  end
  local pool = {}
  local pool_size = Work.pool_size()          -- (Deeper Deck: how many of the cards this player may meet)
  for _, c in ipairs(Cards.list) do if Run.count(c.id) < c.max and c.index <= pool_size and not c.jinx then pool[#pool + 1] = c end end
  local out, families = {}, {}
  local state = mix(Run.seed, salt)
  local function take(list, i)
    local c = list[i]
    for k, p in ipairs(pool) do if p == c then table.remove(pool, k); break end end
    out[#out + 1] = c.id
    families[c.family] = true
  end
  if opts.guarantee then
    -- the guaranteed rarity; when the pool holds none (a fresh save's twelve cards have no rare but Second Wind, and a made-up pool may have
    -- none at all) the next rarity down. Jinxes are never the guaranteed card (they have their own slot, below).
    local order = ({ rare = { "rare", "uncommon", "common" }, uncommon = { "uncommon", "common" } })[opts.guarantee] or { opts.guarantee }
    for _, rarity in ipairs(order) do
      local list = {}
      for _, c in ipairs(pool) do if c.rarity == rarity then list[#list + 1] = c end end
      if #list > 0 then
        state = mix(state, 777)
        take(list, state % #list + 1)
        out.guaranteed = rarity
        break
      end
    end
  end
  for i = #out + 1, math.min(n, #out + #pool) do
    state = mix(state, i)
    local fresh = {}
    for _, c in ipairs(pool) do if not families[c.family] then fresh[#fresh + 1] = c end end
    local list = #fresh > 0 and fresh or pool          -- (the pool cannot fill the offer from new families: repeat one)
    take(list, state % #list + 1)
  end
  -- a jinx may take the last open slot: a seeded chance, more likely later in a run, never in the first offers of a run
  local jn = Cards.jinx
  if Run.offers > jn.skip and #out >= 2 then
    local jp = {}
    for _, c in ipairs(Cards.list) do if c.jinx and c.index <= pool_size and Run.count(c.id) < c.max then jp[#jp + 1] = c end end
    if #jp > 0 then
      local p = math.min(jn.max, jn.base + jn.per_offer * (Run.offers - jn.skip - 1))
      state = mix(state, 5150)
      if state % 1000 < p * 1000 then
        state = mix(state, 5151)
        out[#out] = jp[state % #jp + 1].id
        nova.log("a jinx takes the last slot: " .. out[#out])
      end
    end
  end
  local fresh = false
  for _, id in ipairs(out) do fresh = Meta.see(id, true) or fresh end
  if fresh then Meta.save() end
  nova.log("offer " .. Run.offers .. ": " .. table.concat(out, ","))
  return out
end

return Run

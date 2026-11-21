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

local Run = { active = false }

local function fresh_mods()
  return {
    reach = 1, live_wire = 0, knock = 1, stun = 0, burn = 0, bounces = 0, pellets = 1, tracer = 0, shock = 0, rolls = 1,
    hp = 0, pips = 0, scrap = 1, solder = 0,
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
    result = result, loose = loose, moved = Run.moved, best = Meta.best, den_notes = Run.den_notes, seed = Run.seed, cleared = Run.cleared, time = Run.time, keys = Run.banked, scrap_left = J.scrap,
    cards = #Run.cards, card_names = names, rooms = Run.chain and 8 or nil,
  }
  Run.active = false
  nova.log(string.format("run ends: %s, %d rooms, %.1f s, %d keys banked, %d cards", result, Run.cleared, Run.time, Run.banked, #Run.cards))
end

start(1) -- (a run exists before any room begins one: the test rooms and routes use it as is)
Run.active = false

function Run.max_hp() return P.health + Run.mods.hp end
function Run.max_charge() return P.charge.pips + Run.mods.pips end
function Run.count(id) return Run.counts[id] or 0 end

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
  Run.counts[id] = Run.count(id) + 1
  Run.cards[#Run.cards + 1] = id
  c.apply(Run)
  Run.give_to(runner)
  nova.log("card taken: " .. id .. " (" .. Run.count(id) .. ")")
  return true
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
  for _, c in ipairs(Cards.list) do if Run.count(c.id) < c.max and c.index <= pool_size then pool[#pool + 1] = c end end
  local out, families = {}, {}
  local state = mix(Run.seed, salt)
  local function take(list, i)
    local c = list[i]
    for k, p in ipairs(pool) do if p == c then table.remove(pool, k); break end end
    out[#out + 1] = c.id
    families[c.family] = true
  end
  if opts.guarantee then
    local list = {}
    for _, c in ipairs(pool) do if c.rarity == opts.guarantee then list[#list + 1] = c end end
    if #list > 0 then
      state = mix(state, 777)
      take(list, state % #list + 1)
    end
  end
  for i = #out + 1, math.min(n, #out + #pool) do
    state = mix(state, i)
    local fresh = {}
    for _, c in ipairs(pool) do if not families[c.family] then fresh[#fresh + 1] = c end end
    local list = #fresh > 0 and fresh or pool          -- (the pool cannot fill the offer from new families: repeat one)
    take(list, state % #list + 1)
  end
  nova.log("offer " .. Run.offers .. ": " .. table.concat(out, ","))
  return out
end

return Run

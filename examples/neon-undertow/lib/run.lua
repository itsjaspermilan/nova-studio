-- The run: its seed, the cards held, the modifiers they change, scrap and the health and charge carried from room to room.
-- A module (it lives as long as the game does); a fight room's first scene begins a run, the others carry it on.
-- Entities read `Run.mods`; cards (data/cards.lua) change them with `apply(Run)`. Nothing here knows a card by name.
local P = require("data.player")
local Cards = require("data.cards")
local J = require("lib.juice")

local Run = { active = false }

local function fresh_mods()
  return {
    reach = 1, live_wire = 0, knock = 1, stun = 0, burn = 0, bounces = 0, pellets = 1, tracer = 0, shock = 0, rolls = 1,
    hp = 0, pips = 0, scrap = 1,
  }
end

-- A repeatable integer hash (splitmix-like) of two numbers: the offer's draws depend on the seed and the offer's number only.
local function mix(a, b)
  local z = (a * 0x9E3779B97F4A7C15 + b * 0xBF58476D1CE4E5B9 + 0x94D049BB133111EB) & 0x7FFFFFFFFFFFFFFF
  z = ((z ~ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0x7FFFFFFFFFFFFFFF
  z = ((z ~ (z >> 27)) * 0x94D049BB133111EB) & 0x7FFFFFFFFFFFFFFF
  return z ~ (z >> 31)
end

local function start(seed)
  Run.active = true
  Run.seed = seed or math.random(1, 1000000)
  Run.cards, Run.counts = {}, {}
  Run.mods = fresh_mods()
  Run.scrap, Run.frac = 0, 0
  Run.hp, Run.charge = nil, nil
  Run.offers = 0
  Run.room = 0
end

function Run.begin(seed)
  start(seed)
  nova.log("run begins, seed " .. Run.seed)
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
-- The same seed and the same offer number always give the same cards. Returns a list of ids.
function Run.offer(n)
  n = n or 3
  Run.offers = Run.offers + 1
  local pool = {}
  for _, c in ipairs(Cards.list) do if Run.count(c.id) < c.max then pool[#pool + 1] = c.id end end
  local out = {}
  local state = mix(Run.seed, Run.offers)
  for i = 1, math.min(n, #pool) do
    state = mix(state, i)
    local k = state % #pool + 1
    out[i] = table.remove(pool, k)
  end
  nova.log("offer " .. Run.offers .. ": " .. table.concat(out, ","))
  return out
end

return Run

-- What outlives a run, and is saved with nova.save (the key "undertow"): keys (the permanent money, scrap banked 4 to 1), upgrades bought,
-- how often each stranger was met, who moved into the Den, runs, wins, the best time, and what LULLABY last saw (for her wake-up line).
-- Plain numbers, strings, booleans and tables only. `Meta.load()` runs at boot (main.lua); `Meta.save()` after anything that changes it.
-- The fields live in this one table for the life of the game (other files keep a reference to it): `reset` and `load` change it in place.
local KEY = "undertow"
local Meta = {}

local function int(v) return math.tointeger(v) or v end      -- (a number read back from the save may be 12.0: 12 is what it means)

function Meta.reset()
  Meta.keys = 0
  Meta.met = { patch = 0, old_sal = 0 }
  Meta.runs = 0          -- runs begun
  Meta.wins = 0          -- runs that got through the boss door
  Meta.best = 0          -- best winning time in seconds (0 = none yet)
  Meta.upgrades = {}     -- Workbench tiers bought, by upgrade id
  Meta.moved_in = {}     -- strangers who live in the Den now
  Meta.seen_in = {}      -- ... and whose arrival the Den has already shown
  Meta.last = "first"    -- what brought you to the Den: first | dead | win
  Meta.prints = 0        -- times printed again (deaths)
  Meta.lines = {}        -- how many wake-up lines of each kind were read
  Meta.talks = {}        -- how many times each Den resident and the screen were talked to
  Meta.warm_pick = ""    -- Warm Start's chosen card (tier 3)
  Meta.started = false   -- the game has been played (the title says Continue)
end
Meta.reset()

function Meta.tier(id) return Meta.upgrades[id] or 0 end

local FIELDS = { "keys", "runs", "wins", "best", "prints" }
local TABLES = { "met", "upgrades", "moved_in", "seen_in", "lines", "talks" }

function Meta.load()
  local t = nova.save.get(KEY)
  if type(t) ~= "table" then return false end
  Meta.reset()
  for _, f in ipairs(FIELDS) do if type(t[f]) == "number" then Meta[f] = int(t[f]) end end
  for _, f in ipairs(TABLES) do
    if type(t[f]) == "table" then for k, v in pairs(t[f]) do Meta[f][k] = (type(v) == "number") and int(v) or v end end
  end
  if type(t.last) == "string" then Meta.last = t.last end
  if type(t.warm_pick) == "string" then Meta.warm_pick = t.warm_pick end
  Meta.started = t.started == true
  nova.log(string.format("save loaded: %d keys, %d runs, %d wins", Meta.keys, Meta.runs, Meta.wins))
  return true
end

function Meta.save()
  local t = { last = Meta.last, warm_pick = Meta.warm_pick, started = Meta.started }
  for _, f in ipairs(FIELDS) do t[f] = Meta[f] end
  for _, f in ipairs(TABLES) do
    t[f] = {}
    for k, v in pairs(Meta[f]) do t[f][k] = v end
  end
  nova.save.set(KEY, t)
  nova.save.flush()
end

-- "New game": everything forgotten, on disk too.
function Meta.wipe()
  Meta.reset()
  nova.save.delete(KEY)
  nova.save.flush()
  nova.log("save wiped")
end

return Meta

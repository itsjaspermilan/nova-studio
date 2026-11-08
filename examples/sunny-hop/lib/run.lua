-- The level being played: hearts, coins, gems, keys, the pressed switches, the checkpoint and the stopwatch. The entities report to it and the
-- HUD reads it; `run.pulse` remembers when each counter last changed, so that the HUD can bounce it.
local audio = require("lib.audio")

local run = {}

function run.start(level, mode)
  run.level, run.mode = level, mode or "normal"
  run.hearts, run.max_hearts = 3, 3
  run.coins, run.coin_total = 0, 0
  run.gems = { false, false, false }
  run.keys = {}       -- colour -> true while held
  run.switches = {}   -- colour -> true once pressed
  run.time, run.clock = 0, false
  run.checkpoint = nil
  run.finished, run.boss_down = false, false
  run.deaths = 0
  run.pulse = { coins = -9, hearts = -9, gems = -9, keys = -9, time = -9 }
  run.hero = nil
  run.listeners = {}
end

function run.now() return nova.time() end

function run.add_coins(n)
  run.coins = run.coins + n
  run.pulse.coins = run.now()
end

-- coins picked up in quick succession ring higher and higher
local last_coin, combo = -9, 0
function run.coin_combo(t)
  combo = (t - last_coin < 0.45) and combo + 1 or 0
  last_coin = t
  return combo
end

function run.found_gem(i)
  run.gems[i] = true
  run.pulse.gems = run.now()
end

function run.take_key(color) run.keys[color] = true; run.pulse.keys = run.now() end
function run.use_key(color) run.keys[color] = nil; run.pulse.keys = run.now() end

function run.heal()
  if run.hearts < run.max_hearts then run.hearts = run.hearts + 1; run.pulse.hearts = run.now(); return true end
  return false
end
function run.lose_heart()
  run.hearts = math.max(0, run.hearts - 1)
  run.pulse.hearts = run.now()
  return run.hearts
end

-- a switch tells everything of its colour (gates, doors) through run.on("switch")
function run.press(color)
  if run.switches[color] then return false end
  run.switches[color] = true
  for _, f in ipairs(run.listeners) do f("switch", color) end
  return true
end
function run.on(f) run.listeners[#run.listeners + 1] = f end
function run.emit(what, a) for _, f in ipairs(run.listeners) do f(what, a) end end

run.start(nil)
run.audio = audio
return run

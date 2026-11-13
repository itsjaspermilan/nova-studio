-- Which level this run is: a six digit number (the seed) that the generator builds the level from. A new one is made each time you start over; hold L1 when you press Start to
-- play the same level again. The numbers of runs so far are kept in the save file so that the seeds do not repeat.
local run = { seed = nil, same = false }

function run.fresh()
  local n = nova.save.get("rg_runs", 0) + 1
  nova.save.set("rg_runs", n)
  run.seed = (n * 7919 + math.floor(nova.clock() * 1000)) % 900000 + 100000
  return run.seed
end

-- The seed for the level being built now.
function run.begin()
  if not run.seed or not run.same then run.fresh() end
  run.same = false
  return run.seed
end

-- Called when the player starts over (Start): a new level, or the same one with `same`.
function run.again(same) run.same = same and true or false end

return run

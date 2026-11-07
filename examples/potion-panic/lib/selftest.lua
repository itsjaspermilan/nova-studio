-- Checks that the levels and the rules hold together (F10 on the title screen, or `cargo test -p nova-runtime --test potion`): every map is a rectangle with a start, every
-- potion can be made from the crates of its level, no potion is a part of another, every station can be reached, and the mechanics work (a brew finishes and can burn, wrong things
-- make sludge, lava burns, a served potion pays). `bot_job` (F9 on the title screen) lets the computer apprentice play every level over several frames.
local data = require("lib.data")
local Kitchen = require("lib.kitchen")
local Bot = require("lib.bot")

local selftest = { debug = false }

local function run_for(k, bot, seconds, dt)
  local steps = math.floor(seconds / dt)
  for _ = 1, steps do
    k:update(dt, bot and bot:update(dt) or {})
    k:take_events()
    if k.over then break end
  end
end

function selftest.run()
  local checks, failed = 0, {}
  local function check(ok, what)
    checks = checks + 1
    if not ok then failed[#failed + 1] = what end
  end

  for i, level in ipairs(data.levels) do
    local id = level.id
    local width = #level.map[1]
    local has = { C = false, B = false, S = false, M = false, X = false }
    local starts = 0
    for _, line in ipairs(level.map) do
      check(#line == width, id .. ": every row of the map is as wide as the first")
      for ch in line:gmatch(".") do
        if has[ch] ~= nil then has[ch] = true end
        if ch == "@" then starts = starts + 1 end
      end
    end
    check(starts == 1, id .. " has one start")
    check(has.C and has.B and has.S and has.X, id .. " has a cauldron, bottles, a hatch and a bin")
    check(data.biomes[level.biome] ~= nil, id .. " has a biome")
    local have = {}
    for _, ing in ipairs(level.crates) do have[ing] = true end
    local needs_mortar = false
    for _, rid in ipairs(level.recipes) do
      local r = data.recipes[rid]
      check(r ~= nil, id .. ": potion " .. rid .. " exists")
      for _, it in ipairs(r.items) do
        check(have[it[1]], id .. ": the crates give " .. it[1] .. " for " .. rid)
        if it[2] then needs_mortar = true end
      end
    end
    check(not needs_mortar or has.M, id .. " has a mortar for the ground ingredients")
    -- the rules it plays under: its own, the easy ones and the master ones
    for _, mode in ipairs({ "level", "easy", "all" }) do
      local k = Kitchen.new(level, { recipes = mode }, i)
      -- no potion's items are a part of another's (or the cauldron would start too early)
      local list = k.recipes
      for _, a in ipairs(list) do
        for _, b in ipairs(list) do
          if a ~= b then
            local ka = {}
            for _, key in ipairs(k.recipe_keys[a]) do ka[#ka + 1] = key end
            local sub = false
            -- (a is a part of b when b still has items over after taking a's away)
            local count = {}
            for _, key in ipairs(k.recipe_keys[b]) do count[key] = (count[key] or 0) + 1 end
            local all = true
            for _, key in ipairs(ka) do
              if (count[key] or 0) == 0 then all = false; break end
              count[key] = count[key] - 1
            end
            sub = all and #k.recipe_keys[b] > #ka
            check(not sub, id .. " (" .. mode .. "): " .. a .. " is a part of " .. b)
          end
        end
      end
      -- every station can be reached
      local bot = Bot.new(k)
      for _, st in ipairs(k.stations) do
        check(bot:route(bot:stands(st)) ~= nil, id .. ": the " .. st.kind .. " at " .. st.x .. "," .. st.z .. " can be reached")
      end
    end
  end

  -- the story
  for _, key in ipairs({ "intro", "biome1", "biome2", "biome3", "biome4", "end" }) do check(data.story[key] and #data.story[key] > 0, "story " .. key) end

  -- the mechanics, on the first level
  do
    local level = data.levels[1]
    local k = Kitchen.new(level, nil, 3)
    local bot = Bot.new(k)
    Bot.debug = selftest.debug
    run_for(k, bot, 90, 1 / 20)
    Bot.debug = false
    check(k.stats.served >= 1, "the computer apprentice serves a potion in 90 seconds (served " .. k.stats.served .. ")")
    check(k.score > 0, "serving pays")
  end
  do
    -- wrong things make sludge, and a finished brew burns if it is left
    local k = Kitchen.new(data.levels[1], nil, 4)
    local cauldron
    for _, st in ipairs(k.stations) do if st.kind == "cauldron" then cauldron = st end end
    k:add_to_cauldron(cauldron, { k = "ing", id = "sunpetal", ground = true })
    k:add_to_cauldron(cauldron, { k = "ing", id = "sunpetal", ground = true })
    check(cauldron.state == "idle", "two wrong things do not start a brew")
    k:add_to_cauldron(cauldron, { k = "ing", id = "sunpetal", ground = true })
    check(cauldron.state == "brewing" and cauldron.recipe == "sludge", "three wrong things make sludge")
    run_for(k, nil, 5.2, 1 / 20)
    check(cauldron.state == "done", "the brew finishes")
    run_for(k, nil, 10, 1 / 20)
    check(cauldron.state == "burnt", "a finished brew left alone burns")
    local k2 = Kitchen.new(data.levels[1], { burn = false }, 4)
    local c2
    for _, st in ipairs(k2.stations) do if st.kind == "cauldron" then c2 = st end end
    k2:add_to_cauldron(c2, { k = "ing", id = "glowcap", ground = true })
    k2:add_to_cauldron(c2, { k = "ing", id = "sunpetal", ground = false })
    check(c2.state == "brewing" and c2.recipe == "heal", "a glowcap ground and a sunpetal make a Healing Draught")
    run_for(k2, nil, 20, 1 / 20)
    check(c2.state == "done", "with burning off a finished brew waits")
  end
  do
    -- throwing: an ingredient into the cauldron from a distance, a potion through the hatch, a loose one onto the floor (and back into the hands), a bottle that breaks
    local k = Kitchen.new(data.tutorial, nil, 8)
    local cauldron
    for _, st in ipairs(k.stations) do if st.kind == "cauldron" then cauldron = st end end
    local c = k.chef
    c.x, c.z, c.fx, c.fz = cauldron.cx, cauldron.cz + 2.0, 0, -1
    c.held = { k = "ing", id = "glowcap", ground = true }
    k:update(1 / 60, { throw = true })
    run_for(k, nil, 1, 1 / 60)
    check(#cauldron.items == 1 and c.held == nil, "an ingredient thrown at the cauldron lands in it")
    k.orders = { { id = 1, recipe = "heal", t = 60, total = 60, age = 1 } }
    local hatch
    for _, st in ipairs(k.stations) do if st.kind == "hatch" then hatch = st end end
    c.x, c.z, c.fx, c.fz = hatch.cx, hatch.cz - 2.0, 0, 1
    c.held = { k = "potion", recipe = "heal" }
    k:update(1 / 60, { throw = true })
    run_for(k, nil, 1, 1 / 60)
    check(k.stats.served == 1 and k.score > 0, "a potion thrown at the hatch is served")
    c.x, c.z, c.fx, c.fz = 4.5, 3.5, 1, 0
    c.held = { k = "ing", id = "sunpetal", ground = false }
    k:update(1 / 60, { throw = true })
    run_for(k, nil, 1, 1 / 60)
    check(#k.drops == 1 and c.held == nil, "an ingredient thrown at nothing lands on the floor")
    local d = k.drops[1]
    c.x, c.z, c.fx, c.fz = d.x - 0.5, d.z, 1, 0
    k:update(1 / 60, { grab = true })
    check(c.held ~= nil and c.held.id == "sunpetal" and #k.drops == 0, "and can be picked up again")
    c.held = { k = "bottle" }
    local broke = false
    k:update(1 / 60, { throw = true })
    for _ = 1, 60 do
      k:update(1 / 60, {})
      for _, e in ipairs(k:take_events()) do if e.type == "shatter" then broke = true end end
    end
    check(broke, "a bottle thrown at nothing breaks")
    -- stirring brews faster
    local k2 = Kitchen.new(data.tutorial, nil, 9)
    local c2
    for _, st in ipairs(k2.stations) do if st.kind == "cauldron" then c2 = st end end
    k2:add_to_cauldron(c2, { k = "ing", id = "glowcap", ground = true })
    k2:add_to_cauldron(c2, { k = "ing", id = "sunpetal", ground = false })
    k2.chef.x, k2.chef.z, k2.chef.fx, k2.chef.fz = c2.cx, c2.cz + 1.0, 0, -1
    for _ = 1, 60 do k2:update(1 / 60, { work = true }) end
    check(c2.timer > 1.15, "stirring speeds a brew up (the timer is at " .. string.format("%.2f", c2.timer) .. " after a second)")
  end
  do
    -- the biomes' cauldrons: slow in the frost, fast in the caverns
    local f = Kitchen.new(data.levels[4], nil, 1)
    local e = Kitchen.new(data.levels[7], nil, 1)
    check(f.burn_after > e.burn_after and f.temper.brew > e.temper.brew, "frost cauldrons are slower and more forgiving than ember ones")
  end
  do
    -- the tutorial: the computer apprentice brews the potion, and the last steps get the events they wait for; every step is passed, in order
    local Tutorial = require("lib.tutorial")
    local k = Kitchen.new(data.tutorial, nil, 11)
    local tut = Tutorial.new(k)
    local bot = Bot.new(k)
    local done, last = false, 1
    local injected = false
    for step = 1, 20 * 120 do
      local input = bot:update(1 / 20)
      -- from the throw step on, the lesson wants a throw and a dash that the computer does not make
      local events = {}
      if tut.i >= 12 and not injected then k:emit({ type = "throw" }); injected = true end
      if tut.i >= 13 then k:emit({ type = "dash" }) end
      k:update(1 / 20, input)
      for _, e in ipairs(k:take_events()) do events[#events + 1] = e end
      for _ = 1, 3 do if tut:update(events) then done = true end end
      if tut.i > last + 0 then last = tut.i end
      if done then break end
    end
    check(done, "the tutorial can be finished (it got as far as step " .. tut.i .. " of " .. Tutorial.COUNT .. ")")
  end
  do
    -- lava burns
    local level = data.levels[7]
    local k = Kitchen.new(level, nil, 5)
    local lx, lz
    for z = 1, k.rows do for x = 1, k.cols do if k.floor[z][x] == "lava" and not lx then lx, lz = x, z end end end
    k.chef.x, k.chef.z = lx - 0.5, lz - 0.5
    local died = false
    for _ = 1, 5 do
      k:update(1 / 60, {})
      for _, e in ipairs(k:take_events()) do if e.type == "lava" then died = true end end
    end
    check(died, "standing in lava burns")
    run_for(k, nil, 2, 1 / 20)
    check(k.chef.dead <= 0 and math.abs(k.chef.x - k.start.x) < 0.01, "and puts the apprentice back at the start")
  end
  do
    -- the rules change the level: no hazards, icy floors
    local k = Kitchen.new(data.levels[7], { hazards = false }, 6)
    local lava = 0
    for z = 1, k.rows do for x = 1, k.cols do if k.floor[z][x] == "lava" then lava = lava + 1 end end end
    check(lava == 0, "with hazards off there is no lava")
    local k2 = Kitchen.new(data.levels[1], { slippery = true }, 6)
    check(k2.floor[3][3] == "ice", "with slippery floors on every floor is ice")
  end

  if #failed == 0 then nova.log("selftest: ok " .. checks .. " checks") else for _, f in ipairs(failed) do nova.log("selftest: FAIL " .. f) end end
end

-- the computer apprentice plays each level in turn; `step(n)` does about n small steps and returns false when it is done
function selftest.bot_job()
  local job = { i = 0, k = nil, bot = nil, steps = 0, results = {} }
  function job:step(n)
    for _ = 1, n do
      if not self.k then
        self.i = self.i + 1
        local level = data.levels[self.i]
        if not level then
          local bad = 0
          for _, r in ipairs(self.results) do if r < 1 then bad = bad + 1 end end
          nova.log("botsim: done, " .. bad .. " levels under one star")
          return false
        end
        self.k = Kitchen.new(level, nil, self.i)
        self.bot = Bot.new(self.k)
      end
      self.k:update(1 / 20, self.bot:update(1 / 20))
      self.k:take_events()
      if self.k.over then
        local level = data.levels[self.i]
        nova.log(string.format("botsim: %s score=%d stars=%d served=%d expired=%d burnt=%d fell=%d", level.id, self.k.score, self.k:stars(), self.k.stats.served, self.k.stats.expired, self.k.stats.burnt, self.k.stats.fell))
        self.results[#self.results + 1] = self.k:stars()
        self.k, self.bot = nil, nil
      end
    end
    return true
  end
  return job
end

return selftest

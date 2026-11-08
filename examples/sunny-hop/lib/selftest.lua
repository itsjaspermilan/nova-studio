-- The self-test (F10 on the title, and tests/sunny_hop.rs): every level's scene file has what a level needs, the map names every level, the hero
-- jumps as the levels are drawn for, and save data comes back as it went in. The proof that each level can be finished, with every gem, is the
-- computer player (lib/bot.lua, F9).
local levels = require("lib.levels")
local world = require("lib.world")
local hero = require("lib.hero")

local selftest = {}

local LAYERS = { back = true, ladders = true, platforms = true, hazards = true, ground = true, water = true, lava = true, front = true, secret = true }

function selftest.run()
  local checks, fails = 0, {}
  local function check(ok, what)
    checks = checks + 1
    if not ok then fails[#fails + 1] = what; nova.log("sunny: selftest FAIL " .. what) end
  end

  -- ---- the levels' files
  local list = levels.all()
  check(#list == 25, "25 levels (found " .. #list .. ")")
  local worlds = levels.worlds()
  check(#worlds == 4, "four worlds")
  for _, w in ipairs(worlds) do
    local last = w.levels[#w.levels]
    check(last and last.props.boss ~= nil, w.id .. " ends with a boss level")
    check(#w.levels >= 6, w.id .. " has six levels or more")
  end
  local kinds_ok = {}
  for _, lv in ipairs(list) do
    local data = nova.scene_data(lv.scene)
    local counts, gems = {}, {}
    for _, o in ipairs(data.objects) do
      counts[o.kind] = (counts[o.kind] or 0) + 1
      if o.kind == "gem" or (o.kind == "qblock" and o.props and o.props.gives == "gem") then gems[#gems + 1] = o.props and o.props.n end
      if kinds_ok[o.kind] == nil then kinds_ok[o.kind] = pcall(require, "entities." .. o.kind) end
      check(kinds_ok[o.kind], lv.id .. ": the kind '" .. o.kind .. "' has an entity file")
    end
    check(counts.start == 1, lv.id .. ": one start")
    check(counts.goal == 1, lv.id .. ": one goal")
    check(counts.level == 1, lv.id .. ": one level object")
    check(type(lv.props.name) == "string" and #lv.props.name > 0, lv.id .. ": a name")
    check(type(lv.props.target) == "number" and lv.props.target > 0, lv.id .. ": a star time")
    table.sort(gems, function(a, b) return (a or 0) < (b or 0) end)
    check(#gems == 3 and gems[1] == 1 and gems[2] == 2 and gems[3] == 3, lv.id .. ": gems 1, 2 and 3")
    if lv.props.boss then check(counts.boss == 1, lv.id .. ": a boss") end
    local cols, rows
    for _, tm in ipairs(data.tilemaps) do
      check(LAYERS[tm.name or ""] == true, lv.id .. ": the tilemap '" .. tostring(tm.name) .. "' is a known layer")
      check(tm.tileset.image == "sprites/tiles.png" and tm.tileset.tile_width == 96 and tm.tileset.scale == 0.5, lv.id .. ": " .. tostring(tm.name) .. " uses the HD tileset at half size")
      check(tm.x == 0 and tm.y == 0, lv.id .. ": " .. tostring(tm.name) .. " starts at 0, 0")
      cols, rows = cols or #tm.tiles[1], rows or #tm.tiles
      check(#tm.tiles[1] == cols and #tm.tiles == rows, lv.id .. ": every layer is the same size")
    end
    check(rows and rows >= 12, lv.id .. ": at least 12 rows")
  end
  -- ---- the map
  local map = nova.scene_data("map")
  local nodes = {}
  for _, o in ipairs(map.objects) do if o.kind == "node" then nodes[o.props.level] = true end end
  for _, lv in ipairs(list) do check(nodes[lv.id], "the map has a node for " .. lv.id) end

  -- ---- the hero's jumps, on a flat test ground
  local row = {}
  for c = 1, 60 do row[c] = 1 end
  world.build({ { name = "ground", tiles = { row, row }, x = 0, y = 480, tile = 48 } })
  local function sim(b, frames, input)
    local top = b.y
    for f = 1, frames do
      hero.step(b, input(f), 1 / 60)
      top = math.min(top, b.y)
    end
    return top
  end
  local function jump_height(hold_frames, run)
    local b = hero.new(400, 480)
    b.ground = true
    if run then b.vx = hero.H.run end
    local top = sim(b, 120, function(f) return { x = run and 1 or 0, y = 0, jump = f <= hold_frames, jump_pressed = f == 1 } end)
    return (480 - top) / 48
  end
  local full = jump_height(120)
  check(full >= 4.05 and full <= 4.6, string.format("a held jump rises 4 to 4.5 tiles (%.2f)", full))
  local tap = jump_height(2)
  check(tap < 1.6 and tap > 0.6, string.format("a tapped jump is a hop of about a tile (%.2f)", tap))
  -- how far a running jump carries, landing at the height it left
  do
    local b = hero.new(100, 480); b.ground = true; b.vx = hero.H.run
    local x0
    for f = 1, 90 do
      hero.step(b, { x = 1, y = 0, jump = true, jump_pressed = f == 1 }, 1 / 60)
      if f == 1 then x0 = b.x end
      if f > 3 and b.ground then break end
    end
    local reach = (b.x - x0) / 48
    check(reach >= 4.0, string.format("a running jump carries over 4 tiles (%.2f)", reach))
  end
  -- coyote time: a jump just after running off a ledge still happens
  do
    local edge = {}
    for c = 1, 10 do edge[c] = 1 end
    for c = 11, 40 do edge[c] = -1 end
    world.build({ { name = "ground", tiles = { edge, edge }, x = 0, y = 480, tile = 48 } })
    local b = hero.new(440, 480); b.ground = true; b.vx = hero.H.run
    local left_at, jumped
    for f = 1, 40 do
      local over = b.x - b.w / 2 > 480
      if over and not left_at then left_at = f end
      local press = left_at and f == left_at + 4
      hero.step(b, { x = 1, y = 0, jump = press or false, jump_pressed = press or false }, 1 / 60)
      if press then jumped = b.vy < -500 end
    end
    check(jumped == true, "a jump 4 frames after leaving a ledge still jumps (coyote time)")
    world.build({ { name = "ground", tiles = { row, row }, x = 0, y = 480, tile = 48 } })
  end
  -- the buffer: a jump pressed just before landing happens on landing
  do
    local b = hero.new(400, 380); b.vy = 400
    local pressed_at, jumped
    for f = 1, 60 do
      local press = (not pressed_at) and b.y > 480 - 40
      if press then pressed_at = f end
      hero.step(b, { x = 0, y = 0, jump = pressed_at ~= nil and f - pressed_at < 30, jump_pressed = press }, 1 / 60)
      if pressed_at and f > pressed_at and b.vy < -500 then jumped = true end
    end
    check(jumped == true, "a jump pressed just before landing happens (the buffer)")
  end
  -- a spring throws the hero nine tiles or more
  do
    world.springs[1] = { x0 = 380, y0 = 454, x1 = 420, y1 = 474 }
    local b = hero.new(400, 300); b.vy = 300
    local top = sim(b, 120, function() return { x = 0, y = 0, jump = true, jump_pressed = false } end)
    check((474 - top) / 48 >= 9, string.format("a spring throws nine tiles or more (%.2f)", (474 - top) / 48))
    world.springs = {}
  end

  -- ---- save data
  local probe = { done = true, gems = { true, false, true }, best = 42.5, coins = 17 }
  nova.save.set("selftest_probe", probe)
  local back = nova.save.get("selftest_probe")
  check(back and back.done == true and back.gems[2] == false and back.gems[3] == true and back.best == 42.5, "save data comes back as it went in")
  nova.save.delete("selftest_probe")
  check(nova.save.get("selftest_probe") == nil, "save data can be deleted")

  local ok = #fails == 0
  local report = ok and (checks .. " checks passed") or (#fails .. " of " .. checks .. " checks failed: " .. fails[1])
  return ok, report, checks, fails
end

return selftest

-- Checks the rules (F10 on the title screen, or `cargo test -p nova-runtime --test nebula`): every puzzle is won by its recorded solution, a line of
-- three clears, garbage beside a match breaks into blocks, a stack that reaches the top ends the game, and the rival finds a move.
local Board = require("lib.board")
local AI = require("lib.ai")
local puzzles = require("lib.puzzles")

local selftest = {}

local function settle(b, limit)
  for _ = 1, limit or 3000 do
    b:update(1 / 60, false)
    if not b:busy() then return true end
  end
  return false
end

function selftest.run()
  local checks, failed = 0, {}
  local function check(ok, what)
    checks = checks + 1
    if not ok then failed[#failed + 1] = what end
  end

  -- every puzzle is won by its solution, in exactly its number of swaps
  local chains = 0
  for i, p in ipairs(puzzles) do
    local b = Board.new({ mode = "puzzle", puzzle = p, seed = i })
    check(not b:busy() or settle(b), "puzzle " .. i .. " starts at rest")
    local ok = true
    for _, s in ipairs(p.solution) do
      b.cursor.r, b.cursor.c = s[1], s[2]
      if not b:swap() then ok = false end
      settle(b)
    end
    check(ok, "puzzle " .. i .. ": every swap of the solution is allowed")
    settle(b)
    check(b.won, "puzzle " .. i .. " is won by its solution")
    check(b.moves_left == p.moves - #p.solution, "puzzle " .. i .. " uses " .. #p.solution .. " swaps")
    if b.max_chain >= 2 then chains = chains + 1 end
  end
  nova.log("selftest: puzzles " .. #puzzles .. ", with a chain in " .. chains)

  -- three in a row clear
  do
    local b = Board.new({ mode = "puzzle", puzzle = { rows = { "111..." }, moves = 3 } })
    settle(b)
    check(b.won, "a line of three clears the board")
    check(b.score > 0 and b.cleared == 3, "a clear scores")
  end
  -- four in a row is a combo that sends garbage
  do
    local b = Board.new({ mode = "puzzle", puzzle = { rows = { "1111.." }, moves = 3 } })
    local sent = 0
    for _ = 1, 600 do
      b:update(1 / 60, false)
      for _, e in ipairs(b:take_events()) do if e.type == "send" then sent = sent + 1 end end
    end
    check(sent == 1, "a combo of four sends one piece of garbage (sent " .. sent .. ")")
  end
  -- a block with nothing under it falls
  do
    local b = Board.new({ mode = "puzzle", puzzle = { rows = { "1.....", "......", "......" }, moves = 3 } })
    -- (the loader stacks rows from the bottom: three rows, so the 1 is in row 3 with nothing under it)
    check(b.cells[3][1] ~= nil, "the block starts in row 3")
    settle(b)
    check(b.cells[1][1] ~= nil and b.cells[3][1] == nil, "the block fell to row 1")
  end
  -- a chain: the 2s clear, the 4 that stood on one falls into the row beside two 4s, and that line clears as a chain
  do
    local b = Board.new({ mode = "puzzle", puzzle = { rows = { "......" }, moves = 5 } })
    local function put(r, c, k) b.cells[r][c] = b:new_gem(k) end
    put(1, 1, 2); put(1, 2, 2); put(1, 3, 2)
    put(2, 3, 4)
    put(1, 4, 4); put(1, 5, 4)
    settle(b)
    check(b:count_gems() == 0, "the 4s clear after the 2s: left " .. b:count_gems())
    check(b.max_chain >= 2, "the second clear is a chain (chain " .. b.max_chain .. ")")
    check(b.score > 6 * 10, "a chain scores more than its blocks alone")
  end
  -- garbage beside a match breaks into blocks
  do
    local b = Board.new({ mode = "endless", seed = 3, start_rows = 0 })
    b.cells[1][1], b.cells[1][2], b.cells[1][3] = b:new_gem(1), b:new_gem(1), b:new_gem(2)
    b.cells[1][4] = b:new_gem(5)
    local g = { t = "garbage", w = 3, h = 1, c = 1, r = 2, st = "idle", timer = 0, vy = 0, id = 1 }
    for c = 1, 3 do b.cells[2][c] = g end
    b.cells[2][4] = nil
    -- swap the 2 out and a 1 in: put a 1 at column 4 and swap columns 3 and 4
    b.cells[1][4] = b:new_gem(1)
    b.cursor.r, b.cursor.c = 1, 3
    check(b:swap(), "the swap beside garbage is allowed")
    local broke = false
    for _ = 1, 400 do
      b:update(1 / 60, false)
      for _, e in ipairs(b:take_events()) do if e.type == "garbage_break" then broke = true end end
    end
    check(broke, "garbage beside a match breaks")
    check(b.cells[2][1] == nil or b.cells[2][1].t == "gem", "the slab is gone (its cells are blocks or empty)")
  end
  -- a stack that reaches the top ends the game
  do
    local b = Board.new({ mode = "endless", seed = 5, start_rows = Board.SHOWN })
    local over = false
    for _ = 1, 60 * 10 do
      b:update(1 / 60, false)
      for _, e in ipairs(b:take_events()) do if e.type == "over" then over = true end end
      if over then break end
    end
    check(over, "a full stack ends the game")
  end
  -- the rival finds the one move
  do
    local b = Board.new({ mode = "versus", seed = 9, start_rows = 0 })
    for c = 1, 6 do b.cells[1][c] = b:new_gem((c % 2) + 1) end
    b.cells[1][1] = b:new_gem(3); b.cells[1][2] = b:new_gem(3); b.cells[1][3] = b:new_gem(4); b.cells[1][4] = b:new_gem(3)
    local ai = AI.new(b, "hard")
    local pick = ai:find()
    check(pick ~= nil and pick.r == 1 and pick.c == 3, "the rival sees the swap that makes three")
  end
  if #failed == 0 then nova.log("selftest: ok " .. checks .. " checks") else for _, f in ipairs(failed) do nova.log("selftest: FAIL " .. f) end end
end

return selftest

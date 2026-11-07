-- The rival in garbage battles: looks over its board for a swap that makes a match, moves its cursor there a step at a time (so that the player sees
-- it work), swaps, and raises the stack when it has nothing better to do. The levels differ in how fast it thinks and moves, and in what it prefers.
local Board = require("lib.board")

local AI = {}
AI.__index = AI

local LEVELS = {
  easy = { think = 1.0, step = 0.17, garbage = false, raise = 0.45 },
  normal = { think = 0.5, step = 0.1, garbage = true, raise = 0.6 },
  hard = { think = 0.18, step = 0.06, garbage = true, raise = 0.8 },
}
AI.LEVELS = { "easy", "normal", "hard" }

function AI.new(board, level)
  local o = LEVELS[level] or LEVELS.normal
  return setmetatable({ board = board, o = o, timer = 1.0, plan = nil, raising = false }, AI)
end

-- the kind of a block that is standing still (or false for nothing, nil for something that cannot be matched or moved)
local function kind(b, r, c, sw)
  if c < 1 or c > Board.COLS or r < 1 then return nil end
  if sw and r == sw.r and c == sw.c then c = sw.c + 1 elseif sw and r == sw.r and c == sw.c + 1 then c = sw.c end
  local g = b.cells[r] and b.cells[r][c]
  if g == nil then return false end
  if g.t == "gem" and g.st == "idle" then return g.k end
  return nil
end

-- how many blocks a swap at (r, c) would match (0 for none)
local function swap_value(b, r, c)
  local a, d = kind(b, r, c), kind(b, r, c + 1)
  if a == nil or d == nil or (a == false and d == false) or a == d then return 0 end
  local sw = { r = r, c = c }
  local total = 0
  local seen = {}
  local function run(rr, cc, dr, dc)
    local k = kind(b, rr, cc, sw)
    if not k then return end
    local n, cells = 1, { { rr, cc } }
    local x, y = cc + dc, rr + dr
    while kind(b, y, x, sw) == k do n = n + 1; cells[#cells + 1] = { y, x }; x, y = x + dc, y + dr end
    x, y = cc - dc, rr - dr
    while kind(b, y, x, sw) == k do n = n + 1; cells[#cells + 1] = { y, x }; x, y = x - dc, y - dr end
    if n >= 3 then
      for _, p in ipairs(cells) do
        local key = p[1] * 16 + p[2]
        if not seen[key] then seen[key] = true; total = total + 1 end
      end
    end
  end
  for _, cc in ipairs({ c, c + 1 }) do
    run(r, cc, 0, 1)
    run(r, cc, 1, 0)
  end
  return total
end

function AI:find()
  local b, best, best_score = self.board, nil, 0
  for r = 1, Board.SHOWN do
    for c = 1, Board.COLS - 1 do
      local n = swap_value(b, r, c)
      if n > 0 then
        local score = n * 10 + r * 1.5
        if self.o.garbage then
          -- a match beside garbage breaks it open
          for _, d in ipairs({ { r + 1, c }, { r - 1, c }, { r, c - 1 }, { r, c + 2 } }) do
            local g = b.cells[d[1]] and b.cells[d[1]][d[2]]
            if g and g.t == "garbage" then score = score + 18 end
          end
        end
        if score > best_score then best, best_score = { r = r, c = c }, score end
      end
    end
  end
  return best
end

function AI:update(dt)
  local b = self.board
  self.raising = false
  if b.over or b.won then return end
  self.timer = self.timer - dt
  if self.timer > 0 then return end
  local cur = b.cursor
  if not self.plan then
    self.plan = self:find()
    if not self.plan then
      -- nothing to do: raise the stack while it is low
      self.raising = b:top_row() <= 4 + math.floor(self.o.raise * 3)
      self.timer = 0.1
      return
    end
  end
  local p = self.plan
  if cur.r ~= p.r then
    b:move_cursor(p.r > cur.r and 1 or -1, 0)
    self.timer = self.o.step
  elseif cur.c ~= p.c then
    b:move_cursor(0, p.c > cur.c and 1 or -1)
    self.timer = self.o.step
  else
    b:swap()
    self.plan = nil
    self.timer = self.o.think
  end
end

return AI

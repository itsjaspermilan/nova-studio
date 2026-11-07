-- The rules of Nebula Swap, with nothing drawn: a board of six columns, blocks that rise from below, a cursor that swaps two neighbours, matches of
-- three or more that flash and pop, gravity, chains (a match made by blocks that fell because of the last one), and garbage (a grey slab that is
-- broken by a match beside it). The scenes draw it (lib/view.lua) and listen to `board.events`.
--
-- Rows are numbered from the bottom (row 1). `cells[r][c]` is a gem, a garbage slab (every cell it covers holds the same table) or nil.
local Board = {}
Board.__index = Board

local COLS, SHOWN, HEIGHT = 6, 12, 26 -- columns, rows the player sees, rows the grid holds (garbage waits above the top)
local SWAP_TIME = 0.09
local HOVER = 0.09 -- a block whose support went waits this long, then falls
local FALL_SPEED = 14 -- rows a second
local FLASH = 0.5
local POP_GAP = 0.09 -- each matched block pops this much after the one before
local POP_TIME = 0.16

Board.COLS, Board.SHOWN, Board.HEIGHT = COLS, SHOWN, HEIGHT

-- A small random generator of our own, so that a board with a seed always plays out the same (the tests rely on it, and so does a puzzle).
local function rng(seed)
  local s = (seed or 1) % 2147483647
  if s <= 0 then s = s + 2147483646 end
  return function(n)
    s = (s * 48271) % 2147483647
    return s % n + 1
  end
end

-- options: seed, colours (how many kinds, 3 to 6), level (the starting speed), mode "endless" | "versus" | "puzzle", puzzle = { rows = {...}, moves = n }
function Board.new(o)
  o = o or {}
  local b = setmetatable({}, Board)
  b.mode = o.mode or "endless"
  b.rand = rng(o.seed or 1)
  b.colours = o.colours or 6
  b.level = o.level or 1
  b.start_level = b.level
  b.cells = {}
  for r = 1, HEIGHT do b.cells[r] = {} end
  b.offset = 0 -- how far the next row has risen (0 to 1)
  b.cursor = { r = 5, c = 3 }
  b.events = {}
  b.score, b.cleared, b.max_chain, b.max_combo = 0, 0, 0, 0
  b.chain = 0
  b.stop = 0
  b.panic = 0
  b.time = 0
  b.over = false
  b.won = false
  b.incoming = {} -- garbage on its way: { w =, h = }
  b.spawn_wait = 0
  b.group_id = 0
  b.garbage_id = 0
  b.groups = {}
  b.manual = false
  b.static = (b.mode == "puzzle")
  b.moves_left = nil
  if b.mode == "puzzle" then
    b:load_puzzle(o.puzzle)
  else
    b.next_row = b:new_row()
    -- the starting stack: a few rows, with no matches in it
    for r = 1, o.start_rows or 5 do
      for c = 1, COLS do b.cells[r][c] = b:new_gem(b:pick(r, c)) end
    end
    b.cursor = { r = 4, c = 3 }
    b.next_row = b:new_row() -- (again, now that there is a stack to fit)
  end
  return b
end

function Board:new_gem(k)
  return { t = "gem", k = k, st = "idle", timer = 0, vx = 0, vy = 0 }
end

-- a colour for (r, c) that does not make three in a row with what is already there (below and to the left)
function Board:pick(r, c, row_colours)
  for _ = 1, 30 do
    local k = self.rand(self.colours)
    local bad = false
    local function kind(rr, cc)
      if row_colours and rr == r then return row_colours[cc] end
      local g = self.cells[rr] and self.cells[rr][cc]
      return g and g.t == "gem" and g.k or nil
    end
    if c >= 3 and kind(r, c - 1) == k and kind(r, c - 2) == k then bad = true end
    if r >= 3 and kind(r - 1, c) == k and kind(r - 2, c) == k then bad = true end
    if not bad then return k end
  end
  return self.rand(self.colours)
end

function Board:new_row()
  local row = {}
  for c = 1, COLS do
    local k
    for _ = 1, 30 do
      k = self.rand(self.colours)
      -- no three in a row sideways, and none up the column once the row has risen into place (the row above it is row 1 after the shift)
      local up1 = self.cells[1] and self.cells[1][c]
      local up2 = self.cells[2] and self.cells[2][c]
      local side = c >= 3 and row[c - 1] == k and row[c - 2] == k
      local up = up1 and up2 and up1.t == "gem" and up2.t == "gem" and up1.k == k and up2.k == k
      if not side and not up then break end
    end
    row[c] = k
  end
  return row
end

-- puzzles: rows is a list of strings from the top row to the bottom, "." for empty, "1".."6" for a colour
function Board:load_puzzle(p)
  assert(p, "a puzzle board needs a puzzle")
  local n = #p.rows
  for i, line in ipairs(p.rows) do
    local r = n - i + 1
    for c = 1, COLS do
      local ch = line:sub(c, c)
      if ch ~= "." and ch ~= " " and ch ~= "" then self.cells[r][c] = self:new_gem(tonumber(ch)) end
    end
  end
  self.moves_left = p.moves
  self.moves_total = p.moves
  self.cursor = { r = math.max(1, math.min(SHOWN, p.cursor_r or 1)), c = p.cursor_c or 3 }
  self.next_row = nil
end

function Board:emit(e)
  self.events[#self.events + 1] = e
end

function Board:take_events()
  local e = self.events
  self.events = {}
  return e
end

function Board:at(r, c)
  local row = self.cells[r]
  return row and row[c]
end

-- ---- queries ----------------------------------------------------------------------------------------------------------------

function Board:count_gems()
  local n = 0
  for r = 1, HEIGHT do
    for c = 1, COLS do
      local g = self.cells[r][c]
      if g and g.t == "gem" then n = n + 1 end
    end
  end
  return n
end

-- whether anything is moving, flashing or waiting (a puzzle waits for this before it takes the next swap)
function Board:busy()
  for r = 1, HEIGHT do
    for c = 1, COLS do
      local g = self.cells[r][c]
      if g and g.st ~= "idle" then return true end
    end
  end
  return false
end

function Board:top_row()
  for r = HEIGHT, 1, -1 do
    for c = 1, COLS do if self.cells[r][c] then return r end end
  end
  return 0
end

-- ---- the cursor and swapping ----------------------------------------------------------------------------------------------------

function Board:move_cursor(dr, dc)
  local cur = self.cursor
  cur.r = math.max(1, math.min(SHOWN, cur.r + dr))
  cur.c = math.max(1, math.min(COLS - 1, cur.c + dc))
end

local function swappable(g)
  return g == nil or (g.t == "gem" and g.st == "idle")
end

-- Swaps the two cells under the cursor. Returns true if it did.
function Board:swap()
  if self.over or self.won then return false end
  local r, c = self.cursor.r, self.cursor.c
  local a, b = self.cells[r][c], self.cells[r][c + 1]
  if a == nil and b == nil then return false end
  if not swappable(a) or not swappable(b) then return false end
  if self.mode == "puzzle" then
    if self:busy() or self.moves_left <= 0 then return false end
    self.moves_left = self.moves_left - 1
  end
  self.cells[r][c], self.cells[r][c + 1] = b, a
  if a then a.st, a.timer, a.vx = "swap", SWAP_TIME, -1 end
  if b then b.st, b.timer, b.vx = "swap", SWAP_TIME, 1 end
  self:emit({ type = "swap", r = r, c = c })
  return true
end

-- ---- matching -----------------------------------------------------------------------------------------------------------------

local function matchable(g)
  return g and g.t == "gem" and g.st == "idle"
end

-- Finds every block that is in a line of three or more of one kind (only blocks that are standing still count). Returns a list of { r, c }.
function Board:find_matches()
  local mark, list = {}, {}
  local function add(r, c)
    local key = r * 16 + c
    if not mark[key] then mark[key] = true; list[#list + 1] = { r = r, c = c } end
  end
  for r = 1, HEIGHT do
    local c = 1
    while c <= COLS do
      local g = self.cells[r][c]
      if matchable(g) then
        local e = c
        while e + 1 <= COLS and matchable(self.cells[r][e + 1]) and self.cells[r][e + 1].k == g.k do e = e + 1 end
        if e - c + 1 >= 3 then for x = c, e do add(r, x) end end
        c = e + 1
      else
        c = c + 1
      end
    end
  end
  for c = 1, COLS do
    local r = 1
    while r <= HEIGHT do
      local g = self.cells[r][c]
      if matchable(g) then
        local e = r
        while e + 1 <= HEIGHT and matchable(self.cells[e + 1][c]) and self.cells[e + 1][c].k == g.k do e = e + 1 end
        if e - r + 1 >= 3 then for y = r, e do add(y, c) end end
        r = e + 1
      else
        r = r + 1
      end
    end
  end
  return list
end

-- The garbage that a combo or a chain sends: { { w =, h = }, ... }
function Board.garbage_for(n, chain)
  local out = {}
  if n >= 4 then
    out[#out + 1] = { w = math.min(6, n - 1), h = 1 }
    if n >= 8 then out[#out + 1] = { w = math.min(6, n - 4), h = 1 } end
  end
  if chain >= 2 then out[#out + 1] = { w = 6, h = math.min(6, chain - 1) } end
  return out
end

function Board:scan()
  -- (a puzzle matches only when everything has come to rest, so that it plays out exactly as the solver that made it did)
  if self.mode == "puzzle" and self:busy() then return end
  local list = self:find_matches()
  if #list == 0 then
    -- the blocks that stood still and matched nothing lose their chain mark
    for r = 1, HEIGHT do
      for c = 1, COLS do
        local g = self.cells[r][c]
        if g and g.t == "gem" and g.st == "idle" then g.chain_ok = nil end
      end
    end
    return
  end
  local chained = false
  for _, p in ipairs(list) do
    if self.cells[p.r][p.c].chain_ok then chained = true end
  end
  if chained then self.chain = math.max(2, self.chain + 1) else self.chain = math.max(1, self.chain) end
  local n = #list
  self.group_id = self.group_id + 1
  local group = { remaining = n }
  self.groups[self.group_id] = group
  -- the order they pop in: top row first, left to right
  table.sort(list, function(a, b) if a.r ~= b.r then return a.r > b.r end return a.c < b.c end)
  for i, p in ipairs(list) do
    local g = self.cells[p.r][p.c]
    g.st, g.age, g.group, g.pop_at, g.gone_at = "flash", 0, self.group_id, FLASH + (i - 1) * POP_GAP, FLASH + (i - 1) * POP_GAP + POP_TIME
    g.chain_ok = nil
  end
  -- garbage beside the match breaks
  local broken = {}
  for _, p in ipairs(list) do
    for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
      local g = self:at(p.r + d[1], p.c + d[2])
      if g and g.t == "garbage" and not broken[g] then broken[g] = true end
    end
  end
  for g in pairs(broken) do self:break_garbage(g) end
  -- score
  local points = n * 10
  if n > 3 then points = points + (n - 3) * 20 end
  if self.chain >= 2 then points = points + (self.chain - 1) * 50 end
  self.score = self.score + points
  self.cleared = self.cleared + n
  self.max_combo = math.max(self.max_combo, n)
  self.max_chain = math.max(self.max_chain, self.chain)
  self.stop = math.min(4, self.stop + 0.4 + 0.12 * n + 0.5 * math.max(0, self.chain - 1))
  self:emit({ type = "match", n = n, chain = self.chain, points = points, r = list[#list].r, c = list[#list].c, cells = list })
  for _, piece in ipairs(Board.garbage_for(n, self.chain)) do self:emit({ type = "send", w = piece.w, h = piece.h }) end
end

-- The bottom row of a slab turns into blocks (which fall, and count for a chain); a slab one row high turns into blocks all at once.
function Board:break_garbage(g)
  local c0, w = g.c, g.w
  local r = g.r
  for c = c0, c0 + w - 1 do
    local k = self.rand(self.colours)
    local gem = self:new_gem(k)
    gem.chain_ok = true
    gem.st, gem.timer = "hover", HOVER
    self.cells[r][c] = gem
    self:emit({ type = "break", r = r, c = c })
  end
  if g.h > 1 then
    g.h = g.h - 1
    g.r = g.r + 1
  end
  self:emit({ type = "garbage_break", r = r, c = c0, w = w })
end

-- ---- gravity and timers ----------------------------------------------------------------------------------------------------

function Board:update_gems(dt)
  local cells = self.cells
  for r = 1, HEIGHT do
    for c = 1, COLS do
      local g = cells[r][c]
      if g and g.t == "gem" then
        if g.st == "swap" then
          g.timer = g.timer - dt
          g.vx = g.vx * math.max(0, g.timer / SWAP_TIME)
          if g.timer <= 0 then g.st, g.vx = "idle", 0 end
        elseif g.st == "flash" then
          g.age = g.age + dt
          if g.age >= g.gone_at then
            cells[r][c] = nil
            self:emit({ type = "pop", r = r, c = c, k = g.k, order = g.pop_at })
            local group = self.groups[g.group]
            if group then
              group.remaining = group.remaining - 1
              if group.remaining <= 0 then self.groups[g.group] = nil end
            end
            -- what stood on it may fall, and a match it makes then is a chain
            for y = r + 1, HEIGHT do
              local above = cells[y][c]
              if above and above.t == "gem" then above.chain_ok = true end
            end
          end
        elseif g.st == "hover" then
          g.timer = g.timer - dt
          if g.timer <= 0 then
            if r > 1 and cells[r - 1][c] == nil then g.st = "fall" else g.st = "idle" end
          end
        end
      end
    end
  end
  -- falling gems, bottom to top so that a stack falls together
  for r = 1, HEIGHT do
    for c = 1, COLS do
      local g = cells[r][c]
      if g and g.t == "gem" and g.st == "fall" then
        g.vy = g.vy - FALL_SPEED * dt
        local guard = 0
        while g.vy <= 0 and guard < 4 do
          guard = guard + 1
          if r > 1 and cells[r - 1][c] == nil then
            cells[r][c] = nil
            r = r - 1
            cells[r][c] = g
            g.vy = g.vy + 1
          else
            g.st, g.vy = "idle", 0
            self:emit({ type = "land", r = r, c = c })
            break
          end
        end
        if g.st == "fall" and g.vy < 0 then g.vy = 0 end
      end
    end
  end
  -- a block with nothing under it starts to fall
  for r = 2, HEIGHT do
    for c = 1, COLS do
      local g = cells[r][c]
      if g and g.t == "gem" and g.st == "idle" and cells[r - 1][c] == nil then
        g.st, g.timer = "hover", HOVER
      end
    end
  end
end

-- garbage falls as one piece
function Board:update_garbage(dt)
  local seen = {}
  for r = 1, HEIGHT do
    for c = 1, COLS do
      local g = self.cells[r][c]
      if g and g.t == "garbage" and not seen[g] then
        seen[g] = true
        local free = g.r > 1
        if free then
          for x = g.c, g.c + g.w - 1 do
            local below = self.cells[g.r - 1][x]
            if below ~= nil and below ~= g then free = false end
          end
        end
        if g.st == "idle" and free then
          g.st, g.timer = "hover", HOVER
        elseif g.st == "hover" then
          g.timer = g.timer - dt
          if g.timer <= 0 then g.st, g.vy = free and "fall" or "idle", 0 end
        elseif g.st == "fall" then
          g.vy = g.vy - FALL_SPEED * dt
          while g.vy <= 0 do
            local can = g.r > 1
            if can then
              for x = g.c, g.c + g.w - 1 do
                local below = self.cells[g.r - 1][x]
                if below ~= nil and below ~= g then can = false end
              end
            end
            if can then
              for y = g.r, g.r + g.h - 1 do for x = g.c, g.c + g.w - 1 do self.cells[y][x] = nil end end
              g.r = g.r - 1
              for y = g.r, g.r + g.h - 1 do for x = g.c, g.c + g.w - 1 do self.cells[y][x] = g end end
              g.vy = g.vy + 1
            else
              g.st, g.vy = "idle", 0
              self:emit({ type = "garbage_land", r = g.r, c = g.c, w = g.w, h = g.h })
              break
            end
          end
        end
      end
    end
  end
end

-- Puts a slab in at the top and lets it fall. Returns false if the place is taken.
function Board:drop_garbage(w, h)
  w = math.min(COLS, w)
  local c = (w == COLS) and 1 or self.rand(COLS - w + 1)
  local r = math.max(SHOWN + 1, self:top_row() + 1)
  if r + h - 1 > HEIGHT then h = HEIGHT - r + 1 end
  if h < 1 then return false end
  self.garbage_id = self.garbage_id + 1
  local g = { t = "garbage", w = w, h = h, c = c, r = r, st = "idle", timer = 0, vy = 0, id = self.garbage_id }
  for y = r, r + h - 1 do for x = c, c + w - 1 do self.cells[y][x] = g end end
  self:emit({ type = "garbage_in", w = w, h = h })
  return true
end

-- ---- rising --------------------------------------------------------------------------------------------------------------------

function Board:speed()
  return math.min(0.85, 0.09 + 0.032 * (self.level - 1))
end

function Board:raise_row()
  -- a row of blocks comes in at the bottom; everything moves up one (the cursor with it)
  for r = HEIGHT, 2, -1 do self.cells[r] = self.cells[r - 1] end
  self.cells[1] = {}
  for c = 1, COLS do
    self.cells[1][c] = self:new_gem(self.next_row[c])
  end
  -- garbage's own rows move with the stack
  local seen = {}
  for r = 1, HEIGHT do
    for c = 1, COLS do
      local g = self.cells[r][c]
      if g and g.t == "garbage" and not seen[g] then seen[g] = true; g.r = g.r + 1 end
    end
  end
  self.next_row = self:new_row()
  self.cursor.r = math.min(SHOWN, self.cursor.r + 1)
  self.offset = self.offset - 1
  self:emit({ type = "raise" })
end

function Board:row_taken(r)
  for c = 1, COLS do if self.cells[r][c] then return true end end
  return false
end

function Board:update_rise(dt, raising)
  if self.static then return end
  local active = false
  for r = 1, HEIGHT do
    for c = 1, COLS do
      local g = self.cells[r][c]
      if g and (g.st == "flash") then active = true end
    end
  end
  self.stop = math.max(0, self.stop - dt)
  local blocked = self:row_taken(SHOWN)
  local rate = 0
  if raising and not blocked then rate = 5.5 end
  if rate == 0 and self.stop <= 0 and not active and not blocked then rate = self:speed() end
  -- (a stack that touches the top cannot rise; if it stays there, it is over)
  if blocked then
    if not active and self.stop <= 0 and not self:garbage_or_fall_pending() then
      self.panic = self.panic + dt
      if self.panic >= 1.6 and not self.over then
        self.over = true
        self:emit({ type = "over" })
      end
    end
  else
    self.panic = math.max(0, self.panic - dt * 2)
  end
  self.offset = self.offset + rate * dt
  if self.offset >= 1 then
    if self:row_taken(SHOWN) then self.offset = 0.999 else self:raise_row() end
  end
  self.manual = raising and rate > 0
end

function Board:garbage_or_fall_pending()
  for r = 1, HEIGHT do
    for c = 1, COLS do
      local g = self.cells[r][c]
      if g and (g.st == "hover" or g.st == "fall") then return true end
    end
  end
  return false
end

-- ---- the update -----------------------------------------------------------------------------------------------------------------

function Board:update(dt, raising)
  if self.over or self.won then
    self:update_gems(dt)
    return
  end
  self.time = self.time + dt
  self:update_gems(dt)
  self:update_garbage(dt)
  self:scan()
  if self.mode == "endless" or self.mode == "versus" then
    self.level = self.start_level + math.floor(self.time / 24) + math.floor(self.cleared / 60)
  end
  self:update_rise(dt, raising)
  -- garbage that was sent here comes in one piece at a time, once the chain has settled
  if #self.incoming > 0 then
    self.spawn_wait = self.spawn_wait - dt
    if self.spawn_wait <= 0 and self.chain == 0 then
      local piece = table.remove(self.incoming, 1)
      if not self:drop_garbage(piece.w, piece.h) then table.insert(self.incoming, 1, piece) end
      self.spawn_wait = 0.45
    end
  end
  -- the chain ends when nothing that fell is left to match
  if self.chain > 0 then
    local live = false
    for r = 1, HEIGHT do
      for c = 1, COLS do
        local g = self.cells[r][c]
        if g and g.t == "gem" and (g.st ~= "idle" or g.chain_ok) then live = true end
      end
    end
    if not live then
      if self.chain >= 2 then self:emit({ type = "chain_end", n = self.chain }) end
      self.chain = 0
    end
  end
  if self.mode == "puzzle" then
    if not self:busy() then
      if self:count_gems() == 0 then
        self.won = true
        self:emit({ type = "won" })
      elseif self.moves_left <= 0 then
        self.over = true
        self:emit({ type = "over" })
      end
    end
  end
end

-- the garbage a rival sent: it cancels what is on its way to us, then comes in
function Board:receive(w, h)
  self.incoming[#self.incoming + 1] = { w = w, h = h }
end

-- our own garbage first cancels what is coming to us (returns the piece if nothing was left to cancel)
function Board:send_or_cancel(w, h)
  if #self.incoming > 0 then
    table.remove(self.incoming, 1)
    return nil
  end
  return { w = w, h = h }
end

return Board

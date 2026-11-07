-- Draws a board (lib/board.lua) and the effects its events call for: sparkles and rings where blocks pop, floating scores, a chain banner, a shake
-- when garbage lands. The blocks, the cursor and the sparkles go into the world layer (so the anti-aliasing covers them); the frame, the masks that hide
-- the row coming in from below and the text go into the UI layer.
local Board = require("lib.board")
local ui = require("lib.ui")
local state = require("lib.state")

local View = {}
View.__index = View

local COLOURS = { { 232, 64, 76 }, { 250, 204, 40 }, { 66, 206, 104 }, { 84, 214, 232 }, { 168, 96, 236 }, { 60, 92, 226 } }
local COLS, SHOWN = Board.COLS, Board.SHOWN

-- x, y: the top left of the field; cell: the size of a block
function View.new(board, x, y, cell, name)
  return setmetatable({ b = board, x = x, y = y, cell = cell, name = name or "", parts = {}, rings = {}, pops = {}, shake = 0, t = 0, banner = nil, flash = 0 }, View)
end

function View:bottom() return self.y + self.cell * SHOWN end
function View:width() return self.cell * COLS end

-- the centre of cell (r, c) on the screen (r may be fractional)
function View:pos(r, c)
  return self.x + (c - 0.5) * self.cell, self:bottom() - (r - 0.5) * self.cell
end

function View:burst(x, y, k)
  local col = COLOURS[k] or { 255, 255, 255 }
  for i = 1, 7 do
    local a = (i / 7) * math.pi * 2 + math.random() * 0.8
    local sp = 60 + math.random() * 90
    self.parts[#self.parts + 1] = { x = x, y = y, vx = math.cos(a) * sp, vy = math.sin(a) * sp - 40, life = 0.55 + math.random() * 0.25, age = 0, col = col, size = 8 + math.random() * 8 }
  end
  self.rings[#self.rings + 1] = { x = x, y = y, age = 0, col = col }
end

function View:float(text, x, y, col, size)
  self.pops[#self.pops + 1] = { text = text, x = x, y = y, age = 0, col = col or ui.color.white, size = size or 14 }
end

-- listens to the board's events (the scene passes them in so that it can hear them too)
function View:handle(events)
  for _, e in ipairs(events) do
    if e.type == "pop" then
      local x, y = self:pos(e.r, e.c)
      self:burst(x, y, e.k)
    elseif e.type == "match" then
      local x, y = self:pos(e.r, e.c)
      if e.chain >= 2 then
        self.banner = { text = "CHAIN " .. e.chain, age = 0, col = ui.color.gold }
        self:float("+" .. e.points, x, y - 14, ui.color.gold, 16)
      elseif e.n >= 4 then
        self.banner = { text = "COMBO " .. e.n, age = 0, col = ui.color.cyan }
        self:float("+" .. e.points, x, y - 14, ui.color.cyan, 16)
      else
        self:float("+" .. e.points, x, y - 14, ui.color.white, 13)
      end
    elseif e.type == "garbage_land" then
      if state.shake then self.shake = 0.3 end
    elseif e.type == "break" then
      local x, y = self:pos(e.r, e.c)
      self:burst(x, y, 0)
    end
  end
end

function View:update(dt)
  self.t = self.t + dt
  self.shake = math.max(0, self.shake - dt)
  for i = #self.parts, 1, -1 do
    local p = self.parts[i]
    p.age = p.age + dt
    p.vy = p.vy + 260 * dt
    p.x, p.y = p.x + p.vx * dt, p.y + p.vy * dt
    if p.age >= p.life then table.remove(self.parts, i) end
  end
  for i = #self.rings, 1, -1 do
    local r = self.rings[i]
    r.age = r.age + dt
    if r.age > 0.4 then table.remove(self.rings, i) end
  end
  for i = #self.pops, 1, -1 do
    local p = self.pops[i]
    p.age = p.age + dt
    if p.age > 0.9 then table.remove(self.pops, i) end
  end
  if self.banner then
    self.banner.age = self.banner.age + dt
    if self.banner.age > 1.3 then self.banner = nil end
  end
end

-- ---- the world layer --------------------------------------------------------------------------------------------------------

function View:draw_world(dim, cursor_colour, hide)
  if hide == "all" then return end
  local b, cell = self.b, self.cell
  local sx, sy = 0, 0
  if self.shake > 0 then sx, sy = math.sin(self.t * 90) * self.shake * 8, math.cos(self.t * 70) * self.shake * 6 end
  local x0, bottom = self.x + sx, self:bottom() + sy
  local fw, fh = self:width(), cell * SHOWN
  -- the field: a dark glass, with a lighter line down each column
  nova.rect(x0, self.y + sy, fw, fh, { 6, 10, 30, 215 })
  for c = 1, COLS - 1 do nova.rect(x0 + c * cell, self.y + sy, 1, fh, { 120, 160, 255, 26 }) end
  local danger = b:top_row() >= SHOWN - 2 and not b.static
  if danger then
    local a = math.floor(30 + 30 * math.sin(self.t * 9))
    nova.rect(x0, self.y + sy, fw, fh, { 255, 60, 70, a })
  end
  if hide then return end -- (paused: the field stays, the blocks do not, so that the pause is not a time to plan)
  local off = b.offset
  local tintc = dim and { 150, 150, 165, 255 } or { 255, 255, 255, 255 }
  -- the row that is rising in
  if b.next_row then
    local shade = math.floor(95 + 90 * off)
    for c = 1, COLS do
      local x = x0 + (c - 0.5) * cell
      local y = bottom - (0 - 0.5 + off) * cell
      nova.sprite("gem_" .. b.next_row[c], x, y, { w = cell, h = cell, color = { shade, shade, shade + 12, 255 } })
    end
  end
  local seen = {}
  for r = 1, Board.HEIGHT do
    for c = 1, COLS do
      local g = b.cells[r][c]
      if g and g.t == "gem" then
        local x = x0 + (c - 0.5 + g.vx) * cell
        local y = bottom - (r - 0.5 + g.vy + off) * cell
        local sprite, w, col = "gem_" .. g.k, cell, tintc
        if g.st == "flash" then
          if g.age >= g.pop_at then
            local left = math.max(0, (g.gone_at - g.age) / (g.gone_at - g.pop_at))
            w = cell * (0.4 + 0.7 * left)
            col = { 255, 255, 255, math.floor(255 * left) }
            sprite = "gem_" .. g.k .. "_flash"
          else
            if math.floor(g.age * 14) % 2 == 0 then sprite = "gem_" .. g.k .. "_flash" end
            w = cell * (1 + 0.04 * math.sin(g.age * 40))
          end
        elseif g.st == "hover" or g.st == "fall" then
          col = tintc
        end
        nova.sprite(sprite, x, y, { w = w, h = w, color = col })
      elseif g and g.t == "garbage" and not seen[g] then
        seen[g] = true
        self:draw_garbage(g, x0, bottom, off)
      end
    end
  end
  -- the cursor
  if cursor_colour ~= false then
    local cur = b.cursor
    local cx = x0 + cur.c * cell
    local cy = bottom - (cur.r - 0.5 + off) * cell
    local pulse = 1 + 0.035 * math.sin(self.t * 8)
    nova.sprite("cursor", cx, cy, { w = (cell * 2 + 4) * pulse, h = (cell + 4) * pulse, color = cursor_colour or { 255, 255, 255, 255 } })
  end
  -- the sparkles and rings
  for _, r in ipairs(self.rings) do
    local k = r.age / 0.4
    local size = cell * (0.8 + 1.6 * k)
    nova.sprite("ring", r.x, r.y, { w = size, h = size, color = { r.col[1], r.col[2], r.col[3], math.floor(200 * (1 - k)) } })
  end
  for _, p in ipairs(self.parts) do
    local k = 1 - p.age / p.life
    nova.sprite("bg/star_small", p.x, p.y, { w = p.size * k + 3, h = p.size * k + 3, rotation = p.age * 5, color = { p.col[1], p.col[2], p.col[3], math.floor(255 * k) } })
  end
end

function View:draw_garbage(g, x0, bottom, off)
  local cell = self.cell
  for y = g.r, g.r + g.h - 1 do
    for x = g.c, g.c + g.w - 1 do
      local px = x0 + (x - 0.5) * cell
      local py = bottom - (y - 0.5 + g.vy + off) * cell
      nova.sprite("garbage", px, py, { w = cell, h = cell })
    end
  end
  -- a bright edge round the slab so that it reads as one piece
  local left = x0 + (g.c - 1) * cell
  local top = bottom - (g.r + g.h - 1 + g.vy + off) * cell
  local w, h = g.w * cell, g.h * cell
  local light = { 200, 214, 240, 230 }
  nova.rect(left, top, w, 2, light)
  nova.rect(left, top + h - 2, w, 2, { 30, 38, 60, 230 })
  nova.rect(left, top, 2, h, light)
  nova.rect(left + w - 2, top, 2, h, { 30, 38, 60, 230 })
  if g.st == "hover" then nova.rect(left, top, w, h, { 255, 255, 255, 30 }) end
end

-- ---- the UI layer ---------------------------------------------------------------------------------------------------------

-- the frame, the two masks (what rises above the top or comes from below the bottom is hidden behind them) and the floating text
function View:draw_ui(title, incoming, meter, hide)
  if hide == "all" then return end
  local cell = self.cell
  local x0, y0, fw = self.x, self.y, self:width()
  local bottom = self:bottom()
  -- the masks: opaque, dark navy (the glass frame goes over them)
  nova.ui.rect(x0 - 8, y0 - cell, fw + 16, cell, { 10, 16, 44, 255 })
  nova.ui.rect(x0 - 8, bottom, fw + 16, cell + 2, { 10, 16, 44, 255 })
  -- the sides
  nova.ui.rect(x0 - 5, y0, 3, bottom - y0, { 96, 220, 255, 190 })
  nova.ui.rect(x0 + fw + 2, y0, 3, bottom - y0, { 96, 220, 255, 190 })
  nova.ui.rect(x0 - 8, y0 - 3, fw + 16, 3, { 96, 220, 255, 230 })
  nova.ui.rect(x0 - 8, bottom, fw + 16, 3, { 96, 220, 255, 230 })
  -- the title and the garbage that is coming
  if title then ui.text(x0 + 4, y0 - cell + math.floor((cell - 12) / 2), title, 12, ui.color.cyan) end
  if meter then
    -- the bottom bar shows how fast the stack is rising
    local by = bottom + 9
    ui.text(x0 + 4, by, "SPEED", 11, ui.color.dim)
    local bx, bw = x0 + 64, fw - 72
    nova.ui.rect(bx, by + 1, bw, 9, { 30, 44, 96, 255 })
    nova.ui.rect(bx, by + 1, bw * math.max(0.04, math.min(1, meter)), 9, meter > 0.7 and { 255, 96, 110, 255 } or { 96, 220, 255, 255 })
  end
  if incoming and #incoming > 0 then
    local x = x0 + fw
    for i = #incoming, 1, -1 do
      local p = incoming[i]
      local w = 5 + p.w * 3
      x = x - w - 3
      nova.ui.rect(x, y0 - cell + 8, w, 6 + p.h * 3, { 150, 164, 196, 255 })
      if x < x0 + 60 then break end
    end
  end
  if hide then return end
  -- floating text
  for _, p in ipairs(self.pops) do
    local k = p.age / 0.9
    local a = math.floor(255 * (1 - k * k))
    ui.text(p.x - ui.width(p.text, p.size) / 2, p.y - 40 * k, p.text, p.size, { p.col[1], p.col[2], p.col[3], a })
  end
  if self.banner then
    local k = self.banner.age / 1.3
    local pop = 1 + 0.4 * math.max(0, 1 - self.banner.age / 0.15)
    local size = math.floor(20 * pop)
    local a = math.floor(255 * math.min(1, (1 - k) * 3))
    local c = self.banner.col
    ui.text(x0 + fw / 2 - ui.width(self.banner.text, size) / 2, y0 + 20 - 14 * k, self.banner.text, size, { c[1], c[2], c[3], a })
  end
end

return View

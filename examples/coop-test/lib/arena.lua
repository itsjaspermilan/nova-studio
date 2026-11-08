-- The rules of Coop Test: up to four players run around an arena (scenes/arena.scene.json), dash into each other, and
-- race to collect stars. A pure step: `A.step(game, dt, read)` takes each player's input through `read(n)` and returns what
-- happened, so the same rules run on one device (local players) or on a host (players on other devices too).
local A = {}

local SIZE, SPEED, DASH_SPEED, DASH_TIME, DASH_COOL = 28, 260, 760, 0.16, 0.55
A.SIZE = SIZE
A.COLORS = { { 255, 112, 96 }, { 72, 214, 200 }, { 255, 206, 72 }, { 176, 132, 255 } }

local level

-- The arena from its scene file: walls, where each player starts, where stars appear, and the score to win.
function A.level()
  if level then return level end
  local data = nova.scene_data("arena")
  level = { walls = {}, spawns = {}, spots = {}, w = 960, h = 540, goal = 10 }
  for _, o in ipairs(data.objects) do
    local p = o.props or {}
    if o.kind == "wall" then
      level.walls[#level.walls + 1] = { x = o.x, y = o.y, w = p.w, h = p.h }
    elseif o.kind == "spawn" then
      level.spawns[p.player] = { x = o.x, y = o.y }
    elseif o.kind == "star" then
      level.spots[#level.spots + 1] = { x = o.x, y = o.y }
    elseif o.kind == "arena" then
      level.w, level.h, level.goal = p.w or 960, p.h or 540, p.goal or 10
    end
  end
  return level
end

function A.new()
  local g = { players = {}, star = 1, time = 0, winner = nil }
  return g
end

-- A player arrives (or comes back: the score is kept).
function A.join(g, n, name)
  local p = g.players[n]
  if p then
    p.here, p.name = true, name or p.name
    return p
  end
  local s = A.level().spawns[n] or { x = 480, y = 270 }
  p = { n = n, x = s.x, y = s.y, vx = 0, vy = 0, score = 0, dash = 0, cool = 0, here = true, name = name or ("Player " .. n) }
  g.players[n] = p
  return p
end

function A.leave(g, n)
  if g.players[n] then g.players[n].here = false end
end

local function overlaps(ax, ay, aw, ah, b)
  return ax < b.x + b.w and ax + aw > b.x and ay < b.y + b.h and ay + ah > b.y
end

-- moves a box through the walls one axis at a time
local function move(p, dx, dy)
  local half = SIZE / 2
  p.x = p.x + dx
  for _, w in ipairs(A.level().walls) do
    if overlaps(p.x - half, p.y - half, SIZE, SIZE, w) then
      p.x = dx > 0 and w.x - half or w.x + w.w + half
    end
  end
  p.y = p.y + dy
  for _, w in ipairs(A.level().walls) do
    if overlaps(p.x - half, p.y - half, SIZE, SIZE, w) then
      p.y = dy > 0 and w.y - half or w.y + w.h + half
    end
  end
end

-- One step. `read(n)` gives player n's input: { x, y (-1 to 1), dash (pressed this step) }. Returns events:
-- { kind = "star" | "bump" | "win", player, other }.
function A.step(g, dt, read)
  local events = {}
  if g.winner then return events end
  g.time = g.time + dt
  local L = A.level()
  for n, p in pairs(g.players) do
    if p.here then
      local i = read(n)
      p.cool = math.max(0, p.cool - dt)
      p.dash = math.max(0, p.dash - dt)
      local len = math.sqrt(i.x * i.x + i.y * i.y)
      if len > 1 then i.x, i.y = i.x / len, i.y / len end
      if i.dash and p.cool == 0 and len > 0.2 then
        p.dash, p.cool = DASH_TIME, DASH_COOL
        p.dx, p.dy = i.x / math.max(len, 0.0001), i.y / math.max(len, 0.0001)
      end
      if p.dash > 0 then
        move(p, p.dx * DASH_SPEED * dt, p.dy * DASH_SPEED * dt)
      else
        move(p, i.x * SPEED * dt, i.y * SPEED * dt)
      end
    end
  end
  -- a dash into another player knocks them away
  for n, p in pairs(g.players) do
    if p.here and p.dash > 0 then
      for m, q in pairs(g.players) do
        if m ~= n and q.here and math.abs(p.x - q.x) < SIZE and math.abs(p.y - q.y) < SIZE then
          move(q, p.dx * 70, p.dy * 70)
          p.dash = 0
          events[#events + 1] = { kind = "bump", player = n, other = m }
        end
      end
    end
  end
  local star = L.spots[g.star]
  for n, p in pairs(g.players) do
    if p.here and math.abs(p.x - star.x) < 26 and math.abs(p.y - star.y) < 26 then
      p.score = p.score + 1
      events[#events + 1] = { kind = "star", player = n }
      local next = g.star
      while next == g.star do next = math.random(#L.spots) end
      g.star = next
      if p.score >= L.goal then
        g.winner = n
        events[#events + 1] = { kind = "win", player = n }
      end
      break
    end
  end
  return events
end

local function round(v) return math.floor(v * 10 + 0.5) / 10 end

-- What a joined device needs to draw the game: a list (not a table keyed by player numbers: lists travel as lists).
function A.snapshot(g)
  local list = {}
  for n = 1, 4 do
    local p = g.players[n]
    if p then
      list[#list + 1] = { n = n, x = round(p.x), y = round(p.y), s = p.score, d = p.dash > 0, h = p.here, name = p.name }
    end
  end
  local star = A.level().spots[g.star]
  return { p = list, star = { star.x, star.y }, w = g.winner, goal = A.level().goal }
end

-- Draws a snapshot (the host draws its own, so both devices show the same picture).
function A.draw(s, me)
  local L = A.level()
  local ui = nova.ui
  for _, w in ipairs(L.walls) do ui.rect(w.x, w.y, w.w, w.h, { 70, 78, 110 }) end
  local t = nova.time()
  local pulse = 4 + 2 * math.sin(t * 6)
  ui.rect(s.star[1] - 10 - pulse / 2, s.star[2] - 10 - pulse / 2, 20 + pulse, 20 + pulse, { 255, 236, 120 })
  ui.rect(s.star[1] - 5, s.star[2] - 5, 10, 10, { 255, 255, 230 })
  for _, p in ipairs(s.p) do
    local c = A.COLORS[p.n]
    local alpha = p.h and 255 or 90
    local half = SIZE / 2
    if p.n == me then ui.rect(p.x - half - 4, p.y - half - 4, SIZE + 8, SIZE + 8, { 255, 255, 255, alpha }) end
    ui.rect(p.x - half, p.y - half, SIZE, SIZE, { c[1], c[2], c[3], alpha })
    if p.d then ui.rect(p.x - half + 6, p.y - half + 6, SIZE - 12, SIZE - 12, { 255, 255, 255, alpha }) end
    ui.text(p.x, p.y - half - 22, "P" .. p.n, { size = 16, align = "center", color = { 255, 255, 255, alpha } })
  end
  -- scores along the top
  local x = 40
  for _, p in ipairs(s.p) do
    local c = A.COLORS[p.n]
    local label = string.format("%s  %d/%d%s", p.name, p.s, s.goal, p.h and "" or "  (away)")
    local w = ui.text(x, 30, label, { size = 18, color = c, shadow = true })
    x = x + w + 36
  end
end

return A

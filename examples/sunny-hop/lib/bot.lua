-- The computer player (F9 on the title: it plays every level in turn, finds every gem and logs how it went; the self-test's proof that each
-- level can be finished). It plays through the same controls as a person, with no shortcuts:
--  1. a route: a search over the level's cells for where the hero's body fits, with jumps limited to what the hero can do (up to four tiles above
--     what it stands on, nine over a spring, four across in the air; ladders climb), from the hero to the next target (a gem, a key, a switch,
--     the boss, the goal);
--  2. the next few tenths of a second: from where the hero is, it tries the stick and the jump button in short pieces, moving a copy of the hero
--     with the game's own step (lib/hero.lua) and the enemies where they say they will be, and keeps the tries that get furthest along the route
--     without getting hurt (a beam search). It takes the first piece of the best one and thinks again a few frames later.
local world = require("lib.world")
local hero = require("lib.hero")
local run = require("lib.run")
local audio = require("lib.audio")
local fx = require("lib.fx")

local bot = { active = false, all = false, log = {}, debug = false }

local T = world.T
local SOLID, ONEWAY, LADDER, HAZARD, LIQUID = world.SOLID, world.ONEWAY, world.LADDER, world.HAZARD, world.LIQUID
local MACRO, DEPTH, WIDTH = 6, 6, 22
local JUMP_UP, SPRING_UP, AIR = 4, 10, 4

function bot.start_all()
  bot.active, bot.all, bot.log = true, true, {}
  audio.muted, fx.calm = true, true
  nova.music.volume(0)
end
function bot.start_one()
  bot.active, bot.all = true, false
end
function bot.stop()
  bot.active, bot.all = false, false
  audio.muted, fx.calm = false, false
end

-- ---- the level's cells ---------------------------------------------------------------------------------------------------------------
local cols, rows
local function box_solid(c, r, oneway_too)
  local x0, y0, x1, y1 = c * T + 1, r * T + 1, (c + 1) * T - 1, (r + 1) * T - 1
  for _, b in ipairs(world.boxes) do
    if not b.off and (oneway_too or not b.oneway) and not b.path and x0 < b.x1 and x1 > b.x0 and y0 < b.y1 and y1 > b.y0 then return true end
  end
  return false
end
local function blocked(c, r)
  if c < 0 or c >= cols then return true end
  if r < 0 then return false end
  if r >= rows then return false end
  return world.flags(c, r) & SOLID ~= 0 or box_solid(c, r)
end
local function deadly(c, r)
  if r < 0 or r >= rows then return r >= rows end
  return world.flags(c, r) & (HAZARD | LIQUID) ~= 0
end
-- the hero's body fits with its feet in cell (c, r): that cell and the one above are free
local function fits(c, r) return r < rows and not blocked(c, r) and not blocked(c, r - 1) and not deadly(c, r) and not deadly(c, r - 1) end

local support, height, springy, platformy
local function build_cells()
  cols, rows = world.cols, world.rows
  support, height, springy, platformy = {}, {}, {}, {}
  -- moving platforms: every cell their tops pass through is something to stand on
  for _, b in ipairs(world.movers) do
    for k = 0, 23 do
      local x0, y0 = b.path(k / 24 * (b.owner.period or 5))
      local r = math.floor((y0 - 1) / T)
      for c = math.floor(x0 / T), math.floor((x0 + (b.x1 - b.x0) - 1) / T) do platformy[r * cols + c] = true end
    end
  end
  for c = 0, cols - 1 do
    for r = 0, rows - 1 do
      local below = world.flags(c, r + 1)
      local s = (below & (SOLID | ONEWAY | LADDER) ~= 0) or world.flags(c, r) & LADDER ~= 0 or box_solid(c, r + 1, true) or platformy[r * cols + c]
      support[r * cols + c] = s
    end
    -- how far above something to stand on each cell is (rows), counted from below
    local h = 99
    for r = rows - 1, 0, -1 do
      if support[r * cols + c] then h = 0 elseif blocked(c, r) then h = 99 else h = h + 1 end
      height[r * cols + c] = h
    end
  end
  for _, s in ipairs(world.springs) do
    local sc, sr = math.floor((s.x0 + s.x1) / 2 / T), math.floor(s.y1 / T)
    for dc = -1, 1 do
      for k = 0, SPRING_UP do
        local c, r = sc + dc, sr - k
        if c >= 0 and c < cols and r >= 0 then springy[r * cols + c] = true end
      end
    end
  end
end

-- the route: breadth-first over (cell, air steps across) from the hero to every cell
local dist, prev
local function route_from(c0, r0)
  dist, prev = {}, {}
  local K = AIR + 1
  local function key(c, r, k) return ((r + 2) * cols + c) * K + k end
  local q, head = {}, 1
  local start = key(c0, r0, 0)
  dist[start] = 0
  q[1] = { c0, r0, 0 }
  while head <= #q do
    local s = q[head]; head = head + 1
    local c, r, k = s[1], s[2], s[3]
    local d = dist[key(c, r, k)]
    local function go(nc, nr, nk)
      if nr < -1 or nr >= rows or nc < 0 or nc >= cols then return end
      if not fits(nc, nr) then return end
      local id = key(nc, nr, nk)
      if dist[id] then return end
      dist[id] = d + 1
      prev[id] = key(c, r, k)
      q[#q + 1] = { nc, nr, nk }
    end
    local sup = r >= 0 and support[r * cols + c]
    local ladder = r >= 0 and world.flags(c, r) & LADDER ~= 0
    for dc = -1, 1, 2 do
      local nc = c + dc
      local nsup = r >= 0 and nc >= 0 and nc < cols and support[r * cols + nc]
      local nk = nsup and 0 or (sup and 1 or k + 1)
      if nk <= AIR then go(nc, r, nk) end
    end
    -- up: by a ladder, a jump or a spring
    if r - 1 >= -1 then
      local up_ok = ladder or (r - 1 >= 0 and world.flags(c, r - 1) & LADDER ~= 0)
      if not up_ok and r - 1 >= 0 then
        local h = height[(r - 1) * cols + c]
        up_ok = h <= JUMP_UP or (springy[(r - 1) * cols + c] and h <= SPRING_UP)
        -- (a jump starts from something to stand on: rising further than JUMP_UP over a pit is not possible)
        if up_ok and k > 0 and h > JUMP_UP then up_ok = false end
      end
      if up_ok then go(c, r - 1, (sup or ladder) and 0 or k) end
    end
    go(c, r + 1, k)
  end
  return function(c, r)
    local best, bk
    for k = 0, AIR do local v = dist[key(c, r, k)]; if v and (not best or v < best) then best, bk = v, k end end
    return best, bk and key(c, r, bk)
  end, function(id)
    -- the path back from a cell to the start, as a list of { c, r } from the start
    local out = {}
    while id do
      local k = id % K
      local cell = (id - k) // K
      local c = cell % cols
      local r = cell // cols - 2
      table.insert(out, 1, { c, r })
      id = prev[id]
    end
    return out
  end
end

-- ---- targets -------------------------------------------------------------------------------------------------------------------------
local function targets()
  local out = {}
  local boss = run.boss
  if boss and boss:is_alive() and not boss.dead then
    out[#out + 1] = { kind = "boss", e = boss, x = boss.x, y = boss.y - boss.bh - 4, prio = 0 }
    return out
  end
  for _, g in ipairs(nova.all("gem")) do out[#out + 1] = { kind = "gem", e = g, x = g.x, y = g.y, prio = 1 } end
  for _, k in ipairs(nova.all("key")) do out[#out + 1] = { kind = "key", e = k, x = k.x, y = k.y, prio = 2 } end
  for _, s in ipairs(nova.all("switch")) do
    if not s.pressed then out[#out + 1] = { kind = "switch", e = s, x = s.x, y = s.y - 10, prio = 2 } end
  end
  for _, l in ipairs(nova.all("lock")) do
    if l.opening < 0 and run.keys[l.color] then out[#out + 1] = { kind = "lock", e = l, x = l.x, y = l.y, prio = 2 } end
  end
  -- gems inside ? blocks: stand under and bump
  for _, q in ipairs(nova.all("qblock")) do
    if q.gives == "gem" and not q.used then out[#out + 1] = { kind = "block", e = q, x = q.x, y = q.y + 64, prio = 1 } end
  end
  local goal = nova.first("goal")
  if goal and goal:ready() then out[#out + 1] = { kind = "goal", e = goal, x = goal.x, y = goal.y - 40, prio = 3 } end
  return out
end

local function done(tg)
  if tg.kind == "boss" then return not tg.e:is_alive() or tg.e.dead end
  if tg.kind == "block" then return tg.e.used end
  if tg.kind == "switch" then return tg.e.pressed end
  if tg.kind == "lock" then return not tg.e:is_alive() or tg.e.opening >= 0 end
  if tg.kind == "goal" then return run.finished end
  return not tg.e:is_alive()
end

-- ---- the look-ahead ------------------------------------------------------------------------------------------------------------------
local ACTIONS = {
  { x = 1, j = true }, { x = 1, j = false }, { x = -1, j = true }, { x = -1, j = false }, { x = 0, j = true }, { x = 0, j = false },
}
local CLIMB = { { x = 0, y = -1, j = false }, { x = 0, y = 1, j = false } }
local sim_inp = { x = 0, y = 0, jump = false, jump_pressed = false }

local foes = {}
local function gather_foes(hx, hy)
  for i = #foes, 1, -1 do foes[i] = nil end
  for _, e in ipairs(nova.all("enemy")) do
    if not e.dead and math.abs(e.x - hx) < 700 and math.abs(e.y - hy) < 600 then foes[#foes + 1] = e end
  end
end

-- move a copy of the hero for one piece (MACRO frames) of an action; returns false if it would be hurt
local function simulate(st, act, t0)
  local b = st.b
  local dt = 1 / 60
  for f = 1, MACRO do
    local t = t0 + (st.frames + f) * dt
    world.set_time(t)
    sim_inp.x, sim_inp.y = act.x, act.y or 0
    sim_inp.jump = act.j
    sim_inp.jump_pressed = act.j and not st.held
    st.held = act.j
    local prev_y = b.y
    hero.step(b, sim_inp, dt)
    for i = 1, b.nev do
      local n = b.ev[i].name
      if n == "hurt" or n == "drown" or n == "fall" then return false end
      if n == "bump" and bot.target and bot.target.kind == "block" and b.ev[i].a and b.ev[i].a.owner == bot.target.e then st.bumped = true end
    end
    -- enemies, where they will be
    if (f % 2 == 0 or f == MACRO) and #foes > 0 then
      local hw = b.w * 0.5
      local lead = (st.frames + f) * dt
      for i, e in ipairs(foes) do
        if st.killed & (1 << i) == 0 then
          local ex, ey = e:predict(lead)
          if ex then
            local ehw = e.bw * 0.5 + 4
            if b.x + hw > ex - ehw and b.x - hw < ex + ehw and b.y > ey - e.bh - 4 and b.y - b.h < ey + 4 then
              local from_above = b.vy >= 0 and prev_y <= ey - e.bh + 22
              if from_above and (e.stompable or e.bounce_top) then
                b.vy = -(act.j and hero.H.stomp_hold or hero.H.stomp)
                b.rising, b.ground = act.j, false
                st.killed = st.killed | (1 << i)
                if e.boss and e.vulnerable and e:vulnerable() then st.boss_hits = st.boss_hits + 1 end
                if e.stompable then st.stomps = st.stomps + 1 end
              elseif not (e.harmless and e:harmless()) then
                return false
              end
            end
          end
        end
      end
    end
  end
  st.frames = st.frames + MACRO
  return true
end

local function score(st, path, index_of, tg)
  local b = st.b
  local c, r = math.floor(b.x / T), math.floor((b.y - 1) / T)
  local s
  local hw = b.w * 0.5
  if st.bumped then return 1e6 - st.frames end
  if tg and tg.kind ~= "block" and math.abs(tg.x - b.x) < hw + 22 and tg.y > b.y - b.h - 20 and tg.y < b.y + 20 then return 1e6 - st.frames end
  local idx = index_of[r * cols + c] or index_of[(r - 1) * cols + c] or index_of[(r + 1) * cols + c]
  if idx then
    s = idx * 10
  else
    -- off the route: how near the nearest route cell is
    local best = 1e9
    for i = 1, #path, 2 do
      local p = path[i]
      local d = math.abs(p[1] - c) + math.abs(p[2] - r)
      if d < best then best = d; s = i * 10 - d * 14 end
    end
    s = s or -1e5
  end
  if b.ground then s = s + 3 end
  s = s + st.boss_hits * 5000 + st.stomps * 2
  -- near the target, closer is better
  if tg then s = s - math.min(200, (math.abs(tg.x - b.x) + math.abs(tg.y - (b.y - 30))) / 24) end
  return s
end

local saved = {}
local function think(h)
  local b = h.b
  local t0 = world.t
  -- (the look-ahead moves the platforms; put them back exactly as they were, how far they last moved included)
  for i, m in ipairs(world.movers) do
    local s = saved[i] or {}
    s[1], s[2], s[3], s[4], s[5], s[6] = m.x0, m.y0, m.x1, m.y1, m.dx, m.dy
    saved[i] = s
  end
  gather_foes(b.x, b.y)
  local beam = { { b = hero.copy(b), held = bot.held, frames = 0, first = nil, killed = 0, stomps = 0, boss_hits = 0 } }
  local best, best_s = nil, -1e18
  local near_ladder = world.area_flags(b.x - 30, b.y - b.h - 30, b.x + 30, b.y + 30) & LADDER ~= 0
  for depth = 1, DEPTH do
    local next_beam, seen = {}, {}
    for _, st in ipairs(beam) do
      local acts = ACTIONS
      for pass = 1, near_ladder and 2 or 1 do
        if pass == 2 then acts = CLIMB end
        for _, act in ipairs(acts) do
          local ns = { b = hero.copy(st.b), held = st.held, frames = st.frames, first = st.first or act, killed = st.killed, stomps = st.stomps, boss_hits = st.boss_hits, bumped = st.bumped }
          if simulate(ns, act, t0) then
            local key = math.floor(ns.b.x / 10) .. ":" .. math.floor(ns.b.y / 10) .. ":" .. (ns.b.ground and 1 or 0) .. ":" .. math.floor(ns.b.vy / 200) .. ":" .. ns.killed .. (ns.held and "h" or "")
            if not seen[key] then
              seen[key] = true
              ns.s = score(ns, bot.path, bot.index_of, bot.target)
              next_beam[#next_beam + 1] = ns
              if ns.s > best_s then best, best_s = ns, ns.s end
            end
          end
        end
      end
    end
    table.sort(next_beam, function(a, c) return a.s > c.s end)
    for i = WIDTH + 1, #next_beam do next_beam[i] = nil end
    beam = next_beam
    if #beam == 0 or best_s >= 1e5 then break end
  end
  world.t = t0
  for i, m in ipairs(world.movers) do
    local s = saved[i]
    m.x0, m.y0, m.x1, m.y1, m.dx, m.dy = s[1], s[2], s[3], s[4], s[5], s[6]
  end
  return best and best.first or { x = 0, j = false }, best_s
end

-- ---- driving --------------------------------------------------------------------------------------------------------------------------
local inp = { x = 0, y = 0, jump = false, jump_pressed = false }

function bot.begin(play, lv)
  bot.level = lv
  bot.play = play
  build_cells()
  bot.target, bot.path, bot.index_of = nil, {}, {}
  bot.act, bot.left, bot.held = { x = 0, j = false }, 0, false
  bot.best_progress, bot.stuck, bot.replan = -1e18, 0, 0
  bot.given_up = {}
  bot.t = 0
  play.hero.control = function(h) return bot.control(h) end
end

local function choose_target(h)
  local b = h.b
  local c0, r0 = math.floor(b.x / T), math.floor((b.y - 1) / T)
  if not fits(c0, r0) then r0 = r0 - 1 end
  build_cells()
  local cost, path_of = route_from(c0, r0)
  local best, best_d, best_id
  local list = targets()
  local goal
  for _, tg in ipairs(list) do
    if not bot.given_up[tg.e] then
      local tc, tr = math.floor(tg.x / T), math.floor(tg.y / T)
      -- the body reaches a target in its own cell or the one above or below it
      local d, id
      for _, dr in ipairs({ 0, 1, -1, 2 }) do
        for _, dc in ipairs({ 0, -1, 1 }) do
          local dd, ii = cost(tc + dc, tr + dr)
          if dd and (not d or dd < d) then d, id = dd, ii end
        end
      end
      if d then
        if tg.kind == "goal" then goal = { tg, d, id }
        else
          local v = d + tg.prio * 4
          if not best_d or v < best_d then best, best_d, best_id = tg, v, id end
        end
      end
    end
  end
  if not best and goal then best, best_id = goal[1], goal[3] end
  bot.target = best
  bot.path = best_id and path_of(best_id) or {}
  bot.index_of = {}
  for i, p in ipairs(bot.path) do bot.index_of[p[2] * cols + p[1]] = i end
  bot.best_progress, bot.stuck = -1e18, 0
end

function bot.update(play, dt)
  bot.t = bot.t + dt
end

function bot.control(h)
  bot.replan = bot.replan - 1
  if not bot.target or done(bot.target) or bot.replan_route then
    bot.replan_route = false
    choose_target(h)
    bot.left = 0
  end
  if bot.left <= 0 then
    local act, s = think(h)
    bot.act, bot.left = act, MACRO
    if bot.debug then nova.log(string.format("BOT x=%.0f y=%.0f tg=%s path=%d s=%.1f act=%d,%s stuck=%d", h.b.x, h.b.y, bot.target and bot.target.kind or "-", #bot.path, s, act.x, tostring(act.j), bot.stuck)) end
    if s > bot.best_progress + 5 then bot.best_progress, bot.stuck = s, 0 else bot.stuck = bot.stuck + MACRO end
    -- no headway for a while: look again (the world may have changed); for longer, give the target up
    if bot.stuck > 60 * 4 then bot.replan_route = true; bot.stuck_total = (bot.stuck_total or 0) + 1 end
    if (bot.stuck_total or 0) >= 5 and bot.target then
      nova.log("sunny: bot gave up on a " .. bot.target.kind .. " in " .. bot.level.id .. " at " .. math.floor(bot.target.x) .. "," .. math.floor(bot.target.y))
      bot.given_up[bot.target.e] = true
      bot.stuck_total = 0
      bot.target = nil
    end
  end
  bot.left = bot.left - 1
  local a = bot.act
  inp.x, inp.y = a.x, a.y or 0
  inp.jump_pressed = a.j and not bot.held
  inp.jump = a.j
  bot.held = a.j
  return inp
end

function bot.died(play, kind)
  bot.deaths = (bot.deaths or 0) + 1
  nova.log("sunny: bot fell (" .. tostring(kind) .. ") in " .. bot.level.id .. " near x=" .. math.floor(play.hero.x))
  bot.target = nil
end

-- the level is finished: log it, and go on to the next one when playing them all
function bot.finished(play, lv)
  local gems = 0
  for i = 1, 3 do if run.gems[i] then gems = gems + 1 end end
  local line = string.format("sunny: bot %s done time=%.2f gems=%d/3 deaths=%d", lv.id, run.time, gems, run.deaths)
  nova.log(line)
  bot.log[#bot.log + 1] = { id = lv.id, time = run.time, gems = gems, deaths = run.deaths }
  if bot.all then
    local levels = require("lib.levels")
    local nxt = levels.next(lv)
    play:after(0.5, function()
      if nxt then
        nova.goto_scene("play", nxt.id, "normal")
      else
        local all_gems = 0
        for _, r in ipairs(bot.log) do if r.gems == 3 then all_gems = all_gems + 1 end end
        nova.log(string.format("sunny: bot finished all %d levels, every gem in %d", #bot.log, all_gems))
        bot.stop()
        nova.goto_scene("title")
      end
    end)
  end
end

return bot

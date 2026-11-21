//! What a scripted headless run (`nova run --headless --play plan.json`, see `crate::playtest`) asks of a game from
//! outside: start in a named scene, run a piece of Lua once, read a value, and say what is on screen.

use mlua::{Function, Table, Value as LuaValue};
use serde_json::Value;

use super::{Game, debug_api};

/// Helpers the run uses, loaded once: `show(expr)` gives the value of a Lua expression as short text, `truth(expr)`
/// whether it holds, `scene(name)` makes the framework start in a scene, `snapshot()` lists what is alive.
const HELPERS: &str = r#"
local loaded = ...
local H = {}

local function class_name(cls)
  local seen = 0
  while type(cls) == "table" and seen < 8 do
    for name, value in pairs(loaded) do
      if value == cls then return (name:gsub("^entities%.", ""):gsub("^scenes%.", "")) end
    end
    cls = rawget(cls, "__parent")
    seen = seen + 1
  end
  return nil
end

local function num(v)
  if v == math.floor(v) and math.abs(v) < 1e15 then return string.format("%d", v) end
  return (string.format("%.3f", v):gsub("0+$", ""):gsub("%.$", ""))
end

-- An entity of a 3D game: it draws a model, or stands somewhere off the z = 0 plane.
local function three_d(e)
  local z = e.z
  return (rawget(e, "model") or (getmetatable(e) or {}).__model) ~= nil or (type(z) == "number" and z ~= 0)
end

local function show(v, depth)
  local t = type(v)
  if t == "number" then return num(v) end
  if t == "string" then return depth > 0 and string.format("%q", v) or v end
  if t ~= "table" then return tostring(v) end
  if rawget(getmetatable(v) or {}, "__kind") == "entity" then
    return "<" .. (class_name(getmetatable(v)) or "entity") .. " at " .. num(v.x or 0) .. ", " .. num(v.y or 0) .. (three_d(v) and (", " .. num(v.z or 0)) or "") .. (rawget(v, "_dead") and " (destroyed)" or "") .. ">"
  end
  if depth >= 2 then return "{...}" end
  local parts, n = {}, 0
  for i = 1, #v do
    n = n + 1
    if n > 12 then parts[#parts + 1] = "..."; break end
    parts[#parts + 1] = show(v[i], depth + 1)
  end
  local keys = {}
  for k in pairs(v) do
    if not (type(k) == "number" and k >= 1 and k <= #v and k == math.floor(k)) and not (type(k) == "string" and k:sub(1, 1) == "_") then keys[#keys + 1] = k end
  end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  for _, k in ipairs(keys) do
    n = n + 1
    if n > 16 then parts[#parts + 1] = "..."; break end
    local value = v[k]
    if type(value) ~= "function" then parts[#parts + 1] = tostring(k) .. " = " .. show(value, depth + 1) end
  end
  return "{ " .. table.concat(parts, ", ") .. " }"
end

local function compile(expr)
  local f, err = load("return " .. expr, "=expression")
  if not f then f, err = load(expr, "=expression") end
  if not f then error(err, 0) end
  return f
end

function H.show(expr)
  local results = table.pack(compile(expr)())
  if results.n == 0 then return "nil" end
  local out = {}
  for i = 1, results.n do out[i] = show(results[i], 0) end
  return table.concat(out, ", ")
end

function H.truth(expr)
  return compile(expr)() and true or false
end

function H.scene(name)
  local W = nova.world
  if not (W and W.started) then error("this project does not call nova.start, so it has no scenes to start in", 0) end
  W.pending = { name = name, args = { n = 0 } }
end

function H.snapshot()
  local W = nova.world
  local out = { entities = {} }
  if not (W and W.started) then return out end
  out.scene = W.scene_name and (W.scene_name:gsub("^scenes%.", "")) or nil
  out.camera = { W.cam.x, W.cam.y }
  local vw, vh = nova.view()
  out.view = { vw, vh }
  out.count = #W.list
  local labels = {}
  if W.scene then
    for k, v in pairs(W.scene) do
      if type(k) == "string" and type(v) == "table" and labels[v] == nil then labels[v] = k end
    end
  end
  for _, e in ipairs(W.list) do
    if not rawget(e, "_dead") then
      local cls = getmetatable(e) or {}
      local kind = class_name(cls) or (cls == nova.Picture and "picture") or (cls == nova.Text and "text") or (rawget(e, "map") and "tilemap") or "entity"
      if kind ~= "tilemap" and kind ~= "picture" and kind ~= "text" or labels[e] then
        local item = { kind = kind, name = labels[e], id = rawget(e, "id"), x = e.x, y = e.y }
        if three_d(e) then item.z = e.z or 0 end
        local a = rawget(e, "_anim")
        if a then item.anim = a.tag end
        if type(e.frame) == "number" and e.frame ~= 0 then item.frame = e.frame end
        if e.visible == false then item.hidden = true end
        if type(e.x) == "number" and type(e.y) == "number" then out.entities[#out.entities + 1] = item end
        if #out.entities >= 400 then break end
      end
    end
  end
  return out
end

-- ---------------------------------------------------------------- walking: who, where to, and the way round what is solid
local W = nova.world

local function ground(e, plane)
  if plane == "xz" then return e.x, e.z end
  return e.x, e.y
end

-- An entity's box in the plane (a point when it has no hitbox or sprite, or when hitboxes are measured in another plane).
local function box(e, plane)
  if plane == "xy" or W.xz then
    local ok, x0, y0, x1, y1 = pcall(e.bounds, e)
    if ok and x0 then return x0, y0, x1, y1 end
  end
  local a, b = ground(e, plane)
  return a, b, a, b
end

-- How far apart two boxes are: 0 when their edges meet, and below 0 (by how deep) when they overlap.
local function gap_of(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1)
  local dx = math.max(bx0 - ax1, ax0 - bx1)
  local dy = math.max(by0 - ay1, ay0 - by1)
  if dx < 0 and dy < 0 then return math.max(dx, dy) end
  dx, dy = math.max(dx, 0), math.max(dy, 0)
  return math.sqrt(dx * dx + dy * dy)
end

local function label_of(e)
  return rawget(e, "name") or class_name(getmetatable(e)) or "entity"
end

local function find_walker(who)
  if not (W and W.started) then error("this project does not call nova.start, so it has no entities to walk", 0) end
  local e
  if who then
    e = nova.named(who) or nova.first(who)
    if not e then error("there is no entity named or tagged '" .. tostring(who) .. "' in this scene (\"who\" is a scene object's name or a tag)", 0) end
  else
    e = nova.named("hero") or nova.named("player") or nova.first("hero") or nova.first("player") or W.cam.follow
    who = e and (rawget(e, "name") or class_name(getmetatable(e)) or "the camera's target")
    if not e then error("say who walks: \"who\" is a scene object's name or a tag (nothing here is named or tagged hero or player, and the 2D camera follows nothing)", 0) end
  end
  if rawget(e, "_dead") then error("'" .. tostring(who) .. "' has been destroyed", 0) end
  return e, tostring(who)
end

-- Who a walk_to step steers and where it is: x and the other ground coordinate (y in a flat game, z in a 3D one).
function H.walker(who, plane)
  local e, label = find_walker(who)
  plane = plane or (three_d(e) and "xz" or "xy")
  local a, b = ground(e, plane)
  if type(a) ~= "number" or type(b) ~= "number" then error("'" .. label .. "' has no position", 0) end
  -- (the turn of the 3D camera: a stick that is relative to it turns with it)
  local yaw = plane == "xz" and nova.cam3 and nova.cam3.yaw or 0
  return a, b, plane, label, type(yaw) == "number" and yaw or 0
end

-- The living entity with this name, or the nearest one with this tag (and how many there are).
local function find_target(name, from, plane)
  local e = nova.named(name)
  if e and not rawget(e, "_dead") and e ~= from then return e, 1 end
  local best, bd, n = nil, nil, 0
  local fx, fy = ground(from, plane)
  local function try(o)
    if o ~= from and not rawget(o, "_dead") then
      n = n + 1
      local x, y = ground(o, plane)
      local d = (x - fx) ^ 2 + (y - fy) ^ 2
      if not bd or d < bd then best, bd = o, d end
    end
  end
  local list = W.tags[name]
  if list and #list > 0 then
    for i = 1, #list do try(list[i]) end
  else
    -- (not a name, not a tag: the kind, as the scene file and entities/<kind>.lua say it)
    for _, o in ipairs(W.list) do
      if class_name(getmetatable(o)) == name then try(o) end
    end
  end
  return best, n
end

local function names_here()
  local names, tags = {}, {}
  if W.scene then
    for k, v in pairs(W.scene) do
      if type(k) == "string" and type(v) == "table" and rawget(getmetatable(v) or {}, "__kind") ~= nil and #names < 16 then names[#names + 1] = k end
    end
  end
  for tag, list in pairs(W.tags) do
    if #list > 0 and tag ~= "nova_tilemap" and #tags < 16 then tags[#tags + 1] = tag end
  end
  table.sort(names); table.sort(tags)
  return "names here: " .. (#names > 0 and table.concat(names, ", ") or "none") .. "; tags: " .. (#tags > 0 and table.concat(tags, ", ") or "none")
end

-- Where an entity that a step walks to (or fights) is, as the place the walker would stand to be on it; how far apart
-- the two hitboxes are; and how many such entities live. Nothing when there is none and `optional`.
function H.goal(who, plane, name, optional)
  local e = find_walker(who)
  plane = plane or (three_d(e) and "xz" or "xy")
  local t, n = find_target(name, e, plane)
  if not t then
    if optional then return nil end
    error("there is no entity with the name, tag or kind '" .. tostring(name) .. "' in this scene (" .. names_here() .. ")", 0)
  end
  local ax0, ay0, ax1, ay1 = box(e, plane)
  local bx0, by0, bx1, by1 = box(t, plane)
  local px, py = ground(e, plane)
  local hp
  for _, k in ipairs({ "hp", "health", "hearts", "lives" }) do
    if type(e[k]) == "number" then hp = k .. " " .. num(e[k]); break end
  end
  return {
    x = (bx0 + bx1) / 2 - ((ax0 + ax1) / 2 - px), y = (by0 + by1) / 2 - ((ay0 + ay1) / 2 - py),
    gap = gap_of(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1), label = label_of(t), count = n, id = rawget(t, "id") or 0,
    size = math.max(ax1 - ax0, ay1 - ay0), hp = hp,
  }
end

-- A* over nodes named by one number. `neighbours(k, emit)` calls emit(next, cost); `h(k)` is the distance left.
-- Returns the nodes from the start to the goal (or to the nearest node reached), whether the goal was reached, and how
-- many nodes were looked at.
local function astar(start, neighbours, h, is_goal, limit)
  local g, parent, closed = { [start] = 0 }, {}, {}
  local hf, hk, n = { h(start) }, { start }, 1
  local best, best_h, found, expanded = start, h(start), false, 0
  local current
  local function emit(nk, cost)
    if closed[nk] then return end
    local ng = g[current] + cost
    if not g[nk] or ng < g[nk] - 1e-9 then
      g[nk] = ng; parent[nk] = current
      n = n + 1; hf[n], hk[n] = ng + h(nk), nk
      local c = n
      while c > 1 do
        local p = c // 2
        if hf[p] <= hf[c] then break end
        hf[p], hf[c] = hf[c], hf[p]; hk[p], hk[c] = hk[c], hk[p]; c = p
      end
    end
  end
  while n > 0 do
    local k = hk[1]
    hf[1], hk[1] = hf[n], hk[n]; hf[n], hk[n] = nil, nil; n = n - 1
    local i = 1
    while true do
      local l, r, m = i * 2, i * 2 + 1, i
      if l <= n and hf[l] < hf[m] then m = l end
      if r <= n and hf[r] < hf[m] then m = r end
      if m == i then break end
      hf[i], hf[m] = hf[m], hf[i]; hk[i], hk[m] = hk[m], hk[i]; i = m
    end
    if not closed[k] then
      closed[k] = true
      local left = h(k)
      if left < best_h then best, best_h = k, left end
      if is_goal(k) then best, found = k, true; break end
      expanded = expanded + 1
      if expanded > limit then break end
      current = k
      neighbours(k, emit)
    end
  end
  local path, k = {}, best
  while k do path[#path + 1] = k; k = parent[k] end
  for i = 1, #path // 2 do path[i], path[#path + 1 - i] = path[#path + 1 - i], path[i] end
  return path, found, expanded
end

local function key(i, j) return (i + 32768) * 65536 + (j + 32768) end
local function unkey(k) return k // 65536 - 32768, k % 65536 - 32768 end
local DIRS = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 }, { 1, 1 }, { 1, -1 }, { -1, 1 }, { -1, -1 } }

-- Drops the corners of a path that a straight walk can skip. `pts` is { {x, y}, ... }; clear(a, b) says whether the
-- walker can go straight from one to the other.
local function shorten(pts, clear)
  local out, i = { pts[1] }, 1
  while i < #pts do
    local j = #pts
    while j > i + 1 and not clear(pts[i], pts[j]) do j = j - 1 end
    out[#out + 1] = pts[j]
    i = j
  end
  return out
end

-- A flat game: the solid tiles of every tile layer and the hitboxes of the entities tagged `solid` (or the tags in
-- `avoid`), tested with the walker's own hitbox on a grid of half tiles.
local function plan2(e, tx, ty, target, avoid, reach)
  local x0, y0, x1, y1 = box(e, "xy")
  local hw, hh = math.max((x1 - x0) / 2, 0.5) - 0.05, math.max((y1 - y0) / 2, 0.5) - 0.05
  local ocx, ocy = (x0 + x1) / 2 - e.x, (y0 + y1) / 2 - e.y
  local layers, s, ox, oy = {}, nil, 0, 0
  local ex0, ey0, ex1, ey1 = math.min(e.x, tx), math.min(e.y, ty), math.max(e.x, tx), math.max(e.y, ty)
  for _, tm in ipairs(W.tags.nova_tilemap or {}) do
    if not rawget(tm, "_dead") and next(tm.solid) then
      local cols, rows, tw, th = tm:size()
      layers[#layers + 1] = { tm = tm, x = tm.x, y = tm.y, cols = cols, rows = rows, tw = tw, th = th }
      if not s or math.min(tw, th) / 2 < s then s, ox, oy = math.min(tw, th) / 2, tm.x, tm.y end
      ex0, ey0 = math.min(ex0, tm.x), math.min(ey0, tm.y)
      ex1, ey1 = math.max(ex1, tm.x + cols * tw), math.max(ey1, tm.y + rows * th)
    end
  end
  local solids = {}
  for _, tag in ipairs(avoid) do
    for _, o in ipairs(W.tags[tag] or {}) do
      if o ~= e and o ~= target and not rawget(o, "_dead") then
        local a, b, c, d = box(o, "xy")
        solids[#solids + 1] = { a, b, c, d }
        ex0, ey0, ex1, ey1 = math.min(ex0, a), math.min(ey0, b), math.max(ex1, c), math.max(ey1, d)
      end
    end
  end
  if #layers == 0 and #solids == 0 then return nil, "nothing solid is known here (no solid tiles, no entity tagged " .. table.concat(avoid, " or ") .. ")" end
  s = s or math.max(8, hw, hh)
  while ((ex1 - ex0) / s) * ((ey1 - ey0) / s) > 400000 do s = s * 2 end
  local pad = s * 3 + math.max(hw, hh)
  ex0, ey0, ex1, ey1 = ex0 - pad, ey0 - pad, ex1 + pad, ey1 + pad
  local function blocked_at(cx, cy)
    local bx0, by0, bx1, by1 = cx - hw, cy - hh, cx + hw, cy + hh
    if bx0 < ex0 or by0 < ey0 or bx1 > ex1 or by1 > ey1 then return true end
    for i = 1, #layers do
      local L = layers[i]
      local c0, c1 = math.max(0, math.floor((bx0 - L.x) / L.tw)), math.min(L.cols - 1, math.floor((bx1 - L.x) / L.tw))
      local r0, r1 = math.max(0, math.floor((by0 - L.y) / L.th)), math.min(L.rows - 1, math.floor((by1 - L.y) / L.th))
      for r = r0, r1 do
        for c = c0, c1 do
          local t = L.tm:get(c, r)
          if t >= 0 and L.tm.solid[t] then return true end
        end
      end
    end
    for i = 1, #solids do
      local b = solids[i]
      if bx0 < b[3] and b[1] < bx1 and by0 < b[4] and b[2] < by1 then return true end
    end
    return false
  end
  local cache = {}
  local function blocked(i, j)
    local k = key(i, j)
    local v = cache[k]
    if v == nil then v = blocked_at(ox + i * s, oy + j * s); cache[k] = v end
    return v
  end
  local function nearest_free(cx, cy, rings)
    local i0, j0 = math.floor((cx - ox) / s + 0.5), math.floor((cy - oy) / s + 0.5)
    local best, bd
    for r = 0, rings do
      for i = i0 - r, i0 + r do
        for j = j0 - r, j0 + r do
          if (math.abs(i - i0) == r or math.abs(j - j0) == r) and not blocked(i, j) then
            local d = (ox + i * s - cx) ^ 2 + (oy + j * s - cy) ^ 2
            if not bd or d < bd then best, bd = key(i, j), d end
          end
        end
      end
      if best then return best end
    end
    return nil
  end
  local scx, scy = e.x + ocx, e.y + ocy
  local gcx, gcy = tx + ocx, ty + ocy
  local start = nearest_free(scx, scy, 2)
  if not start then return nil, "the walker stands inside something solid" end
  local goal, tb
  if target then
    tb = { box(target, "xy") }
  else
    goal = nearest_free(gcx, gcy, 4)
    if not goal then return nil, "the point is inside something solid, with no free place within " .. num(4 * s) .. " units of it" end
  end
  local function h(k)
    local i, j = unkey(k)
    local dx, dy = ox + i * s - gcx, oy + j * s - gcy
    return math.sqrt(dx * dx + dy * dy)
  end
  local function is_goal(k)
    if goal then return k == goal end
    local i, j = unkey(k)
    local cx, cy = ox + i * s, oy + j * s
    return gap_of(cx - hw, cy - hh, cx + hw, cy + hh, tb[1], tb[2], tb[3], tb[4]) <= reach + s * 0.5
  end
  local function neighbours(k, emit)
    local i, j = unkey(k)
    for d = 1, 8 do
      local di, dj = DIRS[d][1], DIRS[d][2]
      if not blocked(i + di, j + dj) and (d <= 4 or (not blocked(i + di, j) and not blocked(i, j + dj))) then
        emit(key(i + di, j + dj), d <= 4 and s or s * 1.41421)
      end
    end
  end
  local nodes, found, looked = astar(start, neighbours, h, is_goal, 60000)
  local pts = { { scx, scy } }
  for n = 1, #nodes do
    local i, j = unkey(nodes[n])
    pts[#pts + 1] = { ox + i * s, oy + j * s }
  end
  local function clear(a, b)
    local dx, dy = b[1] - a[1], b[2] - a[2]
    local steps = math.max(1, math.ceil(math.sqrt(dx * dx + dy * dy) / (s * 0.5)))
    for n = 1, steps do
      if blocked_at(a[1] + dx * n / steps, a[2] + dy * n / steps) then return false end
    end
    return true
  end
  if found and not target and clear(pts[#pts], { gcx, gcy }) then pts[#pts + 1] = { gcx, gcy } end
  pts = shorten(pts, clear)
  local out = {}
  for n = 2, #pts do out[#out + 1] = pts[n][1] - ocx; out[#out + 1] = pts[n][2] - ocy end
  return out, nil, found, looked
end

-- A 3D game: a grid of half metres over the ground around the walker, each step of it tried with the level's own
-- movers (nova.solid.move with the body the game itself last moved, nova.walls.move) and the scenery's circles. The way
-- is first looked for with a body a hand wider than the walker's, so that it keeps clear of corners and plinths a real
-- walk would catch on; only if there is none that wide is the walker's own width tried. Going up or down costs extra, so
-- a way round a low base is preferred to one over it.
local function model_of(o) return rawget(o, "model") or (getmetatable(o) or {}).__model end

local function mover3()
  local r, h, step, slope = nil, nil, nil, nil
  if nova.solid then r, h, step, slope = nova.solid.mover() end
  return r or 0.3, h or 1.6, { step = step, slope = slope, probe = true }
end

local function plan3_with(e, tx, tz, target, reach, grow)
  local solid = nova.solid and nova.solid.count() > 0
  local walls = nova.walls and nova.walls.count() > 0
  local scen = nova.scenery and nova.scenery.count() > 0
  if not (solid or walls or scen) then return nil, "nothing solid is known here (nova.solid, nova.walls and nova.scenery are empty)" end
  local s = 0.5
  local r0, height, mopts = mover3()
  local r = r0 + grow
  height = math.max(height, 2 * r + 0.01)
  local ox, oz = e.x, e.z
  local heights = { [key(0, 0)] = e.y }
  local function hop(ax, ay, az, bx, bz)
    local y = ay
    if solid then
      local m = nova.solid.move(ax, ay, az, r, height, bx - ax, 0, bz - az, mopts)
      if math.abs(m.x - bx) + math.abs(m.z - bz) > 0.1 then return false end
      y = m.y
    end
    if walls then
      local nx, nz = nova.walls.move(ax, az, bx - ax, bz - az, r)
      if math.abs(nx - bx) + math.abs(nz - bz) > 0.1 then return false end
    end
    if scen and not nova.scenery.line_clear(ax, az, bx, bz, r) then return false end
    return true, y
  end
  -- (a long stretch is tried a grid step at a time: one long move slides round things and skips thin ones)
  local function pass(ax, ay, az, bx, bz)
    local dx, dz = bx - ax, bz - az
    local n = math.max(1, math.ceil(math.sqrt(dx * dx + dz * dz) / s - 1e-6))
    local y = ay
    for i = 1, n do
      local ok, ny = hop(ax + dx * (i - 1) / n, y, az + dz * (i - 1) / n, ax + dx * i / n, az + dz * i / n)
      if not ok then return false end
      y = ny
    end
    return true, y
  end
  local span = 40
  local i_lo, i_hi = math.floor((math.min(ox, tx) - span - ox) / s), math.ceil((math.max(ox, tx) + span - ox) / s)
  local j_lo, j_hi = math.floor((math.min(oz, tz) - span - oz) / s), math.ceil((math.max(oz, tz) + span - oz) / s)
  local function h(k)
    local i, j = unkey(k)
    local dx, dz = ox + i * s - tx, oz + j * s - tz
    return math.sqrt(dx * dx + dz * dz)
  end
  local near = target and math.max(reach, 0.75) or s * 0.75
  local function is_goal(k)
    local d = h(k)
    if d <= near then return true end
    -- A thing that is solid itself is never that near: beside it is where the step towards it is stopped, and what stops
    -- it is the thing (not a pillar that happens to stand between).
    if target and solid and d <= 12 then
      local i, j = unkey(k)
      local ax, az = ox + i * s, oz + j * s
      if not hop(ax, heights[k], az, ax + (tx - ax) / d * s, az + (tz - az) / d * s) then
        local model, mx, _, mz = nova.solid.touching(ax, heights[k], az, r, height, s)
        return model ~= nil and model == model_of(target) and math.abs(mx - target.x) < 0.01 and math.abs(mz - (target.z or 0)) < 0.01
      end
    end
    return false
  end
  local function neighbours(k, emit)
    local i, j = unkey(k)
    local ax, az, ay = ox + i * s, oz + j * s, heights[k]
    for d = 1, 8 do
      local ni, nj = i + DIRS[d][1], j + DIRS[d][2]
      if ni >= i_lo and ni <= i_hi and nj >= j_lo and nj <= j_hi then
        local ok, y = hop(ax, ay, az, ox + ni * s, oz + nj * s)
        if ok then
          local nk = key(ni, nj)
          if heights[nk] == nil then heights[nk] = y end
          emit(nk, (d <= 4 and s or s * 1.41421) + math.abs(y - ay) * 6)
        end
      end
    end
  end
  local nodes, found, looked = astar(key(0, 0), neighbours, h, is_goal, 20000)
  local pts = {}
  for n = 1, #nodes do
    local i, j = unkey(nodes[n])
    pts[#pts + 1] = { ox + i * s, oz + j * s, heights[nodes[n]] }
  end
  -- (a short cut is only taken over level ground: one over a step would undo the choice to go round it)
  local function clear(a, b)
    local ok, y = pass(a[1], a[3], a[2], b[1], b[2])
    return ok and math.abs(y - a[3]) < 0.05 and math.abs((b[3] or y) - a[3]) < 0.05
  end
  if found and not target then
    local last = pts[#pts]
    if pass(last[1], last[3], last[2], tx, tz) then pts[#pts + 1] = { tx, tz, last[3] } end
  end
  pts = shorten(pts, clear)
  local out = {}
  for n = 2, #pts do out[#out + 1] = pts[n][1]; out[#out + 1] = pts[n][2] end
  return out, nil, found, looked
end

local function plan3(e, tx, tz, target, reach)
  local points, why, found, looked = plan3_with(e, tx, tz, target, reach, 0.15)
  if points and not found then
    -- (also when the wide body could not even leave where the walker stands, pressed against something)
    local p2, w2, f2, l2 = plan3_with(e, tx, tz, target, reach, 0.02)
    if p2 and (f2 or (l2 or 0) > (looked or 0)) then return p2, w2, f2, l2 end
  end
  return points, why, found, looked
end

-- What stands in the walker's way, in words ("'arch' (model arch) at x 0, z -13"), and whether that is the thing it
-- walks to (`name`). Nothing when nothing known touches it.
function H.blocked(who, plane, name, avoid)
  local e = find_walker(who)
  plane = plane or (three_d(e) and "xz" or "xy")
  local target = name and (find_target(name, e, plane)) or nil
  local function entity_at(x, z, model)
    for _, o in ipairs(W.list) do
      if o ~= e and not rawget(o, "_dead") and type(o.x) == "number" and math.abs(o.x - x) < 0.01 and math.abs((o.z or 0) - z) < 0.01 and model_of(o) == model then return o end
    end
    -- (a piece of scenery the scene file named is not among the live entities, but the scene knows it by its name)
    for _, o in pairs(W.scene or {}) do
      if type(o) == "table" and o ~= e and type(rawget(o, "x")) == "number" and math.abs(o.x - x) < 0.01 and math.abs((rawget(o, "z") or 0) - z) < 0.01 and model_of(o) == model then return o end
    end
  end
  if plane == "xz" then
    local r, h = mover3()
    if nova.solid and nova.solid.count() > 0 then
      local model, mx, _, mz, px, _, pz = nova.solid.touching(e.x, e.y, e.z, r, h, 0.3)
      if model then
        local o = entity_at(mx, mz, model)
        local what = o and ("'" .. label_of(o) .. "'" .. (model ~= "" and (" (model " .. model .. ")") or "")) or (model ~= "" and ("the model '" .. model .. "'") or "something solid")
        return { text = what .. " at x " .. num(mx) .. ", z " .. num(mz) .. " (it touches at x " .. num(px) .. ", z " .. num(pz) .. ")", target = o ~= nil and o == target }
      end
    end
    if nova.scenery and nova.scenery.count() > 0 then
      local model, sx, sz = nova.scenery.touching(e.x, e.z, r, 0.3)
      if model then return { text = "the scenery '" .. model .. "' at x " .. num(sx) .. ", z " .. num(sz), target = false } end
    end
    if nova.walls and nova.walls.count() > 0 then
      for _, d in ipairs(DIRS) do
        local nx, nz = nova.walls.move(e.x, e.z, d[1] * 0.3, d[2] * 0.3, r)
        if math.abs(nx - e.x - d[1] * 0.3) + math.abs(nz - e.z - d[2] * 0.3) > 0.05 then
          return { text = "a wall of nova.walls beside x " .. num(e.x) .. ", z " .. num(e.z), target = false }
        end
      end
    end
    return nil
  end
  local x0, y0, x1, y1 = box(e, "xy")
  for _, tag in ipairs(avoid or { "solid" }) do
    for _, o in ipairs(W.tags[tag] or {}) do
      if o ~= e and not rawget(o, "_dead") then
        local a, b, c, d = box(o, "xy")
        if gap_of(x0, y0, x1, y1, a, b, c, d) <= 3 then
          return { text = "'" .. label_of(o) .. "' (tagged " .. tag .. ") at x " .. num(o.x) .. ", y " .. num(o.y), target = o == target }
        end
      end
    end
  end
  for _, tm in ipairs(W.tags.nova_tilemap or {}) do
    if not rawget(tm, "_dead") and next(tm.solid) then
      local cols, rows, tw, th = tm:size()
      for r = math.max(0, math.floor((y0 - 3 - tm.y) / th)), math.min(rows - 1, math.floor((y1 + 3 - tm.y) / th)) do
        for c = math.max(0, math.floor((x0 - 3 - tm.x) / tw)), math.min(cols - 1, math.floor((x1 + 3 - tm.x) / tw)) do
          local t = tm:get(c, r)
          if t >= 0 and tm.solid[t] then
            return { text = "the solid tile at column " .. c .. ", row " .. r .. " (x " .. num(tm.x + c * tw) .. ", y " .. num(tm.y + r * th) .. ")", target = false }
          end
        end
      end
    end
  end
  return nil
end

-- The way from the walker to a point (or to an entity, `name`): the corners to walk through in order, as { x, y, ... }.
-- `found` is false when the place cannot be reached (the way then ends at the nearest place that can).
function H.path(who, plane, tx, ty, name, avoid, reach)
  local e = find_walker(who)
  plane = plane or (three_d(e) and "xz" or "xy")
  local target = name and (find_target(name, e, plane)) or nil
  local points, why, found, looked
  if plane == "xz" then points, why, found, looked = plan3(e, tx, ty, target, reach)
  else points, why, found, looked = plan2(e, tx, ty, target, avoid or { "solid" }, reach) end
  if not points then return { why = why } end
  return { points = points, found = found, looked = looked }
end

-- What a picture is framed on (`crop_to`, `view`): the living entity with this name, tag or kind. In a flat game its box
-- on the screen (units of nova.view(), from the top left) and the view's size; in a 3D one a box round its model in the
-- world (the model's parts at rest, scaled by sx: a person 1.6 high when it has no model).
function H.extent(name)
  if not (W and W.started) then error("this project does not call nova.start, so it has no entities", 0) end
  local e = nova.named(name)
  if not e or rawget(e, "_dead") then e = nova.first(name) end
  if not e then
    for _, o in ipairs(W.list) do
      if not rawget(o, "_dead") and class_name(getmetatable(o)) == name then e = o; break end
    end
  end
  if not e then error("there is no entity with the name, tag or kind '" .. tostring(name) .. "' in this scene (" .. names_here() .. ")", 0) end
  if three_d(e) then
    local model = rawget(e, "model") or (getmetatable(e) or {}).__model
    local s = math.abs(type(e.sx) == "number" and e.sx or 1)
    local x0, y0, z0, x1, y1, z1 = -0.3, 0, -0.3, 0.3, 1.6, 0.3
    if model then
      local ok, pose = pcall(nova.model_pose, model)
      if ok and type(pose) == "table" then
        local lo, hi, r = math.huge, -math.huge, 0
        for _, p in pairs(pose) do
          lo = math.min(lo, p.low or p.y, p.y)
          hi = math.max(hi, p.y)
          r = math.max(r, math.abs(p.x), math.abs(p.z))
        end
        if lo < hi then
          local h = hi - lo
          -- (a part's place is its joint: the head and the hands reach past theirs)
          x0, y0, z0, x1, y1, z1 = -(r + h * 0.12), lo, -(r + h * 0.12), r + h * 0.12, hi + h * 0.15, r + h * 0.12
        end
      end
    end
    local ex, ey, ez = e.x, e.y or 0, e.z or 0
    return "3d", ex + x0 * s, ey + y0 * s, ez + z0 * s, ex + x1 * s, ey + y1 * s, ez + z1 * s
  end
  local x0, y0, x1, y1 = e:bounds()
  local ax, ay = nova.cam.to_screen(x0, y0)
  local bx, by = nova.cam.to_screen(x1, y1)
  local vw, vh = nova.view()
  return "2d", math.min(ax, bx), math.min(ay, by), math.max(ax, bx), math.max(ay, by), vw, vh
end

-- The scene that runs now: a token that differs each time a scene is built (entered again too), and its name.
function H.scene_now()
  local W = nova.world
  if not (W and W.started and W.scene) then return nil end
  return tostring(W.scene), W.scene_name and (W.scene_name:gsub("^scenes%.", "")) or "?"
end

-- ---------------------------------------------------------------- a run in which the hero cannot die
local PINS = { "hp", "health", "hearts", "lives", "life", "energy" }
local god

-- The life fields of one entity are kept out of the entity itself and every write to them goes through its class, which
-- refuses a write that lowers them (a blow is refused as it lands, so a hit bigger than what is left cannot kill, and the
-- game's own "hp <= 0" check right after it sees the life it had). Returns a function that puts everything back.
local function guard(e, pins)
  local cls = getmetatable(e)
  if type(cls) ~= "table" then return function() end end
  local store = {}
  for k in pairs(pins) do store[k] = rawget(e, k); rawset(e, k, nil) end
  local old_index, old_newindex = rawget(cls, "__index"), rawget(cls, "__newindex")
  cls.__index = function(t, k)
    if t == e then
      local v = store[k]
      if v ~= nil then return v end
    end
    if type(old_index) == "function" then return old_index(t, k) end
    return old_index and old_index[k]
  end
  cls.__newindex = function(t, k, v)
    if t == e and pins[k] ~= nil then
      local now = store[k]
      if type(v) == "number" and type(now) == "number" and v < now then
        god.restored = god.restored + 1
        return
      end
      store[k] = v
      return
    end
    if old_newindex then return old_newindex(t, k, v) end
    rawset(t, k, v)
  end
  return function()
    cls.__index, cls.__newindex = old_index, old_newindex
    for k, v in pairs(store) do rawset(e, k, v) end
  end
end

-- Keeps the walker's life from going down. Called after every frame of a run with `invincible`; the first call (and the
-- first after the walker changes, a new scene) puts the guard on.
function H.god(who)
  nova.testing.invincible = true
  local ok, e, label = pcall(find_walker, who)
  if not ok then return nil end
  if not god or god.e ~= e then
    if god and god.release then god.release() end
    local pins = {}
    for _, k in ipairs(PINS) do
      if type(e[k]) == "number" then pins[k] = e[k] end
    end
    god = { e = e, pins = pins, restored = (god and god.restored or 0), label = label }
    if next(pins) then god.release = guard(e, pins) end
  end
  local names = {}
  for _, k in ipairs(PINS) do
    local most = god.pins[k]
    if most then
      local now = e[k]
      if type(now) == "number" then
        if now < most then e[k] = most; god.restored = god.restored + 1 elseif now > most then god.pins[k] = now end
      end
      names[#names + 1] = k .. " " .. num(god.pins[k])
    end
  end
  return { who = god.label, pinned = table.concat(names, ", "), restored = god.restored }
end

-- ---------------------------------------------------------------- hitboxes, solid things and names drawn over the picture
local function draw_overlay(want)
  if want.lights then
    -- each 2D light of this frame: an ellipse at its radius and a cross at its middle (screen units, as the lights are kept)
    local c = { 255, 220, 60, 255 }
    for _, l in ipairs(nova.raw.lights2d()) do
      local n = 28
      for i = 0, n - 1 do
        local a, b = i / n * math.pi * 2, (i + 1) / n * math.pi * 2
        nova.ui.line(l.x + math.cos(a) * l.rx, l.y + math.sin(a) * l.ry, l.x + math.cos(b) * l.rx, l.y + math.sin(b) * l.ry, 1.5, c)
      end
      nova.ui.line(l.x - 5, l.y, l.x + 5, l.y, 1.5, c); nova.ui.line(l.x, l.y - 5, l.x, l.y + 5, 1.5, c)
    end
    if not (want.hitboxes or want.solids or want.names) then return end
  end
  if not (W and W.started) then return end
  local vw, vh = nova.view()
  local function outline(x0, y0, x1, y1, c)
    local ax, ay = nova.cam.to_screen(x0, y0)
    local bx, by = nova.cam.to_screen(x1, y1)
    if bx < 0 or by < 0 or ax > vw or ay > vh then return false end
    nova.ui.line(ax, ay, bx, ay, 1.5, c); nova.ui.line(bx, ay, bx, by, 1.5, c)
    nova.ui.line(bx, by, ax, by, 1.5, c); nova.ui.line(ax, by, ax, ay, 1.5, c)
    return true, ax, ay
  end
  if want.solids then
    local cx, cy = nova.cam.to_world(0, 0)
    for _, tm in ipairs(W.tags.nova_tilemap or {}) do
      if not rawget(tm, "_dead") and next(tm.solid) and not tm.screen then
        local cols, rows, tw, th = tm:size()
        local c0, c1 = math.max(0, math.floor((cx - tm.x) / tw)), math.min(cols - 1, math.floor((cx + vw - tm.x) / tw))
        local r0, r1 = math.max(0, math.floor((cy - tm.y) / th)), math.min(rows - 1, math.floor((cy + vh - tm.y) / th))
        for r = r0, r1 do
          for c = c0, c1 do
            local t = tm:get(c, r)
            if t >= 0 and tm.solid[t] then
              local ax, ay = nova.cam.to_screen(tm.x + c * tw, tm.y + r * th)
              nova.ui.rect(ax, ay, tw, th, { 255, 40, 40, 80 })
            end
          end
        end
      end
    end
  end
  for _, e in ipairs(W.list) do
    if not rawget(e, "_dead") and not rawget(e, "map") and not e.screen and not three_d(e) then
      local cls = getmetatable(e)
      local kind = class_name(cls)
      if kind or (cls ~= nova.Picture and cls ~= nova.Text) then
        local ok, x0, y0, x1, y1 = pcall(e.bounds, e)
        -- (a class keeps its tags as a set)
        local solid = (cls.__tags or {}).solid == true
        local shown, sx, sy
        if ok and x0 then
          if want.hitboxes or (want.solids and solid) then
            shown, sx, sy = outline(x0, y0, x1, y1, (solid and want.solids) and { 255, 60, 60, 255 } or { 60, 255, 90, 255 })
          else
            sx, sy = nova.cam.to_screen(x0, y0)
            shown = sx > -40 and sy > -10 and sx < vw and sy < vh + 10
          end
        end
        if want.names and shown then
          local text = (rawget(e, "name") and (rawget(e, "name") .. ":") or "") .. (kind or "entity")
          nova.ui.text(sx + 1, sy - 13, text, { size = 11, color = { 0, 0, 0, 255 } })
          nova.ui.text(sx, sy - 14, text, { size = 11, color = { 255, 255, 255, 255 } })
        end
      end
    end
  end
end

-- Draws them after everything the game draws, on every frame from now on.
function H.overlay(list)
  local want = {}
  for _, k in ipairs(list) do want[k] = true end
  local inner = _G.draw
  if type(inner) ~= "function" then error("this project has no draw function to draw over", 0) end
  local failed = false
  _G.draw = function()
    inner()
    if not failed then
      local ok, err = pcall(draw_overlay, want)
      if not ok then failed = true; nova.log("overlay: " .. tostring(err)) end
    end
  end
end

return H
"#;

/// An entity a step walks to or fights.
pub struct Goal {
    /// Where the walker would stand to be on it.
    pub x: f64,
    pub y: f64,
    /// How far apart the two hitboxes are (0 when they touch or overlap).
    pub gap: f64,
    /// The walker's own size (the longer side of its hitbox).
    pub size: f64,
    /// How many entities of that name or tag live.
    pub count: u32,
    pub id: i64,
    pub label: String,
    /// The walker's life as text (`hp 3`), when it has such a field.
    pub hp: Option<String>,
}

/// A way round what is solid.
#[derive(Default)]
pub struct PathFound {
    /// The corners to walk through, in order.
    pub points: Vec<(f64, f64)>,
    /// Whether the way reaches the place (else it ends at the nearest place that can be reached).
    pub found: bool,
    pub looked: u32,
    /// Why there is no path to follow (nothing solid is known, the walker is inside a wall).
    pub why: Option<String>,
}

fn first_line(s: &str) -> String {
    let line = s.lines().next().unwrap_or("");
    line.strip_prefix("runtime error: ")
        .unwrap_or(line)
        .to_string()
}

impl Game {
    fn playtest_helpers(&self) -> Result<Table, String> {
        if let Ok(t) = self.lua.named_registry_value::<Table>("nova.playtest") {
            return Ok(t);
        }
        let loaded: Table = self
            .lua
            .named_registry_value("nova.loaded")
            .map_err(|e| e.to_string())?;
        let t: Table = self
            .lua
            .load(HELPERS)
            .set_name("=nova.playtest")
            .call(loaded)
            .map_err(|e| e.to_string())?;
        self.lua
            .set_named_registry_value("nova.playtest", &t)
            .map_err(|e| e.to_string())?;
        Ok(t)
    }

    fn playtest_call<R: mlua::FromLuaMulti>(
        &self,
        name: &str,
        args: impl mlua::IntoLuaMulti,
    ) -> Result<R, String> {
        let f: Function = self
            .playtest_helpers()?
            .get(name)
            .map_err(|e| e.to_string())?;
        f.call(args).map_err(|e| first_line(&e.to_string()))
    }

    /// Makes the framework start in this scene instead of the one `main.lua` named (`nova run --start-scene`). Call it
    /// before the first frame.
    pub fn start_in_scene(&self, name: &str) -> Result<(), String> {
        self.playtest_call("scene", name)
    }

    /// Runs a piece of Lua in the game, as if a script of the project had (`nova run --run-lua`, a plan's `lua`).
    pub fn run_lua(&self, source: &str, name: &str) -> Result<(), String> {
        self.lua
            .load(source)
            .set_name(format!("={name}"))
            .exec()
            .map_err(|e| first_line(&e.to_string()))
    }

    /// The value of a Lua expression as short text (`hero.x`, `nova.count("enemy")`, a table, an entity).
    pub fn lua_text(&self, expression: &str) -> Result<String, String> {
        self.playtest_call("show", expression)
    }

    /// Whether a Lua expression holds (anything but `false` and `nil`).
    pub fn lua_truth(&self, expression: &str) -> Result<bool, String> {
        self.playtest_call("truth", expression)
    }

    /// What is on screen, for a reader with no eyes: the scene's name, the camera, and the living entities with their
    /// kind, the name the scene file gave them and where they are. Empty for a game that does not use the framework.
    pub fn snapshot(&self) -> Value {
        match self.playtest_call::<LuaValue>("snapshot", ()) {
            Ok(v) => debug_api::to_json(&v, 0),
            Err(e) => serde_json::json!({ "error": e, "entities": [] }),
        }
    }

    /// Where the entity a `walk_to` step steers is: its two ground coordinates, the plane they are in (`xy` or `xz`) and
    /// what it is called. `who` is a scene object's name or a tag; left out, the hero or player.
    pub fn walker(
        &self,
        who: Option<&str>,
        plane: Option<&str>,
    ) -> Result<(f64, f64, String, String, f64), String> {
        self.playtest_call("walker", (who, plane))
    }

    /// Where the entity a step walks to or fights is (see the helpers' `goal`). `None` when there is none and `optional`.
    pub fn goal(
        &self,
        who: Option<&str>,
        plane: Option<&str>,
        name: &str,
        optional: bool,
    ) -> Result<Option<Goal>, String> {
        let v: LuaValue = self.playtest_call("goal", (who, plane, name, optional))?;
        if v.is_nil() {
            return Ok(None);
        }
        let v = debug_api::to_json(&v, 0);
        let n = |k: &str| v[k].as_f64().unwrap_or(0.0);
        Ok(Some(Goal {
            x: n("x"),
            y: n("y"),
            gap: n("gap"),
            size: n("size"),
            count: n("count") as u32,
            id: n("id") as i64,
            label: v["label"].as_str().unwrap_or("entity").to_string(),
            hp: v["hp"].as_str().map(str::to_string),
        }))
    }

    /// The way from the walker to a place round what is solid (see the helpers' `path`).
    pub fn path(
        &self,
        who: Option<&str>,
        plane: Option<&str>,
        to: (f64, f64),
        name: Option<&str>,
        avoid: Option<&[String]>,
        reach: f64,
    ) -> Result<PathFound, String> {
        let avoid = match avoid {
            Some(list) => LuaValue::Table(
                self.lua
                    .create_sequence_from(list.iter().cloned())
                    .map_err(|e| e.to_string())?,
            ),
            None => LuaValue::Nil,
        };
        let t: Table = self.playtest_call("path", (who, plane, to.0, to.1, name, avoid, reach))?;
        let get = |e: mlua::Error| e.to_string();
        let why: Option<String> = t.get("why").map_err(get)?;
        if why.is_some() {
            return Ok(PathFound {
                why,
                ..Default::default()
            });
        }
        let flat: Vec<f64> = t.get("points").map_err(get)?;
        Ok(PathFound {
            points: flat
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| (p[0], p[1]))
                .collect(),
            found: t
                .get::<Option<bool>>("found")
                .map_err(get)?
                .unwrap_or(false),
            looked: t.get::<Option<u32>>("looked").map_err(get)?.unwrap_or(0),
            why: None,
        })
    }

    /// What stands against the walker (see the helpers' `blocked`): it in words, and whether it is the thing walked to.
    pub fn blocked(
        &self,
        who: Option<&str>,
        plane: Option<&str>,
        name: Option<&str>,
        avoid: Option<&[String]>,
    ) -> Option<(String, bool)> {
        let avoid = match avoid {
            Some(list) => {
                LuaValue::Table(self.lua.create_sequence_from(list.iter().cloned()).ok()?)
            }
            None => LuaValue::Nil,
        };
        let v: LuaValue = self
            .playtest_call("blocked", (who, plane, name, avoid))
            .ok()?;
        let LuaValue::Table(t) = v else {
            return None;
        };
        Some((
            t.get::<String>("text").ok()?,
            t.get::<Option<bool>>("target").ok()?.unwrap_or(false),
        ))
    }

    /// What a picture is framed on (see the helpers' `extent`): `Ok((false, [x0, y0, x1, y1, view_w, view_h]))` on the
    /// screen of a flat game, `Ok((true, [x0, y0, z0, x1, y1, z1]))` a box in the world of a 3D one.
    pub fn extent(&self, name: &str) -> Result<(bool, Vec<f64>), String> {
        let v: mlua::MultiValue = self.playtest_call("extent", name)?;
        let mut it = v.into_iter();
        let kind = match it.next() {
            Some(LuaValue::String(s)) => s.to_string_lossy(),
            _ => return Err("no extent".into()),
        };
        let nums: Vec<f64> = it
            .filter_map(|x| match x {
                LuaValue::Number(n) => Some(n),
                LuaValue::Integer(n) => Some(n as f64),
                _ => None,
            })
            .collect();
        Ok((kind == "3d", nums))
    }

    /// The 3D camera the game drew its last frame with.
    pub fn camera3(&self) -> crate::gfx::Camera {
        self.camera
    }

    /// The scene that runs now, as a token that changes whenever a scene is built (entered again too) and its name.
    pub fn scene_now(&self) -> Option<(String, String)> {
        let (token, name) = self
            .playtest_call::<(Option<String>, Option<String>)>("scene_now", ())
            .ok()?;
        Some((token?, name.unwrap_or_default()))
    }

    /// Puts the hero's life back (a run with `invincible`): who it is, the fields pinned and how often they were lower.
    pub fn god(&self, who: Option<&str>) -> Option<Value> {
        let v: LuaValue = self.playtest_call("god", who).ok()?;
        (!v.is_nil()).then(|| debug_api::to_json(&v, 0))
    }

    /// Sets a field of `nova.testing`, which a game may read to behave differently in a scripted run.
    pub fn set_testing(&self, name: &str, value: bool) {
        if let Ok(nova) = self.lua.globals().get::<Table>("nova")
            && let Ok(t) = nova.get::<Table>("testing")
        {
            let _ = t.set(name, value);
        }
    }

    /// Draws hitboxes, solid things and names over everything the game draws, from now on.
    pub fn overlay(&self, what: &[String]) -> Result<(), String> {
        let list = self
            .lua
            .create_sequence_from(what.iter().cloned())
            .map_err(|e| e.to_string())?;
        self.playtest_call("overlay", list)
    }

    /// The input actions scripts asked about since the last call.
    pub fn take_input_reads(&self) -> Vec<String> {
        std::mem::take(&mut *self.shared.borrow().input_reads.borrow_mut())
            .into_iter()
            .collect()
    }

    /// Buttons and the axes they share most of their keys with, as (button, axis, the side of the axis: -1 or 1). With
    /// the built-in actions: `left` and `move_x` -1, `up` and `move_y` -1, and so on.
    pub fn input_links(&self) -> Vec<(String, String, f32)> {
        use crate::actions::Binding;
        let plain = |ids: Vec<String>| -> Vec<String> {
            ids.into_iter()
                .map(|s| s.trim_end_matches(['+', '-']).to_string())
                .collect()
        };
        let sh = self.shared.borrow();
        let mut out = Vec::new();
        for (button, b) in sh.bindings.iter() {
            let Binding::Button(_) = b else { continue };
            let own = plain(b.source_ids());
            for (axis, a) in sh.bindings.iter() {
                let Binding::Axis { negative, positive } = a else {
                    continue;
                };
                for (side, list) in [(-1.0, negative), (1.0, positive)] {
                    let theirs = plain(list.iter().map(|s| s.id()).collect());
                    let shared = own.iter().filter(|s| theirs.contains(s)).count();
                    if shared * 2 > own.len() {
                        out.push((button.to_string(), axis.to_string(), side));
                    }
                }
            }
        }
        out
    }

    /// What the renderer was given for the frame just drawn, for a reader who cannot see it: whether anything 3D was
    /// drawn, the camera, the sun, and whether shadows and fog are on.
    pub fn render_facts(&self) -> Value {
        let models = self.models.len() + self.shading.models.len();
        if models == 0 {
            let f = &self.fx_facts;
            if !f.any {
                return serde_json::json!({ "three_d": false });
            }
            return serde_json::json!({
                "three_d": false,
                "fx2d": {
                    "ambient": f.ambient,
                    "lights": f.lights,
                    "lights_asked": f.lights_asked,
                    "dropped": f.dropped,
                    "max_lights": crate::gfx::MAX_LIGHTS_2D,
                    "added": f.added,
                    "shadows": f.shadows,
                    "reflections": f.reflections,
                    "reflective_tiles": f.reflective_tiles,
                    "mirrored": f.mirrored,
                    "rain": f.rain,
                    "bloom": f.bloom,
                    "low": f.low,
                    "off": f.off,
                }
            });
        }
        let l = &self.lighting;
        let r = |v: f32| (v as f64 * 1000.0).round() / 1000.0;
        let v3 = |v: [f32; 3]| serde_json::json!([r(v[0]), r(v[1]), r(v[2])]);
        let casters = self.models.iter().filter(|m| m.casts).count();
        serde_json::json!({
            "three_d": true,
            "models": models,
            "camera": { "eye": v3(self.camera.eye.to_array()), "target": v3(self.camera.target.to_array()), "fov": r(self.camera.fov_y_degrees) },
            "light": { "direction": v3(l.direction), "color": v3(l.color), "ambient": v3(l.ambient) },
            "shadows": l.shadows.as_ref().map(|s| serde_json::json!({ "radius": r(s.radius), "strength": r(s.strength), "casters": casters })),
            "fog": l.fog.as_ref().map(|f| serde_json::json!({ "near": r(f.near), "far": r(f.far), "color": v3(f.color) })),
        })
    }

    /// Whether a name given to a common call resolves as the call itself would resolve it: `kind` is "sound" (effects and
    /// music files, as `nova.sound.play` finds them), "music", "sprite", "model" or "scene" (`scenes/<name>.lua`).
    /// Unknown kinds count as found.
    pub fn asset_exists(&self, kind: &str, name: &str) -> bool {
        let sh = self.shared.borrow();
        match kind {
            "sound" | "music" => {
                super::find_sound(&sh.sounds, name).is_some()
                    || super::find_stream(&sh.streams, name).is_some()
            }
            "sprite" => {
                name == crate::assets::WHITE
                    || super::resolve_sprite(&sh.layout, &sh.sheets, name).is_some()
            }
            "model" => super::find_model(&sh.known_models, name).is_some(),
            "scene" => {
                let short = name
                    .strip_prefix("scenes.")
                    .unwrap_or(name)
                    .replace('.', "/");
                self.vfs().read(&format!("scenes/{short}.lua")).is_ok()
            }
            _ => true,
        }
    }

    /// The short names of what a call of that kind can be given (`hit`, `items/bomb`, `levels.one`), for a nearest match.
    pub fn asset_names(&self, kind: &str) -> Vec<String> {
        let sh = self.shared.borrow();
        let strip = |id: &str, folders: &[&str], exts: &[&str]| -> Option<String> {
            let rest = folders
                .iter()
                .find_map(|f| id.strip_prefix(&format!("{f}/")))?;
            exts.iter()
                .find_map(|e| rest.strip_suffix(e))
                .map(str::to_string)
        };
        let mut names: Vec<String> = match kind {
            "sound" | "music" => sh
                .sounds
                .keys()
                .chain(sh.streams.keys())
                .filter_map(|id| strip(id, &["sounds", "music"], &[".wav", ".ogg"]))
                .collect(),
            "sprite" => sh
                .sheets
                .keys()
                .filter_map(|id| strip(id, &["sprites"], &[".sprite.json"]))
                .chain(
                    sh.layout
                        .rects
                        .keys()
                        .filter_map(|id| strip(id, &["sprites"], &[".png"])),
                )
                .collect(),
            "model" => sh
                .known_models
                .iter()
                .filter_map(|id| strip(id, &["models"], &[".glb"]))
                .collect(),
            "scene" => self
                .vfs()
                .list()
                .unwrap_or_default()
                .iter()
                .filter_map(|e| strip(&e.path, &["scenes"], &[".lua"]))
                .map(|s| s.replace('/', "."))
                .collect(),
            _ => Vec::new(),
        };
        names.sort();
        names.dedup();
        names
    }

    /// The first part of `nova.<a>.<b>...` that does not exist, as text (`nova.scene_nowx`), or `None` when the whole name is
    /// there or cannot be judged (it goes through a value that is not a table, or into the framework's internals).
    pub fn api_missing(&self, parts: &[String]) -> Option<String> {
        if matches!(parts.first().map(String::as_str), Some("world" | "raw")) {
            return None;
        }
        let mut current: LuaValue = self.lua.globals().get("nova").ok()?;
        let mut name = String::from("nova");
        for part in parts {
            let LuaValue::Table(table) = &current else {
                return None;
            };
            name.push('.');
            name.push_str(part);
            let next: LuaValue = table.get(part.as_str()).ok()?;
            if next.is_nil() {
                return Some(name);
            }
            current = next;
        }
        None
    }

    /// Every input action the game knows (`nova.input.actions()`).
    pub fn action_names(&self) -> Vec<String> {
        self.shared
            .borrow()
            .bindings
            .names()
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    /// The sounds and music scripts started since the last call, by name (`play hit`, `music town`).
    pub fn take_sound_log(&self) -> Vec<String> {
        std::mem::take(&mut self.shared.borrow_mut().sound_log)
    }
}

-- Nova devtools: what the debugger and the keep-state reload need from inside Lua. Loaded by the engine (game.rs) with
-- Lua's `debug` library, which games never see: this chunk gets it as an argument and keeps it in a local. Nothing here
-- runs unless a debugger is attached (`nova run --debug`) or a reload swaps code in.
--
-- Frames are named by how far they are from the bottom of the stack ("depth", 1 = the oldest), which stays the same
-- while these helpers run on top of the paused code: the engine counts the frames when it pauses and passes that count.
local debug, loaded = ...
local getinfo, getlocal, getupvalue, upvaluejoin = debug.getinfo, debug.getlocal, debug.getupvalue, debug.upvaluejoin
local D = {}

-- ------------------------------------------------------------------ values as text, tables by reference
local refs, next_ref = {}, 1
local MAX_REFS = 20000

function D.clear_refs() refs, next_ref = {}, 1 end

local function ref_of(t)
  if next_ref > MAX_REFS then return nil end
  local id = next_ref
  next_ref = next_ref + 1
  refs[id] = t
  return id
end

-- the name a module was required by, for classes ("entities.player" -> "player")
local function module_name(v)
  for name, value in pairs(loaded) do
    if value == v then return (name:gsub("^entities%.", ""):gsub("^scenes%.", "")) end
  end
  return nil
end

local function class_name(cls)
  local seen = 0
  while type(cls) == "table" and seen < 8 do
    local name = module_name(cls)
    if name then return name end
    cls = rawget(cls, "__parent")
    seen = seen + 1
  end
  return nil
end

local function short(s, n)
  if #s > n then return s:sub(1, n) .. "…" end
  return s
end

local function count(t)
  local n = 0
  for _ in next, t do n = n + 1 end
  return n
end

--- One value as the debugger shows it: { value = text, type = "number" | ..., ref = id of a table to open (or nil) }.
local function describe(v)
  local kind = type(v)
  if kind == "number" then
    local text
    if math.type(v) == "integer" then text = tostring(v) else text = string.format("%.6g", v) end
    return { value = text, type = kind }
  elseif kind == "string" then
    return { value = string.format("%q", short(v, 300)):gsub("\\\n", "\\n"), type = kind }
  elseif kind == "boolean" or kind == "nil" then
    return { value = tostring(v), type = kind }
  elseif kind == "table" then
    local mt = getmetatable(v)
    local label
    if type(mt) == "table" and rawget(mt, "__kind") then
      local name = class_name(mt) or "?"
      local id = rawget(v, "id")
      label = name .. " " .. mt.__kind .. (id and (" #" .. tostring(id)) or "")
    elseif rawget(v, "__kind") then
      label = (class_name(v) or "?") .. " (" .. tostring(rawget(v, "__kind")) .. " class)"
    else
      local n, len = count(v), #v
      if n == 0 then label = "{}" elseif len == n then label = "{ " .. n .. " items }" else label = "{ " .. n .. " fields }" end
    end
    return { value = label, type = kind, ref = ref_of(v) }
  elseif kind == "function" then
    local info = getinfo(v, "S")
    if info.what == "C" then return { value = "function (engine)", type = kind } end
    return { value = "function (" .. info.short_src .. ":" .. tostring(info.linedefined) .. ")", type = kind }
  end
  return { value = tostring(v):gsub(": 0x%x+", ""), type = kind }
end
D.describe = describe

local function sort_entries(out)
  table.sort(out, function(a, b)
    local na, nb = tonumber(a.name), tonumber(b.name)
    if na and nb then return na < nb end
    if na or nb then return na ~= nil end
    return a.name < b.name
  end)
  return out
end

local function entry(name, v)
  local d = describe(v)
  d.name = name
  return d
end

--- The fields of a table given out earlier by reference (most `__` fields of classes are left out).
function D.children(id)
  local t = refs[id]
  if t == nil then return nil end
  local out = {}
  for k, v in next, t do
    local name = type(k) == "string" and k or "[" .. tostring(k) .. "]"
    if type(k) == "number" then name = tostring(k) end
    if not (type(k) == "string" and k:sub(1, 2) == "__" and k ~= "__kind") then
      out[#out + 1] = entry(name, v)
      if #out >= 500 then break end
    end
  end
  return sort_entries(out)
end

-- ------------------------------------------------------------------ the stack
local function level_of(depth)
  -- this function is level 1 inside itself, its caller (the D function) is 2; count the whole stack once
  local total = 1
  while getinfo(total + 1, "l") do total = total + 1 end
  -- the frame `depth` from the bottom is (total - depth + 1) levels up from here; one more for the D.* caller
  return total - depth + 1
end

-- a name for a function that Lua could not name (one the engine called, such as update): a global, or a module's field
local function name_of(fn)
  for k, v in pairs(_G) do
    if v == fn and type(k) == "string" then return k end
  end
  for modname, m in pairs(loaded) do
    if type(m) == "table" then
      for k, v in next, m do
        if v == fn and type(k) == "string" then
          local short_name = modname:match("([^.]+)$") or modname
          return short_name .. (rawget(m, "__kind") and ":" or ".") .. k
        end
      end
    end
  end
  return nil
end

local function frame_text(info)
  local name = info.name
  if not name and info.func then name = name_of(info.func) end
  if not name then
    if info.what == "main" then name = "(top of the file)" else name = "(function)" end
  end
  return name
end

--- The frames of the paused code, innermost first: { file, line, func, depth, internal }. `top` is the depth of the
--- paused frame (the count of frames when it stopped). The debugger's own frames (the error guard) are left out.
function D.stack(top)
  local out = {}
  for depth = top, 1, -1 do
    local info = getinfo(level_of(depth) - 1, "Slnf")
    if not info then break end
    local src = info.source or "?"
    local file = src:sub(1, 1) == "@" and src:sub(2) or nil
    local ours = src == "=nova.devtools" or (info.what == "C" and info.func == xpcall)
    if not ours then
      out[#out + 1] = {
        file = file,
        line = info.currentline,
        func = frame_text(info),
        depth = depth,
        internal = file == nil,
      }
    end
  end
  return out
end

--- Local variables, upvalues or globals of the frame `depth` from the bottom.
function D.scope(depth, which)
  local out = {}
  if which == "globals" then
    -- the game's own globals: the standard libraries and the engine are left out
    local skip = { _G = true, nova = true, string = true, table = true, math = true, utf8 = true, coroutine = true,
      require = true, print = true }
    for k, v in pairs(_G) do
      if type(k) == "string" and not skip[k] and not (type(v) == "function" and getinfo(v, "S").what == "C") then
        out[#out + 1] = entry(k, v)
      end
    end
    return sort_entries(out)
  end
  local level = level_of(depth) - 1
  local info = getinfo(level, "f")
  if not info then return out end
  if which == "upvalues" then
    local i = 1
    while true do
      local name, v = getupvalue(info.func, i)
      if not name then break end
      if name ~= "_ENV" then out[#out + 1] = entry(name, v) end
      i = i + 1
    end
    return out
  end
  local i = 1
  while true do
    local name, v = getlocal(level, i)
    if not name then break end
    if name:sub(1, 1) ~= "(" then out[#out + 1] = entry(name, v) end -- "(temporary)", "(for state)"
    i = i + 1
  end
  -- varargs
  i = -1
  while true do
    local name, v = getlocal(level, i)
    if not name then break end
    out[#out + 1] = entry("..." .. tostring(-i), v)
    i = i - 1
  end
  return out
end

--- A function that calls `f(...)` and, when it fails, calls `pause(message, depth)` while the failing frame is still there
--- (Lua's error handler runs before the stack unwinds). Gives ok, message-with-traceback.
function D.guard(pause)
  local function handler(msg)
    local text = tostring(msg)
    -- level 1 is this handler; the failing frame is the first Lua frame above it (error() itself is an engine frame)
    local level = 2
    while true do
      local info = getinfo(level, "S")
      if not info or info.what ~= "C" then break end
      level = level + 1
    end
    if getinfo(level, "l") then
      local total = level
      while getinfo(total + 1, "l") do total = total + 1 end
      pause(text, total - level + 1)
    end
    return debug.traceback(text, 2)
  end
  return function(f, ...)
    local ok, err = xpcall(f, handler, ...)
    return ok, err
  end
end

-- ------------------------------------------------------------------ the running scene's objects
local function world() return nova.world end

local function all_objects()
  local W = world()
  local out = {}
  if not W then return out end
  if W.scene then out[#out + 1] = W.scene end
  for _, e in ipairs(W.list) do
    if not rawget(e, "_dead") then out[#out + 1] = e end
  end
  return out
end

local function find(id)
  local W = world()
  if not W then return nil end
  if id == "scene" or id == 0 then return W.scene end
  for _, e in ipairs(W.list) do
    if rawget(e, "id") == id and not rawget(e, "_dead") then return e end
  end
  return nil
end
D.find = find

local function tags_of(cls)
  local out = {}
  for t in pairs(rawget(cls, "__tags") or {}) do out[#out + 1] = t end
  table.sort(out)
  return out
end

local function num(v) if type(v) == "number" then return v end return nil end

--- Every living entity (and the scene, id 0): { id, name, kind, label, x, y, z, tags }. `label` is the scene's field that
--- holds it (`self.hero`), when there is one.
function D.entities()
  local out = {}
  local W = world()
  local labels = {}
  if W and W.scene then
    for k, v in pairs(W.scene) do
      if type(k) == "string" and type(v) == "table" and labels[v] == nil then labels[v] = k end
    end
  end
  for _, e in ipairs(all_objects()) do
    local cls = getmetatable(e) or {}
    local is_scene = e == W.scene
    local name = class_name(cls)
      or (cls == nova.Picture and "picture") or (cls == nova.Text and "text") or "entity"
    out[#out + 1] = {
      id = is_scene and 0 or rawget(e, "id"),
      name = is_scene and (W.scene_name or "scene") or name,
      label = not is_scene and labels[e] or nil,
      kind = is_scene and "scene" or "entity",
      x = num(e.x), y = num(e.y), z = num(rawget(e, "z")),
      tags = tags_of(cls),
    }
    if #out >= 5000 then break end
  end
  return { scene = W and W.scene_name or nil, entities = out, count = W and #W.list or 0 }
end

--- The fields of one entity (its own and the defaults it inherits), as the debugger shows values.
function D.entity(id)
  local e = find(id)
  if not e then return nil end
  local out, seen = {}, {}
  for k, v in pairs(e) do
    if type(k) == "string" and k:sub(1, 1) ~= "_" then
      seen[k] = true
      out[#out + 1] = entry(k, v)
    end
  end
  -- the class's plain defaults that the entity has not set itself (x, y, angle, alpha, ...)
  local cls = getmetatable(e)
  local defaults = cls and rawget(cls, "__defaults") or {}
  for _, k in ipairs({ "x", "y", "z", "vx", "vy", "vz", "sx", "sy", "angle", "alpha", "visible", "frame", "depth" }) do
    if not seen[k] and e[k] ~= nil and type(e[k]) ~= "function" then seen[k] = true; out[#out + 1] = entry(k, e[k]) end
  end
  for k, v in pairs(defaults) do
    if not seen[k] and type(k) == "string" then out[#out + 1] = entry(k, e[k] or v) end
  end
  return sort_entries(out)
end

--- Sets a number, text or true/false on an entity (or a table opened by reference: `ref`). The value must be the same kind
--- as the one there now (or the field must be empty), so a typo in the studio cannot turn a speed into a string.
function D.set(target, key, value)
  local t
  if type(target) == "table" and target.ref then t = refs[target.ref] else t = find(target) end
  if t == nil then return nil, "that object is gone" end
  if type(key) ~= "string" and type(key) ~= "number" then return nil, "a field name is text or a number" end
  local kind = type(value)
  if kind ~= "number" and kind ~= "string" and kind ~= "boolean" then return nil, "only numbers, text and true/false can be set" end
  local now = t[key]
  if now ~= nil and type(now) ~= kind then
    return nil, ("'%s' holds %s, not %s"):format(tostring(key), type(now), kind)
  end
  t[key] = value
  return describe(t[key])
end

-- the highlighted entity: drawn over the game after draw() each frame
local highlight
function D.set_highlight(id) highlight = id end

local YELLOW = { 255, 214, 0, 255 }
function D.draw_highlight()
  if highlight == nil then return end
  local e = find(highlight)
  if not e then return end
  local cls = getmetatable(e) or {}
  if rawget(e, "model") or rawget(cls, "__model") then
    -- a 3D thing: a box of lines around where it stands
    local s = math.abs(e.sx or 1)
    local x, y, z = e.x or 0, e.y or 0, rawget(e, "z") or e.z or 0
    local h, r = 2 * s, 0.6 * s
    local o = { color = YELLOW, width = 0.04 }
    for _, c in ipairs({ { -r, -r }, { r, -r }, { r, r }, { -r, r } }) do
      nova.line3(x + c[1], y, z + c[2], x + c[1], y + h, z + c[2], o)
    end
    for _, yy in ipairs({ y, y + h }) do
      nova.line3(x - r, yy, z - r, x + r, yy, z - r, o)
      nova.line3(x + r, yy, z - r, x + r, yy, z + r, o)
      nova.line3(x + r, yy, z + r, x - r, yy, z + r, o)
      nova.line3(x - r, yy, z + r, x - r, yy, z - r, o)
    end
    return
  end
  local x0, y0, x1, y1 = e:bounds()
  if not x0 then x0, y0, x1, y1 = (e.x or 0) - 8, (e.y or 0) - 8, (e.x or 0) + 8, (e.y or 0) + 8 end
  local screen = rawget(e, "screen")
  if screen == nil then screen = rawget(cls, "__screen") end
  local rect = nova.rect
  if screen then
    rect = nova.ui.rect
  else
    local W = world()
    local w, h = nova.view()
    local ox, oy = W.cam.x - w * 0.5, W.cam.y - h * 0.5
    x0, y0, x1, y1 = x0 - ox, y0 - oy, x1 - ox, y1 - oy
  end
  local t = 2
  rect(x0 - t, y0 - t, x1 - x0 + 2 * t, t, YELLOW)
  rect(x0 - t, y1, x1 - x0 + 2 * t, t, YELLOW)
  rect(x0 - t, y0, t, y1 - y0, YELLOW)
  rect(x1, y0, t, y1 - y0, YELLOW)
end

-- ------------------------------------------------------------------ swapping a module's code in (keep-state reload)
-- Module-level locals (upvalues) that hold tables, functions or other objects are state: the new code is joined to the
-- old ones, so caches, lists and other modules stay the same. Plain values (numbers, text, true/false) are the new code's,
-- so a changed constant takes effect.
local function keeps_state(v)
  local t = type(v)
  return t == "table" or t == "function" or t == "userdata" or t == "thread"
end

-- every function reachable from a module value: its fields, class fields, and the upvalues of those functions
local function collect_functions(root, out, seen, depth)
  seen = seen or {}
  out = out or {}
  depth = depth or 0
  if depth > 6 or root == nil or seen[root] then return out end
  local kind = type(root)
  if kind == "function" then
    seen[root] = true
    if getinfo(root, "S").what == "C" then return out end
    out[#out + 1] = root
    local i = 1
    while true do
      local name, v = getupvalue(root, i)
      if not name then break end
      if type(v) == "function" then collect_functions(v, out, seen, depth + 1) end
      i = i + 1
    end
  elseif kind == "table" then
    seen[root] = true
    for k, v in next, root do
      if type(v) == "function" then collect_functions(v, out, seen, depth + 1)
      elseif type(v) == "table" and type(k) == "string" and (k == "__index" or depth == 0) and v ~= root then
        collect_functions(v, out, seen, depth + 1)
      end
    end
  end
  return out
end

-- name -> { fn, index } for the old code's upvalues
local function upvalue_map(fns)
  local map = {}
  for _, f in ipairs(fns) do
    local i = 1
    while true do
      local name, v = getupvalue(f, i)
      if not name then break end
      if name ~= "_ENV" and map[name] == nil and keeps_state(v) then map[name] = { f, i } end
      i = i + 1
    end
  end
  return map
end

local function join_upvalues(fns, map, changed_classes)
  for _, f in ipairs(fns) do
    local i = 1
    while true do
      local name, v = getupvalue(f, i)
      if not name then break end
      local old = map[name]
      if old and name ~= "_ENV" then
        local _, ov = getupvalue(old[1], old[2])
        -- join state; a new constant wins over an old one; a class table is always joined (it is the same class)
        if keeps_state(ov) and (keeps_state(v) or v == nil) then upvaluejoin(f, i, old[1], old[2]) end
      end
      i = i + 1
    end
  end
end

-- is this table an entity or scene class?
local function is_class(t) return type(t) == "table" and rawget(t, "__kind") ~= nil and rawget(t, "__spec") ~= nil end

--- Puts the new module value's code into the old one. Returns true, or false and why it cannot be done safely (the engine
--- then restarts the game). `replaced` maps old functions to new ones, for D.retarget.
function D.swap(old, new, replaced)
  if type(old) ~= type(new) then return false, "it now returns a " .. type(new) .. " instead of a " .. type(old) end
  if type(old) ~= "table" then
    if old == new then return true end
    return false, "it returns a " .. type(old) .. ", not a table of functions"
  end
  local old_fns = collect_functions(old)
  local new_fns = collect_functions(new)
  join_upvalues(new_fns, upvalue_map(old_fns))
  local function merge(o, n, depth)
    for k, v in next, n do
      local ov = rawget(o, k)
      local bookkeeping = type(k) == "string" and k:sub(1, 2) == "__"
      if type(v) == "function" then
        if type(ov) == "function" and ov ~= v then replaced[ov] = v end
        rawset(o, k, v)
      elseif k == "__spec" or k == "__parent" then
        rawset(o, k, v) -- the class's description is the new one; finalize works the rest out again
      elseif bookkeeping then
        -- (__index, __defaults, __tags...: worked out again by finalize)
      elseif type(v) == "table" and type(ov) == "table" and is_class(v) and is_class(ov) and depth < 2 then
        merge(ov, v, depth + 1) -- a class kept in a module's table
        rawset(ov, "__flat", false)
      elseif type(v) ~= "table" then
        rawset(o, k, v) -- a plain value: a constant of the module or a class's default
      elseif ov == nil then
        rawset(o, k, v) -- a new table
      end
      -- (an existing table is the game's state: it stays)
    end
    -- methods taken out of the file go away (but not the copies a class took from its parent)
    for k, ov in next, o do
      if type(ov) == "function" and rawget(n, k) == nil and type(k) == "string" and not replaced[ov] then
        local parent = rawget(o, "__parent")
        if not (parent and (parent[k] == ov or replaced[ov] ~= nil)) then rawset(o, k, nil) end
      end
    end
  end
  merge(old, new, 0)
  if is_class(old) then rawset(old, "__flat", false) end
  return true
end

--- After swaps: every class (and module table) that still holds an old function gets the new one (subclasses copied
--- their parent's methods when they were first used), and classes below a changed class are worked out again.
--- Returns a list of problems found while doing that (empty when there were none).
function D.retarget(replaced, changed)
  local seen, classes = {}, {}
  local function visit(t, depth)
    if type(t) ~= "table" or seen[t] or depth > 3 then return end
    seen[t] = true
    for k, v in next, t do
      if type(v) == "function" and replaced[v] then rawset(t, k, replaced[v]) end
    end
    if is_class(t) then
      classes[#classes + 1] = t
      local p = rawget(t, "__parent")
      while type(p) == "table" do
        if changed[p] then rawset(t, "__flat", false) break end
        p = rawget(p, "__parent")
      end
    end
    for _, v in next, t do
      if type(v) == "table" and (is_class(v) or depth == 0) then visit(v, depth + 1) end
    end
  end
  for _, v in pairs(loaded) do visit(v, 0) end
  for _, e in ipairs(all_objects()) do visit(getmetatable(e), 1) end
  -- the hooks the game set as globals (update, draw, ...)
  for k, v in pairs(_G) do
    if type(v) == "function" and replaced[v] then _G[k] = replaced[v] end
  end
  local problems = {}
  local finalize = world() and world().finalize
  if finalize then
    for _, cls in ipairs(classes) do
      if rawget(cls, "__flat") == false then
        local ok, err = pcall(finalize, cls)
        if not ok then problems[#problems + 1] = (class_name(cls) or "a class") .. ": " .. tostring(err) end
      end
    end
  end
  return problems
end

-- coroutines made while a debugger is attached, so that the engine can switch their line hooks on and off too
local threads = setmetatable({}, { __mode = "k" })
function D.track_coroutines()
  local create, resume, unpack, pack = coroutine.create, coroutine.resume, table.unpack, table.pack
  coroutine.create = function(f)
    local co = create(f)
    threads[co] = true
    return co
  end
  coroutine.wrap = function(f)
    local co = coroutine.create(f)
    return function(...)
      local r = pack(resume(co, ...))
      if not r[1] then error(r[2], 0) end
      return unpack(r, 2, r.n)
    end
  end
end
function D.threads()
  local out = {}
  for co in pairs(threads) do
    if coroutine.status(co) ~= "dead" then out[#out + 1] = co end
  end
  return out
end

return D

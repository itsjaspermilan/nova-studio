-- A computer apprentice (F9 in a game): takes the oldest order and brews it, one step at a time: fetch an ingredient, grind it if the potion wants it ground, drop it in a
-- cauldron, wait, bottle, fill, serve. It walks by the shortest way over the floor, steers clear of lava and waits for a flickering tile to go dark. The tests and the
-- screenshots use it, and so can anyone who wants to see how a level is meant to go.
local data = require("lib.data")

local Bot = {}
Bot.__index = Bot

function Bot.new(k)
  return setmetatable({ k = k, plan = {}, path = nil, wait = 0, face_t = 0, current = nil }, Bot)
end

-- ---- finding the way ------------------------------------------------------------------------------------------------------------

local DIRS = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }

function Bot:walkable(cx, cz)
  local k = self.k
  if k:blocked(cx, cz) then return false end
  local f = k.floor[cz][cx]
  return f ~= nil and f ~= "lava"
end

-- the cells to walk through to reach one of `goals` (a set of "cx,cz") from the cell the apprentice is in
function Bot:route(goals)
  local k = self.k
  local sx, sz = math.floor(k.chef.x) + 1, math.floor(k.chef.z) + 1
  local prev, queue, head = { [sx .. "," .. sz] = false }, { { sx, sz } }, 1
  while head <= #queue do
    local x, z = queue[head][1], queue[head][2]
    head = head + 1
    if goals[x .. "," .. z] then
      local path, key = {}, x .. "," .. z
      while key do
        local px, pz = key:match("(%-?%d+),(%-?%d+)")
        table.insert(path, 1, { tonumber(px), tonumber(pz) })
        key = prev[key]
      end
      return path
    end
    for _, d in ipairs(DIRS) do
      local nx, nz = x + d[1], z + d[2]
      local key = nx .. "," .. nz
      if prev[key] == nil and self:walkable(nx, nz) then
        prev[key] = x .. "," .. z
        queue[#queue + 1] = { nx, nz }
      end
    end
  end
  return nil
end

-- the cells beside a station that can be stood on, as a set
function Bot:stands(st)
  local goals = {}
  for _, d in ipairs(DIRS) do
    local cx, cz = st.x + d[1], st.z + d[2]
    if self:walkable(cx, cz) then goals[cx .. "," .. cz] = { d[1], d[2] } end
  end
  return goals
end

-- the nearest station of a kind that suits `ok`
function Bot:find(kind, ok)
  local best, best_len
  for _, st in ipairs(self.k.stations) do
    if st.kind == kind and (not ok or ok(st)) then
      local goals = self:stands(st)
      local path = self:route(goals)
      if path and (not best_len or #path < best_len) then best, best_len = st, #path end
    end
  end
  return best
end

-- ---- the plan ---------------------------------------------------------------------------------------------------------------------

function Bot:make_plan(order)
  local k = self.k
  local recipe = data.recipes[order.recipe]
  local plan = {}
  local cauldron = self:find("cauldron", function(st) return st.state == "idle" and #st.items == 0 end)
  if not cauldron then return nil end
  for _, it in ipairs(recipe.items) do
    local crate = self:find("crate", function(st) return st.ing == it[1] end)
    if not crate then return nil end
    plan[#plan + 1] = { st = crate, act = "grab" }
    if it[2] then
      local mortar = self:find("mortar", function(st) return not st.item end)
      if not mortar then return nil end
      plan[#plan + 1] = { st = mortar, act = "grab" } -- (put it in)
      plan[#plan + 1] = { st = mortar, act = "work" }
      plan[#plan + 1] = { st = mortar, act = "grab" } -- (take it out ground)
    end
    plan[#plan + 1] = { st = cauldron, act = "grab" }
  end
  plan[#plan + 1] = { st = cauldron, act = "wait" }
  plan[#plan + 1] = { act = "bottle" } -- (from the crate, or washed at the window: decided when it comes to it)
  plan[#plan + 1] = { st = cauldron, act = "grab" }
  local hatch = self:find("hatch")
  plan[#plan + 1] = { st = hatch, act = "grab" }
  return plan
end

-- ---- the update ----------------------------------------------------------------------------------------------------------------------

-- returns the same table the stick and buttons would give: { mx, mz, grab, work, dash }
function Bot:update(dt)
  local k = self.k
  local c = k.chef
  local out = { mx = 0, mz = 0 }
  if c.dead > 0 then self.path = nil; self.plan = {}; return out end
  if #self.plan == 0 then
    -- take the order that runs out first
    local oldest
    for _, o in ipairs(k.orders) do
      if not oldest or o.t < oldest.t then oldest = o end
    end
    if c.held then
      -- (something left in hand: a bottle goes back in its crate, anything else in the bin)
      if c.held.k == "bottle" then
        local crate = self:find("bottles", function(st) return st.count < 4 end)
        if crate then self.plan = { { st = crate, act = "grab" } } end
      else
        local bin = self:find("bin")
        if bin then self.plan = { { st = bin, act = "grab" } } end
      end
    elseif oldest then
      self.plan = self:make_plan(oldest) or {}
      self.order = oldest
    end
    return out
  end
  local step = self.plan[1]
  -- a bottle: the crate while it has some, else a clean one at the window, else wash one there, else wait for one to come back
  if step.act == "bottle" then
    local crate = self:find("bottles", function(b) return b.count > 0 end)
    local clean = self:find("wash", function(w) return w.clean > 0 end)
    local dirty = self:find("wash", function(w) return w.dirty > 0 end)
    if crate then step.st, step.act = crate, "grab"
    elseif clean then step.st, step.act = clean, "grab"
    elseif dirty then table.insert(self.plan, 1, { st = dirty, act = "work" }); return out
    else return out end
  end
  local st = step.st
  if Bot.debug and math.floor(k.t * 2) ~= self.dbg then
    self.dbg = math.floor(k.t * 2)
    nova.log(string.format("bot t=%.1f at %.2f,%.2f step %s %s@%d,%d held=%s cauldron=%s", k.t, c.x, c.z, step.act, st.kind, st.x, st.z, tostring(c.held and (c.held.id or c.held.k)), tostring(st.state)))
  end
  -- waiting for a brew
  if step.act == "wait" then
    if st.state == "done" or st.state == "burnt" then table.remove(self.plan, 1) end
    return out
  end
  if step.act == "work" then
    if (st.kind == "mortar" and st.item and st.item.ground) or (st.kind == "wash" and st.clean > 0) then table.remove(self.plan, 1); return out end
    -- stand and face the mortar, holding B
    local goals = self:stands(st)
    local cx, cz = math.floor(c.x) + 1, math.floor(c.z) + 1
    local d = goals[cx .. "," .. cz]
    if not d then self.path = self:route(goals); return self:walk(out, dt) end
    out.mx, out.mz = -d[1] * 0.0 + (st.x - cx), (st.z - cz)
    out.work = true
    return out
  end
  -- walk to the station, face it, and press A
  local goals = self:stands(st)
  local cx, cz = math.floor(c.x) + 1, math.floor(c.z) + 1
  local dir = goals[cx .. "," .. cz]
  if dir and math.abs(c.x - (cx - 0.5)) < 0.35 and math.abs(c.z - (cz - 0.5)) < 0.35 then
    out.mx, out.mz = st.x - cx, st.z - cz
    self.face_t = self.face_t + dt
    if self.face_t > 0.12 and k:target() == st then
      out.grab = true
      self.face_t = 0
      table.remove(self.plan, 1)
    end
    return out
  end
  self.face_t = 0
  self.path = self:route(goals)
  return self:walk(out, dt)
end

function Bot:walk(out, dt)
  local k, c = self.k, self.k.chef
  local path = self.path
  if not path or #path < 1 then return out end
  local nxt = path[2] or path[1]
  local cx, cz = nxt[1], nxt[2]
  -- a flickering tile that will burn soon (this step or any of the next few): wait
  for i = 2, math.min(#path, 5) do
    local p = path[i]
    if k.floor[p[2]][p[1]] == "pulse" then
      if k:pulse_burning(p[1], p[2], k.t + 0.3 * (i - 1) + 0.25) or k:pulse_burning(p[1], p[2], k.t + 0.3 * (i - 1) - 0.1) or k:pulse_burning(p[1], p[2], k.t) then return out end
    end
  end
  local tx, tz = cx - 0.5, cz - 0.5
  local dx, dz = tx - c.x, tz - c.z
  local len = math.sqrt(dx * dx + dz * dz)
  if len > 0.01 then out.mx, out.mz = dx / len, dz / len end
  -- on ice, ease off when near the target so as not to slide past it
  local here = k:floor_at(c.x, c.z)
  if here == "ice" and len < 0.9 then out.mx, out.mz = out.mx * 0.3, out.mz * 0.3 end
  return out
end

return Bot

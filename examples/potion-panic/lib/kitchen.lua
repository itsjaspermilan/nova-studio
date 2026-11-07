-- The rules of Potion Panic with nothing drawn: a workshop on a grid, the apprentice, the stations (crates, worktops, mortar, cauldron, hatch, bin), the items they
-- carry, the orders that come in, and the score. The play scene feeds it the stick and buttons and draws what it holds (lib/view.lua).
local data = require("lib.data")

local Kitchen = {}
Kitchen.__index = Kitchen

local RADIUS = 0.3
local WALK, DASH_SPEED, DASH_TIME, DASH_COOLDOWN = 4.1, 9.0, 0.2, 0.9
local GRIND_TIME = 1.7
local BURN_AFTER = 9 -- seconds a finished brew can wait before it burns
local REACH = 0.62
local FILL_TIME = 0.0

Kitchen.RADIUS = RADIUS

-- Free Brew's rules and the campaign's (which is the first of each choice)
Kitchen.DEFAULT_RULES = { time = 0, pace = 2, burn = true, value = 1, hazards = true, slippery = false, recipes = "level" }

local STATION = { T = "counter", B = "bottles", M = "mortar", C = "cauldron", S = "hatch", X = "bin" }
local BELT = { [">"] = { 1, 0 }, ["<"] = { -1, 0 }, ["^"] = { 0, -1 }, w = { 0, 1 } }

-- a small random generator of our own, so that a level with a seed plays out the same way (the tests rely on it)
local function rng(seed)
  local s = (seed or 1) % 2147483647
  if s <= 0 then s = s + 2147483646 end
  return function(n)
    s = (s * 48271) % 2147483647
    return s % n + 1
  end
end

-- how many of each kind of item a list holds, as a key: "glowcap:1,sunpetal:0" sorted
local function key_of(items)
  local list = {}
  for _, it in ipairs(items) do list[#list + 1] = it[1] .. ":" .. ((it[2] or it.ground) and "g" or "r") end
  table.sort(list)
  return table.concat(list, ",")
end

local function subset(small, big)
  -- whether the items of `small` (a sorted key list) all appear in `big`, with at least one item left over
  local count = {}
  for _, it in ipairs(big) do count[it] = (count[it] or 0) + 1 end
  for _, it in ipairs(small) do
    if not count[it] or count[it] == 0 then return false end
    count[it] = count[it] - 1
  end
  return #big > #small
end

local function split(key)
  local out = {}
  for part in key:gmatch("[^,]+") do out[#out + 1] = part end
  return out
end

-- which potions a level brews, given the rules
function Kitchen.recipes_for(level, rules)
  local list = {}
  if rules.recipes == "all" then
    local have = {}
    for _, id in ipairs(level.crates) do have[id] = true end
    local order = { "heal", "night", "swift", "frost", "fire", "bog", "ember", "mire", "glacier", "panacea" }
    for _, id in ipairs(order) do
      local ok = true
      for _, it in ipairs(data.recipes[id].items) do if not have[it[1]] then ok = false end end
      if ok then list[#list + 1] = id end
    end
  elseif rules.recipes == "easy" then
    for _, id in ipairs(level.recipes) do
      if #data.recipes[id].items == 2 then list[#list + 1] = id end
    end
    if #list == 0 then list[1] = level.recipes[1] end
  else
    for _, id in ipairs(level.recipes) do list[#list + 1] = id end
  end
  return list
end

-- level: an entry of data.levels; rules: see DEFAULT_RULES (missing entries take the defaults); seed: for the orders
function Kitchen.new(level, rules, seed)
  local k = setmetatable({}, Kitchen)
  k.level = level
  k.rules = {}
  for key, v in pairs(Kitchen.DEFAULT_RULES) do k.rules[key] = v end
  for key, v in pairs(rules or {}) do k.rules[key] = v end
  k.rand = rng(seed or 1)
  k.events = {}
  k.t = 0
  k.score = 0
  k.stats = { served = 0, expired = 0, burnt = 0, sludge = 0, fell = 0, tips = 0 }
  k.over = false
  k.orders = {}
  k.next_order_id = 1
  k.recipes = Kitchen.recipes_for(level, k.rules)
  k.time_left = (k.rules.time > 0) and k.rules.time or level.time
  k.endless = false
  -- the map
  k.rows = #level.map
  k.cols = 0
  for _, line in ipairs(level.map) do k.cols = math.max(k.cols, #line) end
  k.floor, k.solid, k.station = {}, {}, {}
  k.stations = {}
  for z = 1, k.rows do
    k.floor[z], k.solid[z], k.station[z] = {}, {}, {}
    local line = level.map[z]
    for x = 1, k.cols do
      local ch = line:sub(x, x)
      if ch == "" then ch = " " end
      local floor = "floor"
      local solid = false
      if ch == "#" or ch == " " then
        solid = true
        floor = nil
      elseif ch == "@" then
        k.start = { x = x - 0.5, z = z - 0.5 }
      elseif ch == "i" then floor = "ice"
      elseif ch == "m" then floor = "mud"
      elseif ch == "L" then floor = "lava"
      elseif ch == "v" then floor = "pulse"
      elseif BELT[ch] then floor = "belt:" .. ch
      elseif STATION[ch] or ch:match("^[a-d]$") then
        solid = true
        local st = { x = x, z = z, cx = x - 0.5, cz = z - 0.5 }
        if ch:match("^[a-d]$") then
          st.kind = "crate"
          st.ing = level.crates[ch:byte() - 96]
          assert(st.ing, "level " .. level.id .. ": crate " .. ch .. " has no ingredient")
        else
          st.kind = STATION[ch]
        end
        if st.kind == "cauldron" then st.items, st.state, st.timer = {}, "idle", 0 end
        if st.kind == "mortar" then st.progress = 0 end
        k.station[z][x] = st
        k.stations[#k.stations + 1] = st
        floor = nil
      end
      if floor and not k.rules.hazards and (floor == "lava" or floor == "pulse" or floor == "mud" or floor:sub(1, 4) == "belt") then floor = "floor" end
      if floor and k.rules.slippery then floor = "ice" end
      k.floor[z][x] = floor
      k.solid[z][x] = solid
    end
  end
  assert(k.start, "level " .. level.id .. " has no start (@)")
  k.chef = { x = k.start.x, z = k.start.z, vx = 0, vz = 0, fx = 0, fz = 1, held = nil, dash_t = 0, dash_cd = 0, dead = 0, work = 0, target = nil, step_t = 0 }
  k.order_wait = 3
  local temper = data.biomes[level.biome].cauldron or { brew = 1, burn = 1 }
  k.temper = temper
  k.burn_after = BURN_AFTER * temper.burn
  k.drops, k.shots = {}, {}
  k.last_recipe = nil
  -- which brews could still be added to (so that the cauldron does not start too early)
  k.recipe_keys = {}
  for _, id in ipairs(k.recipes) do k.recipe_keys[id] = split(key_of(data.recipes[id].items)) end
  return k
end

function Kitchen:emit(e)
  self.events[#self.events + 1] = e
end

function Kitchen:take_events()
  local e = self.events
  self.events = {}
  return e
end

-- ---- the floor ------------------------------------------------------------------------------------------------------------------

-- whether a pulsing lava cell is burning now (it comes and goes: 4 seconds safe, 3 burning, each cell a little out of step with the next)
function Kitchen:pulse_burning(x, z, t)
  local phase = (t + x * 0.45) % 7
  return phase >= 4, phase >= 3.2 and phase < 4 -- (burning, about to)
end

function Kitchen:floor_at(x, z)
  local cx, cz = math.floor(x) + 1, math.floor(z) + 1
  return self.floor[cz] and self.floor[cz][cx], cx, cz
end

function Kitchen:blocked(cx, cz)
  if cx < 1 or cz < 1 or cx > self.cols or cz > self.rows then return true end
  return self.solid[cz][cx]
end

-- ---- moving -----------------------------------------------------------------------------------------------------------------------

local function move_axis(self, c, dx, dz)
  c.x, c.z = c.x + dx, c.z + dz
  local x0, x1 = math.floor(c.x - RADIUS) + 1, math.floor(c.x + RADIUS) + 1
  local z0, z1 = math.floor(c.z - RADIUS) + 1, math.floor(c.z + RADIUS) + 1
  local hit = false
  for cz = z0, z1 do
    for cx = x0, x1 do
      -- (only a cell the circle's box really overlaps counts: one it merely touches does not)
      local eps = 1e-6
      local overlaps = c.x + RADIUS > cx - 1 + eps and c.x - RADIUS < cx - eps and c.z + RADIUS > cz - 1 + eps and c.z - RADIUS < cz - eps
      if overlaps and self:blocked(cx, cz) then
        -- the cell's box is [cx - 1, cx] by [cz - 1, cz]
        if dx > 0 then c.x = math.min(c.x, cx - 1 - RADIUS) hit = true
        elseif dx < 0 then c.x = math.max(c.x, cx + RADIUS) hit = true
        elseif dz > 0 then c.z = math.min(c.z, cz - 1 - RADIUS) hit = true
        elseif dz < 0 then c.z = math.max(c.z, cz + RADIUS) hit = true end
      end
    end
  end
  return hit
end

function Kitchen:move_chef(dt, mx, mz, dash)
  local c = self.chef
  local len = math.sqrt(mx * mx + mz * mz)
  if len > 1 then mx, mz = mx / len, mz / len end
  if len > 0.15 then c.fx, c.fz = mx / len, mz / len end
  local floor = self:floor_at(c.x, c.z)
  local speed = WALK
  local accel = 40
  if floor == "ice" then accel = 3.2 end
  if floor == "mud" then speed = WALK * 0.5 end
  if dash and c.dash_cd <= 0 and len > 0.15 then
    c.dash_t, c.dash_cd = DASH_TIME, DASH_COOLDOWN
    c.vx, c.vz = c.fx * DASH_SPEED, c.fz * DASH_SPEED
    self:emit({ type = "dash" })
  end
  if c.dash_t > 0 then
    c.dash_t = c.dash_t - dt
  else
    local tx, tz = mx * speed, mz * speed
    local k = math.min(1, accel * dt)
    c.vx, c.vz = c.vx + (tx - c.vx) * k, c.vz + (tz - c.vz) * k
  end
  c.dash_cd = math.max(0, c.dash_cd - dt)
  local bx, bz = 0, 0
  if floor and floor:sub(1, 5) == "belt:" then
    local b = BELT[floor:sub(6)]
    bx, bz = b[1] * 1.7, b[2] * 1.7
  end
  local step = 1 / 60
  local steps = math.max(1, math.ceil(dt / step))
  local sdt = dt / steps
  local hit_x, hit_z = false, false
  for _ = 1, steps do
    if move_axis(self, c, (c.vx + bx) * sdt, 0) then hit_x = true end
    if move_axis(self, c, 0, (c.vz + bz) * sdt) then hit_z = true end
  end
  if hit_x then c.vx = 0 end
  if hit_z then c.vz = 0 end
  c.moving = len > 0.15 or c.dash_t > 0
  if c.moving then
    c.step_t = c.step_t + dt * (c.dash_t > 0 and 12 or 8)
    if c.step_t >= 1 then c.step_t = 0; self:emit({ type = "step", ice = floor == "ice" }) end
  end
end

-- ---- what the apprentice faces -----------------------------------------------------------------------------------------------------

function Kitchen:target()
  local c = self.chef
  local dx, dz
  if math.abs(c.fx) > math.abs(c.fz) then dx, dz = (c.fx > 0 and 1 or -1), 0 else dx, dz = 0, (c.fz > 0 and 1 or -1) end
  c.dir = { dx, dz }
  for _, off in ipairs({ 0, 0.3, -0.3 }) do
    local px = c.x + dx * REACH + (dz ~= 0 and off or 0)
    local pz = c.z + dz * REACH + (dx ~= 0 and off or 0)
    local cx, cz = math.floor(px) + 1, math.floor(pz) + 1
    local st = self.station[cz] and self.station[cz][cx]
    if st then return st end
  end
  return nil
end

-- ---- items ------------------------------------------------------------------------------------------------------------------------

local function ing(id, ground) return { k = "ing", id = id, ground = ground or false } end
local function is_ing(it) return it and it.k == "ing" end

-- the potion that a cauldron's contents make, or nil if they make none (yet); `wait` is true when they could still become one
function Kitchen:brew_of(items)
  local list = {}
  for _, it in ipairs(items) do list[#list + 1] = it.id .. ":" .. (it.ground and "g" or "r") end
  table.sort(list)
  local key = table.concat(list, ",")
  local match
  for _, id in ipairs(self.recipes) do
    if key_of(data.recipes[id].items) == key then match = id end
  end
  -- (it keeps waiting if a bigger potion could still be made from these)
  local wait = false
  for _, id in ipairs(self.recipes) do
    if id ~= match and subset(list, self.recipe_keys[id]) then wait = true end
  end
  return match, wait
end

function Kitchen:add_to_cauldron(st, item)
  st.items[#st.items + 1] = item
  self:emit({ type = "pot_add", st = st })
  local match, wait = self:brew_of(st.items)
  if match and not wait then
    st.state, st.timer, st.recipe, st.total = "brewing", 0, match, data.recipes[match].brew * self.temper.brew
    self:emit({ type = "brew_start", st = st })
  elseif #st.items >= 3 and not match then
    st.state, st.timer, st.recipe, st.total = "brewing", 0, "sludge", 5 * self.temper.brew
    self:emit({ type = "brew_start", st = st })
  end
end

-- ---- what the buttons would do now ---------------------------------------------------------------------------------------------------------

-- Returns { a = "text" or nil, b = "text" or nil }: what A and B do at the station the apprentice faces, so that the screen can say so.
function Kitchen:prompt()
  local c = self.chef
  if c.dead > 0 then return {} end
  local st = self:target()
  if not st then
    if not c.held and self:near_drop() then return { a = "Pick up " .. data.ingredients[self.drops[self:near_drop()].item.id].name } end
    return {}
  end
  local held = c.held
  local kind = st.kind
  local function name(item)
    if item.k == "ing" then return (item.ground and "ground " or "") .. data.ingredients[item.id].name end
    if item.k == "bottle" then return "bottle" end
    return item.recipe == "sludge" and "sludge" or data.recipes[item.recipe].name
  end
  if kind == "crate" then
    return { a = (not held) and ("Take " .. data.ingredients[st.ing].name) or nil }
  elseif kind == "bottles" then
    return { a = (not held) and "Take a bottle" or nil }
  elseif kind == "counter" then
    if held and not st.item then return { a = "Put down" } end
    if not held and st.item then return { a = "Pick up " .. name(st.item) } end
    return {}
  elseif kind == "mortar" then
    if held and not st.item and is_ing(held) and not held.ground then return { a = "Put in the mortar" } end
    if not held and st.item then
      return { a = st.item.ground and ("Take the " .. name(st.item)) or "Take it back", b = (not st.item.ground) and "Hold to grind" or nil }
    end
    return {}
  elseif kind == "cauldron" then
    if st.state == "brewing" then return { b = "Hold to stir (faster)" } end
    if held and is_ing(held) and st.state == "idle" and #st.items < 3 then return { a = "Add to the cauldron" } end
    if held and held.k == "bottle" and st.state == "done" then return { a = "Fill the bottle" } end
    if held and held.k == "bottle" and st.state == "burnt" then return { a = "Scoop the sludge" } end
    if not held and st.state == "idle" and #st.items > 0 then return { a = "Take the last one out" } end
    if st.state == "brewing" then return {} end
    return {}
  elseif kind == "hatch" then
    if held and held.k == "potion" then return { a = (held.recipe == "sludge") and "Not an order" or "Serve " .. name(held) } end
    return {}
  elseif kind == "bin" then
    return { a = held and ("Throw away " .. name(held)) or nil }
  end
  return {}
end

-- ---- the buttons -------------------------------------------------------------------------------------------------------------------

-- the nearest thing lying on the floor in front of the apprentice
function Kitchen:near_drop()
  local c = self.chef
  local px, pz = c.x + c.fx * 0.45, c.z + c.fz * 0.45
  local best, bd
  for i, d in ipairs(self.drops) do
    local dist = math.sqrt((d.x - px) ^ 2 + (d.z - pz) ^ 2)
    if dist < 1.0 and (not bd or dist < bd) then best, bd = i, dist end
  end
  return best
end

function Kitchen:grab()
  local c = self.chef
  local st = self:target()
  if not st then
    if not c.held then
      local i = self:near_drop()
      if i then
        c.held = table.remove(self.drops, i).item
        self:emit({ type = "grab" })
      end
    end
    return
  end
  local held = c.held
  local kind = st.kind
  if kind == "crate" then
    if not held then c.held = ing(st.ing); self:emit({ type = "grab", st = st }) else self:emit({ type = "nope" }) end
  elseif kind == "bottles" then
    if not held then c.held = { k = "bottle" }; self:emit({ type = "grab", st = st }) else self:emit({ type = "nope" }) end
  elseif kind == "counter" then
    if held and not st.item then st.item, c.held = held, nil; self:emit({ type = "drop", st = st })
    elseif not held and st.item then c.held, st.item = st.item, nil; self:emit({ type = "grab", st = st })
    elseif held and st.item then self:emit({ type = "nope" }) end
  elseif kind == "mortar" then
    if held and not st.item and is_ing(held) and not held.ground then
      st.item, st.progress, c.held = held, 0, nil
      self:emit({ type = "drop", st = st })
    elseif not held and st.item then
      c.held, st.item, st.progress = st.item, nil, 0
      self:emit({ type = "grab", st = st })
    else
      self:emit({ type = "nope" })
    end
  elseif kind == "cauldron" then
    if held and is_ing(held) and st.state == "idle" and #st.items < 3 then
      c.held = nil
      self:add_to_cauldron(st, held)
    elseif held and held.k == "bottle" and (st.state == "done" or st.state == "burnt") then
      local recipe = (st.state == "burnt") and "sludge" or st.recipe
      c.held = { k = "potion", recipe = recipe }
      self:emit({ type = "fill", st = st, recipe = recipe })
      st.items, st.state, st.timer, st.recipe, st.warned = {}, "idle", 0, nil, nil
    elseif not held and st.state == "idle" and #st.items > 0 then
      -- take the last thing back out
      c.held = table.remove(st.items)
      self:emit({ type = "grab", st = st })
    else
      self:emit({ type = "nope" })
    end
  elseif kind == "hatch" then
    if held and held.k == "potion" then
      self:serve(held)
    elseif held then
      self:emit({ type = "nope" })
    end
  elseif kind == "bin" then
    if held then
      self:emit({ type = "bin", item = held })
      c.held = nil
    end
  end
end

function Kitchen:serve(potion)
  local c = self.chef
  if potion.recipe == "sludge" then
    self:emit({ type = "reject" })
    return false
  end
  local best
  for i, o in ipairs(self.orders) do
    if o.recipe == potion.recipe and (not best or o.t < self.orders[best].t) then best = i end
  end
  if not best then self:emit({ type = "reject" }); return false end
  local o = table.remove(self.orders, best)
  local base = math.floor(data.recipes[o.recipe].value * self.rules.value)
  local tip = math.floor(base * 0.5 * math.max(0, o.t / o.total))
  self.score = self.score + base + tip
  self.stats.served = self.stats.served + 1
  self.stats.tips = self.stats.tips + tip
  c.held = nil
  self:emit({ type = "serve", recipe = o.recipe, points = base + tip, tip = tip })
  return true
end

-- Where a thrown item can land: puts it into the station if the station takes it. Returns true if it did.
function Kitchen:put_item(st, item)
  local kind = st.kind
  if kind == "counter" and not st.item then st.item = item; self:emit({ type = "drop", st = st }); return true end
  if kind == "mortar" and not st.item and is_ing(item) and not item.ground then st.item, st.progress = item, 0; self:emit({ type = "drop", st = st }); return true end
  if kind == "cauldron" and is_ing(item) and st.state == "idle" and #st.items < 3 then self:add_to_cauldron(st, item); return true end
  if kind == "hatch" and item.k == "potion" then return self:serve(item) end
  if kind == "bin" then self:emit({ type = "bin", item = item }); return true end
  return false
end

-- (Y): throws what is held, straight ahead, up to five cells; it lands in the station it hits if that takes it, else on the floor (a bottle or a potion breaks)
function Kitchen:throw()
  local c = self.chef
  if c.dead > 0 or not c.held then return end
  local item = c.held
  c.held = nil
  local len = math.sqrt(c.fx * c.fx + c.fz * c.fz)
  local dx, dz = c.fx / len, c.fz / len
  self.shots[#self.shots + 1] = { item = item, x = c.x + dx * 0.4, z = c.z + dz * 0.4, dx = dx, dz = dz, travel = 0, range = 5.5, px = c.x, pz = c.z }
  self:emit({ type = "throw" })
end

function Kitchen:land(x, z, item)
  local floor = self:floor_at(x, z)
  if floor == "lava" then self:emit({ type = "lost", x = x, z = z }); return end
  if item.k == "ing" then
    if #self.drops >= 8 then table.remove(self.drops, 1) end
    self.drops[#self.drops + 1] = { x = x, z = z, item = item }
    self:emit({ type = "drop" })
  else
    self:emit({ type = "shatter", x = x, z = z })
  end
end

function Kitchen:update_shots(dt)
  for i = #self.shots, 1, -1 do
    local s = self.shots[i]
    local step = 12 * dt
    s.px, s.pz = s.x, s.z
    s.x, s.z = s.x + s.dx * step, s.z + s.dz * step
    s.travel = s.travel + step
    local cx, cz = math.floor(s.x) + 1, math.floor(s.z) + 1
    local done = false
    if self:blocked(cx, cz) then
      local st = self.station[cz] and self.station[cz][cx]
      if not (st and self:put_item(st, s.item)) then self:land(s.px, s.pz, s.item) end
      done = true
    elseif s.travel >= s.range then
      self:land(s.x, s.z, s.item)
      done = true
    end
    if done then table.remove(self.shots, i) end
  end
end

-- (B) held: grinds what is in the mortar
function Kitchen:work(dt, down)
  local c = self.chef
  c.work = 0
  if not down then return end
  local st = self:target()
  if st and st.kind == "cauldron" and st.state == "brewing" then
    c.work = 2
    st.timer = st.timer + dt * 1.2 -- (stirring brews faster)
    st.stirred = self.t
    self.stirring = st
  end
  if st and st.kind == "mortar" and st.item and not st.item.ground then
    c.work = 1
    if st.progress == 0 then self:emit({ type = "grind_start", st = st }) end
    st.progress = st.progress + dt / GRIND_TIME
    self.grinding = st
    if st.progress >= 1 then
      st.progress = 1
      st.item.ground = true
      self:emit({ type = "ground", st = st })
    end
  end
end

-- ---- orders -----------------------------------------------------------------------------------------------------------------------

function Kitchen:pace()
  return ({ 1.4, 1, 0.7 })[self.rules.pace] or 1
end

function Kitchen:new_order()
  local id
  for _ = 1, 6 do
    id = self.recipes[self.rand(#self.recipes)]
    if id ~= self.last_recipe or #self.recipes == 1 then break end
  end
  self.last_recipe = id
  local patience = self.level.patience * ({ 1.3, 1, 0.8 })[self.rules.pace]
  local o = { id = self.next_order_id, recipe = id, t = patience, total = patience, age = 0 }
  self.next_order_id = self.next_order_id + 1
  self.orders[#self.orders + 1] = o
  self:emit({ type = "order", order = o })
end

-- ---- the update -------------------------------------------------------------------------------------------------------------------

-- input: { mx, mz (the stick, -1 to 1; z is down the screen), grab (pressed), work (held), dash (pressed) }
function Kitchen:update(dt, input)
  if self.over then return end
  input = input or {}
  self.t = self.t + dt
  local c = self.chef
  -- falling in the lava
  if c.dead > 0 then
    c.dead = c.dead - dt
    if c.dead <= 0 then
      c.x, c.z, c.vx, c.vz, c.dead = self.start.x, self.start.z, 0, 0, 0
      self:emit({ type = "respawn" })
    end
  else
    self:move_chef(dt, input.mx or 0, input.mz or 0, input.dash)
    local floor, cx, cz = self:floor_at(c.x, c.z)
    local burning = floor == "lava"
    if floor == "pulse" then burning = self:pulse_burning(cx, cz, self.t) end
    if burning and c.dash_t <= 0 then
      c.dead = 1.4
      if c.held then c.held = nil end
      self.stats.fell = self.stats.fell + 1
      self:emit({ type = "lava" })
    end
    if input.grab then self:grab() end
    if input.throw then self:throw() end
    self:work(dt, input.work)
  end
  self:update_shots(dt)
  -- the stations
  for _, st in ipairs(self.stations) do
    if st.kind == "cauldron" then
      if st.state == "brewing" then
        st.timer = st.timer + dt
        if st.timer >= st.total then
          st.state, st.timer = "done", 0
          self:emit({ type = "brew_done", st = st })
        end
      elseif st.state == "done" and self.rules.burn then
        st.timer = st.timer + dt
        if st.timer >= self.burn_after - 3 and not st.warned then
          st.warned = true
          self:emit({ type = "warn", st = st })
        end
        if st.timer >= self.burn_after then
          st.state, st.timer = "burnt", 0
          self.stats.burnt = self.stats.burnt + 1
          self:emit({ type = "burnt", st = st })
        end
      end
    end
  end
  -- the orders
  for i = #self.orders, 1, -1 do
    local o = self.orders[i]
    o.t = o.t - dt
    o.age = (o.age or 0) + dt
    if o.t <= 0 then
      table.remove(self.orders, i)
      self.stats.expired = self.stats.expired + 1
      self.score = self.score - 10
      self:emit({ type = "expire", order = o })
    end
  end
  self.order_wait = self.order_wait - dt
  if self.order_wait <= 0 and #self.orders < 4 then
    self:new_order()
    self.order_wait = self.level.interval * self:pace()
  end
  if #self.orders == 0 and self.order_wait > 4 then self.order_wait = 2 end
  -- the clock
  self.time_left = self.time_left - dt
  if self.time_left <= 0 then
    self.time_left = 0
    self.over = true
    self:emit({ type = "time_up" })
  end
end

-- how many stars a score earns (0 to 3)
function Kitchen:stars()
  local n = 0
  for i, s in ipairs(self.level.stars) do if self.score >= s then n = i end end
  return n
end

return Kitchen

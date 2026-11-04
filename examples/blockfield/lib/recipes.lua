-- What can be made. Not a grid you arrange (the handheld has no mouse): a list of things you can make from what you carry,
-- like the console editions. Some need a crafting table or a furnace within four blocks.
local blocks = require("lib.blocks")
local B, P = blocks.B, blocks.P

P[B.coal].fuel, P[B.log].fuel, P[B.birch_log].fuel, P[B.planks].fuel = 8, 2, 2, 1

local R = {}
-- need: { [name] = count }, a name with | means any of those (the first one that is carried)
local function add(out, n, need, station, kind)
  R[#R + 1] = { out = B[out], n = n, need = need, station = station, kind = kind or "craft" }
end

add("planks", 4, { ["log|birch_log"] = 1 })
add("stick", 4, { planks = 2 })
add("crafting_table", 1, { planks = 4 })
add("torch", 4, { coal = 1, stick = 1 })
add("furnace", 1, { cobblestone = 8 }, "crafting_table")
add("sandstone", 1, { sand = 4 })
add("brick", 1, { clay = 4 }, "crafting_table")
add("glass", 1, { sand = 1 }, "furnace", "smelt")
add("iron_ingot", 1, { iron_ore = 1 }, "furnace", "smelt")
add("gold_ingot", 1, { gold_ore = 1 }, "furnace", "smelt")
add("stone", 1, { cobblestone = 1 }, "furnace", "smelt")
add("pork_cooked", 1, { pork = 1 }, "furnace", "smelt")
local tools = {
  { "pickaxe", 3, 2 }, { "axe", 3, 2 }, { "shovel", 1, 2 }, { "sword", 2, 1 },
}
for _, m in ipairs({ { "wood", "planks" }, { "stone", "cobblestone" }, { "iron", "iron_ingot" }, { "diamond", "diamond" } }) do
  for _, t in ipairs(tools) do
    add(m[1] .. "_" .. t[1], 1, { [m[2]] = t[2], stick = t[3] }, "crafting_table")
  end
end

local M = { list = R }

-- which of the names in a need is carried (for "a|b")
local function resolve(inv_count, name)
  for alt in name:gmatch("[^|]+") do
    if inv_count(B[alt]) > 0 then return alt end
  end
  return (name:match("[^|]+"))
end

function M.count(inv, id)
  local n = 0
  for i = 1, 36 do if inv[i] and inv[i].id == id then n = n + inv[i].n end end
  return n
end

function M.take(inv, id, n)
  for i = 1, 36 do
    local s = inv[i]
    if s and s.id == id and n > 0 then
      local t = math.min(n, s.n)
      s.n, n = s.n - t, n - t
      if s.n <= 0 then inv[i] = nil end
    end
  end
end

-- {name, id, have, want} for each ingredient
function M.needs(inv, r)
  local out = {}
  for name, want in pairs(r.need) do
    local actual = resolve(function(id) return M.count(inv, id) end, name)
    out[#out + 1] = { name = actual, id = B[actual], have = M.count(inv, B[actual]), want = want }
  end
  table.sort(out, function(a, b) return a.name < b.name end)
  return out
end

function M.can_make(inv, r, near, fuel)
  if r.station and not near[r.station] then return false, "needs a " .. r.station:gsub("_", " ") end
  for _, n in ipairs(M.needs(inv, r)) do
    if n.have < n.want then return false, "needs " .. n.want .. " " .. n.name:gsub("_", " ") end
  end
  if r.kind == "smelt" and fuel < 1 then
    local has_fuel = false
    for i = 1, 36 do if inv[i] and P[inv[i].id].fuel then has_fuel = true end end
    if not has_fuel then return false, "needs fuel (coal, logs, planks)" end
  end
  return true
end

-- makes it; returns what did not fit (to drop on the ground) and the fuel left
function M.make(inv, r, fuel, add_to)
  for _, n in ipairs(M.needs(inv, r)) do M.take(inv, n.id, n.want) end
  if r.kind == "smelt" then
    if fuel < 1 then
      for i = 1, 36 do
        local s = inv[i]
        if s and P[s.id].fuel then
          fuel = fuel + P[s.id].fuel
          M.take(inv, s.id, 1)
          break
        end
      end
    end
    fuel = fuel - 1
  end
  local dur = P[r.out].uses
  local left = add_to(inv, r.out, r.n, dur)
  return left, fuel
end

return M

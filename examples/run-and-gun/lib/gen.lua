-- The level generator. A level is a row of CHUNKS (little scenes in scenes/chunks/, made in the scene editor) joined at their gates: the "in" gate of each is put where the
-- "out" gate of the one before it ended, so the ground carries on, even when a chunk climbs or drops. A seed decides which chunks, in what order, and which of their soldiers,
-- turrets and health packs are there: the same seed always builds the same level. Enemies are fewer at the start and more towards the end.
local rng = require("lib.rng")
local world = require("lib.world")
local gen = {}

-- the chunks to pick from for the middle of a level (the start and the boss are fixed): add the name of a new chunk here
local MIDDLE = { "flat_a", "flat_pits", "bridge", "stairs_up", "climb_ladders", "climb_shaft", "drop_down", "gauntlet", "platforms",
  "tower_up", "shaft_down", "two_floors", "three_layers", "jump_tower" }
local COUNT = 9 -- how many middle chunks a level has
local MIN_Y, MAX_Y = -1300, 1300 -- how high and how low the ground may wander (the start is at 440; smaller is higher)

local cache = {}
local function load(name)
  if cache[name] then return cache[name] end
  local d = nova.scene_data("chunks." .. name)
  assert(d, "no chunk scenes/chunks/" .. name .. ".scene.json")
  local c = { name = name, objects = {} }
  for _, o in ipairs(d.objects) do
    if o.kind == "gate" then
      if o.props and o.props.side == "out" then c.W, c.outY = o.x, o.y else c.inY = o.y end
    else
      c.objects[#c.objects + 1] = o
    end
  end
  assert(c.W and c.inY and c.outY, "chunk " .. name .. " needs a gate in and a gate out")
  cache[name] = c
  return c
end

local function copy(t)
  local out = {}
  for k, v in pairs(t or {}) do out[k] = v end
  return out
end

-- Builds the level for `seed`: makes every platform, enemy and pickup, and fills in `lib.world`. Returns the list of chunk names, in order.
function gen.build(seed)
  local r = rng.new(seed)
  local x, y = 0, 440 -- where the next chunk's "in" gate goes (the first is the start, at the left, on the ground at 440)
  local top, bottom = 440, 440
  local placed = {}
  local areas = {}

  local function place(c, progress)
    local ox, oy = x, y - c.inY
    for _, o in ipairs(c.objects) do
      local props = copy(o.props)
      local keep = true
      local chance = props.chance
      props.chance = nil
      if o.kind == "soldier" or o.kind == "turret" then
        keep = r:chance(math.min(1, (chance or 1) * (0.5 + 0.7 * progress))) -- fewer at the start, more at the end
        if o.kind == "soldier" then
          if r:chance(0.15) then props.style = (props.style == "gunner") and "rusher" or "gunner" end
          if progress > 0.5 and r:chance(0.3) then props.hp = (props.hp or 1) + 1 end -- tougher ones later (their health bar shows)
        end
      elseif o.kind == "medkit" then
        keep = r:chance(chance or 1)
      end
      if keep then
        nova.spawn(o.kind, ox + o.x, oy + o.y, props)
        if o.kind == "platform" then
          top, bottom = math.min(top, oy + o.y), math.max(bottom, oy + o.y)
        end
      end
    end
    if #placed > 0 then nova.spawn("checkpoint", ox + 40, y, {}) end -- you start again here if you are beaten in this chunk
    areas[#areas + 1] = ox
    placed[#placed + 1] = c.name
    x, y = ox + c.W, oy + c.outY
  end

  place(load("start"), 0)
  local prev = "start"
  for i = 1, COUNT do
    local progress = i / (COUNT + 1)
    -- candidates: not the one just used, and keeping the ground inside the limits
    local options, weights, total = {}, {}, 0
    for _, name in ipairs(MIDDLE) do
      local c = load(name)
      local dy = c.outY - c.inY -- negative: it climbs
      if name ~= prev and y + dy >= MIN_Y and y + dy <= MAX_Y then
        local w = 1
        if dy == 0 then w = 0.6 end -- flat ground is the least interesting
        if dy < 0 and y < -300 then w = 0.4 elseif dy < 0 and y > 300 then w = 1.8 end -- climb more from low, less from high
        if dy > 0 and y > 900 then w = 0.4 elseif dy > 0 and y < 200 then w = 2.2 end -- and drop more from high
        if math.abs(dy) > 300 then w = w * 1.3 end -- the tall ones are what make a level tall
        options[#options + 1], weights[#weights + 1] = c, w
        total = total + w
      end
    end
    local pick = r:float() * total
    local chosen = options[#options]
    for k, w in ipairs(weights) do
      pick = pick - w
      if pick <= 0 then chosen = options[k]; break end
    end
    place(chosen, progress)
    prev = chosen.name
  end
  place(load("boss"), 1)

  -- the ends of the world: walls past the edges
  nova.spawn("platform", -40, top - 1500, { w = 40, h = bottom - top + 3200, kind = "rock" })
  nova.spawn("platform", x, top - 1500, { w = 40, h = bottom - top + 3200, kind = "rock" })

  world.left, world.right, world.top, world.bottom = 0, x, top, bottom
  world.kill_y = bottom + 520 -- below the lowest ground: you are gone
  world.areas, world.seed = areas, seed
  return placed
end

-- Which chunk of the level an x position is in (1 for the start), and how many there are.
function gen.area_at(px)
  local n = 1
  for i, ax in ipairs(world.areas) do if px >= ax then n = i end end
  return n, #world.areas
end

return gen

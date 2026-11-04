-- Terrain: hills and plains, rivers, four biomes, caves, ores, trees, flowers and cacti, all from noise so that the same
-- seed always makes the same world, a chunk at a time (a chunk only places what falls inside it).
local blocks = require("lib.blocks")
local B = blocks.B

local G = { SEA = 40, seed = 20161 }
local SEA = G.SEA

local noise2, hash = nova.noise2, nova.hash
local fill, set, get, carve = nova.voxel.fill, nova.voxel.set, nova.voxel.get, nova.voxel.carve

-- how high the ground is at a column, and the biome there
function G.height(x, z)
  local s = G.seed
  local land = noise2(x * 0.004, z * 0.004, s, 3)
  local hills = noise2(x * 0.02, z * 0.02, s + 1, 4)
  local h = SEA + 7 + land * 24 + hills * 9
  -- rivers: a thin band where a second noise crosses zero
  local river = math.abs(noise2(x * 0.007, z * 0.007, s + 2, 2))
  if river < 0.04 then h = math.min(h, SEA - 2 + river * 40) end
  return math.floor(h)
end

function G.biome(x, z)
  local s = G.seed
  local t = noise2(x * 0.0025, z * 0.0025, s + 3, 2)
  local m = noise2(x * 0.0025, z * 0.0025, s + 4, 2)
  if t > 0.22 and m < 0.12 then return "desert" end
  if t < -0.28 then return "snowy" end
  if m > 0.14 then return "forest" end
  return "plains"
end

local STONEISH = { B.stone, B.dirt, B.gravel, B.grass, B.sand, B.sandstone, B.clay }

-- a small blob of one block inside stone: ore veins and lava pockets
local function blob(wx, wy, wz, id, size, salt)
  for i = 1, size do
    local x = wx + math.floor(hash(wx, wy + i, wz, salt) * 3 - 1 + 0.5)
    local y = wy + math.floor(hash(wx + i, wy, wz, salt + 1) * 3 - 1 + 0.5)
    local z = wz + math.floor(hash(wx, wy, wz + i, salt + 2) * 3 - 1 + 0.5)
    if get(x, y, z) == B.stone then set(x, y, z, id) end
  end
end

local function tree(wx, wz, ground, x0, z0, birch)
  local trunk = 4 + math.floor(hash(wx, 7, wz, G.seed + 21) * 3)
  local log, leaves = birch and B.birch_log or B.log, birch and B.birch_leaves or B.leaves
  local function put(x, y, z, id, onlyair)
    if x < x0 or x > x0 + 15 or z < z0 or z > z0 + 15 then return end -- the neighbouring chunk places its own part
    if onlyair and get(x, y, z) ~= 0 then return end
    set(x, y, z, id)
  end
  local top = ground + trunk
  for dy = top - 2, top + 1 do
    local r = dy >= top and 1 or 2
    for dx = -r, r do
      for dz = -r, r do
        local corner = math.abs(dx) == r and math.abs(dz) == r
        if not (corner and (r == 2 and hash(wx + dx, dy, wz + dz, G.seed + 22) < 0.5 or dy > top)) then
          put(wx + dx, dy, wz + dz, leaves, true)
        end
      end
    end
  end
  for y = ground + 1, top do put(wx, y, wz, log, false) end
end

-- trees that stand in a chunk or reach into it: every chunk around it is asked where its trees are
local function trees(cx, cz, x0, z0)
  for ox = -1, 1 do
    for oz = -1, 1 do
      local tx0, tz0 = (cx + ox) * 16, (cz + oz) * 16
      local biome = G.biome(tx0 + 8, tz0 + 8)
      local count = biome == "forest" and 7 or biome == "plains" and 1 or biome == "snowy" and 2 or 0
      for i = 1, count do
        local wx = tx0 + math.floor(hash(tx0, i, tz0, G.seed + 30) * 16)
        local wz = tz0 + math.floor(hash(tx0, i, tz0, G.seed + 31) * 16)
        local h = G.height(wx, wz)
        if h > SEA + 1 and G.biome(wx, wz) == biome then
          local birch = biome == "forest" and hash(wx, 0, wz, G.seed + 32) < 0.3
          tree(wx, wz, h, x0, z0, birch)
        end
      end
    end
  end
end

function G.generate(cx, cz)
  local x0, z0 = cx * 16, cz * 16
  nova.voxel.create_chunk(cx, cz)
  for lz = 0, 15 do
    for lx = 0, 15 do
      local x, z = x0 + lx, z0 + lz
      local h = G.height(x, z)
      local biome = G.biome(x, z)
      local top, under = B.grass, B.dirt
      if biome == "desert" then top, under = B.sand, B.sandstone end
      if biome == "snowy" then top = B.snowy_grass end
      if h <= SEA + 1 then top, under = B.sand, B.sand end
      if h < SEA - 3 then top, under = B.gravel, B.gravel end
      fill(x, 1, z, x, h - 4, z, B.stone)
      fill(x, h - 3, z, x, h - 1, z, under)
      set(x, h, z, top)
      set(x, 0, z, B.bedrock)
      if hash(x, 1, z, G.seed) < 0.5 then set(x, 1, z, B.bedrock) end
      if h < SEA then fill(x, h + 1, z, x, SEA, z, h < SEA - 1 and B.water or B.water) end
      if h < SEA and biome == "snowy" then set(x, SEA, z, B.ice) end
    end
  end
  -- caves: winding tunnels everywhere under the ground, and a few big rooms deep down
  local through = STONEISH
  carve(x0, 5, z0, x0 + 15, 62, z0 + 15, { through = through, seed = G.seed + 40, scale = 0.05, squash = 1.4, threshold = 0.075, kind = "tunnel" })
  carve(x0, 5, z0, x0 + 15, 28, z0 + 15, { through = through, seed = G.seed + 41, scale = 0.035, squash = 1.5, threshold = 0.38, kind = "cavern" })
  -- ores
  local salt = G.seed + 50
  local function veins(id, tries, ymin, ymax, size)
    salt = salt + 7
    for i = 1, tries do
      local wx = x0 + math.floor(hash(cx, i, cz, salt) * 16)
      local wy = ymin + math.floor(hash(cx, i, cz, salt + 1) * (ymax - ymin))
      local wz = z0 + math.floor(hash(cx, i, cz, salt + 2) * 16)
      blob(wx, wy, wz, id, size, salt + 3 + i)
    end
  end
  veins(B.coal_ore, 14, 6, 70, 8)
  veins(B.iron_ore, 9, 6, 52, 5)
  veins(B.gold_ore, 2, 6, 26, 5)
  veins(B.diamond_ore, 2, 5, 16, 4)
  veins(B.gravel, 3, 10, 60, 10)
  veins(B.clay, 1, SEA - 6, SEA, 8)
  -- lava pockets near the bottom
  for i = 1, 2 do
    local wx = x0 + math.floor(hash(cx, i, cz, salt + 90) * 16)
    local wz = z0 + math.floor(hash(cx, i, cz, salt + 91) * 16)
    local wy = 6 + math.floor(hash(cx, i, cz, salt + 92) * 5)
    if get(wx, wy, wz) == 0 then set(wx, wy, wz, B.lava) end
  end
  -- on the surface: trees, grass, flowers, cactus
  trees(cx, cz, x0, z0)
  for lz = 0, 15 do
    for lx = 0, 15 do
      local x, z = x0 + lx, z0 + lz
      local h = G.height(x, z)
      local ground = get(x, h, z)
      if h > SEA and get(x, h + 1, z) == 0 then
        local r = hash(x, 3, z, G.seed + 60)
        if ground == B.grass then
          if r < 0.12 then set(x, h + 1, z, B.tall_grass)
          elseif r < 0.125 then set(x, h + 1, z, B.dandelion)
          elseif r < 0.13 then set(x, h + 1, z, B.rose) end
        elseif ground == B.sand and G.biome(x, z) == "desert" and r < 0.012 then
          for y = h + 1, h + 1 + math.floor(hash(x, 4, z, G.seed + 61) * 3) do set(x, y, z, B.cactus) end
        end
      end
    end
  end
end

return G

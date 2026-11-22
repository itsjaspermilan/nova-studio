-- Courses made up on the device from a seed and a few settings: the custom stage and the Daily Race. The same share code always gives
-- the same course on every machine, so everything that decides the route is integer arithmetic or + - * / and square roots (which IEEE
-- doubles round the same everywhere), with sines and arc tangents of our own made of those; no math.random, no clock, no math.sin.
--
--   generate.settings_default()          the settings a new player starts with
--   generate.encode(s) / decode(code)     the share code ("ABCD-EFGH": eight letters that hold the settings, the seed and a check)
--   generate.course(s)                    the course: its route (a line every metre, waypoints every 10 m), its looks, its scenery list;
--                                         made once per code and kept (generate.route(s) is the route alone, for the menus' map)
--   generate.build(course)                in the course's scene: the settings, waypoints, gates, grid, scenery, grass and the road mesh
--   generate.entry(s, extra)              the course as the menus and the race know a course (state.current_track())
--
-- The road is a ribbon mesh made here with nova.mesh.make, with the cross-section, colours and texture layout of the studio's road_make
-- (scripts/lib/trackgen.mjs, texturedRoadGlb), and the look (road pictures) of a stage made with it. The scenery follows the rules of
-- trackgen's `layout` (trees, bushes, rocks, far trees, tyres and chevrons on the bends, barriers on the outside of the bends, lamps at
-- night, hay bales, the stands, tents, banners, flags, boards and crowd), placed from the course's own seed.
local generate = {}

generate.VERSION = 1 -- the generator's version: in every code, so that a change here never gives an old code a different course

-- ---- deterministic numbers ------------------------------------------------------------------------------------------------------
-- splitmix64 on Lua's 64-bit integers (they wrap round the same everywhere)
local function mix64(x)
  x = x ~ (x >> 30); x = x * 0xbf58476d1ce4e5b9
  x = x ~ (x >> 27); x = x * 0x94d049bb133111eb
  return x ~ (x >> 31)
end
generate.mix64 = mix64

-- A stream of numbers from `seed`: r() is 0 <= r < 1 (53 bits, exact), r:int(n) is 1..n.
local INV53 = 1 / 9007199254740992
local Rng = {}
Rng.__index = Rng
Rng.__call = function(self)
  self.s = self.s + 0x9e3779b97f4a7c15
  return (mix64(self.s) >> 11) * INV53
end
function Rng:int(n) return math.floor(self() * n) + 1 end
function Rng:range(a, b) return a + (b - a) * self() end
local function rng(seed) return setmetatable({ s = mix64(seed + 0x632be59bd9b4e019) }, Rng) end
generate.rng = rng

-- FNV-1a over a string, 64 bits
function generate.hash(text)
  local h = -3750763034362895579 -- 0xcbf29ce484222325
  for i = 1, #text do
    h = h ~ text:byte(i)
    h = h * 0x100000001b3
  end
  return mix64(h)
end

-- sine, cosine and arc tangents from + - * / and sqrt only (math.sin and math.atan are the C library's, which may differ in the last bit)
local PI, TAU, HALF = 3.141592653589793, 6.283185307179586, 1.5707963267948966
local S3, S5, S7, S9, S11, S13, S15, S17 = -1 / 6, 1 / 120, -1 / 5040, 1 / 362880, -1 / 39916800, 1 / 6227020800, -1 / 1307674368000, 1 / 355687428096000
local function dsin(x)
  x = x - math.floor(x / TAU + 0.5) * TAU
  if x > HALF then x = PI - x elseif x < -HALF then x = -PI - x end
  local q = x * x
  return x * (1 + q * (S3 + q * (S5 + q * (S7 + q * (S9 + q * (S11 + q * (S13 + q * (S15 + q * S17))))))))
end
local function dcos(x) return dsin(x + HALF) end
local function datan(x)
  local sign = 1
  if x < 0 then sign, x = -1, -x end
  local big = x > 1
  if big then x = 1 / x end
  -- twice halved: atan(x) = 2 atan(x / (1 + sqrt(1 + x²)))
  x = x / (1 + math.sqrt(1 + x * x))
  x = x / (1 + math.sqrt(1 + x * x))
  local q = x * x
  local s = x * (1 + q * (-1 / 3 + q * (1 / 5 + q * (-1 / 7 + q * (1 / 9 + q * (-1 / 11 + q * (1 / 13 + q * (-1 / 15 + q * (1 / 17))))))))) * 4
  if big then s = HALF - s end
  return sign * s
end
local function datan2(y, x)
  if x > 0 then return datan(y / x) end
  if x < 0 then return y >= 0 and datan(y / x) + PI or datan(y / x) - PI end
  if y > 0 then return HALF elseif y < 0 then return -HALF end
  return 0
end
generate.dsin, generate.dcos, generate.datan2 = dsin, dcos, datan2

local function r1(v) return math.floor(v * 10 + 0.5) / 10 end
local function r3(v) return math.floor(v * 1000 + 0.5) / 1000 end
local function wrap(a)
  while a > PI do a = a - TAU end
  while a < -PI do a = a + TAU end
  return a
end

-- ---- the settings -----------------------------------------------------------------------------------------------------------------
-- The places, each the look of the hand-made stages of that country (their race and foliage objects, and their track files' scenery).
local FOREST_TREES = { "nk_pinetall_a", "nk_pinetall_b", "nk_pinetall_c", "nk_pinetall_d", "nk_pineround_a", "nk_pineround_c", "nk_pineround_e", "nk_pinesmall_a", "nk_pinesmall_c", "nk_oak", "nk_default", "nk_tall", "nk_fat", "nk_thin", "nk_oak_fall", "pine", "pine_dark", "birch" }
local CROWD = { "crowd_fa", "crowd_fb", "crowd_fc", "crowd_fd", "crowd_ma", "crowd_mb", "crowd_mc", "crowd_md" }
generate.LOCATIONS = {
  { id = "forest", name = "Forest", look = "pine_ridge", horizon = "forest", road = "road_gravel", loose_name = "Gravel", grip = 0.88, dust = { 150, 138, 120 },
    music = "race_forest", sun_to = { 0.55, 0.62, 0.38 }, clouds = 0.4, wind = { direction = 30, strength = 1 },
    look = { ao = 0.45, ao_radius = 1, bloom = 0.3, bloom_threshold = 0.78, saturation = 1.08 },
    plants = { { model = "grass", count = 7000, sway = 0.55, tints = { { 255, 255, 255 }, { 232, 255, 220 }, { 255, 246, 205 } } }, { model = "flowers", count = 700, sway = 0.4 } },
    trees = FOREST_TREES, small = { "nk_bush_large", "nk_bush_detailed", "nk_bush_tri", "bush", "nk_stump", "nk_log", "nk_rock_largeC" },
    rock = { "nk_rock_largeA", "nk_rock_largeC", "nk_rock_largeE", "nk_rock_tallB", "nk_rock_tallF", "nk_rock_tallH" }, density = 0.5, rocks = 0.08,
    far = { kind = { "nk_pinetall_a", "nk_pinetall_d", "nk_pineround_e", "pine_dark" }, density = 0.5 }, landmarks = { kind = {}, count = 0, radius = 0 },
    roadside = { stand = "grandstand", tent = "tent_long", banner = "banner_green", flag = "flag_green", boards = { "billboard", "billboard_low" }, pylon = "pylon" },
    night_trees = { "nk_night_pinetall_a", "nk_night_pinetall_c", "nk_night_pineround_a", "nk_night_pineround_e", "nk_night_pinesmall_a", "pine_dark", "bush" } },
  { id = "autumn", name = "Autumn", look = "autumn_glen", horizon = "autumn", road = "road_gravel", loose_name = "Gravel", grip = 0.95, dust = { 170, 140, 100 },
    music = "race_forest", sun_to = { 0.62, 0.32, 0.45 }, tint = { top = { 1, 0.97, 0.92 }, horizon = { 1.04, 0.94, 0.84 } }, clouds = 0.5, wind = { direction = 250, strength = 1.4 },
    look = { ao = 0.45, ao_radius = 1, bloom = 0.35, bloom_threshold = 0.76, saturation = 1.14 },
    plants = { { model = "grass", count = 6000, sway = 0.55, tints = { { 255, 226, 150 }, { 240, 200, 120 }, { 220, 230, 150 } } }, { model = "flowers", count = 400, sway = 0.4 } },
    trees = { "nk_oak_fall", "nk_tall_fall", "nk_default_fall", "autumn_tree", "nk_oak_fall", "birch", "nk_pineround_a", "nk_tall_fall", "nk_fat", "nk_default_fall", "nk_pinetall_c" },
    small = { "nk_bush_large", "nk_stump", "nk_log", "bush", "nk_bush_detailed", "nk_rock_largeC" },
    rock = { "nk_rock_largeA", "nk_rock_largeC", "nk_rock_largeE", "nk_rock_tallB", "nk_rock_tallF" }, density = 0.5, rocks = 0.08,
    far = { kind = { "nk_tall_fall", "nk_default_fall", "nk_oak_fall", "nk_pinetall_a" }, density = 0.5 }, landmarks = { kind = {}, count = 0, radius = 150 },
    roadside = { stand = "grandstand", tent = "tent_long", banner = "banner_red", flag = "flag_red", boards = { "billboard", "billboard_low" }, pylon = "pylon" } },
  { id = "desert", name = "Canyon", look = "dust_valley", horizon = "desert", road = "road_sand", loose_name = "Sand", grip = 0.82, dust = { 214, 178, 124 },
    music = "race_desert", sun_to = { 0.7, 0.3, -0.5 }, tint = { top = { 1, 0.96, 0.9 }, horizon = { 1, 0.95, 0.88 } }, clouds = 0.25, wind = { direction = 120, strength = 1.5 },
    look = { ao = 0.4, ao_radius = 1, bloom = 0.4, bloom_threshold = 0.74, saturation = 1.06 },
    plants = { { model = "grass", count = 3500, sway = 0.5, tints = { { 255, 226, 150 }, { 240, 205, 140 }, { 255, 240, 190 } } } },
    trees = { "nk_cactus_tall", "nk_cactus_tall", "nk_cactus_short", "nk_cactus_short", "cactus", "nk_dead_thin", "nk_dead_tall", "dry_bush" },
    small = { "dry_bush", "nk_rockred_largeC", "dry_bush", "nk_stump", "nk_rockred_tallF" },
    rock = { "nk_rockred_largeA", "nk_rockred_largeC", "nk_rockred_largeE", "nk_rockred_tallB", "nk_rockred_tallF", "nk_rockred_tallH" }, density = 0.32, rocks = 0.14,
    far = { kind = { "mesa" }, density = 0.22 }, landmarks = { kind = { "mesa" }, count = 14, radius = 220 },
    roadside = { stand = "grandstand_covered", tent = "tent_long", banner = "banner_red", flag = "flag_red", boards = { "billboard", "billboard_low" }, pylon = "pylon" } },
  { id = "snow", name = "Snow", look = "frost_pass", horizon = "snow", road = "road_snow", loose_name = "Snow", grip = 0.72, dust = { 235, 240, 248 },
    music = "race_snow", sun_to = { -0.7, 0.28, -0.55 }, tint = { top = { 0.96, 1, 1.06 }, horizon = { 0.96, 0.99, 1.04 } }, clouds = 0.6, wind = { direction = 200, strength = 0.8 },
    look = { ao = 0.35, ao_radius = 1, bloom = 0.35, bloom_threshold = 0.8, saturation = 1 },
    plants = { { model = "grass", count = 1800, sway = 0.4, tints = { { 235, 245, 240 }, { 220, 235, 225 } } } },
    trees = { "nk_snow_pinetall_a", "nk_snow_pinetall_c", "nk_snow_pinetall_d", "nk_snow_pineround_a", "nk_snow_pineround_e", "nk_snow_pinesmall_a", "pine_snow", "pine_snow", "nk_pinetall_a", "nk_pineround_c" },
    small = { "bush_snow", "nk_rockice_largeC", "bush_snow", "nk_stump" },
    rock = { "nk_rockice_largeA", "nk_rockice_largeC", "nk_rockice_largeE", "nk_rockice_tallB", "nk_rockice_tallF", "nk_rockice_tallH" }, density = 0.55, rocks = 0.1,
    far = { kind = { "pine_snow", "nk_snow_pinetall_d", "nk_snow_pineround_e" }, density = 0.6 }, landmarks = { kind = {}, count = 0, radius = 0 },
    roadside = { stand = "grandstand_covered", tent = "tent_long", banner = "banner_red", flag = "flag_checkers", boards = { "billboard", "billboard_low" }, pylon = "pylon" } },
  { id = "harbour", name = "Harbour", look = "harbour_lights", horizon = "night", road = "road_asphalt", loose_name = "Gravel", loose_road = "road_gravel", grip = 0.95, dust = { 90, 100, 120 },
    music = "race_night", sun_to = { 0.3, -0.45, -0.5 }, clouds = 0.2, wind = { direction = 60, strength = 0.7 }, night_only = true,
    look = { ao = 0.4, ao_radius = 1, bloom = 0.7, bloom_threshold = 0.6, saturation = 1, vignette = 0.2 },
    plants = { { model = "grass", count = 4000, sway = 0.5, tints = { { 110, 140, 130 }, { 100, 125, 120 } } } },
    trees = { "nk_night_pinetall_a", "nk_night_pinetall_c", "nk_night_pineround_a", "nk_night_pineround_e", "nk_night_pinesmall_a", "pine_dark", "bush" },
    small = { "bush", "nk_rock_largeC", "bush", "nk_stump" }, rock = { "nk_rock_largeA", "nk_rock_largeC", "nk_rock_tallB", "nk_rock_tallF" }, density = 0.32, rocks = 0.06,
    far = { kind = { "pine_dark", "nk_night_pinetall_a", "nk_night_pineround_e" }, density = 0.3 }, landmarks = { kind = {}, count = 0, radius = 0 },
    roadside = { stand = "grandstand", tent = "tent_long", banner = "banner_green", flag = "flag_checkers", boards = { "billboard", "billboard_low" }, pylon = "pylon" } },
}
generate.TYPES = { { id = "stage", name = "Rally stage" }, { id = "circuit", name = "Circuit" } }
-- stage: metres from the start line to the finish; circuit: one lap, and the laps of a race
generate.LENGTHS = { { name = "Short", stage = 2000, lap = 1600, laps = 3 }, { name = "Medium", stage = 3500, lap = 2400, laps = 3 },
                     { name = "Long", stage = 5000, lap = 3400, laps = 2 }, { name = "Epic", stage = 8000, lap = 4800, laps = 2 } }
-- how bendy: corners a kilometre, their radii (metres, at the road's middle), the share that are hairpins, the straights between them
generate.COMPLEXITY = {
  { name = "Flowing", blurb = "Long sweepers and fast straights.", per_km = 3.2, r = { 55, 160 }, angle = { 0.35, 1.3 }, hairpin = 0, straight = { 70, 230 }, rmin = 40 },
  { name = "Mixed", blurb = "A bit of everything, now and then a hairpin.", per_km = 5.5, r = { 28, 100 }, angle = { 0.45, 1.9 }, hairpin = 0.08, straight = { 40, 160 }, rmin = 24 },
  { name = "Technical", blurb = "Bend after bend, and hairpins.", per_km = 8.5, r = { 20, 60 }, angle = { 0.6, 2.3 }, hairpin = 0.22, straight = { 25, 100 }, rmin = 18 },
}
-- the hills: two waves each (heights and wavelengths); the steepest the road can ever be is the sum of 2 pi height / wavelength
generate.HILLS = {
  { name = "Flat", waves = { { 1.2, 420 }, { 0.6, 260 } } },
  { name = "Rolling", waves = { { 5.5, 430 }, { 2.2, 260 } } },
  { name = "Mountain", waves = { { 9, 520 }, { 2.5, 320 } } },
}
generate.SURFACES = { { id = "own", name = "Location's" }, { id = "tarmac", name = "Tarmac" }, { id = "mixed", name = "Mixed" } }
generate.TIMES = { { id = "day", name = "Day" }, { id = "dusk", name = "Dusk" }, { id = "night", name = "Night" } }
generate.WEATHERS = { { id = "clear", name = "Clear" }, { id = "snow", name = "Snowing" } }
generate.SEEDS = 262144 -- 18 bits of seed in a code
generate.MAX_SLOPE = 0.16 -- the steepest the hills can make the road (16%)

local KEYS = { "location", "type", "length", "complexity", "hills", "surface", "time", "weather" }
local COUNTS = { #generate.LOCATIONS, 2, 4, 3, 3, 3, 3, 2 }
local BITS = { 3, 1, 2, 2, 2, 2, 2, 1 }
generate.KEYS, generate.COUNTS = KEYS, COUNTS

function generate.settings_default()
  return { version = generate.VERSION, location = 1, type = 1, length = 2, complexity = 2, hills = 2, surface = 1, time = 1, weather = 1, seed = 4242 }
end
function generate.copy(s)
  local c = {}
  for k, v in pairs(s) do c[k] = v end
  return c
end
-- What a setting can be, given the others: the harbour is always at night; it snows only in the snow.
function generate.allowed(s, key, v)
  local loc = generate.LOCATIONS[s.location]
  if key == "time" and loc and loc.night_only then return v == 3 end
  if key == "weather" and loc and loc.id ~= "snow" then return v == 1 end
  return true
end
-- The settings made sound (after the place changed: the harbour's night, the snow's weather).
function generate.normalise(s)
  local loc = generate.LOCATIONS[s.location]
  if loc.night_only then s.time = 3 end
  if loc.id ~= "snow" then s.weather = 1 end
  return s
end
-- Steps setting `key` by `dir` (wrapping round, skipping what is not allowed).
function generate.step(s, key, dir)
  local n
  for i, k in ipairs(KEYS) do if k == key then n = COUNTS[i] end end
  for _ = 1, n do
    s[key] = (s[key] - 1 + dir) % n + 1
    if generate.allowed(s, key, s[key]) then break end
  end
  generate.normalise(s)
end

-- ---- the share code ----------------------------------------------------------------------------------------------------------------
-- Eight letters of an alphabet without 0, O, 1 and I: 40 bits. The low four are a check of the rest; the other 36 are the version
-- (3 bits), the settings (15) and the seed (18), multiplied by an odd number (mod 2^36, which can be undone) so that one setting
-- changed changes the whole code.
generate.ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
local M36 = (1 << 36) - 1
local SCRAMBLE = 0x5DEECE66D & M36 -- odd
local UNSCRAMBLE = (function()
  local x = SCRAMBLE
  for _ = 1, 6 do x = (x * (2 - SCRAMBLE * x)) & M36 end -- (Newton's way to the inverse mod 2^36)
  return x
end)()
local function check4(payload) return (mix64(payload * 31 + 7) >> 60) & 15 end

function generate.encode(s)
  local v = s.version or generate.VERSION
  local bits = v
  local shift = 3
  for i, k in ipairs(KEYS) do
    bits = bits | ((s[k] - 1) << shift)
    shift = shift + BITS[i]
  end
  bits = bits | ((s.seed % generate.SEEDS) << shift)
  local payload = (bits * SCRAMBLE) & M36
  local all = (payload << 4) | check4(payload)
  local out = {}
  for i = 8, 1, -1 do
    local d = (all >> ((i - 1) * 5)) & 31
    out[#out + 1] = generate.ALPHABET:sub(d + 1, d + 1)
  end
  local code = table.concat(out)
  return code:sub(1, 4) .. "-" .. code:sub(5, 8)
end

-- The settings in a code, or nil and why not (in words for the player). Spaces and the dash do not matter, nor small letters.
function generate.decode(code)
  local clean = tostring(code or ""):upper():gsub("[%s%-]", "")
  if #clean ~= 8 then return nil, "A code has eight letters and numbers, like ABCD-EFGH." end
  local all = 0
  for i = 1, 8 do
    local at = generate.ALPHABET:find(clean:sub(i, i), 1, true)
    if not at then return nil, "\"" .. clean:sub(i, i) .. "\" is not in any code: codes have no 0, 1, O or I." end
    all = (all << 5) | (at - 1)
  end
  local payload = all >> 4
  if check4(payload) ~= (all & 15) then return nil, "That code does not add up: check each letter." end
  local bits = (payload * UNSCRAMBLE) & M36
  local s = { version = bits & 7 }
  local shift = 3
  for i, k in ipairs(KEYS) do
    s[k] = ((bits >> shift) & ((1 << BITS[i]) - 1)) + 1
    shift = shift + BITS[i]
  end
  s.seed = (bits >> shift) & (generate.SEEDS - 1)
  if s.version == 0 then return nil, "That code does not add up: check each letter." end
  if s.version < generate.VERSION then return nil, "That code was made with an older version of the game, which made its courses differently." end
  if s.version > generate.VERSION then return nil, "That code was made with a newer version of the game: update to play it." end
  for i, k in ipairs(KEYS) do
    if s[k] > COUNTS[i] then return nil, "That code does not add up: check each letter." end
  end
  local n = generate.normalise(generate.copy(s))
  for _, k in ipairs(KEYS) do if n[k] ~= s[k] then return nil, "That code does not add up: check each letter." end end
  return s
end

-- ---- the route --------------------------------------------------------------------------------------------------------------------
local LEAD_IN, RUNOUT = 40, 90 -- a stage's road before its start line and after its finish (metres), as trackgen's
local GAP_NEAR, GAP_FAR = 34, 50 -- parts of the road more than 60 m (and 160 m) apart along it are at least this far apart
local function half_box(length) return 600 + length / 2 end -- the land a route keeps to: a square of twice this, round the start

-- A spatial hash of the route's points (every 5 m), to find the parts of the road near a place.
local Grid = {}
Grid.__index = Grid
local GRID_CELL = 50
local function gkey(cx, cz) return (cx + 100000) * 200003 + (cz + 100000) end
local function new_grid() return setmetatable({ cells = {}, added = {} }, Grid) end
function Grid:add(i, x, z)
  local k = gkey(math.floor(x / GRID_CELL), math.floor(z / GRID_CELL))
  local c = self.cells[k]
  if not c then c = {}; self.cells[k] = c end
  c[#c + 1] = { i, x, z }
  self.added[#self.added + 1] = c
end
-- takes back the points added last, while their index is `from` or more (points are added in order)
function Grid:drop_from(from)
  local added = self.added
  while #added > 0 do
    local c = added[#added]
    if c[#c][1] < from then break end
    c[#c] = nil
    added[#added] = nil
  end
end
-- the nearest point within one cell that `skip(i)` does not rule out: distance squared and index (1e18 when none)
function Grid:nearest(x, z, skip)
  local cx, cz = math.floor(x / GRID_CELL), math.floor(z / GRID_CELL)
  local best, bi = 1e18, nil
  for gx = cx - 1, cx + 1 do
    for gz = cz - 1, cz + 1 do
      local c = self.cells[gkey(gx, gz)]
      if c then
        for j = 1, #c do
          local p = c[j]
          if not (skip and skip(p[1])) then
            local dx, dz = p[2] - x, p[3] - z
            local d = dx * dx + dz * dz
            if d < best then best, bi = d, p[1] end
          end
        end
      end
    end
  end
  return best, bi
end

-- A stage: drawn by its curvature, metre by metre (a corner eases in and out over a few metres, as a clothoid would), corner by corner,
-- each checked as it is laid: inside the land, and never near the road already laid. A corner that does not fit is tried again
-- another way; after many tries the last corner is taken back.
local function stage_route(s, r)
  local cx = generate.COMPLEXITY[s.complexity]
  local target = generate.LENGTHS[s.length].stage
  local B = half_box(target)
  -- the route so far: points every metre (x, z, heading), and the 5 m points in the grid
  local X, Z, H = { 0 }, { 0 }, { 0 }
  local grid = new_grid()
  grid:add(1, 0, 0)
  local function fits_from(from)
    -- the points laid from `from` on (every fifth metre): inside the land and far enough from the road before them
    for i = from, #X do
      if (i - 1) % 5 == 0 then
        local x, z = X[i], Z[i]
        if x < -B or x > B or z < -B or z > B then return false end
        local d2 = grid:nearest(x, z, function(j) return i - j < 60 end)
        if d2 < GAP_NEAR * GAP_NEAR then return false end
        if d2 < GAP_FAR * GAP_FAR then
          local d3 = grid:nearest(x, z, function(j) return i - j < 160 end)
          if d3 < GAP_FAR * GAP_FAR then return false end
        end
      end
    end
    return true
  end
  local function commit(from)
    for i = from, #X do if (i - 1) % 5 == 0 then grid:add(i, X[i], Z[i]) end end
  end
  local function lay(len, k0, k1)
    -- `len` metres with the curvature going from k0 to k1
    local n = #X
    local x, z, h = X[n], Z[n], H[n]
    for m = 1, len do
      local k = k0 + (k1 - k0) * (m - 0.5) / len
      h = h + k
      x = x + dsin(h)
      z = z + dcos(h)
      n = n + 1
      X[n], Z[n], H[n] = x, z, h
    end
  end
  local function cut(n) for i = #X, n + 1, -1 do X[i], Z[i], H[i] = nil, nil, nil end end

  local goal = (r() * 2 - 1) * 1.1 -- the way the stage goes, in general (radians from +z)
  lay(LEAD_IN + 130, 0, 0) -- the lead-in and a straight from the start line
  commit(2)
  local marks = { #X } -- where each corner began, to take it back
  local length_now = function() return #X - 1 - LEAD_IN end
  local tries, backs = 0, 0
  while length_now() < target do
    local from = #X + 1
    local ok = false
    for _ = 1, 14 do
      tries = tries + 1
      local hairpin = r() < cx.hairpin
      local R = hairpin and r:range(cx.rmin, cx.rmin + 6) or r:range(cx.r[1], cx.r[2])
      local A = hairpin and r:range(2.6, 3.1) or r:range(cx.angle[1], cx.angle[2])
      -- which way: either, but back towards the stage's general direction when it has wandered far from it (a stage goes from
      -- somewhere to somewhere else, and so never winds itself into a corner)
      local n = #X
      local dir = r() < 0.5 and 1 or -1
      local dev = wrap(H[n] - goal)
      if math.abs(dev) > 1.1 and r() < 0.8 then dir = dev > 0 and -1 or 1 end
      local ease = math.max(8, math.min(30, math.floor(R * 0.45)))
      if ease > A * R then ease = math.floor(A * R) end
      local hold = math.floor(A * R - ease + 0.5)
      local k = dir / R
      -- the corner: ease in, hold, ease out; then the straight to the next (shorter after a hairpin, so the road leaves its other leg)
      lay(ease, 0, k * 1)
      lay(hold, k, k)
      lay(ease, k, 0)
      local straight = hairpin and math.floor(r:range(12, 30)) or math.floor(r:range(cx.straight[1], cx.straight[2]))
      straight = math.max(12, straight)
      lay(straight, 0, 0)
      if hairpin then
        -- away from the other leg: a corner the other way
        local R2 = r:range(math.max(cx.r[1], 30), math.max(cx.r[1], 30) + 40)
        local A2 = r:range(1.0, 1.6)
        local e2 = math.max(8, math.min(30, math.floor(R2 * 0.45)))
        lay(e2, 0, -k * R / R2)
        lay(math.floor(A2 * R2 - e2 + 0.5), -dir / R2, -dir / R2)
        lay(e2, -dir / R2, 0)
        lay(math.floor(r:range(20, 60)), 0, 0)
      end
      if fits_from(from) then ok = true; break end
      cut(from - 1)
    end
    if ok then
      commit(from)
      marks[#marks + 1] = from - 1
    else
      -- take back the last corner and try again from there
      backs = backs + 1
      if #marks <= 1 or backs > 60 or tries > 1500 then return nil, tries end
      local back = table.remove(marks)
      grid:drop_from(back + 1)
      cut(back)
    end
  end
  -- the finish: a straight to the line and the run-out after it
  local from = #X + 1
  lay(40 + RUNOUT + (10 - (#X - 1 + 40 + RUNOUT) % 10) % 10, 0, 0) -- (to a whole number of 10 m: the waypoints, every 10 m, end on the last point)
  if not fits_from(from) then return nil, tries end
  return { X = X, Z = Z, open = true }, tries
end

-- A circuit: a wobbly ring (its radius changed by a few smooth waves round the circle, so it can never cross itself), drawn through
-- control points with the Catmull-Rom curve the track editor uses, then started at its straightest place.
local function catmull(p0, p1, p2, p3, t)
  local t2 = t * t
  local t3 = t2 * t
  local function c(a, b, cc, d) return 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3) end
  return c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])
end
-- points every `spacing` metres along the closed curve through `ctl` (as trackgen's `centreline`)
local function loop_line(ctl, spacing)
  local n = #ctl
  local dense = {}
  for i = 1, n do
    local a, b, c, d = ctl[(i - 2) % n + 1], ctl[i], ctl[i % n + 1], ctl[(i + 1) % n + 1]
    for s = 0, 39 do
      local x, z = catmull(a, b, c, d, s / 40)
      dense[#dense + 1] = { x, z }
    end
  end
  local X, Z = { dense[1][1] }, { dense[1][2] }
  local carried = 0
  local ax, az = dense[1][1], dense[1][2]
  for i = 2, #dense + 1 do
    local b = dense[(i - 1) % #dense + 1]
    local dx, dz = b[1] - ax, b[2] - az
    local d = math.sqrt(dx * dx + dz * dz)
    while carried + d >= spacing do
      local f = (spacing - carried) / d
      ax, az = ax + dx * f, az + dz * f
      X[#X + 1], Z[#Z + 1] = ax, az
      dx, dz = b[1] - ax, b[2] - az
      d = math.sqrt(dx * dx + dz * dz)
      carried = 0
    end
    carried = carried + d
    ax, az = b[1], b[2]
  end
  local n2 = #X
  local ex, ez = X[n2] - X[1], Z[n2] - Z[1]
  if ex * ex + ez * ez < spacing * spacing * 0.25 then X[n2], Z[n2] = nil, nil end
  return X, Z
end

-- the length of the closed curve through `ctl` (40 straight pieces between control points)
local function loop_length(ctl)
  local n = #ctl
  local total = 0
  local px, pz = ctl[1][1], ctl[1][2]
  for i = 1, n do
    local a, b, c, d = ctl[(i - 2) % n + 1], ctl[i], ctl[i % n + 1], ctl[(i + 1) % n + 1]
    for s = 1, 40 do
      local x, z = catmull(a, b, c, d, s / 40)
      total = total + math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz))
      px, pz = x, z
    end
  end
  return total
end

-- (each complexity: the metres between control points, and how far each is pushed in or out at random)
local RING = { { 220, 75 }, { 120, 48 }, { 95, 34 } }
local function circuit_route(s, r)
  local len = generate.LENGTHS[s.length].lap
  local curvy = (s.complexity - 1) / 2 -- 0, 0.5, 1
  local spacing, jitter = RING[s.complexity][1], RING[s.complexity][2]
  local n = math.max(10, math.floor(len / spacing + 0.5))
  -- the shape: a ring changed by a few broad waves, squashed
  local waves = {}
  for k = 2, 4 do waves[#waves + 1] = { k = k, a = (0.12 + 0.1 * curvy) * (0.4 + 0.6 * r()) / k, phase = r() * TAU } end
  local squash = 0.55 + 0.4 * r()
  local spin = r() < 0.5 and 1 or -1
  local ctl, dirs = {}, {}
  for i = 0, n - 1 do
    local th = (i + 0.2 * (r() * 2 - 1)) / n * TAU
    local rad = 1
    for _, w in ipairs(waves) do rad = rad + w.a * dcos(w.k * th + w.phase) end
    if rad < 0.45 then rad = 0.45 end
    local dx, dz = dcos(th) * spin, dsin(th) * squash
    ctl[#ctl + 1] = { rad * dx, rad * dz }
    local dl = math.sqrt(dx * dx + dz * dz)
    dirs[#dirs + 1] = { dx / dl, dz / dl }
  end
  -- scaled to the length asked for; each point then pushed out or in by up to `jitter` metres (the bends), and scaled again
  local k = len / loop_length(ctl)
  for i, p in ipairs(ctl) do
    local j = (r() * 2 - 1) * jitter
    p[1], p[2] = p[1] * k + dirs[i][1] * j, p[2] * k + dirs[i][2] * j
  end
  k = len / loop_length(ctl)
  -- (rounded to tenths of a metre, as a track file keeps them)
  for _, p in ipairs(ctl) do p[1], p[2] = r1(p[1] * k), r1(p[2] * k) end
  local X, Z = loop_line(ctl, 1)
  -- start at the straightest place (the least turning over the 70 m before it and the 60 m after), heading along the road
  local m = #X
  local best, bi = 1e18, 1
  local function hd(i) local a, b = (i - 2) % m + 1, i % m + 1 return datan2(X[b] - X[a], Z[b] - Z[a]) end
  for i = 1, m, 5 do
    local turn = 0
    for d = -70, 60, 10 do turn = turn + math.abs(wrap(hd((i + d + 10 - 1) % m + 1) - hd((i + d - 1) % m + 1))) end
    if turn < best then best, bi = turn, i end
  end
  local RX, RZ = {}, {}
  for j = 0, m - 1 do RX[j + 1], RZ[j + 1] = X[(bi - 1 + j) % m + 1], Z[(bi - 1 + j) % m + 1] end
  return { X = RX, Z = RZ, open = false }, 1
end

-- The route's measures: its corners (as the pace notes read them), its tightest bend, the closest two parts, its length.
local function curvature_of(P, open)
  -- (trackgen's: the heading two points either side, 5 m apart, over 20 m)
  local n = #P
  local k = {}
  for i = 1, n do
    local a = open and math.max(1, i - 2) or (i - 3) % n + 1
    local b = open and math.min(n, i + 2) or (i + 1) % n + 1
    k[i] = wrap(P[b].ry - P[a].ry) / 20
  end
  return k
end

-- The line every `step` metres from a route of points every metre, with tangents and headings (as trackgen's centreline gives them).
local function sample(route, step)
  local X, Z, open = route.X, route.Z, route.open
  local P = {}
  local n = #X
  for i = 1, n, step do P[#P + 1] = { x = X[i], z = Z[i] } end
  if open and (n - 1) % step ~= 0 then P[#P + 1] = { x = X[n], z = Z[n] } end
  local m = #P
  for i = 1, m do
    local q = P[open and math.min(i + 1, m) or (i % m + 1)]
    local p = P[open and math.max(i - 1, 1) or ((i - 2) % m + 1)]
    local dx, dz = q.x - p.x, q.z - p.z
    local len = math.sqrt(dx * dx + dz * dz)
    P[i].tx, P[i].tz = dx / len, dz / len
    P[i].ry = datan2(dx, dz)
  end
  return P
end

local function measure(route)
  local line = sample(route, 5)
  local k = curvature_of(line, route.open)
  local peak = 0
  for i = 1, #k do if math.abs(k[i]) > peak then peak = math.abs(k[i]) end end
  local g = new_grid()
  for i, p in ipairs(line) do g:add(i, p.x, p.z) end
  local n = #line
  local closest = 1e18
  for i, p in ipairs(line) do
    local d2 = g:nearest(p.x, p.z, function(j)
      local around = math.abs(i - j)
      if not route.open then around = math.min(around, n - around) end
      return around * 5 < 80
    end)
    if d2 < closest then closest = d2 end
  end
  return line, k, { min_radius = peak > 0 and 1 / peak or 1e9, closest = math.sqrt(closest) }
end

-- The pace notes' corners (lib/race.lua's pace_notes, on the 10 m waypoints): how many, and how many are hairpins.
local function corners_of(wps)
  local count, hairpins = 0, 0
  local cur
  local function close()
    if cur then
      count = count + 1
      if cur.peak > 0.06 then hairpins = hairpins + 1 end
      cur = nil
    end
  end
  for _, w in ipairs(wps) do
    local a = math.abs(w.k)
    if cur and w.k * cur.sign < 0 and a > 0.0085 then close() end
    if not cur then
      if a > 0.0085 then cur = { sign = w.k > 0 and 1 or -1, peak = a } end
    else
      if a > cur.peak then cur.peak = a end
      if a < 0.0045 then close() end
    end
  end
  close()
  return count, hairpins
end

-- The hills of a course: the waves of its hills setting, turned and shifted by its seed.
local function terrain_of(s, r)
  local out = {}
  local base = r() * 180
  for i, w in ipairs(generate.HILLS[s.hills].waves) do
    out[i] = { height = w[1], wavelength = w[2], direction = math.floor(base + (i - 1) * (60 + r() * 60)) % 360, phase = math.floor(r() * 628) / 100 }
  end
  return { waves = out }
end
-- The height of those hills and their slope along a heading (the engine's sum of sines, with our own sine)
function generate.height(terrain, x, z)
  local h = 0
  for _, w in ipairs(terrain.waves) do
    local k = TAU / w.wavelength
    local a = w.direction * PI / 180
    h = h + w.height * dsin(k * dcos(a) * x + k * dsin(a) * z + w.phase)
  end
  return h
end

-- The route of settings `s`: the line every metre, and its measures. Nil when no route could be made (never, in the tests).
local routes = {}
function generate.route(s)
  local code = generate.encode(s)
  if routes[code] then return routes[code] end
  local r = rng(s.seed * 1000003 + (s.location * 7 + s.type * 11 + s.length * 13 + s.complexity * 17) * 7919)
  local route, tries
  local attempts = 0
  repeat
    attempts = attempts + 1
    local sub = rng(s.seed * 1000003 + attempts * 104729 + s.complexity * 31 + s.length * 37 + s.type * 41)
    if s.type == 2 then route, tries = circuit_route(s, sub) else route, tries = stage_route(s, sub) end
    if route then
      local line, k, m = measure(route)
      local cx = generate.COMPLEXITY[s.complexity]
      if m.min_radius < cx.rmin * 0.82 or m.closest < GAP_NEAR then route = nil
      else route.line, route.k, route.measure = line, k, m end
    end
  until route or attempts >= 40
  if not route then return nil end
  route.code, route.attempts, route.tries = code, attempts, tries
  route.terrain = terrain_of(s, r)
  route.rng = r
  -- the waypoints: every 10 m from the start line (a stage) or the start (a circuit), as trackgen's layout gives them
  local line, k = route.line, route.k
  local n = #line
  local L = route.open and math.floor(LEAD_IN / 5 + 0.5) + 1 or 1
  local F = route.open and n - math.floor(RUNOUT / 5 + 0.5) or n
  route.L, route.F = L, F
  local wps = {}
  for i = L, n, 2 do wps[#wps + 1] = { x = r1(line[i].x), z = r1(line[i].z), k = math.floor(k[i] * 10000 + 0.5) / 10000, at = i } end
  route.wps = wps
  route.length = route.open and (F - L) * 5 or n * 5 -- (a stage from the start line to the finish; a circuit's lap)
  route.corners, route.hairpins = corners_of(wps)
  routes[code] = route
  return route
end

-- ---- what the course looks like --------------------------------------------------------------------------------------------------
local function road_kind(s, loc)
  local own = loc.road
  if s.surface == 2 then return "road_asphalt" end
  return own
end
-- The race object's settings for course `s` (see entities/race.lua): the place's own, with the time of day, weather and surface.
local function race_props(s, route)
  local loc = generate.LOCATIONS[s.location]
  local p = { stage = s.type == 1, music = loc.music, horizon = loc.horizon, clouds = loc.clouds, wind = loc.wind, terrain = route.terrain }
  local look = {}
  for k, v in pairs(loc.look) do look[k] = v end
  p.look = look
  p.sun_to = loc.sun_to
  p.tint = loc.tint
  local road = road_kind(s, loc)
  local loose = road ~= "road_asphalt"
  p.surface = loose and "dirt" or "road"
  p.loose = loose or nil
  p.grip = loose and loc.grip or (loc.id == "snow" and 0.82 or 0.95)
  p.dust = loose and loc.dust or { 90, 100, 120 }
  if s.time == 2 then
    -- dusk: the sun low, and warm
    local to = loc.sun_to
    local flat = math.sqrt(to[1] * to[1] + to[3] * to[3])
    p.sun_to = { to[1] / flat * 0.995, 0.07, to[3] / flat * 0.995 }
    p.tint = { top = { 1, 0.95, 0.9 }, horizon = { 1.04, 0.93, 0.84 } }
    look.bloom, look.bloom_threshold = 0.45, 0.7
  elseif s.time == 3 then
    p.night = true
    p.sun_to = { 0.3, -0.45, -0.5 }
    p.sun = loc.id == "snow" and { color = { 90, 110, 160 }, dir = { 0.35, -0.8, -0.45 }, ambient = { 34, 40, 62 } }
      or { color = { 70, 90, 140 }, dir = { 0.35, -0.8, -0.45 }, ambient = { 26, 32, 52 } }
    p.tint = nil
    if loc.id ~= "snow" and loc.id ~= "desert" then p.horizon = "night" end
    look.bloom, look.bloom_threshold, look.vignette = 0.65, 0.62, 0.2
    if loc.id ~= "harbour" then p.music = loc.id == "snow" and "race_snow" or "race_night" end
  end
  if s.weather == 2 then p.weather = { kind = "snow", count = 360, fall = 2.6, drift = 1.6 } end
  return p
end

-- The stretches of a mixed course on its other surface: from a third to two thirds of the way (a stage), or one sector of a lap.
local function zones_of(s, route, loc)
  if s.surface ~= 3 then return {} end
  local own = road_kind(s, loc)
  local other = own == "road_asphalt" and (loc.loose_road or "road_gravel") or "road_asphalt"
  local len = route.length
  local from = math.floor(len * 0.36 / 10) * 10
  local to = math.floor(len * 0.68 / 10) * 10
  return { { from = from, to = to, road = other } }
end

-- ---- the course -----------------------------------------------------------------------------------------------------------------
-- Everything about the course of settings `s`: the route, its waypoints with their road and surface, the gates, the grid, the race
-- object's settings, the grass, the scenery (a list of { kind, x, z, y, props }). Made once per code.
local courses = {}
function generate.course(s)
  local code = generate.encode(s)
  if courses[code] then return courses[code] end
  local route = generate.route(s)
  if not route then return nil end
  local loc = generate.LOCATIONS[s.location]
  local c = { code = code, settings = generate.copy(s), route = route, open = route.open, location = loc }
  c.props = race_props(s, route)
  c.road = road_kind(s, loc)
  c.zones = zones_of(s, route, loc)
  -- each waypoint's surface where a zone changes it (from the start line, metres)
  for j, w in ipairs(route.wps) do
    local at = (j - 1) * 10
    w.road = nil
    for _, z in ipairs(c.zones) do if at >= z.from and at < z.to then w.road = z.road end end
  end
  c.laps = route.open and 1 or generate.LENGTHS[s.length].laps
  c.sections = route.open and math.max(3, math.floor(route.length / 450 + 0.5)) or 0
  c.plants = loc.plants
  c.objects = generate.scenery(c)
  courses[code] = c
  return c
end

-- Forgets the routes and courses made so far (each is kept once made: the menus ask for them every frame).
function generate.forget()
  for k in pairs(routes) do routes[k] = nil end
  for k in pairs(courses) do courses[k] = nil end
end

-- trackgen's `layout`: the start, the finish and gates, the grid, and the scenery beside the road, from the course's own seed.
function generate.scenery(c)
  local s, route, loc = c.settings, c.route, c.location
  local line, curv = route.line, route.k
  local n, open = #line, route.open
  local L, F = route.L, route.F
  local rand = rng(s.seed * 7 + 99991 + s.location * 1009 + s.length * 131 + s.complexity * 37 + s.type * 17 + s.time * 3)
  local night = s.time == 3
  local trees = (night and loc.night_trees) or loc.trees
  local objects = {}
  local function obj(kind, x, z, ry, extra, y)
    local props = extra or {}
    if ry and ry ~= 0 then props.ry = r3(ry) end
    objects[#objects + 1] = { kind = kind, x = r1(x), y = y or 0, z = r1(z), props = props }
  end
  local function pick(v) if #v > 1 then return v[math.floor(rand() * #v) + 1] end return v[1] end
  -- the start, the finish and the gates between
  local p = line[L]
  obj("road_start", p.x, p.z, p.ry, nil, 0.03)
  obj("start_arch", p.x, p.z, p.ry)
  obj("tower", p.x + p.tz * 15, p.z - p.tx * 15, p.ry + PI / 2)
  c.gates = {}
  if open then
    local q = line[F]
    obj("start_arch", q.x, q.z, q.ry)
    for _, side in ipairs({ -1, 1 }) do obj("flag_checkers", q.x + q.tz * side * 8, q.z - q.tx * side * 8) end
    for k = 1, c.sections do
      local g = line[L + math.floor((F - L) * k / c.sections + 0.5)]
      c.gates[k] = { x = r1(g.x), z = r1(g.z) }
      if k < c.sections then
        for _, side in ipairs({ -1, 1 }) do
          obj(loc.roadside.banner, g.x + g.tz * side * 9.5, g.z - g.tx * side * 9.5, g.ry)
          obj("flag_checkers", g.x + g.tz * side * 8, g.z - g.tx * side * 8)
        end
      end
    end
  end
  -- the grid: a stage's one box 6 m behind the line; a circuit's four, staggered, behind it along the loop
  c.grid = {}
  if open then
    c.grid[1] = { x = r1(p.x - dsin(p.ry) * 6), z = r1(p.z - dcos(p.ry) * 6), ry = r3(p.ry) }
  else
    for slot = 1, 4 do
      local back = 6 + (slot - 1) * 6
      local j = back // 5
      local a, b = line[(L - 1 - j) % n + 1], line[(L - 2 - j) % n + 1] -- (the points j and j + 1 behind the line)
      local f = (back - 5 * j) / 5
      local x, z = a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f
      local side = slot % 2 == 0 and 2.2 or -2.2
      c.grid[slot] = { x = r1(x - dcos(a.ry) * side), z = r1(z + dsin(a.ry) * side), ry = r3(a.ry) }
    end
  end
  -- how close the road is to a spot (its 5 m points)
  local g = new_grid()
  for i, q in ipairs(line) do g:add(i, q.x, q.z) end
  local function near(x, z) return math.sqrt(g:nearest(x, z)) end
  local function place(kind, x, z, min_road)
    if not kind then return false end
    if near(x, z) < min_road then return false end
    local v = 218 + math.floor(rand() * 37)
    local warm = math.floor(rand() * 18)
    obj(kind, x, z, rand() * TAU, { sx = math.floor((0.8 + rand() * 0.6) * 100 + 0.5) / 100, tint = { v, v - warm // 2, v - warm } })
    return true
  end
  local far = loc.far
  for i = 1, n do
    local q = line[i]
    for _, side in ipairs({ -1, 1 }) do
      local nx, nz = -q.tz * side, q.tx * side
      if rand() < loc.density then
        local d = 11 + rand() * 38
        local kind = trees[math.floor(rand() * #trees) + 1]
        place(kind, q.x + nx * d + (rand() - 0.5) * 6, q.z + nz * d + (rand() - 0.5) * 6, 10.5)
      end
      if rand() < loc.density * 0.7 then
        local d = 8 + rand() * 12
        place(loc.small[math.floor(rand() * #loc.small) + 1], q.x + nx * d, q.z + nz * d, 11)
      end
      if rand() < loc.rocks then
        local d = 9 + rand() * 20
        place(pick(loc.rock), q.x + nx * d, q.z + nz * d, 8.5)
      end
      if far and rand() < far.density then
        local d = 60 + rand() * 90
        place(pick(far.kind), q.x + nx * d, q.z + nz * d, 40)
      end
    end
    local k = curv[i]
    if math.abs(k) > 0.014 and i % 4 == 0 then
      local side = k > 0 and 1 or -1
      local x, z = q.x - q.tz * side * 9.6, q.z + q.tx * side * 9.6
      if near(x, z) > 8.5 then obj("tires", x, z) end
    end
    local before = curv[open and math.max(1, i - 4) or ((i - 5) % n + 1)]
    if math.abs(k) > 0.011 and math.abs(before) < 0.008 and i % 3 == 0 then
      local side = k > 0 and 1 or -1
      local x, z = q.x - q.tz * side * 8, q.z + q.tx * side * 8
      if near(x, z) > 7 then obj("sign_chevron", x, z, q.ry + PI) end
    end
    if night and i % 8 == 3 then
      local side = i % 16 == 3 and 1 or -1
      local nx, nz = -q.tz * side, q.tx * side
      local x, z = q.x + nx * 9.4, q.z + nz * 9.4
      if near(x, z) > 8.5 then obj("lamp", x, z, datan2(-nx, -nz)) end
    end
    if i % 17 == 5 and math.abs(k) < 0.006 then
      local x, z = q.x - q.tz * 11.5, q.z + q.tx * 11.5
      if near(x, z) > 10 then obj("hay_bale", x, z, q.ry) end
    end
  end
  -- barriers on the outside of the bends (trackgen's railPieces: a 6 m piece every 5.6 m along the line 8.2 m out)
  do
    local function bend_at(i) local k = curv[i] return math.abs(k) > 0.0075 and (k > 0 and 1 or -1) or 0 end
    local start = 1
    if not open then while start <= n and bend_at(start) ~= 0 do start = start + 1 end if start > n then start = 1 end end
    local run, run_side = {}, 0
    local function finish()
      if #run >= 2 then
        local d = { 0 }
        for k = 2, #run do
          local dx, dz = run[k].x - run[k - 1].x, run[k].z - run[k - 1].z
          d[k] = d[k - 1] + math.sqrt(dx * dx + dz * dz)
        end
        local total = d[#d]
        local function at(sd)
          local k = 2
          while k < #run and d[k] < sd do k = k + 1 end
          local t = math.max(0, math.min(1, (sd - d[k - 1]) / math.max(1e-6, d[k] - d[k - 1])))
          return run[k - 1].x + (run[k].x - run[k - 1].x) * t, run[k - 1].z + (run[k].z - run[k - 1].z) * t
        end
        local count = math.max(1, math.floor(total / 5.6 + 0.5))
        local from = (total - count * 5.6) / 2
        for m = 0, count - 1 do
          local ax, az = at(from + m * 5.6)
          local bx, bz = at(from + (m + 1) * 5.6)
          local x, z = (ax + bx) / 2, (az + bz) / 2
          if near(x, z) > 7.4 then obj("guardrail", x, z, datan2(bx - ax, bz - az)) end
        end
      end
      run, run_side = {}, 0
    end
    for j = 0, n - 1 do
      local i = open and j + 1 or (start - 1 + j) % n + 1
      local side = bend_at(i)
      if side == 0 or (run_side ~= 0 and side ~= run_side) then finish() end
      if side ~= 0 then
        run_side = side
        local q = line[i]
        run[#run + 1] = { x = q.x - q.tz * side * 8.2, z = q.z + q.tx * side * 8.2 }
      end
    end
    finish()
  end
  -- tall things well away from the road (the mesas of the canyon)
  for _ = 1, loc.landmarks.count do
    local a = rand() * TAU
    local d = loc.landmarks.radius + rand() * 40
    local cx, cz = 0, 0
    for _, q in ipairs(line) do cx, cz = cx + q.x, cz + q.z end
    cx, cz = cx / n, cz / n
    place(pick(loc.landmarks.kind), cx + dcos(a) * d * 1.3, cz + dsin(a) * d, 50)
  end
  -- the roadside and the crowd, from the waypoints (as trackgen's `roadside` and `crowd`)
  generate.roadside(c, objects, rand, near)
  return objects
end

-- The life beside the road: stands, tents, banners and flags at the start, boards along the straights, pylons on the outside of the
-- hard bends; and groups of people watching (by the start, on the outside of hard bends, here and there along the straights).
function generate.roadside(c, objects, rand, near)
  local route, loc = c.route, c.location
  local wps, open = route.wps, route.open
  local n = #wps
  local pts = {}
  local total = 0
  for i = 1, n do
    local a = wps[open and math.max(i - 1, 1) or ((i - 2) % n + 1)]
    local b = wps[open and math.min(i + 1, n) or (i % n + 1)]
    local dx, dz = b.x - a.x, b.z - a.z
    local len = math.max(math.sqrt(dx * dx + dz * dz), 1e-6)
    local nx = wps[open and math.min(i + 1, n) or (i % n + 1)]
    local seg = (open and i == n) and 0 or math.sqrt((nx.x - wps[i].x) ^ 2 + (nx.z - wps[i].z) ^ 2)
    pts[i] = { x = wps[i].x, z = wps[i].z, tx = dx / len, tz = dz / len, heading = datan2(dx, dz), s = total, w = 6 }
    total = total + seg
  end
  local function point(i) return open and pts[math.max(1, math.min(n, i))] or pts[(i - 1) % n + 1] end
  local bends = { [0] = 0 }
  for i = 1, n do bends[i] = wrap(point(i + 4).heading - point(i).heading) end
  local function add(kind, i, off, turn, along, clear, extra)
    if not kind then return end
    local p = point(i)
    local x, z = p.x + p.tz * off + p.tx * along, p.z - p.tx * off + p.tz * along
    if near(x, z) < clear then return end
    local props = extra or {}
    local ry = p.heading + turn
    if ry ~= 0 then props.ry = r3(ry) end
    objects[#objects + 1] = { kind = kind, x = r1(x), y = 0, z = r1(z), props = props }
  end
  local k = loc.roadside
  add(k.stand, 2, 22, -PI / 2, 14, 14)
  add(k.stand, 2, -22, PI / 2, 14, 14)
  add(k.tent, 3, 17, PI / 2, 30, 11)
  add(k.tent, 3, -17, -PI / 2, 30, 11)
  add(k.banner, 1, 9.5, 0, 0, 8.5)
  add(k.banner, 1, -9.5, 0, 0, 8.5)
  for j = 0, 3 do
    add(k.flag, 1 + j * 3, 8, 0, -22, 7.5)
    add(k.flag, 1 + j * 3, -8, 0, -22, 7.5)
  end
  local next_board, side, last_pylon = 130, 1, -1e9
  for i = 1, n do
    local p = point(i)
    if p.s > 60 and p.s < total - 40 then
      local straight = math.abs(bends[i]) < 0.08 and math.abs(bends[(i + 3) % n + 1] or 0) < 0.08
      if straight and p.s > next_board then
        add(k.boards[i % 2 == 0 and 1 or #k.boards], i, side * 13, side * PI / 2, 0, 10)
        side = -side
        next_board = p.s + 120
      end
      if math.abs(bends[i]) > 0.22 and p.s - last_pylon > 20 then
        local outside = bends[i] > 0 and 1 or -1
        add(k.pylon, i, outside * 7.4, 0, 0, 6.2)
        last_pylon = p.s
      end
    end
  end
  -- the crowd
  local function person(i, off, along)
    local p = point(i)
    local x, z = p.x + p.tz * off + p.tx * along, p.z - p.tx * off + p.tz * along
    if near(x, z) < 9.5 then return end
    local face = p.heading + (off > 0 and -PI / 2 or PI / 2) + (rand() - 0.5) * 0.7
    local kind = CROWD[math.floor(rand() * #CROWD) + 1]
    local sx = r3(2 * (0.92 + rand() * 0.16))
    local hop = rand() < 0.7 and r3(0.15 + rand() * 0.2) or 0
    local rate = rand() < 0.5 and 0.9 or 1.1
    local phase = math.floor(rand() * 8) * 0.5
    objects[#objects + 1] = { kind = kind, x = r1(x), y = 0, z = r1(z), props = { ry = r3(face), sx = sx, hop = hop ~= 0 and hop or nil, rate = rate, phase = phase } }
  end
  local function group(i, sd, off, count)
    local along = rand() * 2
    for _ = 1, count do
      person(i, sd * (off + rand() * 4), along)
      along = along + 2.5 + rand() * 2.5
    end
  end
  for i = 1, 9, 3 do
    group(i, 1, 11, 5)
    group(i, -1, 11, 5)
  end
  local last = -1e9
  for i = 1, n do
    local p = point(i)
    if p.s > 40 and math.abs(bends[i]) > 0.16 and p.s - last > 40 then
      group(i, bends[i] > 0 and 1 or -1, 10.5, 4 + math.floor(rand() * 3))
      last = p.s
    end
  end
  local next_spot, sd = 90, 1
  for i = 1, n do
    local p = point(i)
    if p.s > next_spot and p.s < total - 30 then
      group(i, sd, 11 + rand() * 2, 2 + math.floor(rand() * 3))
      sd = -sd
      next_spot = p.s + 90 + rand() * 60
    end
  end
end

-- ---- the road mesh ------------------------------------------------------------------------------------------------------------------
-- trackgen's texturedRoadGlb, made here: a row every 2 m; across it the bands of the road kind (asphalt: the road, its painted edge line,
-- a strip of road, the verge sloping into the ground; loose: the road, its edge fading into the line colour, the verge), each band a
-- strip of its own with the sheet's column for its kind (or a paint strip) as its u, and 64 m of road a repeat of v.
local SHEET = { size = 1024, column = 192, paint = 960, strip = 32, metres = 64, kinds = { road_asphalt = 0, road_dirt = 1, road_gravel = 2, road_snow = 3, road_sand = 4 } }
local LINEAR = {
  road_asphalt = { road = { 0.2667, 0.2667, 0.2667 }, line = { 0.9451, 0.949, 0.9647 } },
  road_dirt = { road = { 0.5, 0.37, 0.24 }, line = { 0.78, 0.66, 0.48 }, verge = { 0.66, 0.48, 0.28 } },
  road_snow = { road = { 0.6, 0.66, 0.74 }, line = { 0.93, 0.96, 0.99 }, verge = { 0.92, 0.95, 1.0 } },
  road_gravel = { road = { 0.3, 0.26, 0.21 }, line = { 0.5, 0.45, 0.38 }, verge = { 0.2, 0.28, 0.12 } },
  road_sand = { road = { 0.82, 0.66, 0.42 }, line = { 0.92, 0.8, 0.56 }, verge = { 0.7, 0.54, 0.31 } },
}
local SHOULDER = { 0.33, 0.29, 0.23 }
local function blend(a, b, t) return { a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t } end
-- (the mesh takes sRGB colours, as every colour in Lua; the road's are linear, as the glTF has them)
local function srgb(c)
  local out = {}
  for i = 1, 3 do
    local v = c[i]
    out[i] = math.floor(255 * (v <= 0.0031308 and v * 12.92 or 1.055 * v ^ (1 / 2.4) - 0.055) + 0.5)
  end
  return out
end
local function bands(kind)
  local c = LINEAR[kind]
  if kind == "road_asphalt" then
    return { { 0.075, 4.25, c.road, c.road }, { 4.25, 4.45, c.line, c.line, "solid" }, { 4.45, 5, c.road, c.road },
             { 5, 6, blend(c.road, SHOULDER, 0.6), SHOULDER, nil, true } }
  end
  return { { 0, 3.6, c.road, c.road }, { 3.6, 4.6, c.road, c.line }, { 4.6, 5.2, c.line, c.verge }, { 5.2, 6, c.verge, c.verge, nil, true } }
end

-- The road of course `c` as the lists nova.mesh.make takes.
function generate.road_lists(c)
  local route = c.route
  local rows = sample(route, 2)
  local n, open = #rows, route.open
  local P, C, U, I = {}, {}, {}, {}
  local np = 0
  local TOP, SKIRT = 0.02, -0.3
  local laps = n * 2 / SHEET.metres
  local fit = open and 1 or math.max(1, math.floor(laps + 0.5)) / laps
  local L0 = open and (route.L - 1) * 5 or 0 -- (zones are measured from the start line)
  local function kind_at(i) -- the kind of segment i (from row i to i + 1)
    local s = (i - 1) * 2 - L0
    for _, z in ipairs(c.zones) do if s >= z.from and s < z.to then return z.road end end
    return c.road
  end
  local function across(column, x, where)
    if where == "solid" or where == "broken" then return (SHEET.paint + (where == "broken" and SHEET.strip or 0) + SHEET.strip / 2 + (x > 0 and 6 or -6)) / SHEET.size end
    return (column * SHEET.column + (x / 12 + 0.5) * SHEET.column) / SHEET.size
  end
  -- a strip from row a to row b (b may be n + 1 on a loop: row 1 again, with v carried on) between offsets from and to
  local function strip(a, b, from, to, c_from, c_to, where, y_from, y_to, column)
    local cf, ct = srgb(c_from), srgb(c_to)
    local u_from, u_to = across(column, where and -1 or from, where), across(column, where and 1 or to, where)
    local first = np + 1
    for i = a, b do
      local q = rows[(i - 1) % n + 1]
      local v = (i - 1) * 2 / SHEET.metres * fit
      for _, e in ipairs({ { from, y_from, cf, u_from }, { to, y_to, ct, u_to } }) do
        local off = e[1]
        local k = np * 3
        P[k + 1], P[k + 2], P[k + 3] = q.x + q.tz * off, e[2], q.z - q.tx * off
        local kc = np * 3
        C[kc + 1], C[kc + 2], C[kc + 3] = e[3][1], e[3][2], e[3][3]
        U[np * 2 + 1], U[np * 2 + 2] = e[4], v
        np = np + 1
      end
    end
    -- (from < to: the triangles A_i, A_j, B_j and A_i, B_j, B_i face up)
    for r = 0, b - a - 1 do
      local ai, bi = first + r * 2, first + r * 2 + 1
      local aj, bj = ai + 2, bi + 2
      local t = #I
      I[t + 1], I[t + 2], I[t + 3], I[t + 4], I[t + 5], I[t + 6] = ai, aj, bj, ai, bj, bi
    end
  end
  local last = open and n - 1 or n
  local i = 1
  while i <= last do
    local kind = kind_at(i)
    local j = i
    while j + 1 <= last and kind_at(j + 1) == kind do j = j + 1 end
    local column = SHEET.kinds[kind] or 0
    for _, band in ipairs(bands(kind)) do
      local from, to, c_from, c_to, where, drop = band[1], band[2], band[3], band[4], band[5], band[6]
      strip(i, j + 1, from, to, c_from, c_to, where, TOP, drop and SKIRT or TOP, column)
      strip(i, j + 1, -to, -from, c_to, c_from, where, drop and SKIRT or TOP, TOP, column)
    end
    if kind == "road_asphalt" then strip(i, j + 1, -0.075, 0.075, LINEAR.road_asphalt.line, LINEAR.road_asphalt.line, "broken", TOP, TOP, column) end
    i = j + 1
  end
  return { positions = P, colors = C, colors_rgb = true, uvs = U, indices = I, look = "road_stage_pine_ridge" }
end

-- ---- into the scene ---------------------------------------------------------------------------------------------------------------
local made_road
-- Builds course `c` into the scene being entered (scenes/generated.lua calls this before the race's own enter): what a hand-made
-- course's scene file holds, made from the course.
function generate.build(c)
  local started = nova.clock()
  local course = require("lib.course")
  local track = require("lib.track")
  local stage = require("lib.stage")
  local grid = require("lib.grid")
  local foliage = require("lib.foliage")
  course.set(c.props)
  track.open = c.open
  for j, w in ipairs(c.route.wps) do track.add(j, w.x, w.z, w.k, nil, w.road) end
  for k, gte in ipairs(c.gates or {}) do stage.add(k, gte.x, gte.z) end
  for slot, s in ipairs(c.grid) do
    grid.add(slot, s.x, s.z, s.ry)
    nova.scenery.add("grid_box", s.x, 0.035, s.z, { ry = s.ry })
  end
  foliage.set(c.plants)
  local t_objects = nova.clock()
  for _, o in ipairs(c.objects) do
    local props = {}
    for k, v in pairs(o.props) do props[k] = v end
    props.z = o.z
    nova.spawn(o.kind, o.x, o.y, props)
  end
  local t_road = nova.clock()
  if made_road then nova.mesh.free(made_road) end
  local lists = generate.road_lists(c)
  local points, ms
  made_road, points, ms = nova.mesh.make(lists)
  nova.spawn("road", 0, 0, { z = 0, mesh = made_road })
  nova.log(string.format("generate: built %s in %.0f ms (%d objects %.0f ms, road %d points %.0f ms, mesh %.0f ms)", c.code,
    (nova.clock() - started) * 1000, #c.objects, (t_road - t_objects) * 1000, points, (nova.clock() - t_road) * 1000, ms))
end
function generate.release()
  if made_road then nova.mesh.free(made_road); made_road = nil end
end

-- The course of settings `s` as the menus and the race know a course (lib/state.lua's lists): its id, name, laps, length...
function generate.entry(s, extra)
  local route = generate.route(s)
  local loc = generate.LOCATIONS[s.location]
  local code = generate.encode(s)
  local e = {
    id = "gen_" .. code:gsub("-", ""), scene = "generated", generated = generate.copy(s), code = code,
    name = loc.name .. " " .. (s.type == 1 and "Stage" or "Circuit"),
    blurb = generate.COMPLEXITY[s.complexity].blurb, look = loc.look,
    laps = s.type == 1 and 1 or generate.LENGTHS[s.length].laps,
    km = s.type == 1 and math.floor(route.length / 100 + 0.5) / 10 or nil,
    lap_km = s.type == 2 and math.floor(route.length / 100 + 0.5) / 10 or nil,
    level = s.complexity, open = true,
  }
  for k, v in pairs(extra or {}) do e[k] = v end
  return e
end

-- The route as the menus draw it: points in a box 1 across at most, { x, y } from the top left (north up, +x to the left, as the HUD's map).
function generate.preview(route)
  local lo_x, hi_x, lo_z, hi_z = 1e18, -1e18, 1e18, -1e18
  for _, w in ipairs(route.wps) do
    lo_x, hi_x = math.min(lo_x, w.x), math.max(hi_x, w.x)
    lo_z, hi_z = math.min(lo_z, w.z), math.max(hi_z, w.z)
  end
  local size = math.max(hi_x - lo_x, hi_z - lo_z, 1)
  local pts = {}
  for _, w in ipairs(route.wps) do pts[#pts + 1] = { (hi_x - w.x) / size, (hi_z - w.z) / size } end
  return { open = route.open, w = (hi_x - lo_x) / size, h = (hi_z - lo_z) / size, pts = pts }
end

-- A fingerprint of the route (every waypoint to the centimetre), to see that one code always makes the same course.
function generate.fingerprint(route)
  local parts = {}
  for _, w in ipairs(route.wps) do parts[#parts + 1] = string.format("%.1f,%.1f,%.4f", w.x, w.z, w.k) end
  return table.concat(parts, ";")
end

return generate

-- What the game remembers: the player's choices, options and best times (saved between runs).
local state = {}

-- The courses as the menus list them (the courses themselves are their files: tracks/<id>.track.json and scenes/<id>.scene.json), easiest
-- first. `level` is how hard the course is, and so how hard its rivals drive and how tight a stage's times are (state.difficulties).
-- They open one after another: the first of each list from the start, the next once the one before it is done (a circuit finished in
-- the top three, a stage with a star). The circuits and the stages each have their own progress; a time trial goes round the circuits
-- the circuit progress has opened.
state.levels = { "Easy", "Medium", "Hard", "Expert" }
state.tracks = {
  { id = "pine_ridge", name = "Pine Ridge", blurb = "Fast asphalt through the pines. Long straights, one tight hairpin.", laps = 2, level = 1 },
  { id = "dust_valley", name = "Dust Valley", blurb = "Loose dirt and twisty bends between the mesas.", laps = 2, level = 1 },
  { id = "frost_pass", name = "Frost Pass", blurb = "Packed snow on a long, looping pass. Grip is thin: brake early and be gentle.", laps = 2, level = 2 },
  { id = "harbour_lights", name = "Harbour Lights", blurb = "Asphalt after dark. Lamps mark the way; your headlights do the rest.", laps = 2, level = 2 },
  { id = "autumn_glen", name = "Autumn Glen", blurb = "Asphalt under the turning leaves: sweepers, a hairpin, and a corner that tightens.", laps = 2, level = 2 },
  { id = "ridge_gp", name = "Ridge Grand Prix", blurb = "A proper circuit with pits: a long straight into a hairpin, esses, a long right that tightens.", laps = 3, level = 2 },
  { id = "copper_canyon", name = "Copper Canyon", blurb = "Dirt at sunset: chicanes, two hairpins and a narrow walled gorge.", laps = 2, level = 3 },
  { id = "glacier_ring", name = "Glacier Ring", blurb = "Fast sweeping bends on snow. Brake early: the hairpin after the long straight bites.", laps = 2, level = 3 },
  { id = "neon_docks", name = "Neon Docks", blurb = "The docks at night: square corners, walled chicanes and a hairpin. Precision wins.", laps = 3, level = 4 },
  { id = "autumn_summit", name = "Autumn Summit", blurb = "A long mountain lap: a bend that closes into a hairpin, switchbacks on a narrow bridge.", laps = 2, level = 4 },
}
-- The classes: you race the other cars of your own class (the grid on the car page is split by them)
state.classes = {
  { id = "formula", name = "Formula", blurb = "Open-wheel racers: the quickest, and they hold the road." },
  { id = "sport", name = "Sport", blurb = "Fast road cars that slide under power." },
  { id = "everyday", name = "Everyday", blurb = "Family cars and workhorses: slower, and heavy in the bends." },
  { id = "kart", name = "Kart", blurb = "Tiny and nimble: quick off the line and glued to the road, but slow at the top end." },
  { id = "fun", name = "Fun", blurb = "Service vehicles: heavy, slow and silly. Just for fun." },
}
-- The rally stages: point to point, each in the country of one of the circuits (`look`), five sections each (see lib/race.lua). The scene of
-- a stage is the stage's id.
state.stages = {
  { id = "stage_pine_ridge", look = "pine_ridge", name = "Pine Ridge Stage", blurb = "Forest roads from the valley to the ridge, with hairpins on the way up.", laps = 1, km = 2.6, sections = 5, level = 1 },
  { id = "stage_dust_valley", look = "dust_valley", name = "Dust Valley Stage", blurb = "Switchbacks through the canyons as the sun goes down.", laps = 1, km = 2.7, sections = 5, level = 1 },
  { id = "stage_frost_pass", look = "frost_pass", name = "Frost Pass Stage", blurb = "A long climb over packed snow: the hairpins are slippery.", laps = 1, km = 2.2, sections = 5, level = 2 },
  { id = "stage_harbour_lights", look = "harbour_lights", name = "Harbour Night Stage", blurb = "Along the quay after dark: chicanes, then a hairpin at the end.", laps = 1, km = 2.1, sections = 5, level = 2 },
  { id = "stage_autumn_glen", look = "stage_autumn_glen", name = "Autumn Glen Stage", blurb = "Gravel through the woods, then tarmac from the halfway hairpin: mind the change of grip.", laps = 1, km = 3.2, sections = 6, level = 2 },
  { id = "stage_mesa_run", look = "stage_mesa_run", name = "Mesa Run", blurb = "Fast sand between the mesas, with two tight turns to catch you out.", laps = 1, km = 3.3, sections = 6, level = 2 },
  { id = "stage_canyon", look = "stage_canyon", name = "Canyon Climb", blurb = "Hairpin after hairpin up a sandy canyon, through a narrow walled gorge.", laps = 1, km = 2.6, sections = 7, level = 3 },
  { id = "stage_glacier_night", look = "stage_glacier_night", name = "Glacier by Night", blurb = "Snow in the dark: long slippery sweeps and three hairpins under the lamps.", laps = 1, km = 3.1, sections = 7, level = 3 },
  { id = "stage_harbour_sprint", look = "stage_harbour_sprint", name = "Harbour Sprint", blurb = "Square turns, chicanes and narrow walled alleys along the quays at night.", laps = 1, km = 2.6, sections = 7, level = 4 },
  { id = "stage_marathon", look = "stage_marathon", name = "Forest Marathon", blurb = "The long one: gravel, a tarmac middle, gravel again. Eight sections.", laps = 1, km = 4.6, sections = 8, level = 4 },
}
-- `price` is what a car costs in the garage, in coins; a new player has STARTING_COINS, enough for one of the three `starter` cars (one
-- each of Sport, Everyday and Kart), and earns more by racing (state.reward).
state.cars = {
  -- `oversteer`: how readily the rear lets go under power in a bend (0 never, 1 a lot); the sedan and the hatchback are the
  -- drifters, the open-wheel cars hold the road
  -- `wheel`: the wheels' radius in metres (the models' wheels are 0.6, 0.68, 0.66 and 0.62 m across), for how fast they spin
  -- `grip` is how much the tyres hold in a bend (1 is an ordinary road car) and `brake` how hard the brakes bite (1 likewise): the
  -- open-wheel cars have most of both, a van or a pickup the least. The rivals drive their cars up to what these allow.
  -- `idle_rpm` and `max_rpm` are the engine's range (the same numbers as in scripts/rally/engines.mjs, which makes its sound).
  -- `power` is the pull in first gear (m/s squared) and `top` the top speed (m/s): the open-wheel cars are the quick ones
  { id = "car", price = 25000, grip = 1.2, brake = 1.25, class = "formula", name = "Redline", oversteer = 0.35, wheel = 0.385, power = 11.5, top = 50, idle_rpm = 3500, max_rpm = 12500 },
  { id = "car_blue", price = 6000, grip = 1, brake = 1, class = "sport", name = "Blue Streak", oversteer = 0.6, wheel = 0.385, power = 8.5, top = 44, idle_rpm = 900, max_rpm = 7000 },
  { id = "car_green", price = 1000, starter = true, grip = 0.98, brake = 0.95, class = "sport", name = "Green Machine", oversteer = 0.7, wheel = 0.36, power = 8, top = 42, idle_rpm = 1000, max_rpm = 6800 },
  { id = "car_yellow", price = 12000, grip = 1.15, brake = 1.2, class = "formula", name = "Sunburst", oversteer = 0.45, wheel = 0.385, power = 11, top = 48, idle_rpm = 2500, max_rpm = 9800 },
  { id = "car_sedan", price = 1000, starter = true, grip = 0.92, brake = 0.9, class = "everyday", name = "Commuter", oversteer = 0.5, wheel = 0.375, power = 8, top = 42, idle_rpm = 800, max_rpm = 6500 },
  { id = "car_suv", price = 3000, grip = 0.88, brake = 0.9, class = "everyday", name = "Trailblazer", oversteer = 0.4, wheel = 0.44, power = 8.5, top = 42, idle_rpm = 700, max_rpm = 5800 },
  { id = "car_suvl", price = 9000, grip = 0.95, brake = 0.95, class = "sport", name = "Grand Tourer", oversteer = 0.5, wheel = 0.44, power = 9.5, top = 46, idle_rpm = 600, max_rpm = 5500 },
  { id = "car_taxi", price = 1500, grip = 0.9, brake = 0.9, class = "everyday", name = "Cab", oversteer = 0.6, wheel = 0.375, power = 7.5, top = 40, idle_rpm = 850, max_rpm = 6000 },
  { id = "car_police", price = 7500, grip = 1, brake = 1.05, class = "sport", name = "Patrol", oversteer = 0.55, wheel = 0.375, power = 9.5, top = 46, idle_rpm = 700, max_rpm = 6800 },
  { id = "car_van", price = 2000, grip = 0.8, brake = 0.8, class = "everyday", name = "Delivery Van", oversteer = 0.3, wheel = 0.4, power = 7, top = 38, idle_rpm = 800, max_rpm = 4800 },
  { id = "car_pickup", price = 2500, grip = 0.85, brake = 0.85, class = "everyday", name = "Hauler", oversteer = 0.45, wheel = 0.425, power = 8.5, top = 40, idle_rpm = 700, max_rpm = 5500 },
  { id = "car_offroad", price = 4500, grip = 0.9, brake = 0.9, class = "everyday", name = "Outback", oversteer = 0.35, wheel = 0.406, power = 8.6, top = 40, idle_rpm = 650, max_rpm = 4800 },
  { id = "car_gt", price = 18000, grip = 1.12, brake = 1.15, class = "sport", name = "Apex GT", oversteer = 0.5, wheel = 0.338, power = 10.2, top = 49, idle_rpm = 800, max_rpm = 7600 },
  -- (added 2026-11-07) the racing kit's four classic racers, five karts from the car kit (each with its own driver aboard) and, once the player has
  -- won three races, the car kit's service vehicles
  { id = "racecar_green", price = 14000, grip = 1.18, brake = 1.2, class = "formula", name = "Verde GP", oversteer = 0.3, wheel = 0.375, power = 11, top = 48.5, idle_rpm = 3000, max_rpm = 11000 },
  { id = "racecar_orange", price = 16000, grip = 1.12, brake = 1.15, class = "formula", name = "Tangerine", oversteer = 0.5, wheel = 0.375, power = 11.8, top = 49.5, idle_rpm = 3800, max_rpm = 13500 },
  { id = "racecar_red", price = 20000, grip = 1.22, brake = 1.25, class = "formula", name = "Rosso", oversteer = 0.25, wheel = 0.375, power = 10.8, top = 47.5, idle_rpm = 3200, max_rpm = 12000 },
  { id = "racecar_white", price = 18000, grip = 1.15, brake = 1.2, class = "formula", name = "Phantom", oversteer = 0.4, wheel = 0.375, power = 11.4, top = 50.5, idle_rpm = 3000, max_rpm = 11500 },
  { id = "kart_oobi", price = 1000, starter = true, grip = 1.35, brake = 1.3, class = "kart", name = "Oobi", oversteer = 0.5, wheel = 0.27, power = 10, top = 33, idle_rpm = 2200, max_rpm = 13000 },
  { id = "kart_oodi", price = 4000, grip = 1.3, brake = 1.3, class = "kart", name = "Oodi", oversteer = 0.6, wheel = 0.27, power = 10.5, top = 34, idle_rpm = 2400, max_rpm = 13500 },
  { id = "kart_ooli", price = 3000, grip = 1.4, brake = 1.35, class = "kart", name = "Ooli", oversteer = 0.4, wheel = 0.27, power = 9.5, top = 32.5, idle_rpm = 2000, max_rpm = 12500 },
  { id = "kart_oopi", price = 3500, grip = 1.32, brake = 1.3, class = "kart", name = "Oopi", oversteer = 0.55, wheel = 0.27, power = 10.2, top = 33.5, idle_rpm = 2300, max_rpm = 13200 },
  { id = "kart_oozi", price = 4500, grip = 1.28, brake = 1.25, class = "kart", name = "Oozi", oversteer = 0.65, wheel = 0.27, power = 10.8, top = 34.5, idle_rpm = 2500, max_rpm = 14000 },
  { id = "ambulance", price = 5000, grip = 0.85, brake = 0.85, class = "fun", name = "Ambulance", oversteer = 0.35, wheel = 0.375, power = 8, top = 41, idle_rpm = 750, max_rpm = 5200 },
  { id = "firetruck", price = 8000, grip = 0.8, brake = 0.8, class = "fun", name = "Fire Engine", oversteer = 0.25, wheel = 0.425, power = 7, top = 37, idle_rpm = 600, max_rpm = 3600 },
  { id = "garbage_truck", price = 6000, grip = 0.78, brake = 0.78, class = "fun", name = "Bin Lorry", oversteer = 0.2, wheel = 0.425, power = 6.5, top = 35, idle_rpm = 600, max_rpm = 3400 },
  { id = "delivery", price = 3500, grip = 0.82, brake = 0.82, class = "fun", name = "Courier", oversteer = 0.3, wheel = 0.375, power = 7.5, top = 39, idle_rpm = 750, max_rpm = 4600 },
  { id = "tractor", price = 2500, grip = 0.9, brake = 0.9, class = "fun", name = "Tractor", oversteer = 0.45, wheel = 0.38, power = 6, top = 30, idle_rpm = 500, max_rpm = 2600 },
}

-- How hard the rivals drive (race mode). `pace` is the share of its car's top speed a rival runs at, `corner` the share of what its tyres can
-- hold that it dares in a bend, and `band` how much it eases off when it is well ahead of you or pushes when well behind (a share of its speed).
-- Each rival also has a driver's skill (race.lua), so the three of a race are never level.
state.difficulties = {
  { id = "easy", name = "Easy", blurb = "Rivals drive carefully and give up the chase. In a rally the section times to beat are generous.", pace = 0.72, corner = 0.74, band = 0.03, allow = 1.3 },
  { id = "medium", name = "Medium", blurb = "Rivals drive well and stay in touch. In a rally the section times to beat are fair.", pace = 0.88, corner = 0.92, band = 0.06, allow = 1.1 },
  { id = "hard", name = "Hard", blurb = "Rivals drive to the limit of their cars and chase you down. In a rally the section times to beat are tight.", pace = 1.0, corner = 1.06, band = 0.10, allow = 0.98 },
  { id = "expert", name = "Expert", blurb = "Rivals drive at the limit and never give up. In a rally the section times to beat leave nothing spare.", pace = 1.03, corner = 1.1, band = 0.12, allow = 0.93 },
}
-- (each course's level picks its difficulty: Easy, Medium, Hard or Expert, in the order of state.levels)

state.track = 1       -- index into state.tracks
state.stage = 1       -- index into state.stages (in rally mode)
state.car = 1         -- index into state.cars
state.laps = 2
state.mode = "rally"   -- "rally" (a stage, against the section times), "race" (a circuit, against three rivals) or "trial" (alone, against your best lap's ghost)
state.music_volume = 0.7
state.sfx_volume = 0.8
state.shadows = true   -- the sun's shadows (a little slower on a handheld)
state.vibration = true -- shake the gamepad when the car hits something
state.music_style = "kenney" -- "kenney" (Kenney's music loops) or "studio" (the songs made with Nova's music editor)
state.smooth = true    -- edges smoothed (FXAA at 540p, before the picture is scaled up)
state.effects = true   -- bloom, ambient occlusion, grass and wind (a little slower on a handheld)
state.result = nil    -- filled in when a race ends

function state.load()
  local saved = nova.save.get("options", {})
  state.music_volume = saved.music or state.music_volume
  state.sfx_volume = saved.sfx or state.sfx_volume
  if saved.shadows ~= nil then state.shadows = saved.shadows end
  if saved.vibration ~= nil then state.vibration = saved.vibration end
  if saved.effects ~= nil then state.effects = saved.effects end
  if saved.smooth ~= nil then state.smooth = saved.smooth end
  if saved.music_style then state.music_style = saved.music_style end
  state.track = nova.save.get("last_track", 1)
  state.stage = nova.save.get("last_stage", 1)
  state.car = nova.save.get("last_car", 1)
  state.mode = nova.save.get("last_mode", "rally")
  if not state.cars[state.car] then state.car = 1 end
  -- a new player's garage opens on the first starter car (they have none yet)
  if not state.owns(state.current_car().id) then
    for i, c in ipairs(state.garage()) do if state.owns(c.id) then state.car = state.index_of(c.id); break end end
    if not state.owns(state.current_car().id) then state.car = state.index_of(state.garage()[1].id) end
  end
  state.apply_volumes()
end

-- The picture's finish for a course's look (the `look` and `wind` of its race object, lib/course.lua): bloom and ambient occlusion, and the wind; plain when effects are off.
-- The picture's finish for a look, with edges smoothed (FXAA, if the player has it on) and any `extra` fields (the menus add a vignette).
function state.apply_look(look, extra)
  local l = {}
  if state.effects and look.look then for k, v in pairs(look.look) do l[k] = v end end
  for k, v in pairs(extra or {}) do l[k] = v end
  l.fxaa = state.smooth and 1 or 0
  nova.look(l)
  if state.effects and look.wind then nova.wind(look.wind) else nova.wind() end
end

function state.save_options()
  nova.save.set("options", { music = state.music_volume, sfx = state.sfx_volume, shadows = state.shadows, vibration = state.vibration, effects = state.effects, smooth = state.smooth, music_style = state.music_style })
  nova.save.set("last_track", state.track)
  nova.save.set("last_stage", state.stage)
  nova.save.set("last_car", state.car)
  nova.save.set("last_mode", state.mode)
  state.apply_volumes()
end

function state.apply_volumes()
  nova.music.volume(state.music_volume)
  nova.sound.volume(state.sfx_volume)
end

-- How hard the rivals drive and how tight a stage's times are: the chosen course's level.
function state.difficulty_of(course) return state.difficulties[math.max(1, math.min(#state.difficulties, (course and course.level) or 1))] end
function state.current_difficulty() return state.difficulty_of(state.current_track()) end
-- The circuit that is chosen, or in rally mode the stage.
function state.current_track()
  if state.mode == "rally" then return state.stages[state.stage] end
  return state.tracks[state.track]
end
-- The id of the look (sky, sun, trees, hills) of what is chosen: a stage has the look of its circuit.
function state.look_id() local t = state.current_track(); return t.look or t.id end

-- The best total score of a rally stage (higher is better); true if `score` is a new best.
function state.submit_score(id, score)
  local old = nova.save.get("rally_score_" .. id, nil)
  if old == nil or score > old then nova.save.set("rally_score_" .. id, score); return true end
  return false
end
function state.class_of(car) for _, c in ipairs(state.classes) do if c.id == car.class then return c end end end

-- ---- what the player has done and owns (saved) --------------------------------------------------------------------------------
-- Races won (first place in a race against rivals): counted, and shown nowhere yet.
function state.wins() return nova.save.get("wins", 0) end
function state.add_win() nova.save.set("wins", state.wins() + 1) end

-- Every class of car can be driven (the garage sells them all); kept for the menus that ask.
function state.class_open(class) return true end
function state.car_open(car) return true end

-- ---- coins and the garage ---------------------------------------------------------------------------------------------------------
state.STARTING_COINS = 1000
function state.coins() return nova.save.get("coins", state.STARTING_COINS) end
function state.add_coins(n) nova.save.set("coins", state.coins() + math.floor(n + 0.5)) end
-- TESTING (2026-11-09): every vehicle is owned, so any of them can be driven at once. Set this to false to bring back buying cars with
-- coins (progression comes back later); the tests for a new player (rally.rs) are ignored until then.
state.UNLOCK_ALL_VEHICLES = true
function state.owned()
  if state.UNLOCK_ALL_VEHICLES then
    local all = {}
    for _, c in ipairs(state.cars) do all[#all + 1] = c.id end
    return all
  end
  return nova.save.get("owned", {})
end
function state.owns(id)
  for _, o in ipairs(state.owned()) do if o == id then return true end end
  return false
end
-- Buys car `car` (one of state.cars) if there are coins enough; true when it is now the player's.
function state.buy(car)
  if state.owns(car.id) then return true end
  if state.coins() < car.price then return false end
  nova.save.set("coins", state.coins() - car.price)
  local list = nova.save.get("owned", {})
  list[#list + 1] = car.id
  nova.save.set("owned", list)
  nova.log(string.format("garage: bought %s for %d coins, %d left", car.id, car.price, state.coins()))
  return true
end
function state.index_of(id) for i, c in ipairs(state.cars) do if c.id == id then return i end end end
-- The garage's grid: every car, cheapest first (the three starters lead), by name within a price.
local garage_list
function state.garage()
  if not garage_list then
    garage_list = {}
    for _, c in ipairs(state.cars) do garage_list[#garage_list + 1] = c end
    table.sort(garage_list, function(a, b) if a.price ~= b.price then return a.price < b.price end return a.name < b.name end)
  end
  return garage_list
end
-- "12,500"
function state.money(n)
  local s = tostring(math.floor(n))
  while true do
    local r, k = s:gsub("^(%d+)(%d%d%d)", "%1,%2")
    s = r
    if k == 0 then return s end
  end
end

-- What a finished course pays. `how`: { place } (a race against rivals, with `laps`), { stars } (a rally stage) or { trial = true,
-- record = a new best lap }. A harder course pays more; a longer race (more laps than the course's own) pays more, a shorter one less.
local PURSE = { 600, 900, 1400, 2000 }
local PLACE_SHARE = { 1, 0.6, 0.4, 0.2 }
local STAR_SHARE = { [0] = 0.15, 0.4, 0.7, 1 }
function state.reward(course, how)
  local purse = PURSE[course.level or 1] or PURSE[1]
  if how.stars then return math.floor(purse * 1.2 * STAR_SHARE[how.stars] / 10 + 0.5) * 10 end
  if how.trial then return math.floor((purse * 0.15 + (how.record and purse * 0.25 or 0)) / 10 + 0.5) * 10 end
  local laps = math.max(0.5, math.min(2.5, (how.laps or course.laps) / (course.laps or 2)))
  return math.floor(purse * (PLACE_SHARE[how.place] or 0.1) * laps / 10 + 0.5) * 10
end

-- ---- progress through the courses -------------------------------------------------------------------------------------------------
-- (saved apart for the circuits and the stages: `career_circuit` holds the best place on each circuit, `career_rally` the most stars on each stage)
local function career(list) return list == state.stages and "career_rally" or "career_circuit" end
function state.progress(list, id) return nova.save.get(career(list), {})[id] end
-- A course finished: `result` is the place (a circuit) or the stars (a stage). Returns the course this opened, if it opened one.
function state.record(list, id, result)
  local before = {}
  for i, c in ipairs(list) do before[i] = state.course_open(list, c) end
  local t = nova.save.get(career(list), {})
  local old = t[id]
  if list == state.stages then
    if old == nil or result > old then t[id] = result end
  elseif old == nil or result < old then t[id] = result end
  nova.save.set(career(list), t)
  for i, c in ipairs(list) do if not before[i] and state.course_open(list, c) then return c end end
end
local function passed(list, c)
  local r = state.progress(list, c.id)
  if r == nil then return false end
  if list == state.stages then return r >= 1 end
  return r <= 3
end
-- Whether a course of a list (state.tracks or state.stages) can be picked, and if not, what it takes.
function state.course_open(list, course)
  local at
  for i, c in ipairs(list) do if c == course or c.id == course.id then at = i end end
  if not at or at == 1 then return true end
  local before = list[at - 1]
  if passed(list, before) then return true end
  if list == state.stages then return false, "Score a star on " .. before.name .. " to open." end
  return false, "Finish " .. before.name .. " in the top three to open."
end
function state.courses_done(list)
  local n = 0
  for _, c in ipairs(list) do if passed(list, c) then n = n + 1 end end
  return n
end
function state.current_car() return state.cars[state.car] end

-- Best race time and best lap per track, saved with the track's id.
function state.best(kind, track_id) return nova.save.get(kind .. "_" .. track_id, nil) end

-- Returns true when `seconds` is a new record.
function state.submit(kind, track_id, seconds)
  local old = state.best(kind, track_id)
  if old == nil or seconds < old then
    nova.save.set(kind .. "_" .. track_id, seconds)
    return true
  end
  return false
end

return state

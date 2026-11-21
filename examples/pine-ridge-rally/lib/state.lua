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
  { id = "sport", name = "Road", blurb = "Cars for the tarmac: coupes, hatchbacks, a rally car and a racer." },
  { id = "everyday", name = "4x4", blurb = "Workhorses: slower on the road, at home on gravel, sand and snow." },
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
  -- made by scripts/rally/random-stage.mjs from a seed (the studio's "New random route"); `open`: always playable, whatever else has been won
  { id = "stage_random_1", look = "stage_random_1", name = "Random Stage", blurb = "A stage made up from a seed: forest roads nobody has driven before.", laps = 1, km = 3.1, sections = 7, level = 1, open = true },
}
-- The cars, each modelled from its blueprint (scripts/rally/blueprint-cars.mjs and scripts/rally/cars/) and each its own machine. What the numbers mean:
-- `power` is the pull in first gear (m/s squared) and `top` the top speed on the flat (m/s). `gears` is the gearbox: for each gear the
--   speed it runs out at (m/s) and how hard it pulls (a share of `power`); `shift` is how long a change takes (seconds with no pull).
--   The last gear is an overdrive: it runs out well above the top speed, so flat out the engine sits at about 85% of its revs, not on the limiter.
-- `idle_rpm` and `max_rpm` are the engine's range (the same numbers as in scripts/rally/engines.mjs, which makes its sound).
-- `grip` is how much the tyres hold in a bend on the road (1 is an ordinary road car), `brake` how hard the brakes bite, `turn` how
--   eagerly it changes direction, `oversteer` how readily the rear lets go under power in a bend (0 never, 1 a lot).
-- `loose` is what loose ground does to it: `dirt` scales its grip on gravel, sand and snow roads; off the road (`rough`) its top speed
--   falls to `rough_top` of normal, the drag is scaled by `rough_drag` and the grip by `rough_grip`.
-- `spring` and `damper` are the suspension (stiff and flat, or soft and wallowing), `lean` how much the body rolls and nods.
-- `wheel` is the wheels' radius in metres, `length` the car's length (for the size it is shown at in the garage), `tail` where its
--   rear lamps are (the TAIL line scripts/rally/blueprint-cars.mjs prints), `six` true for a six-wheeler. `paints` are its models: the first is the player's, the rest are what rivals wear.
-- `price`: both are starters (a new player can afford either).
state.cars = {
  { id = "car_gt", name = "Apex GT", class = "sport", price = 1000, starter = true,
    blurb = "3.0 litre turbo straight-six, eight gears. Fast and sharp on tarmac; hates leaving it.",
    power = 10.6, top = 54, idle_rpm = 750, max_rpm = 7000, shift = 0.11,
    gears = { { top = 9.5, pull = 1.5 }, { top = 15.5, pull = 1.3 }, { top = 21.5, pull = 1.15 }, { top = 28, pull = 1.03 }, { top = 35, pull = 0.94 }, { top = 42, pull = 0.86 }, { top = 49, pull = 0.8 }, { top = 63.5, pull = 0.74 } },
    grip = 1.14, brake = 1.2, turn = 1.08, oversteer = 0.55,
    loose = { dirt = 0.86, rough_top = 0.42, rough_drag = 1.3, rough_grip = 0.85 },
    spring = 660, damper = 51, lean = 0.75, wheel = 0.338, length = 4.77, tail = { z = -2.31, y = 0.8, x = 0.65 },
    paints = { "car_gt", "car_gt_red", "car_gt_white", "car_gt_grey" } },
  { id = "car_offroad", name = "Outback", class = "everyday", price = 1000, starter = true,
    blurb = "4.2 litre diesel straight-six, five gears, four-wheel drive. Slow to wind up, unbothered by gravel, sand or snow.",
    power = 7.8, top = 38, idle_rpm = 650, max_rpm = 4200, shift = 0.27,
    gears = { { top = 8, pull = 1.6 }, { top = 14, pull = 1.28 }, { top = 21, pull = 1.02 }, { top = 29.5, pull = 0.84 }, { top = 45, pull = 0.7 } },
    grip = 0.9, brake = 0.88, turn = 0.9, oversteer = 0.22,
    loose = { dirt = 1.22, rough_top = 0.85, rough_drag = 0.4, rough_grip = 1.3 },
    spring = 360, damper = 29, lean = 1.6, wheel = 0.406, length = 4.15, tail = { z = -1.84, y = 0.81, x = 0.84 },
    paints = { "car_offroad", "car_offroad_green", "car_offroad_white", "car_offroad_red" } },
  -- the eleven modelled from the second set of blueprints (scripts/rally/cars/*.mjs, 2026-11-20); their numbers are first guesses
  { id = "car_s15", name = "Kaze RS", class = "sport", price = 2600,
    blurb = "2.0 litre turbo four, six gears, rear-wheel drive. Light and eager; the tail steps out whenever you ask.",
    power = 9.6, top = 50, idle_rpm = 850, max_rpm = 7200, shift = 0.16,
    gears = { { top = 9, pull = 1.5 }, { top = 15, pull = 1.28 }, { top = 21.5, pull = 1.1 }, { top = 29, pull = 0.96 }, { top = 38, pull = 0.84 }, { top = 59, pull = 0.72 } },
    grip = 1.08, brake = 1.1, turn = 1.15, oversteer = 0.75,
    loose = { dirt = 0.84, rough_top = 0.42, rough_drag = 1.3, rough_grip = 0.85 },
    spring = 600, damper = 47, lean = 0.85, wheel = 0.331, length = 4.44, tail = { z = -2.14, y = 0.72, x = 0.63 },
    paints = { "car_s15", "car_s15_white", "car_s15_black", "car_s15_red" } },
  { id = "car_s14", name = "Kaze", class = "sport", price = 1800,
    blurb = "2.0 litre turbo four, five long gears. Softer and slower than the RS, and just as happy sideways.",
    power = 8.8, top = 47, idle_rpm = 800, max_rpm = 6800, shift = 0.2,
    gears = { { top = 9.5, pull = 1.5 }, { top = 16.5, pull = 1.25 }, { top = 24.5, pull = 1.05 }, { top = 34, pull = 0.88 }, { top = 55.5, pull = 0.72 } },
    grip = 1.04, brake = 1.02, turn = 1.1, oversteer = 0.7,
    loose = { dirt = 0.84, rough_top = 0.42, rough_drag = 1.3, rough_grip = 0.85 },
    spring = 540, damper = 43, lean = 0.95, wheel = 0.3125, length = 4.56, tail = { z = -2.31, y = 0.73, x = 0.54 },
    paints = { "car_s14", "car_s14_white", "car_s14_blue", "car_s14_black" } },
  { id = "car_hatch_r", name = "Tarn R", class = "sport", price = 3200,
    blurb = "2.0 litre turbo four, six close gears, front-wheel drive. Enormous grip and brakes; it pushes wide rather than slides.",
    power = 10, top = 52, idle_rpm = 800, max_rpm = 7000, shift = 0.13,
    gears = { { top = 9, pull = 1.5 }, { top = 15, pull = 1.3 }, { top = 21.5, pull = 1.14 }, { top = 29, pull = 1 }, { top = 38, pull = 0.88 }, { top = 61.5, pull = 0.76 } },
    grip = 1.16, brake = 1.22, turn = 1.12, oversteer = 0.12,
    loose = { dirt = 0.88, rough_top = 0.44, rough_drag = 1.25, rough_grip = 0.88 },
    spring = 680, damper = 52, lean = 0.7, wheel = 0.322, length = 4.56, tail = { z = -2.21, y = 0.9, x = 0.71 },
    paints = { "car_hatch_r", "car_hatch_r_red", "car_hatch_r_blue", "car_hatch_r_grey" } },
  { id = "car_gt2", name = "Kestrel GT2", class = "sport", price = 9000,
    blurb = "2.5 litre turbo five, seven-speed racing gearbox, slick tyres and a wing. Stay on the tarmac.",
    power = 12.5, top = 60, idle_rpm = 1100, max_rpm = 7200, shift = 0.07,
    gears = { { top = 10.5, pull = 1.5 }, { top = 17, pull = 1.32 }, { top = 23.5, pull = 1.17 }, { top = 30.5, pull = 1.05 }, { top = 38.5, pull = 0.95 }, { top = 48, pull = 0.85 }, { top = 71, pull = 0.76 } },
    grip = 1.38, brake = 1.5, turn = 1.2, oversteer = 0.35,
    loose = { dirt = 0.7, rough_top = 0.3, rough_drag = 1.6, rough_grip = 0.75 },
    spring = 900, damper = 68, lean = 0.4, wheel = 0.344, length = 4.64, tail = { z = -2.27, y = 0.43, x = 0 },
    paints = { "car_gt2", "car_gt2_orange", "car_gt2_blue", "car_gt2_black" } },
  { id = "car_city", name = "Pip", class = "sport", price = 600,
    blurb = "0.8 litre three-cylinder, five gears. Slow, narrow and nimble: it darts where bigger cars have to brake.",
    power = 5.6, top = 34, idle_rpm = 900, max_rpm = 6200, shift = 0.26,
    gears = { { top = 7, pull = 1.6 }, { top = 12.5, pull = 1.25 }, { top = 18.5, pull = 1 }, { top = 26, pull = 0.82 }, { top = 40, pull = 0.66 } },
    grip = 0.92, brake = 0.9, turn = 1.18, oversteer = 0.08,
    loose = { dirt = 0.95, rough_top = 0.5, rough_drag = 1.1, rough_grip = 0.95 },
    spring = 380, damper = 30, lean = 1.5, wheel = 0.272, length = 3.5, tail = { z = -1.66, y = 0.78, x = 0.61 },
    paints = { "car_city", "car_city_blue", "car_city_red", "car_city_white" } },
  { id = "car_hatch", name = "Sora", class = "sport", price = 1400,
    blurb = "2.0 litre four, six gears, front-wheel drive. Smooth, steady and forgiving: the sensible choice.",
    power = 7.6, top = 45, idle_rpm = 750, max_rpm = 6500, shift = 0.2,
    gears = { { top = 8.5, pull = 1.55 }, { top = 14.5, pull = 1.28 }, { top = 21, pull = 1.08 }, { top = 28, pull = 0.94 }, { top = 36, pull = 0.82 }, { top = 53, pull = 0.7 } },
    grip = 1.04, brake = 1.05, turn = 1.02, oversteer = 0.1,
    loose = { dirt = 0.9, rough_top = 0.45, rough_drag = 1.2, rough_grip = 0.9 },
    spring = 500, damper = 40, lean = 1, wheel = 0.353, length = 4.46, tail = { z = -2.14, y = 0.95, x = 0.57 },
    paints = { "car_hatch", "car_hatch_white", "car_hatch_blue", "car_hatch_grey" } },
  { id = "car_rally", name = "Sprint 400", class = "sport", price = 3600,
    blurb = "2.4 litre four on twin carburettors, five gears, rear-wheel drive. Built for loose roads, and always a little sideways.",
    power = 9.8, top = 48, idle_rpm = 1000, max_rpm = 7600, shift = 0.15,
    gears = { { top = 10, pull = 1.5 }, { top = 17, pull = 1.26 }, { top = 25, pull = 1.06 }, { top = 35, pull = 0.9 }, { top = 56.5, pull = 0.76 } },
    grip = 1.06, brake = 1.15, turn = 1.16, oversteer = 0.8,
    loose = { dirt = 1.12, rough_top = 0.6, rough_drag = 0.8, rough_grip = 1.1 },
    spring = 520, damper = 44, lean = 0.9, wheel = 0.2875, length = 4.42, tail = { z = -2.16, y = 0.53, x = 0.59 },
    paints = { "car_rally", "car_rally_blue", "car_rally_yellow", "car_rally_green" } },
  { id = "car_muscle", name = "Brute 340", class = "sport", price = 2400,
    blurb = "5.6 litre V8, four gears. Huge shove in a straight line; soft springs, weak brakes and a restless tail.",
    power = 10.2, top = 49, idle_rpm = 700, max_rpm = 5600, shift = 0.3,
    gears = { { top = 14, pull = 1.5 }, { top = 24, pull = 1.18 }, { top = 36, pull = 0.92 }, { top = 58, pull = 0.72 } },
    grip = 0.9, brake = 0.8, turn = 0.86, oversteer = 0.9,
    loose = { dirt = 0.8, rough_top = 0.45, rough_drag = 1.2, rough_grip = 0.85 },
    spring = 400, damper = 30, lean = 1.5, wheel = 0.334, length = 4.92, tail = { z = -2.4, y = 0.75, x = 0.65 },
    paints = { "car_muscle", "car_muscle_blue", "car_muscle_green", "car_muscle_white" } },
  { id = "car_suv", name = "Trailhead", class = "everyday", price = 2000,
    blurb = "2.8 litre turbo diesel, six gears, four-wheel drive. Tall and comfortable; quicker than the Outback on the road, nearly as sure off it.",
    power = 7.4, top = 42, idle_rpm = 700, max_rpm = 4400, shift = 0.22,
    gears = { { top = 7.5, pull = 1.6 }, { top = 13, pull = 1.3 }, { top = 19, pull = 1.08 }, { top = 26, pull = 0.92 }, { top = 34, pull = 0.8 }, { top = 49.5, pull = 0.68 } },
    grip = 0.94, brake = 0.95, turn = 0.92, oversteer = 0.15,
    loose = { dirt = 1.15, rough_top = 0.78, rough_drag = 0.5, rough_grip = 1.2 },
    spring = 400, damper = 33, lean = 1.4, wheel = 0.3875, length = 4.8, tail = { z = -2.34, y = 1.13, x = 0.68 },
    paints = { "car_suv", "car_suv_white", "car_suv_black", "car_suv_red" } },
  { id = "car_pickup", name = "Ridgeback", class = "everyday", price = 3400,
    blurb = "3.4 litre twin-turbo V6, ten short gears, four-wheel drive. Big, strong and always in the right gear; needs room to turn.",
    power = 9, top = 46, idle_rpm = 650, max_rpm = 5800, shift = 0.14,
    gears = { { top = 5, pull = 1.7 }, { top = 8.5, pull = 1.5 }, { top = 12, pull = 1.34 }, { top = 15.5, pull = 1.2 }, { top = 19.5, pull = 1.08 }, { top = 24, pull = 0.98 }, { top = 29, pull = 0.9 }, { top = 35, pull = 0.82 }, { top = 41, pull = 0.75 }, { top = 54.5, pull = 0.68 } },
    grip = 0.92, brake = 0.9, turn = 0.8, oversteer = 0.3,
    loose = { dirt = 1.18, rough_top = 0.82, rough_drag = 0.45, rough_grip = 1.25 },
    spring = 380, damper = 32, lean = 1.5, wheel = 0.425, length = 5.93, tail = { z = -2.87, y = 1.05, x = 0.96 },
    paints = { "car_pickup", "car_pickup_white", "car_pickup_black", "car_pickup_blue" } },
  { id = "car_truck", name = "Mammut 6x6", class = "everyday", price = 5000,
    blurb = "7.2 litre diesel six, eight gears, six-wheel drive. Barely notices grass, sand or snow, and takes a whole road to turn.",
    power = 5.4, top = 27, idle_rpm = 600, max_rpm = 2500, shift = 0.4,
    gears = { { top = 3.5, pull = 1.7 }, { top = 6, pull = 1.5 }, { top = 9, pull = 1.3 }, { top = 12.5, pull = 1.12 }, { top = 16, pull = 0.98 }, { top = 20, pull = 0.86 }, { top = 23.5, pull = 0.76 }, { top = 32, pull = 0.66 } },
    grip = 0.78, brake = 0.7, turn = 0.62, oversteer = 0.05,
    loose = { dirt = 1.3, rough_top = 0.95, rough_drag = 0.3, rough_grip = 1.4 },
    spring = 300, damper = 30, lean = 1.3, wheel = 0.609, length = 8.47, tail = { z = -4.2, y = 0.95, x = 1 }, six = true,
    paints = { "car_truck", "car_truck_sand", "car_truck_green", "car_truck_white" } },
}
-- The car a model belongs to (a paint is a model of its own): "car_gt_red" -> the Apex GT's entry.
local by_model = {}
for _, c in ipairs(state.cars) do for _, m in ipairs(c.paints) do by_model[m] = c end end
function state.car_of(model) return by_model[model] end

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
-- How good the rivals are (race mode), the player's choice: each rival's own skill (lib/race.lua's RIVALS: pace, bravery, consistency)
-- scaled by these. `pace` is the share of the racing line's corner speed (lib/racing.lua), `bravery` of the brakes, `consistency` how
-- evenly they drive. On Normal the best rival is a few per cent off the car's ideal lap and the slowest about ten: a field to fight
-- through, where a good clean race wins. (Since 2026-11-21 the course's level only nudges this by a per cent or two; its `pace`,
-- `corner` and `band` above were the old drivers'.) The options page needs a line for it: "RIVALS" cycling state.rival_levels.
state.rival_levels = {
  { id = "easy", name = "Easy", blurb = "Rivals brake early and take the bends gently.", pace = 0.92, bravery = 0.88, consistency = 0.95 },
  { id = "normal", name = "Normal", blurb = "Rivals drive well: you have to drive well to win.", pace = 0.97, bravery = 0.96, consistency = 1 },
  { id = "hard", name = "Hard", blurb = "Rivals drive at the limit of their cars, and rarely slip.", pace = 1.0, bravery = 1.0, consistency = 1.04 },
}
state.rival_level = "normal"
function state.current_rival_level()
  for _, l in ipairs(state.rival_levels) do if l.id == state.rival_level then return l end end
  return state.rival_levels[2]
end

state.track = 1       -- index into state.tracks
state.stage = 1       -- index into state.stages (in rally mode)
state.car = 1         -- index into state.cars
state.laps = 2
state.mode = "rally"   -- "rally" (a stage, against the section times), "race" (a circuit, against three rivals) or "trial" (alone, against your best lap's ghost)
state.music_volume = 0.7
state.sfx_volume = 0.8
state.shadows = true   -- the sun's shadows (a little slower on a handheld)
state.vibration = true -- shake the gamepad when the car hits something
state.music_style = "studio" -- "kenney" (Kenney's music loops) or "studio" (the songs made with Nova's music editor)
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
  if saved.rivals then state.rival_level = saved.rivals end
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
  nova.save.set("options", { music = state.music_volume, sfx = state.sfx_volume, shadows = state.shadows, vibration = state.vibration, effects = state.effects, smooth = state.smooth, music_style = state.music_style, rivals = state.rival_level })
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
  if course.open then return true end
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

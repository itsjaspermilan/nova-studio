-- What the game remembers: the player's choices, options and best times (saved between runs).
local state = {}

state.tracks = {
  { id = "pine_ridge", name = "Pine Ridge", blurb = "Fast asphalt through the pines. Long straights, one tight hairpin.", laps = 3, music = "race_forest" },
  { id = "dust_valley", name = "Dust Valley", blurb = "Loose dirt and twisty bends between the mesas.", laps = 3, music = "race_desert" },
  { id = "frost_pass", name = "Frost Pass", blurb = "Packed snow on a long, looping pass. Grip is thin: brake early and be gentle.", laps = 3, music = "race_snow" },
  { id = "harbour_lights", name = "Harbour Lights", blurb = "Asphalt after dark. Lamps mark the way; your headlights do the rest.", laps = 3, music = "race_night" },
}
-- The classes: you race the other cars of your own class (the grid on the car page is split by them)
state.classes = {
  { id = "formula", name = "Formula", blurb = "Open-wheel racers: the quickest, and they hold the road." },
  { id = "sport", name = "Sport", blurb = "Fast road cars that slide under power." },
  { id = "everyday", name = "Everyday", blurb = "Family cars and workhorses: slower, and heavy in the bends." },
}
state.cars = {
  -- `oversteer`: how readily the rear lets go under power in a bend (0 never, 1 a lot); the sedan and the hatchback are the
  -- drifters, the open-wheel cars hold the road
  -- `wheel`: the wheels' radius in metres (the models' wheels are 0.6, 0.68, 0.66 and 0.62 m across), for how fast they spin
  -- `grip` is how much the tyres hold in a bend (1 is an ordinary road car) and `brake` how hard the brakes bite (1 likewise): the
  -- open-wheel cars have most of both, a van or a pickup the least. The rivals drive their cars up to what these allow.
  -- `idle_rpm` and `max_rpm` are the engine's range (the same numbers as in scripts/rally/engines.mjs, which makes its sound).
  -- `power` is the pull in first gear (m/s squared) and `top` the top speed (m/s): the open-wheel cars are the quick ones
  { id = "car", grip = 1.2, brake = 1.25, class = "formula", name = "Redline", oversteer = 0.35, wheel = 0.30, power = 11.5, top = 50, idle_rpm = 3500, max_rpm = 12500 },
  { id = "car_blue", grip = 1, brake = 1, class = "sport", name = "Blue Streak", oversteer = 0.6, wheel = 0.34, power = 8.5, top = 44, idle_rpm = 900, max_rpm = 7000 },
  { id = "car_green", grip = 0.98, brake = 0.95, class = "sport", name = "Green Machine", oversteer = 0.7, wheel = 0.33, power = 8, top = 42, idle_rpm = 1000, max_rpm = 6800 },
  { id = "car_yellow", grip = 1.15, brake = 1.2, class = "formula", name = "Sunburst", oversteer = 0.45, wheel = 0.31, power = 11, top = 48, idle_rpm = 2500, max_rpm = 9800 },
  { id = "car_sedan", grip = 0.92, brake = 0.9, class = "everyday", name = "Commuter", oversteer = 0.5, wheel = 0.335, power = 8, top = 42, idle_rpm = 800, max_rpm = 6500 },
  { id = "car_suv", grip = 0.88, brake = 0.9, class = "everyday", name = "Trailblazer", oversteer = 0.4, wheel = 0.395, power = 8.5, top = 42, idle_rpm = 700, max_rpm = 5800 },
  { id = "car_suvl", grip = 0.95, brake = 0.95, class = "sport", name = "Grand Tourer", oversteer = 0.5, wheel = 0.4, power = 9.5, top = 46, idle_rpm = 600, max_rpm = 5500 },
  { id = "car_taxi", grip = 0.9, brake = 0.9, class = "everyday", name = "Cab", oversteer = 0.6, wheel = 0.335, power = 7.5, top = 40, idle_rpm = 850, max_rpm = 6000 },
  { id = "car_police", grip = 1, brake = 1.05, class = "sport", name = "Patrol", oversteer = 0.55, wheel = 0.375, power = 9.5, top = 46, idle_rpm = 700, max_rpm = 6800 },
  { id = "car_van", grip = 0.8, brake = 0.8, class = "everyday", name = "Delivery Van", oversteer = 0.3, wheel = 0.355, power = 7, top = 38, idle_rpm = 800, max_rpm = 4800 },
  { id = "car_pickup", grip = 0.85, brake = 0.85, class = "everyday", name = "Hauler", oversteer = 0.45, wheel = 0.41, power = 8.5, top = 40, idle_rpm = 700, max_rpm = 5500 },
}

-- How hard the rivals drive (race mode). `pace` is the share of its car's top speed a rival runs at, `corner` the share of what its tyres can
-- hold that it dares in a bend, and `band` how much it eases off when it is well ahead of you or pushes when well behind (a share of its speed).
-- Each rival also has a driver's skill (race.lua), so the three of a race are never level.
state.difficulties = {
  { id = "easy", name = "Easy", blurb = "Rivals drive carefully and give up the chase.", pace = 0.72, corner = 0.68, band = 0.03 },
  { id = "medium", name = "Medium", blurb = "Rivals drive well and stay in touch.", pace = 0.88, corner = 0.86, band = 0.06 },
  { id = "hard", name = "Hard", blurb = "Rivals drive to the limit of their cars and chase you down.", pace = 1.0, corner = 1.03, band = 0.10 },
}

state.track = 1       -- index into state.tracks
state.car = 1         -- index into state.cars
state.laps = 3
state.difficulty = "medium"
state.mode = "race"    -- "race" (against three rivals) or "trial" (alone, against your best lap's ghost)
state.music_volume = 0.7
state.sfx_volume = 0.8
state.shadows = true   -- the sun's shadows (a little slower on a handheld)
state.vibration = true -- shake the gamepad when the car hits something
state.music_style = "kenney" -- "kenney" (Kenney's music loops) or "studio" (the songs made with Nova's music editor)
state.effects = true   -- bloom, ambient occlusion, grass and wind (a little slower on a handheld)
state.result = nil    -- filled in when a race ends

function state.load()
  local saved = nova.save.get("options", {})
  state.music_volume = saved.music or state.music_volume
  state.sfx_volume = saved.sfx or state.sfx_volume
  if saved.shadows ~= nil then state.shadows = saved.shadows end
  if saved.vibration ~= nil then state.vibration = saved.vibration end
  if saved.effects ~= nil then state.effects = saved.effects end
  if saved.music_style then state.music_style = saved.music_style end
  state.track = nova.save.get("last_track", 1)
  state.car = nova.save.get("last_car", 1)
  state.mode = nova.save.get("last_mode", "race")
  state.difficulty = nova.save.get("last_difficulty", "medium")
  state.apply_volumes()
end

-- The picture's finish for a circuit's look (see lib/looks.lua): bloom and ambient occlusion, and the wind; plain when effects are off.
function state.apply_look(look)
  if state.effects and look.look then nova.look(look.look) else nova.look() end
  if state.effects and look.wind then nova.wind(look.wind) else nova.wind() end
end

function state.save_options()
  nova.save.set("options", { music = state.music_volume, sfx = state.sfx_volume, shadows = state.shadows, vibration = state.vibration, effects = state.effects, music_style = state.music_style })
  nova.save.set("last_track", state.track)
  nova.save.set("last_car", state.car)
  nova.save.set("last_mode", state.mode)
  nova.save.set("last_difficulty", state.difficulty)
  state.apply_volumes()
end

function state.apply_volumes()
  nova.music.volume(state.music_volume)
  nova.sound.volume(state.sfx_volume)
end

function state.current_difficulty()
  for _, d in ipairs(state.difficulties) do if d.id == state.difficulty then return d end end
  return state.difficulties[2]
end
function state.current_track() return state.tracks[state.track] end
function state.class_of(car) for _, c in ipairs(state.classes) do if c.id == car.class then return c end end end
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

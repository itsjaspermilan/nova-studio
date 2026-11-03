-- What the game remembers: the player's choices, options and best times (saved between runs).
local state = {}

state.tracks = {
  { id = "pine_ridge", name = "Pine Ridge", blurb = "Fast asphalt through the pines. Long straights, one tight hairpin.", laps = 3, music = "race_forest" },
  { id = "dust_valley", name = "Dust Valley", blurb = "Loose dirt and twisty bends between the mesas.", laps = 3, music = "race_desert" },
}
state.cars = {
  { id = "car", name = "Redline" },
  { id = "car_blue", name = "Blue Streak" },
  { id = "car_green", name = "Green Machine" },
  { id = "car_yellow", name = "Sunburst" },
}

state.track = 1       -- index into state.tracks
state.car = 1         -- index into state.cars
state.laps = 3
state.music_volume = 0.7
state.sfx_volume = 0.8
state.result = nil    -- filled in when a race ends

function state.load()
  local saved = nova.save.get("options", {})
  state.music_volume = saved.music or state.music_volume
  state.sfx_volume = saved.sfx or state.sfx_volume
  state.track = nova.save.get("last_track", 1)
  state.car = nova.save.get("last_car", 1)
  state.apply_volumes()
end

function state.save_options()
  nova.save.set("options", { music = state.music_volume, sfx = state.sfx_volume })
  nova.save.set("last_track", state.track)
  nova.save.set("last_car", state.car)
  state.apply_volumes()
end

function state.apply_volumes()
  nova.music.volume(state.music_volume)
  nova.sound.volume(state.sfx_volume)
end

function state.current_track() return state.tracks[state.track] end
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

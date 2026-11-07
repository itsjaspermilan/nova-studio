-- What outlives a scene: the options, the progress through the campaign, the records, and what the next game should be.
local data = require("lib.data")

local state = {}

state.music_volume = 0.8
state.sfx_volume = 0.9
state.smooth = true -- anti-aliasing (FXAA)
state.vibration = true

state.mode = "campaign" -- "campaign" | "free"
state.level = 1 -- an index into data.levels
state.rules = nil -- Free Brew's rules for the next game
state.result = nil -- what the last game ended with

function state.apply_volumes()
  nova.music.volume(state.music_volume)
  nova.sound.volume(state.sfx_volume * 2) -- (the sounds' own gains in lib/audio.lua assume this)
end

function state.load()
  local saved = nova.save.get("options", nil)
  if saved then
    state.music_volume = saved.music or state.music_volume
    state.sfx_volume = saved.sfx or state.sfx_volume
    if saved.smooth ~= nil then state.smooth = saved.smooth end
    if saved.vibration ~= nil then state.vibration = saved.vibration end
  end
  state.apply_volumes()
end

function state.save_options()
  nova.save.set("options", { music = state.music_volume, sfx = state.sfx_volume, smooth = state.smooth, vibration = state.vibration })
  state.apply_volumes()
end

-- ---- progress -------------------------------------------------------------------------------------------------------------------

function state.stars(i) return nova.save.get("stars_" .. data.levels[i].id, 0) end
function state.best(i) return nova.save.get("best_" .. data.levels[i].id, 0) end

-- a level can be played when the one before it has earned a star (the first always can)
function state.unlocked(i)
  return i == 1 or state.stars(i - 1) >= 1
end

-- the first level not yet cleared (or the last one)
function state.next_level()
  for i = 1, #data.levels do if state.stars(i) == 0 then return i end end
  return #data.levels
end

function state.cleared_count()
  local n = 0
  for i = 1, #data.levels do if state.stars(i) >= 1 then n = n + 1 end end
  return n
end

function state.record(i, score, stars)
  local newbest = score > state.best(i)
  if newbest then nova.save.set("best_" .. data.levels[i].id, score) end
  if stars > state.stars(i) then nova.save.set("stars_" .. data.levels[i].id, stars) end
  return newbest
end

function state.tutorial_done() return nova.save.get("tutorial_done", false) end
function state.set_tutorial_done() nova.save.set("tutorial_done", true) end

function state.seen(name) return nova.save.get("seen_" .. name, false) end
function state.set_seen(name) nova.save.set("seen_" .. name, true) end

-- Free Brew keeps its own records, by level and how hard the rules are
function state.free_best(i) return nova.save.get("free_" .. data.levels[i].id, 0) end
function state.free_record(i, score)
  if score > state.free_best(i) then nova.save.set("free_" .. data.levels[i].id, score); return true end
  return false
end

return state

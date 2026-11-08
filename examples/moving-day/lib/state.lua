-- What outlives a scene: the options, each level's stars and fewest moves, whether the tutorial was played, and what the next game should be.
local levels = require("lib.levels")

local state = {}

state.music_volume = 0.8
state.sfx_volume = 0.9
state.smooth = true -- anti-aliasing (FXAA)
state.level = 1 -- the level to play next
state.result = nil -- what the last level ended with

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
  end
  state.apply_volumes()
end

function state.save_options()
  nova.save.set("options", { music = state.music_volume, sfx = state.sfx_volume, smooth = state.smooth })
  state.apply_volumes()
end

-- ---- progress: keyed by the level's number ----

function state.stars(i) return nova.save.get("stars_" .. i, 0) end
function state.best(i) return nova.save.get("best_" .. i, 0) end

-- a level can be played once the one before it is solved (the first of all always can)
function state.unlocked(i) return i == 1 or state.stars(i - 1) >= 1 end

function state.next_level()
  for i = 1, levels.count() do if state.stars(i) == 0 then return i end end
  return levels.count()
end

function state.total_stars()
  local n = 0
  for i = 1, levels.count() do n = n + state.stars(i) end
  return n
end

-- records a solve: returns whether it is a new fewest
function state.record(i, moves, stars)
  local best = state.best(i)
  local newbest = best == 0 or moves < best
  if newbest then nova.save.set("best_" .. i, moves) end
  if stars > state.stars(i) then nova.save.set("stars_" .. i, stars) end
  return newbest
end

function state.tutorial_done() return nova.save.get("tutorial_done", false) end
function state.set_tutorial_done() nova.save.set("tutorial_done", true) end

return state

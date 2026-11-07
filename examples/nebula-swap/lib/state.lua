-- What outlives a scene: the options, the records, and what the next game should be.
local state = {}

state.music_volume = 0.8
state.sfx_volume = 0.9
state.smooth = true -- anti-aliasing (FXAA)
state.shake = true
state.vibration = true

state.mode = "endless" -- "endless" | "puzzle" | "versus"
state.difficulty = 2 -- endless: 1 easy, 2 normal, 3 hard (the starting speed); battle: the rival's level
state.puzzle = 1
state.result = nil -- what the last game ended with (the results screen reads it)

state.DIFFICULTIES = {
  { id = "easy", name = "Easy", level = 1, blurb = "A slow start. Time to look around." },
  { id = "normal", name = "Normal", level = 4, blurb = "The pace of the classic. Chains pay." },
  { id = "hard", name = "Hard", level = 8, blurb = "Fast from the first row." },
}

function state.apply_volumes()
  nova.music.volume(state.music_volume)
  nova.sound.volume(state.sfx_volume * 2) -- (the effects' own gains in lib/audio.lua assume this)
end

function state.apply_look()
  -- FXAA on the finished picture (the board, the stars and the planets are drawn into it), a little glow and a vignette
  nova.look { fxaa = state.smooth and 1 or 0, vignette = 0.22 }
end

function state.load()
  local saved = nova.save.get("options", nil)
  if saved then
    state.music_volume = saved.music or state.music_volume
    state.sfx_volume = saved.sfx or state.sfx_volume
    if saved.smooth ~= nil then state.smooth = saved.smooth end
    if saved.shake ~= nil then state.shake = saved.shake end
    if saved.vibration ~= nil then state.vibration = saved.vibration end
  end
  state.apply_volumes()
  state.apply_look()
end

function state.save_options()
  nova.save.set("options", { music = state.music_volume, sfx = state.sfx_volume, smooth = state.smooth, shake = state.shake, vibration = state.vibration })
  state.apply_volumes()
  state.apply_look()
end

-- records
function state.best(key) return nova.save.get("best_" .. key, 0) end
function state.submit(key, value)
  if value > state.best(key) then nova.save.set("best_" .. key, value); return true end
  return false
end

function state.puzzle_done(n) return nova.save.get("puzzle_" .. n, false) end
function state.set_puzzle_done(n, moves_used) nova.save.set("puzzle_" .. n, moves_used) end
function state.puzzles_unlocked()
  local n = 1
  while state.puzzle_done(n) do n = n + 1 end
  return n
end

return state

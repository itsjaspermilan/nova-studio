-- What outlives a scene: the options, each level's record (cleared, which gems, best time, coins), and the choices on the map.
local levels = require("lib.levels")
local audio = require("lib.audio")

local state = {}

state.music_volume, state.sfx_volume = 0.8, 0.9
state.last = nil -- the level the map's cursor stands on
state.result = nil -- what the last level ended with, for the map to celebrate

function state.apply_volumes()
  nova.music.volume(state.music_volume)
  nova.sound.volume(state.sfx_volume * 1.5)
end

function state.load()
  local saved = nova.save.get("options", nil)
  if saved then
    state.music_volume = saved.music or state.music_volume
    state.sfx_volume = saved.sfx or state.sfx_volume
  end
  state.last = nova.save.get("last", nil)
  state.apply_volumes()
end

function state.save_options()
  nova.save.set("options", { music = state.music_volume, sfx = state.sfx_volume })
  state.apply_volumes()
end

-- a level's record: { done, gems = { bool, bool, bool }, best (seconds), coins }
function state.record(id)
  local r = nova.save.get("lv_" .. id, nil)
  if not r then r = { done = false, gems = { false, false, false }, coins = 0 } end
  r.gems = r.gems or { false, false, false }
  return r
end

function state.gem_count(id)
  local n = 0
  for _, g in ipairs(state.record(id).gems) do if g then n = n + 1 end end
  return n
end

-- three stars: cleared, every gem found, the time beaten
function state.stars(lv)
  local r = state.record(lv.id)
  local s = { r.done, state.gem_count(lv.id) >= 3, r.best ~= nil and lv.target ~= nil and r.best <= lv.target }
  local n = 0
  for _, v in ipairs(s) do if v then n = n + 1 end end
  return n, s
end

function state.total_stars()
  local n, max = 0, 0
  for _, lv in ipairs(levels.all()) do n = n + state.stars(lv); max = max + 3 end
  return n, max
end

function state.unlocked(lv)
  if lv.index == 1 then return true end
  local prev = levels.all()[lv.index - 1]
  return state.record(prev.id).done
end

-- Store a finished run. Returns what changed: { first_clear, new_best, new_gems = { indexes }, old_best }.
function state.finish(lv, run)
  local r = state.record(lv.id)
  local out = { first_clear = not r.done, old_best = r.best, new_gems = {}, old_stars = state.stars(lv) }
  r.done = true
  for i = 1, 3 do
    if run.gems[i] and not r.gems[i] then r.gems[i] = true; out.new_gems[#out.new_gems + 1] = i end
  end
  if run.time and (not r.best or run.time < r.best) then
    out.new_best = r.best ~= nil
    r.best = run.time
  end
  r.coins = math.max(r.coins or 0, run.coins or 0)
  nova.save.set("lv_" .. lv.id, r)
  out.stars = state.stars(lv)
  return out
end

-- gems found on a run that was not finished still count (they are kept, as in many platformers)
function state.keep_gems(lv, gems)
  local r = state.record(lv.id)
  local changed = false
  for i = 1, 3 do if gems[i] and not r.gems[i] then r.gems[i] = true; changed = true end end
  if changed then nova.save.set("lv_" .. lv.id, r) end
end

function state.set_last(id)
  state.last = id
  nova.save.set("last", id)
end

function state.seen(name) return nova.save.get("seen_" .. name, false) end
function state.set_seen(name) nova.save.set("seen_" .. name, true) end

state.audio = audio
return state

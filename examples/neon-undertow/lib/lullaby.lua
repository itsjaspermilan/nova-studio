-- LULLABY's words: which wake-up line comes next, and which set of screen lines holds now. The lines are data/den.lua.
local Dd = require("data.den")
local Meta = require("lib.meta")

local L = {}

-- The wake-up line for what brought you to the Den ("first", "dead", "win"): in order, cycling; how many were read is saved.
function L.wake_line(kind)
  local set = Dd.wake_lines[kind] or Dd.wake_lines.first
  local n = Meta.lines[kind] or 0
  Meta.lines[kind] = n + 1
  return set[n % #set + 1], kind, n % #set + 1
end

-- What she says at the screen: the set whose test holds (a fresh game, a veteran who has never won, someone who has won, the rest).
function L.screen_set()
  local want
  if Meta.runs <= 1 and Meta.wins == 0 then want = "fresh"
  elseif Meta.wins == 0 and Meta.prints >= 4 then want = "veteran"
  elseif Meta.wins >= 1 then want = "won"
  else want = "default" end
  for _, s in ipairs(Dd.screen) do if s.when == want then return s.lines, want end end
  return Dd.screen[#Dd.screen].lines, "default"
end

return L

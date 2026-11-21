-- A stranger's talk: their lines for this meeting (one at a time, advanced with interact), then a choice (left or right, interact).
-- The lines are data/strangers.lua; the count of meetings is lib/meta.lua (it goes up each time a talk begins, across runs).
local Strangers = require("data.strangers")
local Meta = require("lib.meta")
local Run = require("lib.run")
local Den = require("data.den")

local T = { active = false, stage = "none" }

-- Begins the talk with `who` ("patch" or "old_sal"): counts the meeting and picks the set of lines it earns.
function T.start(who)
  local S = Strangers[who]
  Meta.met[who] = Meta.met[who] + 1
  Meta.save()
  T.who, T.def, T.n = who, S, Meta.met[who]
  T.set = math.min(T.n, #S.sets)
  T.lines = S.sets[T.set]
  T.i, T.sel, T.stage, T.active, T.last_dir = 1, 1, "lines", true, 0
  T.chosen = nil
  nova.log(string.format("talk: %s, meeting %d, lines set %d", who, T.n, T.set))
end

-- One step of the talk (not on the frame it began). `runner` gets the choice's effect through the run.
function T.update(runner)
  if not T.active then return end
  local pressed = nova.input.pressed("interact")
  if T.stage == "lines" then
    if pressed then
      T.i = T.i + 1
      if T.i > #T.lines then T.stage = "choice" end
    end
  elseif T.stage == "choice" then
    local ax = nova.input.axis("move_x")
    local dir = ax > 0.6 and 1 or (ax < -0.6 and -1 or 0)
    if dir ~= 0 and dir ~= T.last_dir then T.sel = math.max(1, math.min(#T.def.choices, T.sel + dir)) end
    T.last_dir = dir
    if pressed then
      local c = T.def.choices[T.sel]
      Run.take_from(runner)
      c.apply(Run)
      Run.give_to(runner)
      T.chosen, T.stage, T.active = c, "done", false
      -- helped three times: they move into the Den (their perk starts with the next run)
      if Meta.met[T.who] >= Den.moved_in_needed and not Meta.moved_in[T.who] then
        Meta.moved_in[T.who] = true
        Run.moved[#Run.moved + 1] = T.who
        nova.log("moves into the Den: " .. T.who)
      end
      Meta.save()
      nova.log(string.format("talk: %s: chose %s", T.who, c.label))
    end
  end
end

return T

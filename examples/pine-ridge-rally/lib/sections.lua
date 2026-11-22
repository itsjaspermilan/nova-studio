-- The sections of a rally stage and the bar along the bottom edge of the screen that shows how each went: one thin line, split into the
-- sections in proportion to their length, grey until driven, then green, yellow or red by how the section's time compares with its target.
--
-- A section's target is the time the speed profile of lib/racing.lua gives for that stretch of the road for the player's car at its best
-- (racing.section_times); the colour is the time over that target: up to GREEN is green, up to YELLOW yellow, beyond it red. Those two
-- numbers are the only place the thresholds are written down. Measured with the game's own driver (the autopilot at its best) and a
-- sloppy run: docs/pine-ridge-rally-sections.md.
--
-- It works for any course with a middle line (lib/track.lua) and notes in the shape of lib/pacenotes_hud.lua; the scene's own gates
-- (lib/stage.lua) are the section ends when the stage has them (`plan`), and otherwise they are cut at natural places.
local track = require("lib.track")
local racing = require("lib.racing")
local ui = require("lib.ui")

local sections = {}

sections.GREEN = 1.12    -- a section driven in at most this times its target is green (the computer at its best: 1.01 to 1.11; 1.135 once)
sections.YELLOW = 1.25   -- up to this, yellow; beyond it red

sections.COLOURS = { green = { 74, 222, 128 }, yellow = { 250, 204, 21 }, red = { 239, 68, 68 }, grey = { 96, 104, 116 } }

-- "green", "yellow" or "red" for a section driven in `time` seconds against its `target`, and the ratio.
function sections.grade(time, target)
  local ratio = time / math.max(0.001, target)
  return (ratio <= sections.GREEN and "green") or (ratio <= sections.YELLOW and "yellow") or "red", ratio
end

-- ---- the sections ----------------------------------------------------------------------------------------------------------

-- The sections of a stage `length` metres long as a list of { from, to } along it. `ends` are the distances the sections end at (the scene's gates; the
-- last is the finish, which may be a little before the road's end) when the stage has them: the sections are exactly those. Otherwise they are cut about every 450 metres (6 to 12 of
-- them) at the calmest place within a third of a section of each equal cut: not in a bend (`notes` say where those are), after one.
function sections.plan(length, ends, notes)
  local list = {}
  if ends and #ends > 0 then
    local from = 0
    for _, s in ipairs(ends) do
      list[#list + 1] = { from = from, to = s }
      from = s
    end
    return list
  end
  local count = math.max(6, math.min(12, math.floor(length / 450 + 0.5)))
  local cuts = { 0 }
  for k = 1, count - 1 do
    local want = length * k / count
    local window = length / count / 3
    local best, best_score = want, -1
    local s = want - window
    while s <= want + window do
      -- the room to the nearest bend (from where it starts to where it ends), less a little for being away from the equal cut
      local room = 1e9
      for _, note in ipairs(notes or {}) do
        if not note.kind then
          local d = (s < note.s) and (note.s - s) or (s > (note.e or note.s)) and (s - (note.e or note.s)) or 0
          room = math.min(room, d)
        end
      end
      local score = math.min(room, 60) - math.abs(s - want) * 0.1
      if score > best_score then best, best_score = s, score end
      s = s + 5
    end
    cuts[#cuts + 1] = best
  end
  cuts[#cuts + 1] = length
  for k = 1, count do list[k] = { from = cuts[k], to = cuts[k + 1] } end
  return list
end

-- the line's point number (with the part way to the next) at distance `s` along the road
local function point_of(s)
  local _, _, i = track.at(s)
  local p = track.point(i)
  local frac = p.seg > 0 and math.max(0, math.min(1, (s - p.s) / p.seg)) or 0
  return i + frac
end

-- The target time of each section for car `car` at its best: `opts` as lib/race.lua's profile options (`standing` for a stage), `plan`
-- from `plan`. Returns a list of seconds.
function sections.targets(plan, car, opts)
  local line = racing.line()
  local sp = racing.speeds(line, car, opts)
  local cuts = { point_of(plan[1].from) }
  for k, sec in ipairs(plan) do cuts[k + 1] = point_of(sec.to) end
  return racing.section_times(line, sp.v, cuts), sp.time
end

-- ---- the bar ---------------------------------------------------------------------------------------------------------------

sections.BAR_Y, sections.BAR_H, sections.GAP = 531, 6, 3

-- One bar into the rectangle `r` (x, y, w, h): `list` is { { from, to, colour = "green" | nil } ... } over `length` metres; `current`
-- the section being driven (or nil) and `here` how far along the stage the car is (a marker in it).
function sections.draw_into(r, list, length, current, here)
  local n = #list
  local gaps = sections.GAP * (n - 1)
  local scale = (r.w - gaps) / math.max(1, length)
  local x = r.x
  for k, sec in ipairs(list) do
    local w = math.max(2, (sec.to - sec.from) * scale)
    local colour = sec.colour and sections.COLOURS[sec.colour] or sections.COLOURS.grey
    local c = { colour[1], colour[2], colour[3], sec.colour and 255 or (k == current and 245 or 190) }
    nova.ui.rect(x, r.y - 1, w, r.h + 2, { 0, 0, 0, 150 })
    nova.ui.rect(x, r.y, w, r.h, c)
    if k == current and here then
      -- the car: a small tall mark, white, at its place in the section
      local through = math.max(0, math.min(1, (here - sec.from) / math.max(1, sec.to - sec.from)))
      local mx = x + w * through
      nova.ui.rect(mx - 2.5, r.y - 5, 5, r.h + 10, { 0, 0, 0, 170 })
      nova.ui.rect(mx - 1.5, r.y - 4, 3, r.h + 8, { 255, 255, 255, 255 })
    end
    x = x + w + sections.GAP
  end
end

-- The bar of a race, along the very bottom of a screen `w` units wide (the race keeps the sections, what was driven and where the car is).
function sections.draw(race, w)
  local list = race.bar
  if not list then return end
  local current = race.section
  if race.player.finish_time then current = nil end
  sections.draw_into({ x = 0, y = sections.BAR_Y, w = w, h = sections.BAR_H }, list, list[#list].to, current, race.player.progress)
end

-- The split just made, small above the bar in the middle of the screen for a few seconds: "SECTION 2   -0.8 vs best   +742".
function sections.draw_split(race, w)
  local split = race.split
  if not split then return end
  local age = race.clock - split.at
  local a = math.min(1, age / 0.2) * math.min(1, math.max(0, (4 - age) / 0.6))
  if a <= 0 then return end
  local F, C = ui.font, ui.color
  local c = sections.COLOURS[split.colour or "green"]
  local d = string.format("%s%.2f", split.delta <= 0 and "-" or "+", math.abs(split.delta))
  local y = 506 - (1 - math.min(1, age / 0.2)) * 8
  local o = { font = F.heavy, size = 26, color = { c[1], c[2], c[3], math.floor(255 * a) }, outline = { color = { 0, 0, 0, math.floor(180 * a) }, width = 1 }, shadow = false, align = "center" }
  local label = "SECTION " .. split.n
  local lw = nova.ui.text_width(label, { font = F.bold, size = 19 })
  local dw = nova.ui.text_width(d, { font = F.heavy, size = 26 })
  local vw = nova.ui.text_width(split.versus, { font = F.bold, size = 17 })
  local total = lw + 12 + dw + 10 + vw
  local x = w / 2 - total / 2
  nova.ui.text(x, y + 4, label, { font = F.bold, size = 19, color = { C.hud[1], C.hud[2], C.hud[3], math.floor(255 * a) }, outline = { color = { 0, 0, 0, math.floor(180 * a) }, width = 1 }, shadow = false })
  nova.ui.text(x + lw + 12, y, d, { font = F.heavy, size = 26, color = o.color, outline = o.outline, shadow = false })
  nova.ui.text(x + lw + 12 + dw + 10, y + 7, split.versus, { font = F.bold, size = 17, color = { C.hud[1], C.hud[2], C.hud[3], math.floor(255 * a) }, outline = o.outline, shadow = false })
end

return sections

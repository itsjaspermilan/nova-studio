-- The pace notes of a rally stage: what each call says (annotate), and the display at the top centre of the screen (draw).
--
-- A note is { s = metres along the stage where it starts, e = where it ends, left = true for a left, grade = 1 (hairpin) to 6 (a gentle
-- bend), peak = its sharpest bend (1 / radius) }. `annotate` adds what a co-driver would add from the road itself (the waypoints of
-- lib/track.lua and the hills): `hairpin`, `square`, `flat`, `long`, `short`, `tightens`, `opens`, `crest`, `jump`, `dip`, `caution`,
-- `dont_cut`, and notes of their own (kind = "crest", "jump", "dip", "caution") for what is not in a bend, and a last one (kind =
-- "finish"). It works for any course that has a middle line (the track's points) and notes in this shape, so a generated stage
-- gets them with no work. lib/codriver.lua turns the same notes into words.
local track = require("lib.track")
local ui = require("lib.ui")

local hud = {}

-- Where the calls change (all in one place): how long a bend is "long" and "short" (metres), the narrowest half-width of a road that
-- is not a caution, and how sharply a hill must curve over (1 / m, the change of slope along 30 m) to be a crest, a jump and a dip.
hud.LONG, hud.SHORT = 150, 30
hud.NARROW = 4.6
hud.CREST, hud.JUMP, hud.DIP = 0.0018, 0.0030, 0.0022

local function wrap(a)
  while a > math.pi do a = a - 2 * math.pi end
  while a < -math.pi do a = a + 2 * math.pi end
  return a
end

-- the points of the track from distance s0 to s1 (indexes)
local function span(s0, s1)
  local first, last
  for i = 1, track.count() do
    local p = track.point(i)
    if p.s >= s0 and not first then first = i end
    if p.s <= s1 then last = i end
  end
  first = first or track.count()
  last = math.max(first, last or first)
  return first, last
end

-- Adds to each note what it says besides its bend (see the top of this file) and the notes for crests, jumps, dips, narrow
-- places and the finish. `notes` is changed and returned, in order of distance.
function hud.annotate(notes)
  track.ensure()
  local n = track.count()
  local total = track.length
  -- the ground's height along the road (the hills are up: nova.terrain was set by the race)
  local height = {}
  for i = 1, n do
    local p = track.point(i)
    height[i] = nova.terrain_height(p.x, p.z)
  end
  for _, note in ipairs(notes) do
    if not note.e or note.e < note.s then note.e = total end
    local first, last = span(note.s, note.e)
    local angle, length = 0, note.e - note.s
    local ks = {}
    local narrow = math.huge
    for i = first, last do
      local p = track.point(i)
      angle = angle + math.abs(p.k or 0) * (p.seg or 0)
      ks[#ks + 1] = math.abs(p.k or 0)
      narrow = math.min(narrow, p.w or 6)
    end
    note.length, note.angle = length, angle
    local peak = note.peak or 0
    -- how it goes: where in the bend the sharpest part is (the first and last thirds)
    local m = #ks
    if m >= 4 and peak > 0 then
      local third = math.max(1, m // 3)
      local head, tail, at = 0, 0, 1
      for i = 1, third do head = head + ks[i] / third end
      for i = m - third + 1, m do tail = tail + ks[i] / third end
      for i = 1, m do if ks[i] > ks[at] then at = i end end
      if at > m * 0.6 and head < peak * 0.6 then note.tightens = true end
      if at < m * 0.4 and tail < peak * 0.55 then note.opens = true end
    end
    note.hairpin = note.grade == 1
    note.square = not note.hairpin and note.grade <= 3 and angle > 1.2 and angle < 1.9 and length <= 70
    note.flat = note.grade == 6 and peak < 0.011
    if length > hud.LONG and note.grade >= 2 then note.long = true end
    if length < hud.SHORT and note.grade >= 3 then note.short = true end
    -- a narrow road, or one that changes under the tyres on the way in
    local road_before = track.point(span(math.max(0, note.s - 60), note.s)).road
    local road_in = track.point(last).road
    if narrow < hud.NARROW or (road_before ~= road_in and note.s > 60) then note.caution = true end
    if note.grade <= 3 and narrow < hud.NARROW + 0.6 then note.dont_cut = true end
  end
  -- the hills: where the road curves over (a crest or a jump) or hollows (a dip), the sharpest point of each
  local step = 3
  local function slope(i, j) local a, b = track.point(i), track.point(j) return (height[j] - height[i]) / math.max(1, b.s - a.s) end
  local found = {}
  for i = 1 + step, n - step do
    local before, after = slope(i - step, i), slope(i, i + step)
    local a, b = track.point(i - step), track.point(i + step)
    local k = (after - before) / math.max(1, (b.s - a.s) / 2)
    if before > 0.005 and k < -hud.CREST or k > hud.DIP and after > before + 0.01 and before < -0.005 then
      local last = found[#found]
      local s = track.point(i).s
      if last and s - last.s < 40 and (k < 0) == (last.k < 0) then
        if math.abs(k) > math.abs(last.k) then last.s, last.k = s, k end
      else
        found[#found + 1] = { s = s, k = k }
      end
    end
  end
  for _, f in ipairs(found) do
    local kind = f.k > 0 and "dip" or (-f.k > hud.JUMP and "jump" or "crest")
    -- in a bend or just before one: part of its call; otherwise a note of its own
    local owner
    for _, note in ipairs(notes) do
      if note.grade and f.s >= note.s - 35 and f.s <= note.e + 5 then owner = note end
    end
    if owner then owner[kind] = true else notes[#notes + 1] = { s = f.s, e = f.s, kind = kind } end
  end
  notes[#notes + 1] = { s = math.max(0, total - 100), e = total, kind = "finish" }
  table.sort(notes, function(a, b) return a.s < b.s end)
  return notes
end

-- ---- what a note says, in words (the display's and the co-driver's own) ---------------------------------------------------------

local MODIFIERS = { "long", "short", "tightens", "opens", "crest", "jump", "dip", "caution", "dont_cut" }
local MODIFIER_TEXT = {
  long = "LONG", short = "SHORT", tightens = "TIGHTENS", opens = "OPENS", crest = "CREST", jump = "JUMP", dip = "DIP",
  caution = "CAUTION", dont_cut = "DON'T CUT",
}
hud.MODIFIERS = MODIFIERS

-- the modifiers a note carries, in the order they are said
function hud.modifiers(note)
  local out = {}
  for _, m in ipairs(MODIFIERS) do if note[m] then out[#out + 1] = m end end
  return out
end

-- "L4", "R2", "HAIRPIN L"... for a bend; the word for a note of its own
function hud.title(note)
  if note.kind then return string.upper(note.kind) end
  if note.hairpin then return "HAIRPIN" end
  if note.square then return (note.left and "L" or "R") .. " SQUARE" end
  return (note.left and "L" or "R") .. (note.flat and " FLAT" or note.grade)
end

function hud.modifier_line(note)
  local words = {}
  for _, m in ipairs(hud.modifiers(note)) do words[#words + 1] = MODIFIER_TEXT[m] end
  return table.concat(words, "  ·  ")
end

-- the icon of a note: the way it turns, or the picture of what it is
local function icon_of(note)
  if note.kind == "crest" or note.kind == "jump" or (not note.kind and (note.crest or note.jump) and false) then return "crest" end
  if note.kind == "dip" then return "dip" end
  if note.kind == "caution" then return "caution" end
  if note.hairpin then return note.left and "hairpin" or "hairpin_right" end
  return note.left and "left" or "right"
end

if not ui.icons.dip then
  -- (a hollow: the arc turned over)
  local pts = {}
  for i = 0, 8 do
    local t = math.pi * 0.05 + (math.pi * 0.9) * i / 8
    pts[#pts + 1] = { 12 + math.cos(t) * 11, 2 + math.sin(t) * 11 }
  end
  ui.icons.dip = { pts }
end

-- ---- the display -----------------------------------------------------------------------------------------------------------

hud.AHEAD = 450       -- metres: the notes shown are the ones within this
hud.FAR = 9           -- the next ones beside the big one: at most this many

local C, F = ui.color, ui.font
local EDGE = { 0, 0, 0, 170 }
local function text(x, y, s, font, size, colour, opts)
  local o = { font = font, size = size, color = colour, outline = { color = EDGE, width = math.max(0.75, size / 34) }, shadow = { 0, 0, 0, 90 } }
  if opts then for k, v in pairs(opts) do o[k] = v end end
  return nova.ui.text(x, y, s, o)
end
local function alpha(c, a) return { c[1], c[2], c[3], math.floor((c[4] or 255) * a) } end

-- the calls up now: the one the car is coming to (the first not yet passed) and the next two behind it
function hud.upcoming(notes, progress, max)
  local list = {}
  for k, note in ipairs(notes) do
    local away = note.s - progress
    if note.kind ~= "finish" and away > -15 and away < hud.AHEAD then
      list[#list + 1] = { k = k, note = note, away = away }
      if #list >= (max or 3) then break end
    end
  end
  return list
end

-- A note's colour: gold, red for a hairpin, a square corner or "don't cut", a cooler one for what is not a bend.
local function colour_of(note)
  if note.hairpin or note.dont_cut then return C.red or { 239, 68, 68 } end
  if note.kind then return { 120, 210, 255 } end
  return C.gold
end

-- Draws the notes at the top centre of a screen `w` units wide: the call to come big in the middle (an arrow, its number, the words that
-- go with it, the distance), the next one and the one after it smaller to its right. `race` keeps what the display remembers (which note
-- is up, since when) so that a new one slides in; `live` is false until the car is under way and after the finish.
function hud.draw(race, w, live)
  if not live then race.pn_current = nil return end
  local now = nova.time()
  local list = hud.upcoming(race.notes, race.player.progress, 3)
  local head = list[1]
  if not head then race.pn_current = nil return end
  if race.pn_current ~= head.k then race.pn_current, race.pn_since = head.k, now end
  local a = math.min(1, (now - race.pn_since) / 0.18)
  local slide = (1 - a) * -14
  local cx = w / 2
  local note = head.note
  local colour = alpha(colour_of(note), a)
  -- a soft dark band behind it, so that it reads on snow and on a bright sky
  local mods = hud.modifier_line(note)
  local title = hud.title(note)
  local size = 54
  local tw = nova.ui.text_width(title, { font = F.heavy, size = size })
  local icon = size * 1.05
  local block = icon + 12 + tw
  local top = 14 + slide
  nova.ui.rect(cx - 215, math.max(0, top - 8), 430, mods ~= "" and 118 or 92, { 6, 9, 14, math.floor(92 * a) })
  -- the arrow beside the number, the pair centred, the distance under them
  local x0 = cx - block / 2
  ui.icon(icon_of(note), x0, top + (size - icon) / 2 + size * 0.1, icon, colour, nil, { 0, 0, 0, math.floor(110 * a) })
  text(x0 + icon + 12, top, title, F.heavy, size, colour, { outline = false })
  local dist = math.max(0, math.floor(head.away / 10 + 0.5) * 10)
  text(cx, top + size + 4, dist .. " m", F.bold, 26, alpha(C.white, a), { align = "center" })
  if mods ~= "" then text(cx, top + size + 34, mods, F.bold, 21, alpha(colour, a), { align = "center", spacing = 0.08 }) end
  -- the next two, to the right of it, smaller and dimmer: a few words each
  local x = cx + 250
  for i = 2, #list do
    local next_note = list[i].note
    local size2 = i == 2 and 34 or 26
    local dim = i == 2 and 0.9 or 0.65
    local c2 = alpha(colour_of(next_note), dim * a)
    local title2 = hud.title(next_note)
    local w2 = nova.ui.text_width(title2, { font = F.heavy, size = size2 })
    local icon2 = size2 * 1.05
    local y2 = 18 + (i - 2) * 46 + slide
    ui.icon(icon_of(next_note), x, y2 + (size2 - icon2) / 2 + size2 * 0.1, icon2, c2, nil, { 0, 0, 0, math.floor(90 * a) })
    text(x + icon2 + 8, y2, title2, F.heavy, size2, c2, { outline = false })
    text(x + icon2 + 8 + w2 + 10, y2 + size2 * 0.28, math.max(0, math.floor(list[i].away / 10 + 0.5) * 10) .. " m", F.bold, 17, alpha(C.hud, dim * a))
  end
end

return hud

-- After the race: the finishing order with times, any new records, and what to do next.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local menu_bg = require("lib.menu_bg")
local transition = require("lib.transition")
local sections = require("lib.sections")

local Results = nova.scene {}

-- (2026-11-08: just two, as asked: the same race again, or back to the main menu)
local CHOICES = { "Restart", "Return" }

function Results:enter()
  menu_bg.setup()
  self.t = 0
  nova.ui.forget("results") -- (every results screen opens on "Race again")
  self.r = state.result
  assert(self.r, "the results scene needs a finished race (state.result)")
  audio.music("results", { volume = 0.95, fade = 0.5 })
  transition.reveal(0.35) -- (coming out of the finish wipe)
  local place = self.r.place
  self.reveal = 0
  self:after(0.5, function() audio.sfx(place == 1 and "finish" or "lap") end)
end


function Results:update(dt)
  self.t = self.t + dt
  transition.update(dt)
  if transition.busy() then return end
  self.reveal = math.min(1, self.reveal + dt * 1.6)
end

function Results:leave() menu_bg.leave() end



-- The screen, as the mockup has it: an orange panel down the left with the place, your time and the choices, and on the right the table
-- (the finishing order, a trial's laps or a stage's sections) with three facts under it. It is one nova.ui.menu tree: the engine places
-- every row, and fits every name and time to its cell.
local C, F = ui.color, ui.font
local RIGHT_W = 489

local function add(list, items) for _, it in ipairs(items) do list[#list + 1] = it end return list end

-- (each row slides in from the right a little after the one above; every row arrives, however many there are)
local function slide(self, i) return (1 - math.min(1, math.max(0, self.t * 3.5 - 0.4 - (i - 1) * 0.25))) * 60 end

-- a row of the table: { number, name, extra, value } cells; `you` is the light row
local function table_row(self, i, h, cells, you)
  local ink = you and C.ink or C.white
  local row = { "row", h = h, pad = { 15, 0 }, gap = 9, dx = slide(self, i), panel = { color = you and C.white or C.panel } }
  for _, c in ipairs(cells) do
    local cellnode = { "text", c.text, font = c.font or (you and F.heavy or F.bold), size = (c.size or 22.5) + (you and 2 or 0),
                       color = c.color or ink, w = c.w, grow = (not c.w) and 1 or nil, align = c.align, spacing = c.spacing }
    row[#row + 1] = cellnode
  end
  return row
end

-- a fact under the table: a coloured line along its top, a quiet label, the value big
local function card(label, value, colour)
  return { "panel", grow = 1, pad = { 13.5, 9 }, gap = 0,
    { "box", h = 4.5, draw = function(r) nova.ui.rect(r.x - 13.5, r.y - 9, r.w + 27, 4.5, colour) end },
    { "text", label, font = F.body, size = 16.5, color = C.dim },
    { "text", value, font = F.heavy, size = 33 } }
end

local function gap_text(d)
  if not d then return nil end
  if d <= 0.005 then return "Fastest" end
  return string.format("+%.2f to leader", d)
end

-- what the left panel says, and the table and facts on the right, for each kind of result
function Results:content()
  local r = self.r
  local left, rows, cards, label = {}, {}, {}, "STANDINGS"
  if r.rally then
    local rally = r.rally
    left = { kicker = "STAGE COMPLETE", big = tostring(rally.stars), small = rally.stars == 1 and " star" or " stars",
             time = ui.time(rally.time), badge = (r.record_score and "New best score") or (r.record_time and "New best time") or (rally.score .. " points") }
    label = "SECTIONS"
    local n = #rally.sections
    local h = math.min(40, math.floor(270 / math.max(1, n)) - 3)
    rows[#rows + 1] = { "row", h = 24, pad = { 15, 0 }, gap = 9,
      { "text", "#", style = "label", size = 15, w = 30 }, { "text", "TIME", style = "label", size = 15, grow = 1 },
      { "text", "TARGET", style = "label", size = 15, w = 110 }, { "text", "POINTS", style = "label", size = 15, w = 80, align = "right" } }
    for i, sec in ipairs(rally.sections) do
      -- (its colour on the bar: green, yellow or red against the target, lib/sections.lua; the time to beat is that target)
      local shade = sec.colour and sections.COLOURS[sec.colour] or nil
      rows[#rows + 1] = table_row(self, i, h, {
        { text = tostring(i), font = F.heavy, w = 30, color = shade },
        { text = ui.time(sec.time), font = F.semi, size = 19.5, color = shade },
        { text = ui.time(sec.target or sec.par), font = F.medium, size = 18, color = C.dim, w = 110 },
        { text = tostring(sec.score), font = F.heavy, color = C.gold, w = 80, align = "right" } })
    end
    -- the finished bar of the stage (the one along the bottom of the screen in the race): every section in the colour it was driven in
    if rally.bar then
      rows[#rows + 1] = { "space", h = 4 }
      rows[#rows + 1] = { "box", h = 14, draw = function(r) sections.draw_into({ x = r.x, y = r.y + 4, w = r.w, h = 6 }, rally.bar, rally.length) end }
    end
    cards = { card("Score", rally.score .. " / " .. rally.max, C.orange), card("Stars", rally.stars .. " of 3", C.gold),
              card("Best time", ui.time(state.best("rally", r.track)), C.green) }
  elseif r.trial then
    left = { kicker = "TIME TRIAL", big = tostring(#r.rows), small = #r.rows == 1 and " lap" or " laps", time = ui.time(r.best_lap),
             time_label = "BEST LAP", badge = r.record_lap and "New lap record" or nil }
    label = "LAPS"
    for i, row in ipairs(r.rows) do
      rows[#rows + 1] = table_row(self, i, row.you and 45 or 39, {
        { text = tostring(i), font = F.heavy, w = 36 }, { text = string.upper(row.name) },
        { text = row.time and ui.time(row.time) or "-", font = row.you and F.semi or F.medium, size = 18, w = 110, align = "right" } }, row.you)
    end
    cards = { card("Best lap", ui.time(r.best_lap), C.gold), card("Laps", tostring(#r.rows), C.orange),
              card("Lap record", ui.time(state.best("lap", r.track)), C.green) }
  else
    local first = r.rows[1] and r.rows[1].time
    left = { kicker = "RACE COMPLETE", big = tostring(r.place), small = ui.ordinal(r.place):gsub("^%d+", ""),
             time = r.time and ui.time(r.time) or "-:--.--", badge = gap_text(r.time and first and (r.time - first)) }
    for i, row in ipairs(r.rows) do
      local time = row.time and ui.time(row.time) or "did not finish"
      local cells = { { text = tostring(i), font = F.heavy, w = 36 }, { text = string.upper(row.name) } }
      if row.estimated then cells[#cells + 1] = { text = "ESTIMATED", font = F.bold, size = 13.5, color = C.dim, w = 72, spacing = 0.12 } end
      cells[#cells + 1] = { text = time, font = row.you and F.semi or F.medium, size = 18, w = 110, align = "right",
                            color = (row.estimated or not row.time) and (row.you and C.ink or C.dim) or nil }
      rows[#rows + 1] = table_row(self, i, row.you and 49.5 or 43.5, cells, row.you)
    end
    cards = { card("Best lap", ui.time(r.best_lap), r.record_lap and C.green or C.gold),
              card("Best " .. r.laps .. (r.laps == 1 and " lap" or " laps"), ui.time(state.best("race" .. r.laps, r.track)), r.record_time and C.green or C.orange),
              card("Laps", tostring(r.laps), C.orange) }
    if r.record_time then cards[2][#cards[2]].text = "New!" end
  end
  local g = r.generated
  if g then
    -- a made-up course: the medal won, and the three times it was against (lib/targets.lua)
    local targets = require("lib.targets")
    if r.rally then
      -- (a made-up stage is won by its medal: that is the big word, and the stage's points go in the badge)
      left.big, left.small, left.big_size = string.upper(targets.NAMES[g.medal]), "", g.medal > 0 and 80 or 56
      left.badge = r.rally.score .. " points"
    else
      left.badge = string.upper(targets.NAMES[g.medal]) .. ((g.medal > 0) and " MEDAL" or "")
    end
    if g.daily and g.best then left.badge = left.badge .. "  ·  BEST TODAY" end
    cards = {}
    for i, medal in ipairs({ "gold", "silver", "bronze" }) do
      local won = g.medal == 4 - i
      cards[i] = card((won and "Won: " or "") .. targets.NAMES[4 - i], ui.time(g.targets[medal]), targets.COLORS[4 - i])
    end
  end
  return left, rows, cards, label
end

function Results:draw_ui()
  if not transition.busy() then self:draw_screens() end
  transition.draw()
end

function Results:draw_screens()
  local r = self.r
  local left, rows, cards, label = self:content()
  menu_bg.flags(self.t)
  ui.side_panel(390, 1, C.orange)
  local choices = CHOICES
  local col = { "column", anchor = "topleft", x = 6, w = 285, gap = 0,
    { "text", left.kicker, font = F.bold, size = 18, spacing = 0.2, color = C.ink },
    { "row", h = 104, align = "end", gap = 0,
      { "text", left.big, font = F.title, size = left.big_size or 112, color = C.ink, h = 104 },
      { "text", left.small, font = F.title, size = 48, color = C.ink, h = 60, align_self = "start", grow = 1 } },
    { "text", string.upper(r.track_name), font = F.heavy, size = 30, color = C.ink },
    { "space", h = 14 },
    { "text", left.time_label or "YOUR TIME", font = F.semi, size = 16.5, spacing = 0.1, color = C.ink },
    { "text", left.time, font = F.heavy, size = 66, color = C.ink, h = 62 } }
  if left.badge then
    col[#col + 1] = { "row", { "text", left.badge, font = F.heavy, size = 28.5, color = C.green, panel = { color = C.ink }, pad = { 13.5, 3 } }, { "space", grow = 1 } }
  end
  -- the coins this race paid, and a track it opened
  if r.coins then
    col[#col + 1] = { "space", h = 8 }
    col[#col + 1] = { "text", "+" .. state.money(r.coins) .. " COINS", font = F.heavy, size = 27, color = C.ink }
  end
  if r.opened then col[#col + 1] = { "text", "Opened: " .. r.opened.name, font = F.semi, size = 16.5, color = C.ink } end
  col[#col + 1] = { "space", grow = 1 }
  for i, c in ipairs(choices) do col[#col + 1] = { "button", string.upper(c), id = i, look = "dark", h = 36 } end
  local right = { "column", anchor = "topright", w = RIGHT_W, gap = 4.5,
    { "text", label, style = "label", h = 26 } }
  add(right, rows)
  add(right, { { "space", h = 15 }, { "row", gap = 7.5, cards[1], cards[2], cards[3] } })
  col.h = 444
  local m = nova.ui.menu {
    id = "results", kind = "stack", w = "100%", h = 444, margin = 33, enter = false, active = self.t >= 0.7,
    col, right,
  }
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Select" } })
  self:choose(m)
end

-- what the choices do
function Results:choose(m)
  if not m.pressed then return end
  audio.sfx("menu_accept")
  audio.stop_music(0.4)
  local choice = tonumber(m.pressed)
  local info = state.current_track()
  if choice == 1 then transition.cover(transition.race_spec(), function() nova.goto_scene(info.scene or info.id) end)
  elseif info.generated then nova.goto_scene("title", info.daily and "daily" or "custom") -- (back to the made-up course's own page)
  else nova.goto_scene("title", "menu") end
end

return Results

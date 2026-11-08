-- After the race: the finishing order with times, any new records, and what to do next.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local backdrop = require("lib.backdrop")
local transition = require("lib.transition")

local Results = nova.scene {}

local CHOICES = { "Race again", "Change circuit", "Main menu" }
local RALLY_CHOICES = { "Run the stage again", "Change stage", "Main menu" }

function Results:enter()
  backdrop.light()
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

function Results:draw()
  backdrop.draw(self.t, "results")
end

-- The screen is two columns, so that nothing can run into anything else however many rows there are: the table on the left (the finishing
-- order, a trial's laps or a stage's sections), and on the right a summary (your time, best lap or score and stars, any new records) with
-- the choices under it. It is one nova.ui.menu tree: the engine places every row from the panel it sits in, and every name and time
-- is fitted to its own cell.
local TABLE_W, SIDE_W, BETWEEN = 560, 304, 24
local TABLE_H = 476 - 108

local function add(list, items) for _, it in ipairs(items) do list[#list + 1] = it end return list end

-- (each row slides in from the right a little after the one above; every row arrives, however many there are)
local function slide(self, i) return (1 - math.min(1, math.max(0, self.t * 3.5 - 0.4 - (i - 1) * 0.25))) * 60 end

-- a medal from the sheet, as a picture in a row
local function medal(frame, scale, colour)
  return { "box", w = 16 * scale, h = 16 * scale, draw = function(r)
    nova.ui.sprite("medal", r.x + r.w / 2, r.y + r.h / 2, { frame = frame, scale = scale, color = colour })
  end }
end

-- the summary on the right: { label, value, colour } lines, then any new records (green) under them, then the choices
local function side(self, lines, records, top, choices)
  local summary = { "panel", pad = { 18, 12 }, gap = 4 }
  if top then summary[#summary + 1] = top end
  for _, l in ipairs(lines) do
    summary[#summary + 1] = { "row", h = 36, { "text", l[1], style = "label", w = 110 }, { "text", l[2], size = 26, font = "mono", color = l[3] or ui.color.white, align = "right", grow = 1 } }
  end
  for _, rec in ipairs(records) do summary[#summary + 1] = { "text", rec, size = 16, color = ui.color.green } end
  local col = { "column", w = SIDE_W, gap = 6, summary, { "space", h = 16 } }
  for i, label in ipairs(choices) do col[#col + 1] = { "button", label, id = i, w = SIDE_W - 14 } end
  return col
end

local function heading(text, sub, colour)
  return { "column", gap = 2, { "text", text, style = "heading", color = colour }, { "text", sub, style = "sub" } }
end

-- what the choices do
function Results:choose(r)
  if not r.pressed then return end
  audio.sfx("menu_accept")
  audio.stop_music(0.4)
  local choice = tonumber(r.pressed)
  if choice == 1 then transition.cover(transition.race_spec(), function() nova.goto_scene(state.current_track().id) end)
  elseif choice == 2 then nova.goto_scene("title", "select")
  else nova.goto_scene("title", "menu") end
end

-- the rally's results: each section's time against its par and the points it earned, the total and the stars
function Results:rally_tree()
  local r = self.r
  local rally = r.rally
  -- the sections, as many as there are: the rows close up to fit the panel
  local rows = #rally.sections
  local rh = math.min(34, math.floor((TABLE_H - 46) / math.max(1, rows)))
  local size = rh >= 30 and 20 or 17
  local tbl = { "panel", w = TABLE_W, pad = { 16, 8 }, gap = 0,
    { "row", h = 32, pad = { 8, 0 }, { "text", "SECTION", style = "label", w = 106 }, { "text", "TIME", style = "label", w = 170 },
      { "text", "TO BEAT", style = "label", grow = 1 }, { "text", "POINTS", style = "label", align = "right", w = 90 } } }
  for i, sec in ipairs(rally.sections) do
    local good = sec.time <= sec.par * 1.1
    tbl[#tbl + 1] = { "row", h = rh, pad = { 8, 0 }, dx = slide(self, i),
      panel = i % 2 == 0 and { sprite = false, color = { 255, 255, 255, 14 }, border = false } or nil,
      { "text", tostring(i), size = size, font = "mono", w = 106 },
      { "text", ui.time(sec.time), size = size, font = "mono", color = good and ui.color.green or ui.color.white, w = 170 },
      { "text", ui.time(sec.par), size = size, font = "mono", color = ui.color.dim, grow = 1 },
      { "text", tostring(sec.score), size = size, font = "mono", color = ui.color.gold, align = "right", w = 90 } }
  end
  local records = {}
  if r.record_score then records[#records + 1] = "New best score" end
  if r.record_time then records[#records + 1] = "New best time" end
  local stars = { "row", h = 50, justify = "center", gap = 16 }
  for k = 1, 3 do stars[#stars + 1] = medal(0, 2.2, k <= rally.stars and { 255, 255, 255, 255 } or { 90, 90, 100, 150 }) end
  return heading(rally.stars == 3 and "STAGE WON!" or "STAGE COMPLETE", r.track_name, ui.color.gold), tbl,
    side(self, { { "SCORE", rally.score .. " / " .. rally.max, ui.color.gold }, { "TIME", ui.time(rally.time) } }, records, stars, RALLY_CHOICES)
end

-- a race or a time trial: the finishing order (a trial: its laps, the fastest picked out)
function Results:race_tree()
  local r = self.r
  local headline = r.trial and "TIME TRIAL" or (r.place == 1 and "YOU WIN!") or (r.place == 2 and "SECOND PLACE") or (r.place == 3 and "THIRD PLACE") or "FINISHED"
  local rh = math.min(46, math.floor((TABLE_H - 16) / math.max(1, #r.rows)))
  local tbl = { "panel", w = TABLE_W, pad = { 6, 8 }, gap = 0 }
  for i, row in ipairs(r.rows) do
    local color = row.you and ui.color.gold or ui.color.white
    local line = { "row", h = rh, pad = { 18, 0, 14, 0 }, gap = 10, dx = slide(self, i),
      panel = row.you and { sprite = false, color = { 245, 158, 11, 60 }, border = false } or nil }
    if not r.trial then
      add(line, { i <= 3 and medal(i - 1, 2) or { "space", w = 32 }, { "text", ui.ordinal(i), size = 24, color = color, w = 60 } })
    end
    local time = row.time and ui.time(row.time) or "did not finish"
    add(line, { { "text", row.name, size = 24, color = color, grow = 1 } })
    if row.estimated then add(line, { { "text", "ESTIMATED", style = "label", w = 70 } }) end
    add(line, { { "text", time, size = 24, font = "mono", align = "right", w = 140,
                  color = row.estimated and ui.color.dim or (row.time and color or ui.color.dim) } })
    tbl[#tbl + 1] = line
  end
  -- your time and best lap on the right, with any new records
  local lines = {}
  if not r.trial then lines[#lines + 1] = { "YOUR TIME", r.time and ui.time(r.time) or "-:--.--", ui.color.gold } end
  lines[#lines + 1] = { "BEST LAP", ui.time(r.best_lap), r.record_lap and ui.color.green or ui.color.white }
  if r.trial then lines[#lines + 1] = { "LAPS", tostring(#r.rows) } end
  local records = {}
  if r.record_lap then records[#records + 1] = "New lap record" end
  if r.record_time then records[#records + 1] = "New race record" end
  return heading(headline, r.track_name .. "  ·  " .. r.laps .. (r.laps == 1 and " lap" or " laps"), r.place == 1 and not r.trial and ui.color.gold or ui.color.white),
    tbl, side(self, lines, records, nil, CHOICES)
end

function Results:draw_ui()
  if not transition.busy() then self:draw_screens() end
  transition.draw()
end

function Results:draw_screens()
  local head, tbl, right
  if self.r.rally then head, tbl, right = self:rally_tree() else head, tbl, right = self:race_tree() end
  local m = nova.ui.menu {
    id = "results", anchor = "top", margin = 12, w = TABLE_W + BETWEEN + SIDE_W, gap = 14, enter = false,
    active = self.t >= 0.7,
    head,
    { "row", gap = BETWEEN, align = "start", tbl, right },
  }
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Accept" } })
  self:choose(m)
end

return Results

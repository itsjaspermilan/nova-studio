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
  self.choice = 1
  self.r = state.result
  assert(self.r, "the results scene needs a finished race (state.result)")
  audio.music("results", { volume = 0.95, fade = 0.5 })
  transition.reveal(0.35) -- (coming out of the finish wipe)
  local place = self.r.place
  self.reveal = 0
  self:after(0.5, function() audio.sfx(place == 1 and "finish" or "lap") end)
end

function Results:leave() backdrop.leave() end

function Results:update(dt)
  self.t = self.t + dt
  transition.update(dt)
  if transition.busy() then return end
  self.reveal = math.min(1, self.reveal + dt * 1.6)
  if self.t < 0.7 then return end
  local choice, action = ui.navigate(self.choice, #CHOICES)
  choice = math.min(choice, #CHOICES)
  self.choice = choice
  if action == "accept" then
    audio.sfx("menu_accept")
    audio.stop_music(0.4)
    if choice == 1 then transition.cover(transition.race_spec(), function() nova.goto_scene(state.current_track().id) end)
    elseif choice == 2 then nova.goto_scene("title", "select")
    else nova.goto_scene("title", "menu") end
  end
end

function Results:draw()
  backdrop.draw(self.t, "results")
end
-- The screen is two columns, so that nothing can run into anything else however many rows there are: the table on the left (the finishing
-- order, a trial's laps or a stage's sections), and on the right a summary (your time, best lap or score and stars, any new records) with
-- the choices under it. Every row is placed from the panel it sits in.
local TABLE_X, TABLE_W = 36, 560
local SIDE_X, SIDE_W = 620, 304
local TOP, BOTTOM = 108, 476

-- (each row slides in from the right a little after the one above; every row arrives, however many there are)
local function slide(self, i) return (1 - math.min(1, math.max(0, self.t * 3.5 - 0.4 - (i - 1) * 0.25))) * 60 end

-- a small label set right-aligned at `rx`
local function label_right(text, rx, y)
  local o = { size = 13, font = "future_narrow" }
  ui.label(rx - nova.ui.text_width(text, o), y, text)
end

-- the heading and the line under it
local function heading(text, sub, colour)
  local w = nova.view()
  ui.center(text, 12, ui.fit(text, 42, w - 80, "bold"), colour, { font = "bold" })
  ui.center(sub, 76, ui.fit(sub, 18, w - 80, "rounded"), ui.color.white)
end

-- the summary on the right: { label, value, colour } lines, then any new records (green) under them; `top` is room kept at the top (stars)
-- (it returns where it ends: the choices go under it)
local function summary(lines, records, top)
  local h = top + #lines * 40 + #records * 24 + 18
  ui.panel(SIDE_X, TOP, SIDE_W, h, 205)
  local y = TOP + top + 12
  for _, l in ipairs(lines) do
    ui.label(SIDE_X + 18, y + 10, l[1])
    ui.right(l[2], SIDE_X + SIDE_W - 18, y, 26, l[3] or ui.color.white, { font = "mono" })
    y = y + 40
  end
  for _, r in ipairs(records) do
    ui.text(SIDE_X + 18, y, r, 16, ui.color.green)
    y = y + 24
  end
  return TOP + h
end

local function choices(self, items, top)
  ui.menu(items, self.choice, math.max(top + 22, 300), { width = SIDE_W - 14, cx = SIDE_X + SIDE_W / 2 - 7, row = 44, id = "results" })
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Accept" } })
end

-- the rally's results: each section's time against its par and the points it earned, the total and the stars
function Results:draw_rally(w)
  local r = self.r
  local rally = r.rally
  heading(rally.stars == 3 and "STAGE WON!" or "STAGE COMPLETE", r.track_name, ui.color.gold)
  -- the sections, as many as there are: the rows close up to fit the panel
  local rows = #rally.sections
  local rh = math.min(34, math.floor((BOTTOM - TOP - 46) / math.max(1, rows)))
  local x, y, width = TABLE_X, TOP, TABLE_W
  ui.panel(x, y, width, 40 + rows * rh + 6, 205)
  local c_time, c_par = x + 130, x + 300
  ui.label(x + 24, y + 14, "SECTION")
  ui.label(c_time, y + 14, "TIME")
  ui.label(c_par, y + 14, "TO BEAT")
  label_right("POINTS", x + width - 24, y + 14)
  local size = rh >= 30 and 20 or 17
  for i, sec in ipairs(rally.sections) do
    local ry = y + 40 + (i - 1) * rh
    local ty = ry + math.floor((rh - size) / 2) - 2
    local s = slide(self, i)
    local good = sec.time <= sec.par * 1.1
    if i % 2 == 0 then nova.ui.rect(x + 8, ry, width - 16, rh, { 255, 255, 255, 14 }) end
    ui.text(x + 28 + s, ty, tostring(i), size, ui.color.white, { font = "mono" })
    ui.text(c_time + s, ty, ui.time(sec.time), size, good and ui.color.green or ui.color.white, { font = "mono" })
    ui.text(c_par + s, ty, ui.time(sec.par), size, ui.color.dim, { font = "mono" })
    ui.right(tostring(sec.score), x + width - 24 + s, ty, size, ui.color.gold, { font = "mono" })
  end
  -- the stars, the score and the time on the right
  local records = {}
  if r.record_score then records[#records + 1] = "New best score" end
  if r.record_time then records[#records + 1] = "New best time" end
  local bottom = summary({ { "SCORE", rally.score .. " / " .. rally.max, ui.color.gold }, { "TIME", ui.time(rally.time) } }, records, 50)
  for k = 1, 3 do
    nova.ui.sprite("medal", SIDE_X + SIDE_W / 2 + (k - 2) * 52, TOP + 34, { frame = 0, scale = 2.2, color = k <= rally.stars and { 255, 255, 255, 255 } or { 90, 90, 100, 150 } })
  end
  choices(self, RALLY_CHOICES, bottom)
end

function Results:draw_ui()
  if not transition.busy() then self:draw_screens() end
  transition.draw()
end

function Results:draw_screens()
  local w = nova.view()
  local r = self.r
  if r.rally then return self:draw_rally(w) end
  local headline = r.trial and "TIME TRIAL" or (r.place == 1 and "YOU WIN!") or (r.place == 2 and "SECOND PLACE") or (r.place == 3 and "THIRD PLACE") or "FINISHED"
  heading(headline, r.track_name .. "  ·  " .. r.laps .. (r.laps == 1 and " lap" or " laps"), r.place == 1 and not r.trial and ui.color.gold or ui.color.white)

  -- the finishing order (a trial: its laps, the fastest picked out)
  local x, y, width = TABLE_X, TOP, TABLE_W
  local rh = math.min(46, math.floor((BOTTOM - TOP - 16) / math.max(1, #r.rows)))
  ui.panel(x, y, width, 12 + #r.rows * rh + 4, 200)
  for i, row in ipairs(r.rows) do
    local ry = y + 8 + (i - 1) * rh
    local ty = ry + math.floor((rh - 24) / 2) - 2
    local s = slide(self, i)
    local color = row.you and ui.color.gold or ui.color.white
    if row.you then nova.ui.rect(x + 6, ry, width - 12, rh - 4, { 245, 158, 11, 60 }) end
    local name_x = x + 24
    if not r.trial then
      if i <= 3 then nova.ui.sprite("medal", x + 36 + s, ry + rh / 2 - 2, { frame = i - 1, scale = 2 }) end
      ui.text(x + 66 + s, ty, ui.ordinal(i), 24, color)
      name_x = x + 136
    end
    ui.text(name_x + s, ty, row.name, 24, color)
    local time = row.time and ui.time(row.time) or "did not finish"
    local o = { size = 24, font = "mono" }
    local rx = x + width - 20 + s
    ui.right(time, rx, ty, 24, row.estimated and ui.color.dim or (row.time and color or ui.color.dim), { font = "mono" })
    if row.estimated then label_right("ESTIMATED", rx - nova.ui.text_width(time, o) - 12, ty + 8) end
  end

  -- your time and best lap on the right, with any new records
  local me
  for _, row in ipairs(r.rows) do if row.you then me = row end end
  local lines = {}
  if not r.trial then lines[#lines + 1] = { "YOUR TIME", r.time and ui.time(r.time) or "-:--.--", ui.color.gold } end
  lines[#lines + 1] = { "BEST LAP", ui.time(r.best_lap), r.record_lap and ui.color.green or ui.color.white }
  if r.trial then lines[#lines + 1] = { "LAPS", tostring(#r.rows) } end
  local records = {}
  if r.record_lap then records[#records + 1] = "New lap record" end
  if r.record_time then records[#records + 1] = "New race record" end
  choices(self, CHOICES, summary(lines, records, 0))
end

return Results

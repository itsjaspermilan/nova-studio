-- After the race: the finishing order with times, any new records, and what to do next.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local backdrop = require("lib.backdrop")

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
  local place = self.r.place
  self.reveal = 0
  self:after(0.5, function() audio.sfx(place == 1 and "finish" or "lap") end)
end

function Results:leave() backdrop.leave() end

function Results:update(dt)
  self.t = self.t + dt
  self.reveal = math.min(1, self.reveal + dt * 1.6)
  if self.t < 0.7 then return end
  local choice, action = ui.navigate(self.choice, #CHOICES)
  choice = math.min(choice, #CHOICES)
  self.choice = choice
  if action == "accept" then
    audio.sfx("menu_accept")
    audio.stop_music(0.4)
    if choice == 1 then nova.goto_scene(state.current_track().id)
    elseif choice == 2 then nova.goto_scene("title", "select")
    else nova.goto_scene("title", "menu") end
  end
end

function Results:draw()
  backdrop.draw(self.t, "results")
end

-- the rally's results: each section's time against its par and the points it earned, the total and the stars
function Results:draw_rally(w)
  local r = self.r
  local rally = r.rally
  local headline = rally.stars == 3 and "STAGE WON!" or "STAGE COMPLETE"
  ui.center(headline, 18, ui.fit(headline, 44, 520, "bold"), ui.color.gold, { font = "bold" })
  ui.center(r.track_name, 74, 18, ui.color.white)
  for k = 1, 3 do
    nova.ui.sprite("medal", w / 2 + (k - 2) * 44, 116, { frame = 0, scale = 2.2, color = k <= rally.stars and { 255, 255, 255, 255 } or { 90, 90, 100, 150 } })
  end
  local x, y, width = w / 2 - 270, 134, 540
  local rows = #rally.sections
  ui.panel(x, y, width, 36 + rows * 34 + 76, 205)
  ui.label(x + 24, y + 12, "SECTION")
  ui.label(x + 190, y + 12, "TIME")
  ui.label(x + 310, y + 12, "TO BEAT")
  ui.label(x + width - 90, y + 12, "POINTS")
  for i, sec in ipairs(rally.sections) do
    local ry = y + 34 + (i - 1) * 34
    local slide = (1 - math.min(1, math.max(0, self.reveal * 2.2 - (i - 1) * 0.3))) * 80
    local good = sec.time <= sec.par * 1.1
    ui.text(x + 28 + slide, ry, tostring(i), 22, ui.color.white)
    ui.text(x + 190 + slide, ry + 2, ui.time(sec.time), 20, good and ui.color.green or ui.color.white, { font = "mono" })
    ui.text(x + 310 + slide, ry + 2, ui.time(sec.par), 20, ui.color.dim, { font = "mono" })
    ui.right(tostring(sec.score), x + width - 22 + slide, ry, 22, ui.color.gold, { font = "mono" })
  end
  local ty = y + 34 + rows * 34 + 4
  nova.ui.rect(x + 16, ty - 2, width - 32, 1, { 255, 255, 255, 60 })
  ui.text(x + 28, ty + 6, "TOTAL", 22, ui.color.white)
  ui.text(x + 190, ty + 8, ui.time(rally.time), 20, ui.color.white, { font = "mono" })
  ui.right(rally.score .. " / " .. rally.max, x + width - 22, ty + 6, 22, ui.color.gold, { font = "mono" })
  local by = ty + 40
  if r.record_score then ui.text(x + 28, by, "NEW BEST SCORE", 16, ui.color.green) end
  if r.record_time then ui.text(x + 290, by, "NEW BEST TIME", 16, ui.color.green) end
  ui.menu(RALLY_CHOICES, self.choice, 428, { width = 300, row = 34 })
end

function Results:draw_ui()
  local w = nova.view()
  local r = self.r
  if r.rally then return self:draw_rally(w) end
  local headline = r.trial and "TIME TRIAL" or (r.place == 1 and "YOU WIN!") or (r.place == 2 and "SECOND PLACE") or (r.place == 3 and "THIRD PLACE") or "FINISHED"
  ui.center(headline, 22, 46, r.place == 1 and ui.color.gold or ui.color.white, { font = "bold" })
  ui.center(r.track_name .. "  ·  " .. r.laps .. (r.laps == 1 and " lap" or " laps"), 92, 20, ui.color.white)

  local x, y, width = w / 2 - 270, 124, 540
  ui.panel(x, y, width, 4 + #r.rows * 46 + 8, 200)
  for i, row in ipairs(r.rows) do
    local ry = y + 8 + (i - 1) * 46
    local slide = (1 - math.min(1, math.max(0, self.reveal * 2.2 - (i - 1) * 0.35))) * 80
    local color = row.you and ui.color.gold or ui.color.white
    if row.you then nova.ui.rect(x + 4, ry - 2 + 0, width - 8, 42, { 245, 158, 11, 60 }) end
    if i <= 3 and not r.trial then nova.ui.sprite("medal", x + 40 + slide, ry + 20, { frame = i - 1, scale = 2 }) end
    if not r.trial then ui.text(x + 76 + slide, ry + 6, ui.ordinal(i), 24, color) end
    ui.text(x + 150 + slide, ry + 6, row.name, 24, color)
    local time = row.time and ui.time(row.time) or "did not finish"
    ui.right(time, x + width - 18 + slide, ry + 6, 24, row.estimated and ui.color.dim or (row.time and color or ui.color.dim), { font = "mono" })
    if row.estimated then ui.label(x + width - 232 + slide, ry + 14, "ESTIMATED") end
  end

  local by = y + 4 + #r.rows * 46 + 24
  if r.best_lap or r.record_time then ui.panel(x, by - 10, width, r.record_time and 66 or 40, 200) end
  if r.best_lap then ui.text(x + 18, by, "Best lap  " .. ui.time(r.best_lap), 20, r.record_lap and ui.color.green or ui.color.dim) end
  if r.record_lap then ui.text(x + 280, by, "NEW LAP RECORD", 20, ui.color.green) end
  if r.record_time then ui.text(x + 280, by + 26, "NEW RACE RECORD", 20, ui.color.green) end

  ui.menu(CHOICES, self.choice, 408, { width = 300, row = 38 })
end

return Results

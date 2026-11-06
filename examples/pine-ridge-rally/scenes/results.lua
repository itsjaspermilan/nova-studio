-- After the race: the finishing order with times, any new records, and what to do next.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local backdrop = require("lib.backdrop")

local Results = nova.scene {}

local CHOICES = { "Race again", "Change circuit", "Main menu" }

function Results:enter()
  backdrop.light()
  self.t = 0
  self.choice = 1
  self.r = state.result
  assert(self.r, "the results scene needs a finished race (state.result)")
  audio.music("results", { volume = 0.55, fade = 0.5 })
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

function Results:draw_ui()
  local w = nova.view()
  local r = self.r
  local headline = r.trial and "TIME TRIAL" or (r.place == 1 and "YOU WIN!") or (r.place == 2 and "SECOND PLACE") or (r.place == 3 and "THIRD PLACE") or "FINISHED"
  ui.center(headline, 22, 46, r.place == 1 and ui.color.gold or ui.color.white, { font = "bold" })
  ui.center(r.track_name .. "  ·  " .. r.laps .. (r.laps == 1 and " lap" or " laps"), 84, 20, ui.color.white)

  local x, y, width = w / 2 - 270, 118, 540
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
    ui.right(time, x + width - 18 + slide, ry + 6, 24, row.time and color or ui.color.dim)
  end

  local by = y + 4 + #r.rows * 46 + 22
  if r.best_lap then ui.text(x + 8, by, "Best lap  " .. ui.time(r.best_lap), 20, r.record_lap and ui.color.green or ui.color.dim) end
  if r.record_lap then ui.text(x + 250, by, "NEW LAP RECORD", 20, ui.color.green) end
  if r.record_time then ui.text(x + 250, by + 26, "NEW RACE RECORD", 20, ui.color.green) end

  ui.menu(CHOICES, self.choice, 410, { width = 300, row = 40 })
end

return Results

-- The front of the game: the title card, the main menu, how to play, options, and choosing a circuit and a car.
-- They are screens of one scene, so the car keeps turning and the music keeps playing between them.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local controls = require("lib.controls")
local backdrop = require("lib.backdrop")

local Title = nova.scene {}

local MENU = { "Race", "How to play", "Options" }
local CONTROLS = {
  { "Steer", "Left / Right  ·  A / D  ·  left stick" },
  { "Accelerate", "Up  ·  W  ·  right trigger  ·  A button" },
  { "Brake / reverse", "Down  ·  S  ·  left trigger  ·  X button" },
  { "Handbrake (slides)", "Space  ·  B button  ·  right bumper" },
  { "Back on the road", "R  ·  Y button" },
  { "Change camera", "C  ·  left bumper" },
  { "Pause", "Esc  ·  P  ·  Start" },
}

function Title:enter(screen)
  backdrop.light()
  self.screen = screen or "title"
  self.choice = 1
  self.t = 0
  audio.music("menu", { volume = 0.6, fade = 0.8 })
  state.apply_volumes()
end

function Title:leave() backdrop.leave() end

function Title:go(screen)
  self.screen, self.choice = screen, 1
end

local function wear()
  local car = nova.first("show")
  if car then car:wear() end
end

function Title:update(dt)
  self.t = self.t + dt
  local screen = self.screen
  if screen == "title" then
    if nova.input.pressed("start") or nova.input.pressed("a") then
      audio.sfx("menu_accept")
      self:go("menu")
    end
  elseif screen == "menu" then
    local choice, action = ui.navigate(self.choice, #MENU)
    self.choice = choice
    if action == "back" then audio.sfx("menu_back"); self:go("title")
    elseif action == "accept" then
      audio.sfx("menu_accept")
      self:go(({ "select", "howto", "options" })[choice])
    end
  elseif screen == "howto" then
    if nova.input.pressed("a") or nova.input.pressed("b") or nova.input.pressed("start") then audio.sfx("menu_back"); self:go("menu") end
  elseif screen == "options" then
    local choice, action = ui.navigate(self.choice, 6)
    self.choice = choice
    local step = (action == "right" and 0.1) or (action == "left" and -0.1) or 0
    if choice == 1 and step ~= 0 then state.music_volume = math.max(0, math.min(1, state.music_volume + step)); state.save_options(); audio.sfx("menu_move") end
    if choice == 2 and step ~= 0 then state.sfx_volume = math.max(0, math.min(1, state.sfx_volume + step)); state.save_options(); audio.sfx("menu_move") end
    if choice == 3 and (step ~= 0 or action == "accept") then state.shadows = not state.shadows; state.save_options(); audio.sfx("menu_move") end
    if choice == 4 and (step ~= 0 or action == "accept") then state.vibration = not state.vibration; state.save_options(); audio.sfx("menu_move"); if state.vibration then nova.input.rumble(0.6, 0.15) end end
    if action == "accept" and choice == 5 then audio.sfx("menu_accept"); self:go("controls"); return end
    if action == "back" or (action == "accept" and choice == 6) then audio.sfx("menu_back"); self:go("menu") end
  elseif screen == "controls" then
    local rows = #controls.rows
    if self.listening then
      -- waiting for the new key or button (it gives up after a few seconds)
      self.listen_time = self.listen_time + dt
      local source = nova.input.next_source()
      if source then
        local row = controls.rows[self.choice]
        if controls.assign(row, source) then
          audio.sfx("menu_accept")
          nova.log(string.format("controls: %s %s = %s", row.action, row.side or "", controls.describe(row)))
          self.listening = false
        else
          audio.sfx("menu_back")
          self.note = "That one does not fit here."
        end
      elseif self.listen_time > 6 then
        self.listening = false
      end
      return
    end
    self.note = nil
    local choice, action = ui.navigate(self.choice, rows + 2)
    self.choice = choice
    if action == "accept" and choice <= rows then
      audio.sfx("menu_accept")
      self.listening, self.listen_time = true, 0
      nova.input.next_source() -- (drop the press that chose this row)
    elseif action == "accept" and choice == rows + 1 then
      audio.sfx("menu_accept")
      controls.reset()
      nova.log("controls: back to the defaults")
    elseif action == "back" or (action == "accept" and choice == rows + 2) then
      audio.sfx("menu_back")
      self:go("options")
    end
  elseif screen == "select" then
    local choice, action = ui.navigate(self.choice, 5)
    self.choice = choice
    local step = (action == "right" and 1) or (action == "left" and -1) or 0
    if choice == 1 and step ~= 0 then state.track = (state.track - 1 + step) % #state.tracks + 1; state.laps = state.current_track().laps; audio.sfx("menu_move") end
    if choice == 2 and step ~= 0 then state.mode = state.mode == "race" and "trial" or "race"; audio.sfx("menu_move") end
    if choice == 3 and step ~= 0 then state.car = (state.car - 1 + step) % #state.cars + 1; wear(); audio.sfx("menu_move") end
    if choice == 4 and step ~= 0 then state.laps = math.max(1, math.min(5, state.laps + step)); audio.sfx("menu_move") end
    if action == "back" then audio.sfx("menu_back"); self:go("menu")
    elseif action == "accept" and choice == 5 then
      audio.sfx("menu_accept")
      state.save_options()
      audio.stop_music(0.6)
      self:after(0.35, function() nova.goto_scene(state.current_track().id) end)
      self.screen = "starting"
    end
  end
end

function Title:draw()
  -- on the menu and the chooser the menu is on the left and the car moves to the right (easing across when the screen changes)
  local dt = self.t - (self.last_t or self.t)
  self.last_t = self.t
  local want = (self.screen == "menu" or self.screen == "select") and 2.6 or 0
  self.shift = (self.shift or 0) + (want - (self.shift or 0)) * math.min(1, dt * 5)
  backdrop.draw(self.t, "title", self.shift)
end

local function logo(t)
  ui.center("PINE RIDGE", 70 + math.sin(t * 1.3) * 3, 84, ui.color.gold, { font = "comic" })
  ui.center("RALLY", 150, 64, ui.color.white, { font = "comic" })
end

function Title:draw_ui()
  local w = nova.view()
  local screen = self.screen
  if screen == "title" or screen == "starting" then
    ui.letterbox()
    logo(self.t)
    if screen == "title" and math.floor(self.t * 1.6) % 2 == 0 then ui.center("PRESS START", 420, 28, ui.color.white) end
    ui.center("four circuits  ·  three rivals  ·  one chance to get it right", 484, 16, ui.color.dim)
  elseif screen == "menu" then
    logo(self.t)
    ui.menu(MENU, self.choice, 270, { width = 340, cx = 230 })
  elseif screen == "howto" then
    ui.center("HOW TO PLAY", 40, 44, ui.color.gold, { font = "comic" })
    ui.panel(w / 2 - 330, 110, 660, 340, 200)
    for i, row in ipairs(CONTROLS) do
      ui.text(w / 2 - 306, 124 + (i - 1) * 42, row[1], 20, ui.color.gold)
      ui.text(w / 2 - 70, 124 + (i - 1) * 42, row[2], 18, ui.color.white)
    end
    ui.center("Finish all the laps ahead of your rivals. The grass slows you down; the handbrake lets the back out.", 405, 14, ui.color.dim, { cx = w / 2 })
    ui.hint("press A")
  elseif screen == "options" then
    ui.center("OPTIONS", 60, 52, ui.color.gold, { font = "comic" })
    ui.menu({
      { "Music volume", string.format("< %d%% >", math.floor(state.music_volume * 100 + 0.5)) },
      { "Sound volume", string.format("< %d%% >", math.floor(state.sfx_volume * 100 + 0.5)) },
      { "Shadows", state.shadows and "< On >" or "< Off >" },
      { "Vibration", state.vibration and "< On >" or "< Off >" },
      "Controls...",
      "Back",
    }, self.choice, 180, { width = 420 })
  elseif screen == "controls" then
    ui.center("CONTROLS", 24, 44, ui.color.gold, { font = "comic" })
    local items = {}
    for i, row in ipairs(controls.rows) do
      items[i] = { row.label, (self.listening and self.choice == i) and "press a key or button..." or controls.describe(row) }
    end
    items[#items + 1] = "Back to the defaults"
    items[#items + 1] = "Back"
    ui.menu(items, self.choice, 84, { width = 700, row = 38 })
    ui.hint(self.note or "A: change     B: back     keys and buttons are changed separately")
  elseif screen == "select" then
    local info = state.current_track()
    ui.center("CHOOSE YOUR RACE", 30, 44, ui.color.gold, { font = "comic", cx = 240 })
    ui.menu({
      { "Circuit", "< " .. info.name .. " >" },
      { "Mode", "< " .. (state.mode == "race" and "Race" or "Time trial") .. " >" },
      { "Car", "< " .. state.current_car().name .. " >" },
      { "Laps", "< " .. state.laps .. " >" },
      state.mode == "race" and "START RACE" or "START TIME TRIAL",
    }, self.choice, 100, { width = 400, cx = 240 })
    -- (the menu and its notes are on the left, so that the car turning behind them can be seen on the right)
    ui.panel(40, 340, 400, 120, 205)
    ui.text(56, 354, state.mode == "race" and info.blurb or "Alone on the circuit, racing the ghost of your best lap.", 15, ui.color.white, { width = 370 })
    local best = state.best("race" .. state.laps, info.id)
    local lap = state.best("lap", info.id)
    ui.label(56, 404, "BEST " .. state.laps .. " LAPS")
    ui.text(180, 398, ui.time(best), 18, ui.color.gold, { font = "mono" })
    ui.label(56, 430, "BEST LAP")
    ui.text(180, 424, ui.time(lap), 18, ui.color.gold, { font = "mono" })
    ui.hint("up / down: choose     left / right: change     A: go     B: back")
  end
end

return Title

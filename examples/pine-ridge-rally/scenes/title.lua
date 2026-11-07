-- The front of the game: the title card, the main menu, how to play, options, and choosing a circuit and a car.
-- They are screens of one scene, so the car keeps turning and the music keeps playing between them.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local controls = require("lib.controls")
local backdrop = require("lib.backdrop")
local previews = require("lib.previews")

local Title = nova.scene {}

local MENU = { "Race", "How to play", "Options" }
-- (the pictures are the handheld's buttons, as a Nintendo-style pad labels them)
local CONTROLS = {
  { "Steer", "Left / Right  ·  A / D", { "pad_stick_l" } },
  { "Accelerate", "Up  ·  W", { "pad_zr", "pad_a" } },
  { "Brake / reverse", "Down  ·  S", { "pad_zl", "pad_x" } },
  { "Handbrake (slides)", "Space", { "pad_b", "pad_r" } },
  { "Back on the road", "R", { "pad_y" } },
  { "Change camera", "C", { "pad_l" } },
  { "Look around", "Q / E  (press the stick: look back)", { "pad_stick_r" } },
  { "Pause", "Esc  ·  P", { "pad_plus" } },
}

function Title:enter(screen)
  backdrop.light()
  self.screen = screen or "title"
  self.choice = 1
  self.t = 0
  audio.music("menu", { volume = 0.95, fade = 0.8 })
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

-- The pages that list the choices for Circuit, Mode and Car as a grid (from the chooser, A on one of those rows). Moving over a card
-- tries it (the backdrop and the car change behind), A keeps it and B puts back what there was.
local MODES = {
  { id = "race", name = "Race", blurb = "Three rivals on the road with you." },
  { id = "trial", name = "Time trial", blurb = "Alone, against the ghost of your best lap." },
  { id = "rally", name = "Rally", blurb = "A point-to-point stage in sections, scored on each section's time." },
}
local LEFT, RIGHT = 36, 614 -- the margins every grid page shares (the cards, the tabs and the notes all run from LEFT to RIGHT)
local GRIDS = {
  circuit = { cols = 2, card_w = 282, card_h = 176, gap = 14, x = 36, y = 100 },
  mode = { cols = 2, card_w = 282, card_h = 150, gap = 14, x = 36, y = 150 },
  car = { cols = 3, card_w = (RIGHT - LEFT - 16) / 3, card_h = 100, gap = 8, x = LEFT, y = 160 },
}

-- the cars of one class, as numbers into state.cars
local function class_cars(class)
  local list = {}
  for i, c in ipairs(state.cars) do if c.class == class then list[#list + 1] = i end end
  return list
end

function Title:items(kind)
  if kind == "circuit" then return state.mode == "rally" and state.stages or state.tracks elseif kind == "mode" then return MODES end
  local items = {}
  for k, i in ipairs(class_cars(self.pick.class)) do items[k] = state.cars[i] end
  return items
end

-- which card is the chosen one (a number among the cards on this page)
function Title:picked(kind)
  if kind == "circuit" then return state.mode == "rally" and state.stage or state.track end
  if kind == "car" then
    for k, i in ipairs(class_cars(self.pick.class)) do if i == state.car then return k end end
    return 0
  end
  for k, m in ipairs(MODES) do if m.id == state.mode then return k end end
  return 1
end

-- a class's tab on the car page: tries its first car
function Title:set_class(n)
  local pick = self.pick
  local count = #state.classes
  local index
  for k, c in ipairs(state.classes) do if c.id == pick.class then index = k end end
  index = (index - 1 + n) % count + 1
  pick.class = state.classes[index].id
  state.car = class_cars(pick.class)[1]
  wear()
end

function Title:set_pick(kind, i)
  if kind == "circuit" then
    if state.mode == "rally" then
      state.stage = i
    else
      state.track = i
      state.laps = state.current_track().laps
    end
    backdrop.light()
  elseif kind == "car" then
    state.car = class_cars(self.pick.class)[i]
    wear()
  else
    state.mode = MODES[i].id
    backdrop.light() -- (a rally's stage has its own look)
  end
end

function Title:open_pick(kind)
  self.pick = { kind = kind, old_laps = state.laps, class = state.current_car().class, tabs = false }
  self.pick.old = (kind == "car") and state.car or self:picked(kind) -- (for a car: its number in state.cars)
  self.screen = "pick"
end

-- the rows of the chooser: the difficulty is for races (a time trial has no rivals)
function Title:select_rows()
  if state.mode == "race" then return { "circuit", "mode", "car", "laps", "difficulty", "start" } end
  if state.mode == "rally" then return { "circuit", "mode", "car", "difficulty", "start" } end
  return { "circuit", "mode", "car", "laps", "start" }
end

function Title:update_pick()
  local pick = self.pick
  local items, grid = self:items(pick.kind), GRIDS[pick.kind]
  local i = self:picked(pick.kind)
  local n, cols = #items, grid.cols
  if pick.kind == "car" then
    -- the classes are tabs along the top: L and R change class, and so do left and right with the tabs selected (up from the top row)
    local handled = false
    local step = (nova.input.pressed("tab_next") and 1) or (nova.input.pressed("tab_prev") and -1) or 0
    if pick.tabs then
      step = step ~= 0 and step or ((nova.input.pressed("right") and 1) or (nova.input.pressed("left") and -1) or 0)
      if nova.input.pressed("down") then pick.tabs = false; handled = true; audio.sfx("menu_move") end
    elseif nova.input.pressed("up") and i <= cols then
      pick.tabs = true; audio.sfx("menu_move")
    end
    if step ~= 0 then self:set_class(step); audio.sfx("menu_move") end
    if pick.tabs or step ~= 0 or handled then
      self:pick_buttons(pick)
      return
    end
  end
  local moved = i
  if nova.input.pressed("left") then moved = i - 1 end
  if nova.input.pressed("right") then moved = i + 1 end
  if nova.input.pressed("up") then moved = i - cols end
  if nova.input.pressed("down") then moved = i + cols end
  if moved < 1 or moved > n then
    -- off an edge: along a row it wraps, down a column it stays
    if nova.input.pressed("left") then moved = n elseif nova.input.pressed("right") then moved = 1 else moved = i end
  end
  if moved ~= i then self:set_pick(pick.kind, moved); audio.sfx("menu_move") end
  self:pick_buttons(pick)
end

function Title:pick_buttons(pick)
  if nova.input.pressed("a") or nova.input.pressed("start") then
    audio.sfx("menu_accept")
    self.screen = "select"
  elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then
    audio.sfx("menu_back")
    if pick.kind == "car" then state.car = pick.old; wear() else self:set_pick(pick.kind, pick.old) end
    state.laps = pick.old_laps
    self.screen = "select"
  end
end

function Title:update(dt)
  self.t = self.t + dt
  local screen = self.screen
  if screen == "title" and nova.input.pressed("art_box") then self.screen = "boxart"
  elseif screen == "title" and nova.input.pressed("art_icon") then self.screen = "icon"
  elseif screen == "title" then
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
    local choice, action = ui.navigate(self.choice, 8)
    self.choice = choice
    local step = (action == "right" and 0.1) or (action == "left" and -0.1) or 0
    if choice == 1 and step ~= 0 then state.music_volume = math.max(0, math.min(1, state.music_volume + step)); state.save_options(); audio.sfx("menu_move") end
    if choice == 2 and step ~= 0 then state.sfx_volume = math.max(0, math.min(1, state.sfx_volume + step)); state.save_options(); audio.sfx("menu_move") end
    if choice == 3 and (step ~= 0 or action == "accept") then
      state.music_style = state.music_style == "kenney" and "studio" or "kenney"
      state.save_options(); audio.restyle(); audio.sfx("menu_move")
    end
    if choice == 4 and (step ~= 0 or action == "accept") then state.shadows = not state.shadows; state.save_options(); audio.sfx("menu_move") end
    if choice == 5 and (step ~= 0 or action == "accept") then state.effects = not state.effects; state.save_options(); backdrop.light(); audio.sfx("menu_move") end
    if choice == 6 and (step ~= 0 or action == "accept") then state.vibration = not state.vibration; state.save_options(); audio.sfx("menu_move"); if state.vibration then nova.input.rumble(0.6, 0.15) end end
    if action == "accept" and choice == 7 then audio.sfx("menu_accept"); self:go("controls"); return end
    if action == "back" or (action == "accept" and choice == 8) then audio.sfx("menu_back"); self:go("menu") end
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
  elseif screen == "pick" then
    self:update_pick()
  elseif screen == "select" then
    local rows = self:select_rows()
    self.choice = math.min(self.choice, #rows)
    local choice, action = ui.navigate(self.choice, #rows)
    self.choice = choice
    local row = rows[choice]
    local step = (action == "right" and 1) or (action == "left" and -1) or 0
    -- (Circuit, Mode and Car are chosen on their own pages: A opens one; Laps and Difficulty are changed with left and right)
    if row == "laps" and step ~= 0 then state.laps = math.max(1, math.min(5, state.laps + step)); audio.sfx("menu_move") end
    if row == "difficulty" and (step ~= 0 or action == "accept") then
      local at = 1
      for k, d in ipairs(state.difficulties) do if d.id == state.difficulty then at = k end end
      state.difficulty = state.difficulties[(at - 1 + (step ~= 0 and step or 1)) % #state.difficulties + 1].id
      audio.sfx("menu_move")
    end
    if action == "back" then audio.sfx("menu_back"); self:go("menu")
    elseif (action == "accept" or action == "right") and (row == "circuit" or row == "mode" or row == "car") then
      audio.sfx("menu_accept")
      self:open_pick(row)
    elseif action == "accept" and row == "start" then
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
  local want = (self.screen == "menu" or self.screen == "select" or self.screen == "pick") and ((self.screen == "pick") and 4.4 or 2.6) or 0
  self.shift = (self.shift or 0) + (want - (self.shift or 0)) * math.min(1, dt * 5)
  if self.screen == "boxart" or self.screen == "icon" then backdrop.draw(0, self.screen, 0) return end
  backdrop.draw(self.t, "title", self.shift)
end

local function logo(t)
  ui.center("PINE RIDGE", 70 + math.sin(t * 1.3) * 3, 70, ui.color.gold, { font = "thick" })
  ui.center("RALLY", 150, 60, ui.color.white, { font = "bold" })
end

-- a course drawn small: its waypoints as dots in a box (the start in gold)
local function course(id, x, y, size)
  local c = previews[id]
  if not c then return end
  local ox, oy = x + (size - c.w * size) / 2, y + (size - c.h * size) / 2
  for _, p in ipairs(c.pts) do nova.ui.rect(ox + p[1] * size - 1.5, oy + p[2] * size - 1.5, 3, 3, { 255, 255, 255, 235 }) end
  local s = c.pts[1]
  nova.ui.rect(ox + s[1] * size - 4, oy + s[2] * size - 4, 8, 8, ui.color.gold)
  if c.open then -- (a stage ends somewhere else: the finish is green)
    local e = c.pts[#c.pts]
    nova.ui.rect(ox + e[1] * size - 4, oy + e[2] * size - 4, 8, 8, ui.color.green)
  end
end

local function bar(x, y, w, label, value)
  ui.label(x, y - 4, label)
  nova.ui.rect(x + 58, y, w, 7, { 255, 255, 255, 50 })
  nova.ui.rect(x + 58, y, w * math.max(0, math.min(1, value)), 7, ui.color.gold)
end

function Title:draw_pick()
  local pick = self.pick
  local items, grid = self:items(pick.kind), GRIDS[pick.kind]
  local title = ({ circuit = state.mode == "rally" and "CHOOSE A STAGE" or "CHOOSE A CIRCUIT", mode = "CHOOSE A MODE", car = "CHOOSE A CAR" })[pick.kind]
  ui.text(grid.x, pick.kind == "car" and 12 or 30, title, ui.fit(title, pick.kind == "car" and 30 or 36, 560), ui.color.gold, { font = "bold" })
  if pick.kind == "car" then
    -- a tab for each class (the chosen class is yellow; with the tabs selected it has a frame round it)
    local tw = (RIGHT - LEFT - 12) / 3
    for k, c in ipairs(state.classes) do
      local x = grid.x + (k - 1) * (tw + 6)
      local on = c.id == pick.class
      nova.ui.panel(on and "ui/btn_yellow" or "ui/btn_grey", x, 58, tw, 34, { slice = { 14, 14, 14, 22 }, scale = 0.75 })
      nova.ui.text(x + 14, 64, c.name, { size = 20, color = ui.color.ink, font = "rounded", shadow = false })
      if on and pick.tabs then nova.ui.panel("ui/panel_frame", x - 3, 55, tw + 6, 40, { slice = 18, scale = 0.5 }) end
    end
    local class = state.class_of({ class = pick.class })
    ui.panel(LEFT, 98, RIGHT - LEFT, 52, 215)
    ui.text(LEFT + 14, 106, class.blurb, 14, ui.color.white, { width = RIGHT - LEFT - 28 })
    ui.text(LEFT + 14, 127, "Your rivals are other " .. class.name .. " cars.", 14, ui.color.gold, { width = RIGHT - LEFT - 28 })
  end
  local on = pick.tabs and 0 or self:picked(pick.kind)
  for i, item in ipairs(items) do
    local col, row = (i - 1) % grid.cols, (i - 1) // grid.cols
    local x = grid.x + col * (grid.card_w + grid.gap)
    local y = grid.y + row * (grid.card_h + grid.gap)
    local w, h = grid.card_w, grid.card_h
    if i == on then nova.ui.panel("ui/btn_yellow", x - 5, y - 5, w + 10, h + 10, { slice = { 14, 14, 14, 22 }, scale = 0.75 }) end
    ui.panel(x, y, w, h, 235)
    if pick.kind == "circuit" then
      course(item.id, x + 12, y + 12, h - 56)
      ui.text(x + h - 36, y + 18, item.name, ui.fit(item.name, 22, w - h + 20, "rounded"), ui.color.white)
      ui.text(x + h - 36, y + 50, item.blurb, 13, { 214, 224, 238 }, { width = w - h + 24 })
      if item.km then
        ui.label(x + 14, y + h - 40, item.km .. " KM  ·  5 SECTIONS")
        ui.text(x + 14, y + h - 22, "BEST " .. tostring(nova.save.get("rally_score_" .. item.id, "-")), 16, ui.color.gold, { font = "mono" })
      else
        ui.label(x + 14, y + h - 40, "BEST LAP")
        ui.text(x + 14, y + h - 22, ui.time(state.best("lap", item.id)), 16, ui.color.gold, { font = "mono" })
      end
    elseif pick.kind == "mode" then
      ui.text(x + 20, y + 24, item.name, 30, ui.color.white, { font = "bold" })
      ui.text(x + 20, y + 74, item.blurb, 17, { 214, 224, 238 }, { width = w - 40 })
    else
      ui.text(x + 12, y + 8, item.name, ui.fit(item.name, 20, w - 24, "rounded"), ui.color.white)
      bar(x + 12, y + 38, w - 82, "POWER", (item.power - 6) / 6.5)
      bar(x + 12, y + 52, w - 82, "SPEED", (item.top - 34) / 18)
      bar(x + 12, y + 66, w - 82, "GRIP", (item.grip - 0.75) / 0.5)
      bar(x + 12, y + 80, w - 82, "DRIFT", item.oversteer)
    end
  end
  if pick.kind == "car" then
    ui.hints({ { "pad_dpad", "look" }, { "pad_l", "class" }, { "pad_r", "class" }, { "pad_a", "choose" }, { "pad_b", "cancel" } })
  else
    ui.hints({ { "pad_dpad", "look" }, { "pad_a", "choose" }, { "pad_b", "cancel" } })
  end
end

function Title:draw_ui()
  local w = nova.view()
  local screen = self.screen
  if screen == "icon" then return end
  if screen == "boxart" then
    -- the box art: the title large at the top, the car below (the picture is made 3 wide to 4 tall)
    local size = ui.fit("PINE RIDGE", 70, w * 0.92, "thick")
    ui.center("PINE RIDGE", 62, size, ui.color.gold, { font = "thick" })
    ui.center("RALLY", 62 + size * 1.05, size * 0.85, ui.color.white, { font = "bold" })
    return
  end
  if screen == "title" or screen == "starting" then
    logo(self.t)
    if screen == "title" and math.floor(self.t * 1.6) % 2 == 0 then ui.center("PRESS START", 420, 28, ui.color.white) end
    ui.center("Made by Jasper Milan", 496, 16, ui.color.white, { font = "future_narrow" })
  elseif screen == "menu" then
    logo(self.t)
    ui.menu(MENU, self.choice, 270, { width = 340, cx = 230 })
  elseif screen == "howto" then
    ui.center("HOW TO PLAY", 40, 38, ui.color.gold, { font = "bold" })
    ui.panel(w / 2 - 330, 110, 660, 340, 200)
    for i, row in ipairs(CONTROLS) do
      ui.text(w / 2 - 306, 124 + (i - 1) * 36, row[1], 20, ui.color.gold)
      for k, icon in ipairs(row[3] or {}) do ui.pad(icon, w / 2 - 90 + (k - 1) * 32, 120 + (i - 1) * 36, 30) end
      ui.text(w / 2 - 14, 124 + (i - 1) * 36, row[2], 17, ui.color.white)
    end
    ui.center("Finish all the laps ahead of your rivals.", 404, 16, ui.color.white, { cx = w / 2 })
    ui.center("The grass slows you down; the handbrake lets the back out.", 424, 16, ui.color.white, { cx = w / 2 })
    ui.hints({ { "pad_a", "back" } })
  elseif screen == "options" then
    ui.center("OPTIONS", 60, 44, ui.color.gold, { font = "bold" })
    ui.menu({
      { "Music volume", string.format("< %d%% >", math.floor(state.music_volume * 100 + 0.5)) },
      { "Sound volume", string.format("< %d%% >", math.floor(state.sfx_volume * 100 + 0.5)) },
      { "Music style", state.music_style == "kenney" and "< Kenney loops >" or "< Nova Studio songs >" },
      { "Shadows", state.shadows and "< On >" or "< Off >" },
      { "Effects", state.effects and "< On >" or "< Off >" },
      { "Vibration", state.vibration and "< On >" or "< Off >" },
      "Controls...",
      "Back",
    }, self.choice, 180, { width = 420 })
  elseif screen == "controls" then
    ui.center("CONTROLS", 24, 38, ui.color.gold, { font = "bold" })
    local items = {}
    for i, row in ipairs(controls.rows) do
      items[i] = { row.label, (self.listening and self.choice == i) and "press a key or button..." or controls.describe(row) }
    end
    items[#items + 1] = "Back to the defaults"
    items[#items + 1] = "Back"
    ui.menu(items, self.choice, 84, { width = 700, row = 38 })
    if self.note then ui.hint(self.note) else ui.hints({ { "pad_a", "change" }, { "pad_b", "back" } }) end
  elseif screen == "pick" then
    self:draw_pick()
  elseif screen == "select" then
    local info = state.current_track()
    ui.center("CHOOSE YOUR RACE", 40, ui.fit("CHOOSE YOUR RACE", 36, 390), ui.color.gold, { font = "bold", cx = 240 })
    local labels = {
      circuit = { state.mode == "rally" and "Stage" or "Circuit", info.name .. "  >" },
      mode = { "Mode", ({ race = "Race", trial = "Time trial", rally = "Rally" })[state.mode] .. "  >" },
      car = { "Car", state.current_car().name .. "  >" },
      laps = { "Laps", "< " .. state.laps .. " >" },
      difficulty = { "Difficulty", "< " .. state.current_difficulty().name .. " >" },
      start = ({ race = "START RACE", trial = "START TIME TRIAL", rally = "START RALLY" })[state.mode],
    }
    local rows, items = self:select_rows(), {}
    for k, id in ipairs(rows) do items[k] = labels[id] end
    ui.menu(items, self.choice, 100, { width = 400, cx = 240, row = 42 })
    local on_difficulty = rows[self.choice] == "difficulty"
    -- (the menu and its notes are on the left, so that the car turning behind them can be seen on the right)
    ui.panel(40, 360, 400, 112, 205)
    local note = on_difficulty and state.current_difficulty().blurb
      or (state.mode == "race" and info.blurb) or (state.mode == "rally" and info.blurb)
      or "Alone on the circuit, racing the ghost of your best lap."
    ui.text(56, 372, note, 15, ui.color.white, { width = 370 })
    if state.mode == "rally" then
      ui.label(56, 416, "BEST SCORE")
      ui.text(180, 410, tostring(nova.save.get("rally_score_" .. info.id, "-")), 18, ui.color.gold, { font = "mono" })
      ui.label(56, 442, "BEST TIME")
      ui.text(180, 436, ui.time(state.best("rally", info.id)), 18, ui.color.gold, { font = "mono" })
    else
      local best = state.best("race" .. state.laps, info.id)
      local lap = state.best("lap", info.id)
      ui.label(56, 416, "BEST " .. state.laps .. " LAPS")
      ui.text(180, 410, ui.time(best), 18, ui.color.gold, { font = "mono" })
      ui.label(56, 442, "BEST LAP")
      ui.text(180, 436, ui.time(lap), 18, ui.color.gold, { font = "mono" })
    end
    ui.hints({ { "pad_dpad", "move" }, { "pad_a", "open / go" }, { "pad_b", "back" } })
  end
end

return Title

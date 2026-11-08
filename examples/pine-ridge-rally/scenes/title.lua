-- The front of the game: the title card, the main menu, how to play, options, and choosing a circuit and a car.
-- They are screens of one scene, so the car keeps turning and the music keeps playing between them.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local controls = require("lib.controls")
local backdrop = require("lib.backdrop")
local previews = require("lib.previews")
local transition = require("lib.transition")
local pars = require("lib.pars")

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
  -- (the menus remember their focus while the title scene is up, going between its screens; coming back from a race they start again
  -- on their first row)
  for _, id in ipairs({ "main", "select", "options", "controls" }) do nova.ui.forget(id) end
  self.t = 0
  self.entered = 0
  audio.music("menu", { volume = 0.95, fade = 0.8 })
  state.apply_volumes()
end

function Title:leave() backdrop.leave() end

function Title:go(screen)
  self.screen, self.entered = screen, 0
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
  circuit = { cols = 2, card_w = 284, card_h = 96, gap = 10, x = 36, y = 92, rows = 3 }, -- (three rows show at once; the page scrolls)
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
  -- (a locked class can be looked at, but its cars are not tried on: the car on show stays the one you have)
  if state.class_open(state.classes[index]) then state.car = class_cars(pick.class)[1] else state.car = pick.old end
  wear()
end

local function class_locked(id) return not state.class_open(state.class_of({ class = id })) end

-- the courses of the list the mode shows, and whether one of them is open
local function course_list() return state.mode == "rally" and state.stages or state.tracks end
local function course_locked(i)
  local list = course_list()
  return not state.course_open(list, list[i])
end
-- each level's colour on the cards
local LEVEL_COLOR = { { 74, 222, 128 }, { 56, 189, 248 }, { 251, 146, 60 }, { 239, 68, 68 } }

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

-- (`back_to`: the screen A and B go back to: the chooser, or the main menu for the garage)
function Title:open_pick(kind, back_to)
  self.pick = { kind = kind, old_laps = state.laps, class = state.current_car().class, back_to = back_to, old_mode = state.mode }
  self.pick.old = (kind == "car") and state.car or self:picked(kind) -- (for a car: its number in state.cars)
  self.screen = "pick"
  self.entered = 0
  -- the page opens on the card chosen now (on the car page, a class that does not have the car opens on its tab)
  nova.ui.focus("pick_" .. kind, "card" .. self:picked(kind))
end

-- the rows of the chooser: the difficulty is for races (a time trial has no rivals)
function Title:select_rows()
  -- (the mode comes first: it decides what the circuit row lists)
  if state.mode == "race" then return { "mode", "circuit", "car", "laps", "difficulty", "start" } end
  if state.mode == "rally" then return { "mode", "circuit", "car", "difficulty", "start" } end
  return { "mode", "circuit", "car", "laps", "start" }
end

-- (the menus themselves, and what their buttons do, are in draw_ui: nova.ui.menu reads the pad as it draws. This is the rest.)
function Title:update(dt)
  self.t = self.t + dt
  self.entered = (self.entered or 0) + dt
  ui.tick(dt)
  transition.update(dt)
  local screen = self.screen
  if screen == "title" and nova.input.pressed("art_box") then self.screen = "boxart"
  elseif screen == "title" and nova.input.pressed("art_icon") then self.screen = "icon"
  elseif screen == "title" then
    if nova.input.pressed("start") or nova.input.pressed("a") then
      audio.sfx("menu_accept")
      self:go("menu")
    end
  elseif screen == "howto" then
    if nova.input.pressed("a") or nova.input.pressed("b") or nova.input.pressed("start") then audio.sfx("menu_back"); self:go("menu") end
  elseif screen == "controls" and self.listening then
    -- waiting for the new key or button (it gives up after a few seconds)
    self.listen_time = self.listen_time + dt
    local source = nova.input.next_source()
    if source then
      local row = controls.rows[self.listen_row]
      if controls.assign(row, source) then
        audio.sfx("menu_accept")
        nova.log(string.format("controls: %s %s = %s", row.action, row.side or "", controls.describe(row)))
        self.listening, self.just_listened = false, true
      else
        audio.sfx("menu_back")
        self.note = "That one does not fit here."
      end
    elseif self.listen_time > 6 then
      self.listening, self.just_listened = false, true
    end
  elseif screen == "pick" and self.pick.kind == "circuit" and (nova.input.pressed("tab_next") or nova.input.pressed("tab_prev")) then
    -- L and R switch the list between the circuits and the rally stages (the mode follows: a stage is a rally)
    local pick = self.pick
    if state.mode == "rally" then state.mode = (pick.old_mode ~= "rally" and pick.old_mode) or "race" else state.mode = "rally" end
    backdrop.light()
    audio.sfx("menu_move")
    nova.ui.focus("pick_circuit", "card" .. self:picked("circuit"))
  elseif screen == "pick" and self.pick.kind == "car" then
    -- L and R change the class from anywhere on the car page (left and right do it on the class tab)
    local step = (nova.input.pressed("tab_next") and 1) or (nova.input.pressed("tab_prev") and -1) or 0
    if step ~= 0 then
      self:set_class(step)
      audio.sfx("menu_move")
      if nova.ui.focus("pick_car") ~= "tab" then nova.ui.focus("pick_car", "card1") end
    end
  end
end

function Title:draw()
  -- the car on show moves aside for the panels (easing across when the screen changes): right of the menus, left of the garage
  local dt = self.t - (self.last_t or self.t)
  self.last_t = self.t
  local screen = self.screen
  local want = 0
  if screen == "menu" or screen == "select" or screen == "options" or screen == "controls" then want = 2.6 end
  if screen == "pick" then want = self.pick.kind == "car" and -2.2 or 0 end
  self.shift = (self.shift or 0) + (want - (self.shift or 0)) * math.min(1, dt * 5)
  if screen == "boxart" or screen == "icon" then
    -- (a landscape cover: the car moves over to the right, and the name is set on the left)
    local w, h = nova.view()
    backdrop.draw(0, screen, (screen == "boxart" and w > h) and 2.6 or 0)
    return
  end
  backdrop.draw(self.t, "title", self.shift)
end

local C, F = ui.color, ui.font

-- the game's name, big and italic, with the orange bar and RALLY spaced out under it (top left of the main panel)
local function logo_tree(size)
  size = size or 81
  return { "column", gap = 6,
    { "text", "PINE RIDGE", font = F.title, size = size, h = size * 0.92 },
    { "row", gap = 12, align = "center",
      { "box", w = 48, h = 6, draw = function(r) nova.ui.rect(r.x, r.y, r.w, r.h, C.orange) end },
      { "text", "RALLY", font = F.bold, size = 19.5, spacing = 0.32, color = C.dim } } }
end

-- a course's route drawn into a rectangle: a dark band, the road in white, the start (S, orange) and, on a stage, the finish (F)
local function route(id, r, pad)
  local c = previews[id]
  if not c then return end
  pad = pad or 24
  local k = math.min((r.w - 2 * pad) / c.w, (r.h - 2 * pad) / c.h)
  local ox, oy = r.x + (r.w - c.w * k) / 2, r.y + (r.h - c.h * k) / 2
  local pts = c.pts
  local function at(i) return ox + pts[i][1] * k, oy + pts[i][2] * k end
  local step = math.max(1, #pts // 140)
  for pass = 1, 2 do
    local width, colour = pass == 1 and 7 or 3, pass == 1 and { 0, 0, 0, 150 } or C.white
    local i = 1
    while i < #pts do
      local j = math.min(i + step, #pts)
      local x1, y1 = at(i)
      local x2, y2 = at(j)
      nova.ui.line(x1, y1, x2, y2, width, colour)
      i = j
    end
    if not c.open then
      local x1, y1 = at(#pts)
      local x2, y2 = at(1)
      nova.ui.line(x1, y1, x2, y2, width, colour)
    end
  end
  local function marker(i, colour, letter)
    local x, y = at(i)
    nova.ui.rect(x - 9, y - 9, 18, 18, colour)
    ui.say(x, y, letter, F.heavy, 13.5, C.ink, { align = "center", valign = "middle" })
  end
  if c.open then marker(#pts, C.white, "F") end
  marker(1, C.orange, "S")
end

-- the course's facts, as the game knows them
local function facts(item)
  local look = require("lib.course").of(item.id)
  local surface = (look.surface == "dirt") and (look.weather and look.weather.kind == "snow" and "Snow" or "Gravel") or "Asphalt"
  local weather = (look.weather and look.weather.kind == "snow") and "Snow" or "Clear"
  return {
    { item.km and "Length" or "Laps", item.km and (item.km .. " km") or tostring(item.laps) },
    { "Surface", surface },
    { "Weather", weather },
    { "Time", look.night and "Night" or "Day" },
  }
end

local function cell(label, value, w)
  return { "panel", w = w, panel = { color = C.panel2 }, pad = { 12, 8 }, gap = 0,
    { "text", label, style = "small" }, { "text", value, style = "value" } }
end

-- the bar of a page, as a box that draws it: `frac` of `w` in orange over the divider colour
local function bar_box(frac, h)
  return { "box", h = h or 10.5, draw = function(r)
    nova.ui.rect(r.x, r.y, r.w, r.h, C.divider)
    nova.ui.rect(r.x, r.y, r.w * math.max(0, math.min(1, frac)), r.h, C.orange)
  end }
end

local function segments(n, of)
  local row = { "row", gap = 4.5 }
  for i = 1, of do
    row[#row + 1] = { "box", w = 33, h = 9, draw = function(r) nova.ui.rect(r.x, r.y, r.w, r.h, i <= n and C.orange or C.divider) end }
  end
  return row
end

-- a line of a panel: a quiet label on the left and the value on the right
local function line(label, value, colour)
  return { "row", h = 27, { "text", label, style = "muted", grow = 1 }, { "text", value, font = F.semi, size = 18, color = colour or C.white, align = "right", w = 220 } }
end

-- ---- the menus -------------------------------------------------------------------------------------------------------
-- Each screen is a nova.ui.menu tree: what is on it and where it sits on the screen. The engine lays it out, moves the orange bar
-- with the d-pad or the stick, remembers where it was, and says which button was pressed. (Sizes are the game's units: the screen
-- is 960 by 540, so the mockup's 1280 by 720 boards are three quarters of their numbers.)

local function add(list, items) for _, it in ipairs(items) do list[#list + 1] = it end return list end
local function on_off(v) return v and "On" or "Off" end
local function level_name(i) return state.levels[i or 1] end
local MODE_NAMES = { race = "Race", trial = "Time trial", rally = "Rally" }

-- the dark ground most pages sit on (the backdrop shows a little through it)
local function ground(alpha)
  local w = nova.view()
  nova.ui.rect(0, 0, w, 540, { C.ground[1], C.ground[2], C.ground[3], math.floor(255 * alpha) })
end

function Title:title_screen()
  ui.side_panel(480)
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 33, logo_tree() }
  if math.floor(self.t * 1.6) % 2 == 0 then ui.say(66, 200, "PRESS START", F.heavy, 30, C.orange, { spacing = 0.08 }) end
  ui.say(48, 440, "Made by Jasper Milan", F.medium, 16.5, C.dim)
  ui.hints({ { "pad_a", "Start" } })
end

function Title:main_menu()
  ui.side_panel(480)
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 33, logo_tree() }
  -- the course chosen now, top right (where the mockup said "continue": the game has no career, so this is what Race would start)
  local info = state.current_track()
  local f = facts(info)
  local rects = nova.ui.layout { anchor = "topright", margin = 36, w = 300, pad = { 18, 13 }, gap = 2, id = "upnext",
    panel = { color = C.panel }, x = 0, y = -3,
    { "text", "UP NEXT", style = "kicker" },
    { "text", string.upper(info.name), font = F.heavy, size = 30 },
    { "text", level_name(info.level) .. "  ·  " .. f[1][2] .. (info.km and "" or " laps") .. "  ·  " .. f[2][2], style = "muted" } }
  local u = rects.upnext
  nova.ui.rect(u.x, u.y, 6, u.h, C.orange)
  local r = nova.ui.menu {
    id = "main", anchor = "topleft", margin = 0, x = 48, y = 160, w = 352, enter = self.entered,
    { "button", "RACE", id = "race" },
    { "button", "TIME TRIAL", id = "trial" },
    { "button", "RALLY STAGES", id = "rally" },
    { "button", "GARAGE", id = "garage" },
    { "button", "HOW TO PLAY", id = "howto" },
    { "button", "OPTIONS", id = "options" },
  }
  ui.hints({ { "pad_a", "Select" }, { "pad_b", "Back" } })
  if r.back then self:go("title")
  elseif r.pressed then
    audio.sfx("menu_accept")
    local id = r.pressed
    if id == "race" or id == "trial" or id == "rally" then
      if state.mode ~= id then state.mode = id; backdrop.light() end
      self:go("select")
    elseif id == "garage" then
      self:open_pick("car", "menu")
    else
      self:go(id)
    end
  end
end

-- the page frame of the options, controls and how-to screens: the dark panel down the left with the header at its top
local function page(kicker, title, width)
  ui.side_panel(width or 560)
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 30, ui.header(kicker, title) }
end

function Title:options_menu()
  page("Settings", "Options")
  local r = nova.ui.menu {
    id = "options", anchor = "topleft", margin = 0, x = 48, y = 124, w = 440, enter = self.entered,
    { "button", "MUSIC VOLUME", value = string.format("< %d%% >", math.floor(state.music_volume * 100 + 0.5)), id = "music", adjust = true, h = 40 },
    { "button", "SOUND VOLUME", value = string.format("< %d%% >", math.floor(state.sfx_volume * 100 + 0.5)), id = "sound", adjust = true, h = 40 },
    { "button", "MUSIC STYLE", value = state.music_style == "kenney" and "< Kenney loops >" or "< Nova Studio songs >", id = "style", adjust = true, h = 40 },
    { "button", "SHADOWS", value = on_off(state.shadows), id = "shadows", adjust = true, h = 40 },
    { "button", "EFFECTS", value = on_off(state.effects), id = "effects", adjust = true, h = 40 },
    { "button", "SMOOTH EDGES", value = on_off(state.smooth), id = "smooth", adjust = true, h = 40 },
    { "button", "VIBRATION", value = on_off(state.vibration), id = "vibration", adjust = true, h = 40 },
    { "button", "CONTROLS", id = "controls", h = 40 },
  }
  ui.hints({ { "pad_dpad", "Change" }, { "pad_a", "Select" }, { "pad_b", "Back" } })
  if r.back then self:go("menu") return end
  if r.pressed == "controls" then audio.sfx("menu_accept"); self:go("controls") return end
  local id, step = r.changed or r.pressed, (r.step or 0) / 10
  if not id then return end
  if r.pressed then audio.sfx("menu_move") end -- (a step has made its sound already)
  if id == "music" and step ~= 0 then state.music_volume = math.max(0, math.min(1, state.music_volume + step)) end
  if id == "sound" and step ~= 0 then state.sfx_volume = math.max(0, math.min(1, state.sfx_volume + step)) end
  if id == "style" then state.music_style = state.music_style == "kenney" and "studio" or "kenney"; audio.restyle() end
  if id == "shadows" then state.shadows = not state.shadows end
  if id == "effects" then state.effects = not state.effects; backdrop.light() end
  if id == "smooth" then state.smooth = not state.smooth; backdrop.light() end
  if id == "vibration" then
    state.vibration = not state.vibration
    if state.vibration then nova.input.rumble(0.6, 0.15) end
  end
  state.save_options()
end

function Title:controls_menu()
  page("Options", "Controls", 640)
  local root = { id = "controls", anchor = "topleft", margin = 0, x = 48, y = 124, w = 530, enter = self.entered, gap = 3,
                 active = not self.listening and not self.just_listened }
  self.just_listened = false
  for i, row in ipairs(controls.rows) do
    local waiting = self.listening and self.listen_row == i
    root[#root + 1] = { "button", string.upper(row.label), value = waiting and "Press a key or button..." or controls.describe(row), id = i, h = 36 }
  end
  root[#root + 1] = { "button", "BACK TO THE DEFAULTS", id = "defaults", h = 36 }
  local r = nova.ui.menu(root)
  if self.note then ui.hint(self.note) else ui.hints({ { "pad_a", "Change" }, { "pad_b", "Back" } }) end
  if r.back then self:go("options")
  elseif r.pressed == "defaults" then
    audio.sfx("menu_accept")
    controls.reset()
    nova.log("controls: back to the defaults")
  elseif r.pressed then
    audio.sfx("menu_accept")
    self.note = nil
    self.listening, self.listen_time, self.listen_row = true, 0, tonumber(r.pressed)
    nova.input.next_source() -- (drop the press that chose this row)
  end
end

function Title:howto_screen()
  ground(0.88)
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 30, ui.header("Pine Ridge Rally", "How to play") }
  local panel = { "panel", pad = { 24, 14 }, gap = 2, w = 760 }
  for i, row in ipairs(CONTROLS) do
    local pads = { "row", w = 100, gap = 4 }
    for _, icon in ipairs(row[3] or {}) do pads[#pads + 1] = { "image", "ui/" .. icon, w = 30, h = 30 } end
    panel[#panel + 1] = { "row", h = 32, gap = 0,
      { "text", string.upper(row[1]), font = F.heavy, size = 21, color = C.orange, w = 230, spacing = 0.03 }, pads, { "space", w = 18 },
      { "text", row[2], font = F.medium, size = 18, color = C.dim, grow = 1 } }
    panel[#panel + 1] = { "box", h = 1.5, draw = function(r) nova.ui.rect(r.x, r.y, r.w, r.h, C.divider) end }
  end
  add(panel, {
    { "space", h = 4 },
    { "text", "Finish all the laps ahead of your rivals. The grass slows you down; the handbrake lets the back out.", style = "body", wrap = true },
  })
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 118, panel }
  ui.hints({ { "pad_b", "Back" } })
end

function Title:select_menu()
  local info = state.current_track()
  local labels = {
    circuit = { state.mode == "rally" and "STAGE" or "CIRCUIT", info.name },
    mode = { "MODE", MODE_NAMES[state.mode] },
    car = { "CAR", state.current_car().name },
    laps = { "LAPS", "< " .. state.laps .. " >" },
    difficulty = { "DIFFICULTY", "< " .. state.current_difficulty().name .. " >" },
    start = { ({ race = "START RACE", trial = "START TIME TRIAL", rally = "START RALLY" })[state.mode] },
  }
  ui.side_panel(500)
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 30, ui.header(MODE_NAMES[state.mode], "Choose your race", 48) }
  local root = { id = "select", anchor = "topleft", margin = 0, x = 48, y = 124, w = 384, enter = self.entered }
  for _, id in ipairs(self:select_rows()) do
    local l = labels[id]
    root[#root + 1] = { "button", l[1], value = l[2], id = id, adjust = id ~= "start", chevron = id == "start" }
  end
  -- the chosen course (or difficulty), top right, so that the car can be seen under it
  local on_difficulty = nova.ui.focus("select") == "difficulty"
  local f = facts(info)
  local side = { "panel", anchor = "topright", margin = 36, w = 330, pad = { 18, 14 }, gap = 3, y = -6, id = "side" }
  if on_difficulty then
    add(side, { { "text", "DIFFICULTY", style = "kicker" }, { "text", string.upper(state.current_difficulty().name), font = F.heavy, size = 30 },
      { "text", state.current_difficulty().blurb, style = "muted", wrap = true } })
  else
    add(side, { { "text", string.upper(level_name(info.level)) .. "  ·  " .. string.upper(f[2][2]), style = "kicker" },
      { "text", string.upper(info.name), font = F.heavy, size = 30 },
      { "text", state.mode == "trial" and "Alone on the circuit, racing the ghost of your best lap." or info.blurb, style = "muted", wrap = true },
      { "space", h = 6 } })
    if state.mode == "rally" then
      add(side, { line("Length", f[1][2]), line("Best score", tostring(nova.save.get("rally_score_" .. info.id, "-")), C.gold),
        line("Best time", ui.time(state.best("rally", info.id)), C.gold) })
    else
      add(side, { line("Best " .. state.laps .. " laps", ui.time(state.best("race" .. state.laps, info.id)), C.gold),
        line("Best lap", ui.time(state.best("lap", info.id)), C.gold) })
    end
  end
  local sr = nova.ui.layout(side).side
  nova.ui.rect(sr.x, sr.y, 6, sr.h, C.orange)
  local r = nova.ui.menu(root)
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Select" }, { "pad_b", "Back" } })

  if r.back then self:go("menu") return end
  local id = r.changed or r.pressed
  if id == "laps" and r.step then state.laps = math.max(1, math.min(5, state.laps + r.step)) end
  if id == "difficulty" then
    local at = 1
    for k, d in ipairs(state.difficulties) do if d.id == state.difficulty then at = k end end
    state.difficulty = state.difficulties[(at - 1 + (r.step or 1)) % #state.difficulties + 1].id
    if r.pressed then audio.sfx("menu_move") end
  end
  -- (Circuit, Mode and Car are chosen on their own pages: A or right opens one; Laps and Difficulty change with left and right)
  if (id == "circuit" or id == "mode" or id == "car") and (r.pressed or r.step == 1) then
    audio.sfx("menu_accept")
    self:open_pick(id)
  elseif r.pressed == "start" then
    audio.sfx("menu_accept")
    state.save_options()
    audio.stop_music(0.6)
    transition.cover(transition.race_spec(), function() nova.goto_scene(state.current_track().id) end)
    self.screen = "starting"
  end
end

-- The circuit (or stage) list, the mode list and the garage: moving over one tries it (the backdrop and the car change behind), A keeps
-- it and B puts back what there was.
function Title:pick_list(kind, items)
  local pick = self.pick
  local on = self:picked(kind)
  local item = items[on] or items[1]
  local list = { "column", flow = true, visible = 6, gap = 4.5 }
  local right = { "panel", anchor = "topright", y = 58, w = 507, h = 358, pad = 0, gap = 0 }
  local kicker, title
  if kind == "circuit" then
    kicker = MODE_NAMES[state.mode] .. (state.mode == "rally" and "  ·  Stages" or "  ·  Circuits")
    title = item.name
    for i, c in ipairs(items) do
      local open = state.course_open(items, c)
      local best = c.km and state.best("rally", c.id) or state.best("lap", c.id)
      list[#list + 1] = { "button", string.upper(c.name), id = "card" .. i, look = "row", number = i, h = 51, locked = not open,
                          done = best ~= nil, value = best and ui.time(best) or "No time set" }
    end
    local open, why = state.course_open(items, item)
    local f = facts(item)
    local cells = { "row", gap = 9 }
    for _, fact in ipairs(f) do cells[#cells + 1] = cell(fact[1], fact[2], 115) end
    local best_label, best_value, par_label, par_value
    if item.km then
      best_label, best_value = "Best score", tostring(nova.save.get("rally_score_" .. item.id, "-"))
      par_label, par_value = "Sections", tostring(item.sections or 5)
    else
      best_label, best_value = "Best lap", ui.time(state.best("lap", item.id))
      local par = (pars.laps[item.id] or {})[state.current_car().class]
      par_label, par_value = "Par lap (" .. state.class_of(state.current_car()).name .. ")", par and ui.time(par) or "-"
    end
    add(right, {
      { "box", h = 178, draw = function(r) if open then route(item.id, r, 22) else ui.lock(r.x + r.w / 2 - 24, r.y + r.h / 2 - 24, 48, C.dim) end end },
      { "column", pad = { 18, 0 }, gap = 6, cells,
        open and line(best_label, best_value, C.gold) or { "text", "Locked: " .. why, font = F.semi, size = 18, color = C.gold, h = 27 },
        line(par_label, par_value),
        { "row", h = 27, { "text", "Difficulty", style = "muted", grow = 1 },
          { "text", string.upper(level_name(item.level)), font = F.bold, size = 18, color = LEVEL_COLOR[item.level or 1], spacing = 0.06, w = 90, align = "right" },
          { "space", w = 10 }, segments(item.level or 1, 4) } },
    })
  else -- the modes
    kicker, title = "Choose a mode", MODE_NAMES[item.id]
    for i, m in ipairs(items) do list[#list + 1] = { "button", string.upper(m.name), id = "card" .. i, look = "row", number = i, h = 51 } end
    right.h = nil
    add(right, { { "column", pad = { 24, 20 }, gap = 8, { "text", "THE MODE", style = "kicker" }, { "text", string.upper(item.name), font = F.heavy, size = 36 },
      { "text", item.blurb, style = "body", size = 18, wrap = true } } })
  end
  ground(0.9)
  local tabs = { "row", anchor = "topright", y = 17, gap = 6 }
  if kind == "circuit" then
    for _, t in ipairs({ { "CIRCUITS", state.mode ~= "rally" }, { "STAGES", state.mode == "rally" } }) do
      tabs[#tabs + 1] = { "text", t[1], font = t[2] and F.heavy or F.bold, size = 19.5, spacing = 0.06, color = t[2] and C.ink or C.dim,
                          panel = { color = t[2] and C.orange or C.panel }, pad = { 15, 6 } }
    end
  end
  local r = nova.ui.menu {
    id = "pick_" .. kind, kind = "stack", w = "100%", h = 450, margin = 36, wrap = false, enter = false,
    { "column", anchor = "topleft", y = -9, ui.header(kicker, title, 45) },
    tabs,
    { "column", anchor = "topleft", y = 58, w = 352, list },
    right,
  }
  if kind == "circuit" then
    ui.hints({ { "pad_dpad", "Look" }, { "pad_l", "" }, { "pad_r", "Circuits / stages" }, { "pad_a", "Select" }, { "pad_b", "Back" } })
  else
    ui.hints({ { "pad_dpad", "Look" }, { "pad_a", "Select" }, { "pad_b", "Back" } })
  end
  return r
end

function Title:garage()
  local pick = self.pick
  local items = self:items("car")
  local locked = class_locked(pick.class)
  local on = self:picked("car")
  local car = items[math.max(1, on)] or items[1]
  local class = state.class_of({ class = pick.class })
  local open, why = state.class_open(class)
  -- (the header sits on a soft dark band, so that it reads over the sky)
  nova.ui.slant(0, 0, 560, 150, 40, { C.ground[1], C.ground[2], C.ground[3], 200 })
  nova.ui.layout { anchor = "topleft", margin = 0, x = 36, y = 27, w = 480, gap = 2,
    { "text", "GARAGE  ·  " .. string.upper(class.name), style = "kicker" },
    { "text", string.upper(car.name), font = F.title, size = 54 },
    { "text", class.blurb, style = "muted", size = 18, wrap = true } }
  -- the classes as tabs along the top of the panel (the chosen class orange; with the focus on it, left and right change class)
  local tabs = { "row", gap = 6, h = 39 }
  for k, c in ipairs(state.classes) do
    local here = c.id == pick.class
    tabs[#tabs + 1] = { "button", string.upper(state.class_open(c) and c.name or (c.name .. " *")), look = "tab", on = here,
                        id = here and "tab" or ("class" .. k), focusable = here, adjust = true, grow = 1, h = 39 }
  end
  local stats = { "column", gap = 15 }
  for _, s in ipairs({ { "Power", (car.power - 6) / 6.5 }, { "Top speed", (car.top - 28) / 24 }, { "Grip", (car.grip - 0.75) / 0.7 }, { "Drift", car.oversteer } }) do
    local v = math.max(0, math.min(1, s[2]))
    add(stats, { { "column", gap = 6,
      { "row", { "text", s[1], font = F.medium, size = 18, grow = 1 }, { "text", tostring(math.floor(v * 100 + 0.5)), font = F.medium, size = 18, color = C.dim, w = 40, align = "right" } },
      bar_box(v) } })
  end
  local dots = { "row", gap = 0, h = 42, w = 21 * #items }
  for i = 1, #items do dots[#dots + 1] = { "button", "", id = "card" .. i, look = "dot", w = 21, h = 42, focusable = not locked } end
  local arrow = function(left) return { "box", w = 42, h = 42, panel = { color = C.panel2 }, draw = function(r) ui.chevron(r.x + r.w / 2, r.y + r.h / 2, 16, C.white, left) end } end
  local yours = state.cars[pick.old] == car
  local r = nova.ui.menu {
    id = "pick_car", kind = "stack", w = "100%", h = 432, margin = 36, wrap = true, enter = false,
    { "panel", anchor = "topright", y = -9, w = 390, h = 380, pad = { 24, 21 }, gap = 0,
      tabs, { "space", h = 21 }, stats, { "space", h = 21 },
      { "box", h = 1.5, draw = function(r) nova.ui.rect(r.x, r.y, r.w, r.h, C.divider) end }, { "space", h = 15 },
      { "text", open and ("Your rivals are other " .. class.name .. " cars.") or ("Locked: " .. why), style = "muted", size = 18, wrap = true,
        color = open and C.dim or C.gold } },
    { "row", anchor = "bottomright", y = 0, w = 390,
      { "text", class.name .. "  ·  " .. (open and "Open" or "Locked"), style = "muted", grow = 1 },
      { "text", locked and "" or (yours and "YOUR CAR" or "A TO CHOOSE"), font = F.heavy, size = 25.5, spacing = 0.04, color = yours and C.green or C.white, align = "right", w = 200 } },
    { "row", anchor = "bottomleft", y = 0, gap = 12, arrow(true), dots, arrow(false) },
  }
  ui.hints({ { "pad_dpad", "Look" }, { "pad_l", "" }, { "pad_r", "Class" }, { "pad_a", "Select" }, { "pad_b", "Back" } })
  return r, locked
end

function Title:pick_menu()
  local pick = self.pick
  local kind = pick.kind
  local r, locked
  if kind == "car" then r, locked = self:garage() else r = self:pick_list(kind, self:items(kind)) end
  if r.moved and r.focus and r.focus:match("^card") then self:set_pick(kind, tonumber(r.focus:sub(5))) end
  if r.changed == "tab" then self:set_class(r.step) end
  local back_to = pick.back_to or "select"
  if r.pressed then
    if (kind == "circuit" and course_locked(self:picked("circuit"))) or locked then
      audio.sfx("menu_back") -- (a locked course or class can be looked at, not chosen)
    else
      audio.sfx("menu_accept")
      self.screen, self.entered = back_to, 0
    end
  elseif r.back then
    if kind == "car" then state.car = pick.old; wear()
    else
      if state.mode ~= pick.old_mode then state.mode = pick.old_mode; backdrop.light() end
      self:set_pick(kind, pick.old)
    end
    state.laps = pick.old_laps
    self.screen, self.entered = back_to, 0
  end
end

function Title:draw_ui()
  if not transition.busy() then self:draw_screens() end
  transition.draw()
end

function Title:draw_screens()
  local w = nova.view()
  local screen = self.screen
  if screen == "icon" then return end
  if screen == "boxart" then
    -- the box art: the name large over the car, in the game's own type
    local _, h = nova.view()
    if w > h then
      local size = ui.fit("PINE RIDGE", 96, w * 0.45, F.title)
      ui.say(w * 0.05, h * 0.62, "PINE RIDGE", F.title, size, C.white)
      ui.say(w * 0.05 + 4, h * 0.62 + size * 0.95, "RALLY", F.bold, size * 0.4, C.orange, { spacing = 0.32 })
      return
    end
    local size = ui.fit("PINE RIDGE", 90, w * 0.9, F.title)
    ui.say(w / 2, 60, "PINE RIDGE", F.title, size, C.white, { align = "center" })
    ui.say(w / 2, 60 + size * 0.95, "RALLY", F.bold, size * 0.4, C.orange, { align = "center", spacing = 0.32 })
    return
  end
  if screen == "title" or screen == "starting" then self:title_screen()
  elseif screen == "menu" then self:main_menu()
  elseif screen == "howto" then self:howto_screen()
  elseif screen == "options" then self:options_menu()
  elseif screen == "controls" then self:controls_menu()
  elseif screen == "pick" then self:pick_menu()
  elseif screen == "select" then self:select_menu()
  end
  -- every screen fades up out of the backdrop when it opens
  local fade = 1 - math.min(1, (self.entered or 1) / 0.22)
  if fade > 0 then nova.ui.rect(0, 0, w, 540, { 0, 0, 0, math.floor(120 * fade * fade) }) end
end

return Title

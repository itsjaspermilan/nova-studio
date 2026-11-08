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

function Title:open_pick(kind)
  self.pick = { kind = kind, old_laps = state.laps, class = state.current_car().class, tabs = false }
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
  -- on the menu and the chooser the menu is on the left and the car moves to the right (easing across when the screen changes)
  local dt = self.t - (self.last_t or self.t)
  self.last_t = self.t
  local want = (self.screen == "menu" or self.screen == "select" or self.screen == "pick") and ((self.screen == "pick") and 4.4 or 2.6) or 0
  self.shift = (self.shift or 0) + (want - (self.shift or 0)) * math.min(1, dt * 5)
  if self.screen == "boxart" or self.screen == "icon" then
    -- (a landscape cover: the car moves over to the right, and the name is set on the left)
    local w, h = nova.view()
    backdrop.draw(0, self.screen, (self.screen == "boxart" and w > h) and 2.6 or 0)
    return
  end
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

-- ---- the menus -------------------------------------------------------------------------------------------------------
-- Each screen is a nova.ui.menu tree: what is on it, top to bottom, and where it sits on the screen. The engine lays it out, moves
-- the gold bar with the d-pad or the stick, remembers where it was, and says which button was pressed.

local function add(list, items) for _, it in ipairs(items) do list[#list + 1] = it end return list end
local function on_off(v) return v and "< On >" or "< Off >" end

function Title:main_menu()
  logo(self.t)
  local r = nova.ui.menu {
    id = "main", anchor = "left", margin = 60, y = 63, w = 340, enter = self.entered,
    { "button", "Race", id = "select" },
    { "button", "How to play", id = "howto" },
    { "button", "Options", id = "options" },
  }
  if r.back then self:go("title")
  elseif r.pressed then audio.sfx("menu_accept"); self:go(r.pressed) end
  ui.hints({ { "pad_a", "Accept" }, { "pad_b", "Back" } })
end

function Title:options_menu()
  local r = nova.ui.menu {
    id = "options", anchor = "top", y = 36, w = 420, enter = self.entered,
    { "text", "OPTIONS", style = "heading", size = 44 },
    { "space", h = 4 },
    { "button", "Music volume", value = string.format("< %d%% >", math.floor(state.music_volume * 100 + 0.5)), id = "music", adjust = true },
    { "button", "Sound volume", value = string.format("< %d%% >", math.floor(state.sfx_volume * 100 + 0.5)), id = "sound", adjust = true },
    { "button", "Music style", value = state.music_style == "kenney" and "< Kenney loops >" or "< Nova Studio songs >", id = "style", adjust = true },
    { "button", "Shadows", value = on_off(state.shadows), id = "shadows", adjust = true },
    { "button", "Effects", value = on_off(state.effects), id = "effects", adjust = true },
    { "button", "Smooth edges", value = on_off(state.smooth), id = "smooth", adjust = true },
    { "button", "Vibration", value = on_off(state.vibration), id = "vibration", adjust = true },
    { "button", "Controls...", id = "controls" },
  }
  ui.hints({ { "pad_a", "Change" }, { "pad_b", "Back" } })
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
  local root = { id = "controls", anchor = "top", y = 0, w = 700, enter = self.entered,
                 active = not self.listening and not self.just_listened,
                 { "text", "CONTROLS", style = "heading", size = 38 }, { "space", h = 4 } }
  self.just_listened = false
  for i, row in ipairs(controls.rows) do
    local waiting = self.listening and self.listen_row == i
    root[#root + 1] = { "button", row.label, value = waiting and "press a key or button..." or controls.describe(row), id = i, h = 32 }
  end
  root[#root + 1] = { "button", "Back to the defaults", id = "defaults", h = 32 }
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
  local panel = { "panel", pad = { 24, 12 }, gap = 6 }
  for _, row in ipairs(CONTROLS) do
    local pads = { "row", w = 100, gap = 2 }
    for _, icon in ipairs(row[3] or {}) do pads[#pads + 1] = { "image", "ui/" .. icon, w = 30, h = 30 } end
    panel[#panel + 1] = { "row", h = 30, gap = 0,
      { "text", row[1], size = 20, color = ui.color.gold, w = 216 }, pads, { "space", w = 16 }, { "text", row[2], size = 17 } }
  end
  add(panel, {
    { "space", h = 2 },
    { "text", "Finish all the laps ahead of your rivals.", size = 16, align = "center" },
    { "text", "The grass slows you down; the handbrake lets the back out.", size = 16, align = "center" },
  })
  nova.ui.layout { anchor = "top", margin = 40, w = 660, gap = 14, { "text", "HOW TO PLAY", style = "heading", size = 38 }, panel }
  ui.hints({ { "pad_a", "Back" } })
end

function Title:select_menu()
  local info = state.current_track()
  local labels = {
    circuit = { state.mode == "rally" and "Stage" or "Circuit", info.name .. "  >" },
    mode = { "Mode", ({ race = "Race", trial = "Time trial", rally = "Rally" })[state.mode] .. "  >" },
    car = { "Car", state.current_car().name .. "  >" },
    laps = { "Laps", "< " .. state.laps .. " >" },
    difficulty = { "Difficulty", "< " .. state.current_difficulty().name .. " >" },
    start = { ({ race = "START RACE", trial = "START TIME TRIAL", rally = "START RALLY" })[state.mode] },
  }
  -- (the menu and its notes are on the left, so that the car turning behind them can be seen on the right)
  local root = { id = "select", anchor = "topleft", margin = 40, w = 400, enter = self.entered,
                 { "text", "CHOOSE YOUR RACE", style = "title", align = "center" }, { "space", h = 5 } }
  for _, id in ipairs(self:select_rows()) do
    local l = labels[id]
    root[#root + 1] = { "button", l[1], value = l[2], id = id, adjust = id ~= "start" }
  end
  local on_difficulty = nova.ui.focus("select") == "difficulty"
  local note = on_difficulty and state.current_difficulty().blurb
    or (state.mode == "race" and info.blurb) or (state.mode == "rally" and info.blurb)
    or "Alone on the circuit, racing the ghost of your best lap."
  local bests
  if state.mode == "rally" then
    bests = { { "BEST SCORE", tostring(nova.save.get("rally_score_" .. info.id, "-")) }, { "BEST TIME", ui.time(state.best("rally", info.id)) } }
  else
    bests = { { "BEST " .. state.laps .. " LAPS", ui.time(state.best("race" .. state.laps, info.id)) }, { "BEST LAP", ui.time(state.best("lap", info.id)) } }
  end
  local notes = { "panel", h = 112, pad = { 16, 10 }, gap = 2, { "text", note, wrap = true, h = 44, color = ui.color.white } }
  for _, b in ipairs(bests) do
    notes[#notes + 1] = { "row", h = 26, { "text", b[1], style = "label", w = 124 }, { "text", b[2], style = "mono" } }
  end
  add(root, { { "space", h = 6 }, notes })
  local r = nova.ui.menu(root)
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Accept" }, { "pad_b", "Back" } })

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

-- the cards of the three pick pages, drawn into the rectangle the grid gives each one (on an opaque panel, so that the gold of the
-- chosen card shows only round its edge)
local CARDS = {}
local CARD_PANEL = { tint = { 255, 255, 255, 255 } }

function CARDS.circuit(r, n)
  -- the course's shape on the left; on the right its name, then one line each for the level and length, the best, and the par or
  -- sections (each line fitted to the card: nothing runs past its edge). The blurb is under the grid, for the chosen card.
  local item, items = n.item, n.items
  local x, y, w, h = r.x, r.y, r.w, r.h
  local size = h - 22
  local open = state.course_open(items, item)
  local tx, tw = x + size + 22, w - size - 34
  if open then
    course(item.id, x + 11, y + 11, size)
  else
    nova.ui.rect(x + 11, y + 11, size, size, { 20, 24, 36, 160 })
    ui.center("LOCKED", y + h / 2 - 8, ui.fit("LOCKED", 14, size - 8, "mono"), ui.color.dim, { cx = x + 11 + size / 2, font = "mono" })
  end
  nova.ui.text(tx, y + 9, item.name, { size = 20, width = tw, fit = "shrink", color = open and ui.color.white or ui.color.dim, shadow = true, font = "rounded" })
  local level = item.level or 1
  local mono = function(text, ty, colour)
    nova.ui.text(tx, ty, text, { size = 13, width = tw, fit = "shrink", color = colour, shadow = true, font = "mono" })
  end
  local length = item.km and (item.km .. " KM") or (item.laps .. " LAPS")
  ui.text(tx, y + 37, string.upper(state.levels[level]), 13, LEVEL_COLOR[level], { font = "mono" })
  ui.right(length, tx + tw, y + 37, 13, ui.color.dim, { font = "mono" })
  if not open then
    mono("Not open yet", y + 58, ui.color.gold)
  elseif item.km then
    mono("BEST " .. tostring(nova.save.get("rally_score_" .. item.id, "-")), y + 58, ui.color.gold)
    mono((item.sections or 5) .. " SECTIONS", y + 75, ui.color.dim)
  else
    mono("BEST " .. ui.time(state.best("lap", item.id)), y + 58, ui.color.gold)
    local par = (pars.laps[item.id] or {})[state.current_car().class]
    if par then mono("PAR  " .. ui.time(par), y + 75, ui.color.dim) end
  end
end

function CARDS.mode(r, n)
  ui.text(r.x + 20, r.y + 24, n.item.name, 30, ui.color.white, { font = "bold" })
  nova.ui.text(r.x + 20, r.y + 74, n.item.blurb, { size = 17, color = { 214, 224, 238 }, width = r.w - 40, fit = "wrap", height = r.h - 84, shadow = true, font = "rounded" })
end

function CARDS.car(r, n)
  local item, x, y, w, h = n.item, r.x, r.y, r.w, r.h
  nova.ui.text(x + 12, y + 8, item.name, { size = 20, width = w - 24, fit = "shrink", color = ui.color.white, shadow = true, font = "rounded" })
  bar(x + 12, y + 38, w - 82, "POWER", (item.power - 6) / 6.5)
  bar(x + 12, y + 52, w - 82, "SPEED", (item.top - 28) / 24)
  bar(x + 12, y + 66, w - 82, "GRIP", (item.grip - 0.75) / 0.7)
  bar(x + 12, y + 80, w - 82, "DRIFT", item.oversteer)
  if n.locked then nova.ui.rect(x, y, w, h, { 0, 0, 0, 150 }) end
end

-- The pages that list the choices for Circuit, Mode and Car as a grid (from the chooser, A on one of those rows). Moving over a card
-- tries it (the backdrop and the car change behind), A keeps it and B puts back what there was.
function Title:pick_menu()
  local pick = self.pick
  local kind = pick.kind
  local items, g = self:items(kind), GRIDS[kind]
  local title = ({ circuit = state.mode == "rally" and "CHOOSE A STAGE" or "CHOOSE A CIRCUIT", mode = "CHOOSE A MODE", car = "CHOOSE A CAR" })[kind]
  local locked = kind == "car" and class_locked(pick.class)
  local root = { id = "pick_" .. kind, anchor = "topleft", margin = 34, w = RIGHT - LEFT, wrap = false, enter = false, gap = 8,
                 { "text", title, style = "title", size = kind == "car" and 30 or 36 } }
  if kind == "car" then
    -- a tab for each class (the chosen class is yellow; with the focus on it, it has a frame round it and left and right change class)
    local tabs = { "row", gap = 6 }
    local count = #state.classes
    for k, c in ipairs(state.classes) do
      local on = c.id == pick.class
      tabs[#tabs + 1] = { "button", state.class_open(c) and c.name or (c.name .. " *"), look = "tab", on = on, id = on and "tab" or ("class" .. k),
                          focusable = on, adjust = true, w = (RIGHT - LEFT - 6 * (count - 1)) / count, h = 34 }
    end
    local class = state.class_of({ class = pick.class })
    local open, why = state.class_open(class)
    add(root, { tabs, { "panel", h = 52, pad = { 14, 6 }, gap = 2,
      { "text", class.blurb, size = 14 },
      { "text", open and ("Your rivals are other " .. class.name .. " cars.") or ("LOCKED: " .. why), size = 14, color = open and ui.color.gold or ui.color.red } } })
  end
  root[#root + 1] = { "space", h = kind == "mode" and 52 or 2 }
  local grid = { "grid", columns = g.cols, cell_w = g.card_w, cell_h = g.card_h, gap = g.gap, flow = true, visible = g.rows }
  for i, item in ipairs(items) do
    grid[#grid + 1] = { "box", id = "card" .. i, focusable = not locked, panel = CARD_PANEL, item = item, items = items, locked = locked, draw = CARDS[kind] }
  end
  root[#root + 1] = grid
  if kind == "circuit" then
    -- the chosen course's blurb (or what opens it), under the grid
    local item = items[self:picked("circuit")]
    local open, why = state.course_open(items, item)
    root.h = 476 - 34
    add(root, { { "space", h = 8 }, { "panel", grow = 1, pad = { 14, 10 }, { "text", open and item.blurb or ("Locked: " .. why), wrap = true, size = 15, color = open and ui.color.white or ui.color.gold } } })
  end
  local r = nova.ui.menu(root)
  if kind == "car" then
    ui.hints({ { "pad_dpad", "Look" }, { "pad_l", "Class" }, { "pad_r", "Class" }, { "pad_a", "Accept" }, { "pad_b", "Cancel" } })
  else
    ui.hints({ { "pad_dpad", "Look" }, { "pad_a", "Accept" }, { "pad_b", "Cancel" } })
  end

  if r.moved and r.focus and r.focus:match("^card") then self:set_pick(kind, tonumber(r.focus:sub(5))) end
  if r.changed == "tab" then self:set_class(r.step) end
  if r.pressed then
    if (kind == "circuit" and course_locked(self:picked("circuit"))) or locked then
      audio.sfx("menu_back") -- (a locked course or class can be looked at, not chosen)
    else
      audio.sfx("menu_accept")
      self.screen, self.entered = "select", 0
    end
  elseif r.back then
    if kind == "car" then state.car = pick.old; wear() else self:set_pick(kind, pick.old) end
    state.laps = pick.old_laps
    self.screen, self.entered = "select", 0
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
    -- the box art: the title large at the top, the car below (the picture is made 3 wide to 4 tall)
    local _, h = nova.view()
    if w > h then
      local size = ui.fit("PINE RIDGE", 78, w * 0.45, "thick")
      ui.text(w * 0.05, h * 0.64, "PINE RIDGE", size, ui.color.gold, { font = "thick" })
      ui.text(w * 0.05 + size * 0.1, h * 0.64 + size * 1.08, "RALLY", size * 0.95, ui.color.white, { font = "bold" })
      return
    end
    local size = ui.fit("PINE RIDGE", 70, w * 0.92, "thick")
    ui.center("PINE RIDGE", 62, size, ui.color.gold, { font = "thick" })
    ui.center("RALLY", 62 + size * 1.05, size * 0.85, ui.color.white, { font = "bold" })
    return
  end
  if screen == "title" or screen == "starting" then
    logo(self.t)
    if screen == "title" and math.floor(self.t * 1.6) % 2 == 0 then ui.center("PRESS START", 420, 28, ui.color.white) end
    if screen == "title" then ui.hints({ { "pad_a", "Accept" } }) end
    ui.center("Made by Jasper Milan", 496, 16, ui.color.white, { font = "future_narrow" })
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

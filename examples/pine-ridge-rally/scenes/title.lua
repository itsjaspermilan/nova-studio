-- The front of the game: the title card, the main menu, how to play, options, the garage, and getting a race ready.
-- They are screens of one scene, so the music keeps playing between them.
--
-- Getting a race ready (2026-11-08): the main menu's RALLY, CIRCUIT or TIME TRIAL is the mode; then the track (the stages, or the circuits),
-- then the car (the garage's stage and carousel, where a car can also be bought), then for a circuit the laps, and last a page with all of it and a big
-- RACE button. B goes back a step at a time. The difficulty is the track's own (its level); the tracks open one after another.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local controls = require("lib.controls")
local backdrop = require("lib.backdrop")
local menu_bg = require("lib.menu_bg")
local garage = require("lib.garage")
local previews = require("lib.previews")
local transition = require("lib.transition")

local Title = nova.scene {}

-- (the pictures are the handheld's buttons, as a Nintendo-style pad labels them)
local CONTROLS = {
  { "Steer", "Left / Right  ·  A / D", { "pad_stick_l" } },
  { "Accelerate", "Up  ·  W", { "pad_zr" } },
  { "Brake / reverse", "Down  ·  S", { "pad_zl" } },
  { "Handbrake (slides)", "Space", { "pad_b", "pad_r" } },
  { "Back on the road", "R", { "pad_select" } },
  { "Change camera", "C", { "pad_l" } },
  { "Look around", "Q / E  (press the stick: look back)", { "pad_stick_r" } },
  { "Pause", "Esc  ·  P", { "pad_start" } },
}

local MODE_NAMES = { race = "Circuit", trial = "Time trial", rally = "Rally" }
local MODE_BLURBS = {
  rally = "A point-to-point stage in sections, scored on each section's time.",
  race = "Three rivals on the road with you, over the laps you choose.",
  trial = "Alone on a circuit, against the ghost of your best lap.",
}

function Title:enter(screen)
  menu_bg.setup()
  -- (2026-11-08: the game opens on the main menu; there is no PRESS START card before it)
  if screen == "select" or screen == "title" or screen == nil then screen = "menu" end
  self.screen = screen
  -- (the menus remember their focus while the title scene is up, going between its screens; coming back from a race they start again
  -- on their first row)
  for _, id in ipairs({ "main", "options", "controls", "pick_track", "garage", "laps", "confirm" }) do nova.ui.forget(id) end
  self.t = 0
  self.entered = 0
  audio.music("menu", { volume = 0.95, fade = 0.8 })
  state.apply_volumes()
end

function Title:leave() menu_bg.leave(); backdrop.leave() end

function Title:go(screen)
  self.screen, self.entered = screen, 0
end

-- the courses of the mode chosen, and which of them is chosen
local function course_list() return state.mode == "rally" and state.stages or state.tracks end
local function course_index() return state.mode == "rally" and state.stage or state.track end
local function set_course(i)
  if state.mode == "rally" then state.stage = i else state.track = i; state.laps = state.current_track().laps end
end

-- ---- the steps of getting a race ready ------------------------------------------------------------------------------------------
function Title:open_track()
  self.old_course = course_index()
  nova.ui.forget("pick_track")
  nova.ui.focus("pick_track", "card" .. course_index())
  self:go("track")
end

-- `from` is "menu" (the garage of the main menu: look, buy, pick the car you drive) or "flow" (choosing the car for this race)
function Title:open_garage(from)
  self.garage_from = from
  self.chosen = state.car
  self.buying = nil
  self.note = nil
  local list = state.showroom()
  local at = 1
  for i, c in ipairs(list) do if c.id == state.current_car().id then at = i end end
  self.gar = garage.new(list, at)
  self:go("garage")
end

-- after the car: the laps (a circuit race), or straight to the page with everything on it
function Title:after_car()
  if state.mode == "race" then
    nova.ui.forget("laps")
    self:go("laps")
  else
    self:open_confirm()
  end
end

function Title:open_confirm()
  nova.ui.forget("confirm")
  self:go("confirm")
end

function Title:start_race()
  state.save_options()
  audio.stop_music(0.6)
  nova.log(string.format("menu: start %s on %s in %s", state.mode, state.current_track().id, state.current_car().id))
  transition.cover(transition.race_spec(), function() nova.goto_scene(state.current_track().id) end)
  self.screen = "starting"
end

-- (the menus themselves, and what their buttons do, are in draw_ui: nova.ui.menu reads the pad as it draws. This is the rest.)
function Title:update(dt)
  self.t = self.t + dt
  self.entered = (self.entered or 0) + dt
  ui.tick(dt)
  transition.update(dt)
  local screen = self.screen
  -- (F12 and F11 make the store pictures, from the main menu)
  if screen == "menu" and nova.input.pressed("art_box") then self.screen = "boxart"; backdrop.light()
  elseif screen == "menu" and nova.input.pressed("art_icon") then self.screen = "icon"; backdrop.light()
  elseif screen == "garage" and self.gar and nova.input.pressed("stats") then
    -- (F3, for the tests and for looking: what the stage shows and how it turns)
    local st = self.gar
    nova.log(string.format("garage: speed=%.3f angle=%.3f tilt=%.3f hand=%d car=%s make=%s", st.omega, st.ang, st.tilt, st.hand and 1 or 0,
      st.list[st.cur].id, st.list[st.cur].make))
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
  end
end

function Title:draw()
  local dt = self.t - (self.last_t or self.t)
  self.last_t = self.t
  local screen = self.screen
  if screen == "boxart" or screen == "icon" then
    -- (the store pictures: the car on its road, as the menus used to show it; a landscape cover has the car to the right)
    local w, h = nova.view()
    backdrop.draw(0, screen, (screen == "boxart" and w > h) and 2.6 or 0)
    return
  end
  menu_bg.setup()
  if screen == "garage" and self.gar then garage.draw3d(self.gar) end
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

-- the dark ground most pages sit on (the backdrop shows a little through it)
local function ground(alpha)
  local w = nova.view()
  nova.ui.rect(0, 0, w, 540, { C.ground[1], C.ground[2], C.ground[3], math.floor(255 * alpha) })
end


-- what a course pays, as the menus say it
local function prize_text(item)
  if state.mode == "rally" then return state.money(state.reward(item, { stars = 3 })) .. " for 3 stars" end
  if state.mode == "trial" then return state.money(state.reward(item, { trial = true })) .. ", more for a lap record" end
  return state.money(state.reward(item, { place = 1, laps = state.laps })) .. " for 1st"
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
  -- the career so far, top right: the coins, the cars, and how far through the stages and the circuits
  local owned = #state.owned()
  local rects = nova.ui.layout { anchor = "topright", margin = 36, w = 330, pad = { 18, 13 }, gap = 2, id = "career",
    panel = { color = C.panel }, x = 0, y = -3,
    { "text", "YOUR CAREER", style = "kicker" },
    { "text", state.money(state.coins()) .. " COINS", font = F.heavy, size = 33, color = C.gold },
    { "space", h = 4 },
    line("Cars", owned == 0 and "None yet: visit the garage" or (owned .. " of " .. #state.cars)),
    line("Rally stages", state.courses_done(state.stages) .. " of " .. #state.stages),
    line("Circuits", state.courses_done(state.tracks) .. " of " .. #state.tracks) }
  local u = rects.career
  nova.ui.rect(u.x, u.y, 6, u.h, C.orange)
  local r = nova.ui.menu {
    id = "main", anchor = "topleft", margin = 0, x = 48, y = 172, w = 352, enter = self.entered,
    { "button", "RALLY", id = "rally", h = 40 },
    { "button", "CIRCUIT", id = "race", h = 40 },
    { "button", "TIME TRIAL", id = "trial", h = 40 },
    { "button", "GARAGE", id = "garage", h = 40 },
    { "button", "HOW TO PLAY", id = "howto", h = 40 },
    { "button", "OPTIONS", id = "options", h = 40 },
    { "button", "QUIT", id = "quit", h = 40 },
  }
  ui.hints({ { "pad_a", "Select" } })
  if r.pressed then
    audio.sfx("menu_accept")
    local id = r.pressed
    if id == "race" or id == "trial" or id == "rally" then
      state.mode = id
      self:open_track()
    elseif id == "garage" then
      self:open_garage("menu")
    elseif id == "quit" then
      nova.quit() -- (saves and closes the game; on Android it does nothing: the system closes apps there)
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
    id = "options", anchor = "topleft", margin = 0, x = 48, y = 142, w = 440, enter = self.entered,
    { "button", "MUSIC VOLUME", value = string.format("< %d%% >", math.floor(state.music_volume * 100 + 0.5)), id = "music", adjust = true, h = 38 },
    { "button", "SOUND VOLUME", value = string.format("< %d%% >", math.floor(state.sfx_volume * 100 + 0.5)), id = "sound", adjust = true, h = 38 },
    { "button", "MUSIC STYLE", value = state.music_style == "kenney" and "< Kenney loops >" or "< Nova Studio songs >", id = "style", adjust = true, h = 38 },
    { "button", "SHADOWS", value = on_off(state.shadows), id = "shadows", adjust = true, h = 38 },
    { "button", "EFFECTS", value = on_off(state.effects), id = "effects", adjust = true, h = 38 },
    { "button", "SMOOTH EDGES", value = on_off(state.smooth), id = "smooth", adjust = true, h = 38 },
    { "button", "VIBRATION", value = on_off(state.vibration), id = "vibration", adjust = true, h = 38 },
    { "button", "CONTROLS", id = "controls", h = 38 },
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
  if id == "effects" then state.effects = not state.effects end
  if id == "smooth" then state.smooth = not state.smooth end
  if id == "vibration" then
    state.vibration = not state.vibration
    if state.vibration then nova.input.rumble(0.6, 0.15) end
  end
  state.save_options()
end

function Title:controls_menu()
  page("Options", "Controls", 640)
  local root = { id = "controls", anchor = "topleft", margin = 0, x = 48, y = 130, w = 530, enter = self.entered, gap = 2,
                 active = not self.listening and not self.just_listened }
  self.just_listened = false
  for i, row in ipairs(controls.rows) do
    local waiting = self.listening and self.listen_row == i
    root[#root + 1] = { "button", string.upper(row.label), value = waiting and "Press a key or button..." or controls.describe(row), id = i, h = 30 }
  end
  root[#root + 1] = { "button", "BACK TO THE DEFAULTS", id = "defaults", h = 30 }
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
    panel[#panel + 1] = { "row", h = 26, gap = 0,
      { "text", string.upper(row[1]), font = F.heavy, size = 21, color = C.orange, w = 230, spacing = 0.03 }, pads, { "space", w = 18 },
      { "text", row[2], font = F.medium, size = 18, color = C.dim, grow = 1 } }
    panel[#panel + 1] = { "box", h = 1.5, draw = function(r) nova.ui.rect(r.x, r.y, r.w, r.h, C.divider) end }
  end
  add(panel, {
    { "space", h = 4 },
    { "text", "Finish all the laps ahead of your rivals. The grass slows you down; the handbrake lets the back out.", style = "body", wrap = true },
    { "text", "Finishes pay coins for faster cars in the Garage; do well to open the next track.", style = "body", wrap = true },
  })
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 134, panel }
  ui.hints({ { "pad_b", "Back" } })
end

-- each level's colour
local LEVEL_COLOR = { { 74, 222, 128 }, { 56, 189, 248 }, { 251, 146, 60 }, { 239, 68, 68 } }

local function level_row(item)
  return { "row", h = 27, { "text", "Difficulty", style = "muted", grow = 1 },
    { "text", string.upper(level_name(item.level)), font = F.bold, size = 18, color = LEVEL_COLOR[item.level or 1], spacing = 0.06, w = 90, align = "right" },
    { "space", w = 10 }, segments(item.level or 1, 4) }
end

-- The tracks of the mode: a list on the left (locked ones with a padlock, finished ones with their number in green), the route and facts of
-- the one under the focus on the right. A on an open one goes on to the car; B back to the main menu.
function Title:track_menu()
  local items = course_list()
  local on = course_index()
  local item = items[on] or items[1]
  local list = { "column", flow = true, visible = 6, gap = 4.5 }
  for i, c in ipairs(items) do
    local open = state.course_open(items, c)
    local best = c.km and state.best("rally", c.id) or state.best("lap", c.id)
    list[#list + 1] = { "button", string.upper(c.name), id = "card" .. i, look = "row", number = i, h = 51, locked = not open,
                        done = state.progress(items, c.id) ~= nil, value = best and ui.time(best) or "No time set" }
  end
  local open, why = state.course_open(items, item)
  local f = facts(item)
  local cells = { "row", gap = 9 }
  for _, fact in ipairs(f) do cells[#cells + 1] = cell(fact[1], fact[2], 115) end
  local best_label, best_value
  if item.km then best_label, best_value = "Best score", tostring(nova.save.get("rally_score_" .. item.id, "-"))
  else best_label, best_value = "Best lap", ui.time(state.best("lap", item.id)) end
  local right = { "panel", anchor = "topright", y = 86, w = 507, h = 352, pad = 0, gap = 0,
    { "box", h = 172, draw = function(r) if open then route(item.id, r, 22) else ui.lock(r.x + r.w / 2 - 24, r.y + r.h / 2 - 24, 48, C.dim) end end },
    { "column", pad = { 18, 0 }, gap = 6, cells,
      open and line(best_label, best_value, C.gold) or { "text", "Locked: " .. why, font = F.semi, size = 18, color = C.gold, h = 27, wrap = true },
      line("Prize", prize_text(item), C.gold),
      level_row(item) } }
  menu_bg.flags(self.t)
  local kicker = MODE_NAMES[state.mode] .. (state.mode == "rally" and "  ·  Stages" or "  ·  Circuits")
  local r = nova.ui.menu {
    id = "pick_track", kind = "stack", w = "100%", h = 450, margin = 36, wrap = false, enter = false,
    { "column", anchor = "topleft", y = -9, ui.header(kicker, item.name, 45) },
    { "column", anchor = "topleft", y = 86, w = 352, list },
    right,
  }
  ui.hints({ { "pad_dpad", "Look" }, { "pad_a", "Select" }, { "pad_b", "Back" } })
  if r.moved and r.focus and r.focus:match("^card") then set_course(tonumber(r.focus:sub(5))) end
  if r.pressed then
    if not state.course_open(items, items[course_index()]) then
      audio.sfx("menu_back") -- (a locked course can be looked at, not chosen)
    else
      audio.sfx("menu_accept")
      self:open_garage("flow")
    end
  elseif r.back then
    set_course(self.old_course or 1)
    self:go("menu")
  end
end

-- The garage (2026-11-21, lib/garage.lua draws it): one car at a time on the stage, turning slowly or by the right stick; along the bottom a
-- carousel of cards, the make's logo and the car's name on each; beside the car its details. Left and right move one car (hold to keep
-- going), L and R jump to the next make. A picks a car of yours; on one you do not have, A asks and a second A buys it, if the coins are there.
local STATS = { { "Power", function(c) return (c.power - 6) / 6.5 end }, { "Top speed", function(c) return (c.top - 28) / 24 end },
                { "Grip", function(c) return (c.grip - 0.75) / 0.7 end }, { "Drift", function(c) return c.oversteer end } }

function Title:garage_menu()
  local st = self.gar
  local list = st.list
  local w = nova.view()
  local dt = math.min(0.1, self.t - (st.last_t or self.t))
  st.last_t = self.t
  local flow = self.garage_from == "flow"

  -- the stage: the right stick turns the car (up and down tip the view), the slide and the carousel move on
  local was, hand = garage.update(st, dt, nova.input.axis("look_x"), nova.input.axis("look_y"))
  if was ~= hand then nova.log(string.format("garage: %s turn (angle %.2f)", hand and "hand" or "slow", st.ang)) end

  -- left and right move one car, and keep moving while held; L and R jump to the next make
  local down = (nova.input.down("right") and 1 or 0) - (nova.input.down("left") and 1 or 0)
  local step = 0
  if down ~= 0 then
    if st.held ~= down then
      st.held, st.hold_t, step = down, 0, down
    else
      st.hold_t = st.hold_t + dt
      if st.hold_t >= 0.4 then st.hold_t, step = st.hold_t - 0.17, down end
    end
  else
    st.held = 0
  end
  local jump = (nova.input.pressed("r1") and 1 or 0) - (nova.input.pressed("l1") and 1 or 0)
  if jump ~= 0 then step = garage.make_jump(st, jump) end
  if step ~= 0 then
    garage.move(st, step)
    audio.sfx("menu_move")
    self.buying, self.note = nil, nil
    state.car = state.index_of(list[garage.index(st)].id)
    nova.log(string.format("garage: shows %s (%s)", list[garage.index(st)].id, list[garage.index(st)].make))
  end

  local on = garage.index(st)
  local car = list[on]
  local make = state.make_of(car)
  local owned = state.owns(car.id)
  local class = state.class_of(car)
  local coins = state.coins()

  -- the header, and the coins
  nova.ui.layout { anchor = "topleft", margin = 0, x = 36, y = 14, ui.header(flow and (MODE_NAMES[state.mode] .. "  ·  " .. state.current_track().name) or "Garage",
    flow and "Choose your car" or "Buy and choose cars", 32) }
  nova.ui.layout { anchor = "topright", margin = 36, y = -2, { "column", gap = 0,
    { "text", "YOUR COINS", style = "kicker", align = "right" },
    { "text", state.money(coins), font = F.heavy, size = 30, color = C.gold, align = "right" } } }

  -- what A does here, and what the car is
  local status, action, colour
  if owned then
    status, colour = (state.cars[self.chosen] == car) and "You drive this car." or "One of your cars.", C.green
    action = flow and "RACE IN IT" or ((state.cars[self.chosen] == car) and "" or "DRIVE IT")
  elseif self.buying == on then
    status, colour = "Buy it for " .. state.money(car.price) .. " coins?", C.gold
    action = "AGAIN: BUY IT"
  elseif coins >= car.price then
    status, colour = "Costs " .. state.money(car.price) .. " coins.", C.gold
    action = "BUY IT"
  else
    status, colour = "Costs " .. state.money(car.price) .. ". Needs " .. state.money(car.price - coins) .. " more.", C.red
    action = ""
  end
  local stats = { "column", gap = 4 }
  for _, s in ipairs(STATS) do
    local v = math.max(0, math.min(1, s[2](car)))
    add(stats, { { "row", h = 22, gap = 8, align = "center",
      { "text", s[1], font = F.medium, size = 16, w = 84 },
      { "box", grow = 1, h = 7, draw = function(r) nova.ui.rect(r.x, r.y, r.w, r.h, C.divider); nova.ui.rect(r.x, r.y, r.w * v, r.h, C.orange) end },
      { "text", tostring(math.floor(v * 100 + 0.5)), font = F.medium, size = 16, color = C.dim, w = 30, align = "right" } } })
  end
  local rects = nova.ui.layout { anchor = "topleft", margin = 0, x = 36, y = 74, w = 262, id = "pane", pad = { 16, 12 }, gap = 0,
    panel = { color = { C.panel[1], C.panel[2], C.panel[3], 235 } },
    { "row", gap = 12, align = "center",
      { "image", make.logo, w = 76, h = 76 },
      { "column", gap = 0, grow = 1,
        { "text", string.upper(make.name), font = F.heavy, size = 30, color = make.color, spacing = 0.06 },
        { "text", string.upper(class.name), style = "kicker", size = 15 } } },
    { "space", h = 6 },
    { "text", string.upper(car.name), font = F.title, size = ui.fit(string.upper(car.name), 38, 228, F.title) },
    { "space", h = 8 }, stats, { "space", h = 8 },
    { "text", self.note or status, font = F.semi, size = 16, color = self.note and C.red or colour, wrap = true } }
  local p = rects.pane
  nova.ui.rect(p.x, p.y, 5, p.h, make.color)

  -- the A button's job, under the car on the right
  if action ~= "" then
    local tw = nova.ui.text_width(action, { font = F.heavy, size = 24, spacing = 0.04 })
    nova.ui.rect(w - 36 - tw - 66, 324, tw + 66, 38, { C.ground[1], C.ground[2], C.ground[3], 200 })
    nova.ui.sprite("ui/pad_a", w - 36 - tw - 66 + 20, 343, { w = 28, h = 28 })
    ui.say(w - 36 - 14, 343, action, F.heavy, 24, C.white, { align = "right", valign = "middle", spacing = 0.04 })
  end

  -- the carousel along the bottom, over a dark band
  nova.ui.rect(0, 372, w, 114, { C.ground[1], C.ground[2], C.ground[3], 170 })
  garage.carousel(st, 429, self.chosen)
  ui.hints({ { "pad_stick_r", "Turn" }, { "pad_l", "" }, { "pad_r", "Make" }, { "pad_dpad", "Car" },
             { "pad_a", owned and (flow and "Race in it" or "Drive it") or "Buy" }, { "pad_b", "Back" } })

  if nova.input.pressed("a") or nova.input.pressed("start") then
    if owned then
      audio.sfx("menu_accept")
      self.chosen = state.car
      state.save_options()
      nova.log("garage: chose " .. car.id)
      if flow then self:after_car() end
    elseif self.buying == on then
      if state.buy(car) then
        audio.sfx("finish")
        self.chosen, self.buying = state.car, nil
        state.save_options()
      end
    elseif coins >= car.price then
      audio.sfx("menu_move")
      self.buying = on
    else
      audio.sfx("menu_back")
      self.note = "Not enough coins yet: race to earn more."
    end
  elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then
    audio.sfx("menu_back")
    if self.buying then self.buying = nil
    else
      state.car = self.chosen
      if flow then self:go("track")
      else self:go("menu") end
    end
  end
end

-- the side of the laps and confirm pages: the track's route and its facts
function Title:course_panel(extra)
  local item = state.current_track()
  local f = facts(item)
  local side = { "panel", anchor = "topright", margin = 36, w = 360, pad = { 18, 14 }, gap = 3, y = -6, id = "side",
    { "text", string.upper(level_name(item.level)) .. "  ·  " .. string.upper(f[2][2]), style = "kicker" },
    { "text", string.upper(item.name), font = F.heavy, size = 30 },
    { "box", h = 150, draw = function(r) route(item.id, r, 16) end } }
  add(side, extra or {})
  local sr = nova.ui.layout(side).side
  nova.ui.rect(sr.x, sr.y, 6, sr.h, C.orange)
end

-- A circuit race: how many laps (left and right), then on.
function Title:laps_menu()
  menu_bg.flags(self.t)
  ui.side_panel(500)
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 30, ui.header("Circuit  ·  " .. state.current_track().name, "How many laps?", 48) }
  local info = state.current_track()
  self:course_panel({ line("Best " .. state.laps .. (state.laps == 1 and " lap" or " laps"), ui.time(state.best("race" .. state.laps, info.id)), C.gold),
    line("Prize", prize_text(info), C.gold) })
  local r = nova.ui.menu {
    id = "laps", anchor = "topleft", margin = 0, x = 48, y = 142, w = 384, enter = self.entered,
    { "button", "LAPS", value = "< " .. state.laps .. " >", id = "laps", adjust = true },
    { "button", "CONTINUE", id = "go" },
  }
  ui.hints({ { "pad_dpad", "Laps" }, { "pad_a", "Continue" }, { "pad_b", "Back" } })
  if r.changed == "laps" and r.step then state.laps = math.max(1, math.min(5, state.laps + r.step)) end
  if r.pressed then
    audio.sfx("menu_accept")
    self:open_confirm()
  elseif r.back then
    self:open_garage("flow")
  end
end

-- Everything chosen, and a big RACE button.
function Title:confirm_menu()
  menu_bg.flags(self.t)
  ui.side_panel(500)
  local info = state.current_track()
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 30, ui.header(MODE_NAMES[state.mode], "Ready to race", 48) }
  local rows = { "column", gap = 0, w = 384,
    line("Mode", MODE_NAMES[state.mode]),
    line(state.mode == "rally" and "Stage" or "Circuit", info.name),
    line("Car", state.current_car().name) }
  if state.mode == "race" then rows[#rows + 1] = line("Laps", tostring(state.laps)) end
  if state.mode ~= "trial" then rows[#rows + 1] = line("Difficulty", level_name(info.level), LEVEL_COLOR[info.level or 1]) end
  rows[#rows + 1] = line("Prize", prize_text(info), C.gold)
  nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 142, rows }
  self:course_panel({ { "text", MODE_BLURBS[state.mode], style = "muted", wrap = true } })
  local r = nova.ui.menu {
    id = "confirm", anchor = "topleft", margin = 0, x = 48, y = 348, w = 384, enter = self.entered,
    { "button", "RACE", id = "race", h = 78, size = 48 },
  }
  ui.hints({ { "pad_a", "Race" }, { "pad_b", "Back" } })
  if r.pressed then
    audio.sfx("menu_accept")
    self:start_race()
  elseif r.back then
    if state.mode == "race" then self:go("laps") else self:open_garage("flow") end
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
  -- (the garage's back is in 3D, behind its cars; every other page has the flags)
  if screen ~= "garage" and screen ~= "track" and screen ~= "laps" and screen ~= "confirm" then menu_bg.flags(self.t) end
  if screen == "starting" then self:title_screen()
  elseif screen == "menu" then self:main_menu()
  elseif screen == "howto" then self:howto_screen()
  elseif screen == "options" then self:options_menu()
  elseif screen == "controls" then self:controls_menu()
  elseif screen == "track" then self:track_menu()
  elseif screen == "garage" then self:garage_menu()
  elseif screen == "laps" then self:laps_menu()
  elseif screen == "confirm" then self:confirm_menu()
  end
  -- every screen fades up when it opens
  local fade = 1 - math.min(1, (self.entered or 1) / 0.22)
  if fade > 0 then nova.ui.rect(0, 0, w, 540, { 0, 0, 0, math.floor(120 * fade * fade) }) end
end

return Title

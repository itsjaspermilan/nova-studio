-- The front of the game: the title card, the main menu, the choice of pace (for Endless and the Garbage battle), the list of puzzles and the options.
-- They are screens of one scene, so the music keeps playing between them. A screen slides out as another slides in.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local backdrop = require("lib.backdrop")
local transition = require("lib.transition")
local puzzles = require("lib.puzzles")

local Title = nova.scene {}

local MENU = { "Endless", "Puzzle", "Garbage battle", "Options" }
local MODES = {
  { id = "endless", name = "ENDLESS", blurb = "The stack never stops rising. Line up three or more of a kind before it reaches the top. Chains and combos score big.", palette = "endless" },
  { id = "puzzle", name = "PUZZLE", blurb = "A few blocks and a handful of swaps. Clear every block before the moves run out. " .. #puzzles .. " puzzles.", palette = "puzzle" },
  { id = "versus", name = "GARBAGE BATTLE", blurb = "Race the computer. Combos and chains send grey garbage to its board; matches beside garbage break it open. Do not let your stack reach the top.", palette = "versus" },
}
local OPTIONS = 5
local COLS_P = 4

local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end

function Title:enter(screen)
  self.screen = screen or "title"
  self.choice = 1
  self.t = 0
  self.entered = 0
  self.leave = nil
  self.pending = nil
  self.puzzle_cursor = math.min(state.puzzles_unlocked(), #puzzles)
  if screen == "puzzles" then self.choice = self.puzzle_cursor end
  audio.music("menu", { fade = 0.8 })
  state.apply_volumes()
  transition.reveal(0.35)
end

function Title:leave_scene() end

-- go to another screen: this one slides out first
function Title:go(screen, choice)
  if self.leave then return end
  self.pending, self.pending_choice = screen, choice
  self.leave = 0
end

local function mode_of(choice) return MODES[choice] end

function Title:start_game(mode)
  state.mode = mode
  local m = ({ endless = MODES[1], puzzle = MODES[2], versus = MODES[3] })[mode]
  local spec
  if mode == "puzzle" then spec = { title = "PUZZLE " .. state.puzzle, sub = puzzles[state.puzzle].moves .. " moves", palette = "puzzle" }
  else spec = { title = m.name, sub = string.upper(state.DIFFICULTIES[state.difficulty].name), palette = m.palette } end
  audio.stop_music(0.6)
  audio.sfx("whoosh")
  transition.cover(spec, function() nova.goto_scene("play") end)
  self.screen = "starting"
end

function Title:update(dt)
  self.t = self.t + dt
  self.entered = self.entered + dt
  transition.update(dt)
  if nova.input.pressed("selftest") then require("lib.selftest").run() end
  if self.screen == "title" and nova.input.pressed("art_box") then self.screen = "boxart" end
  if self.screen == "title" and nova.input.pressed("art_icon") then self.screen = "icon" end
  if self.screen == "boxart" or self.screen == "icon" then return end
  if transition.busy() then return end
  if self.leave then
    self.leave = self.leave + dt / 0.14
    if self.leave >= 1 then
      self.screen, self.choice, self.entered, self.leave = self.pending, self.pending_choice or 1, 0, nil
      self.pending = nil
    end
    return
  end
  local screen = self.screen
  if screen == "title" then
    if nova.input.pressed("start") or nova.input.pressed("a") or nova.input.pressed("swap") then audio.sfx("menu_accept"); self:go("menu") end
  elseif screen == "menu" then
    local choice, action = ui.navigate(self.choice, #MENU)
    self.choice = choice
    if action == "back" then audio.sfx("menu_back"); self:go("title")
    elseif action == "accept" then
      audio.sfx("menu_accept")
      if choice == 1 then self:go("pace", 1, "endless"); self.pace_mode = "endless"
      elseif choice == 2 then self:go("puzzles", math.min(state.puzzles_unlocked(), #puzzles))
      elseif choice == 3 then self:go("pace", 1, "versus"); self.pace_mode = "versus"
      else self:go("options") end
    end
  elseif screen == "pace" then
    local choice, action = ui.navigate(self.choice, #state.DIFFICULTIES)
    self.choice = choice
    if action == "back" then audio.sfx("menu_back"); self:go("menu", self.pace_mode == "versus" and 3 or 1)
    elseif action == "accept" then
      audio.sfx("menu_accept")
      state.difficulty = choice
      self:start_game(self.pace_mode)
    end
  elseif screen == "puzzles" then
    self:update_puzzles()
  elseif screen == "options" then
    local choice, action = ui.navigate(self.choice, OPTIONS)
    self.choice = choice
    local step = (action == "right" and 0.1) or (action == "left" and -0.1) or 0
    local flip = action == "accept" or step ~= 0
    if choice == 1 and step ~= 0 then state.music_volume = math.max(0, math.min(1, state.music_volume + step)); state.save_options(); audio.sfx("menu_move") end
    if choice == 2 and step ~= 0 then state.sfx_volume = math.max(0, math.min(1, state.sfx_volume + step)); state.save_options(); audio.sfx("menu_move") end
    if choice == 3 and flip then state.smooth = not state.smooth; state.save_options(); audio.sfx("menu_move") end
    if choice == 4 and flip then state.shake = not state.shake; state.save_options(); audio.sfx("menu_move") end
    if choice == 5 and flip then state.vibration = not state.vibration; state.save_options(); audio.sfx("menu_move"); if state.vibration then nova.input.rumble(0.6, 0.15) end end
    if action == "back" then audio.sfx("menu_back"); self:go("menu", 4) end
  end
end

function Title:update_puzzles()
  local n = #puzzles
  local i = self.choice
  local moved = i
  if nova.input.pressed("left") then moved = i - 1 end
  if nova.input.pressed("right") then moved = i + 1 end
  if nova.input.pressed("up") then moved = i - COLS_P end
  if nova.input.pressed("down") then moved = i + COLS_P end
  if moved >= 1 and moved <= n and moved ~= i then self.choice = moved; audio.sfx("menu_move") end
  if nova.input.pressed("b") or nova.input.pressed("menu_back") then audio.sfx("menu_back"); self:go("menu", 2); return end
  if nova.input.pressed("a") or nova.input.pressed("start") or nova.input.pressed("swap") then
    if self.choice <= state.puzzles_unlocked() then
      audio.sfx("menu_accept")
      state.puzzle = self.choice
      self:start_game("puzzle")
    else
      audio.sfx("nope")
    end
  end
end

-- ---- drawing ---------------------------------------------------------------------------------------------------------------------

local GEMS = { 1, 2, 3, 4, 5, 6 }
local function gems_row(x, y, size, gap, t, bob)
  for i, k in ipairs(GEMS) do
    local gx = x + (i - 1) * (size + gap)
    local gy = y + math.sin(t * 2 + i * 0.9) * bob
    nova.sprite("gem_" .. k, gx, gy, { w = size, h = size, rotation = math.sin(t * 1.5 + i) * 0.08 })
  end
end

function Title:draw()
  local screen = self.screen
  backdrop.draw(self.t, "menu", 0)
  local w, h = nova.view()
  if screen == "icon" then
    -- the app icon: three stars in a line, about to clear
    local size = w * 0.27
    for i = -1, 1 do nova.sprite("gem_2", w / 2 + i * (size + 8), h / 2, { w = size, h = size }) end
    nova.sprite("cursor", w / 2 - (size + 8) / 2, h / 2, { w = size * 2 + 20, h = size + 14 })
    return
  elseif screen == "boxart" then
    -- the cover (landscape or portrait): the name, and the six blocks
    local land = w > h
    for i, k in ipairs(GEMS) do
      local col, row = (i - 1) % 3, (i - 1) // 3
      local size = land and h * 0.25 or w * 0.27
      local x = land and (w - 56 - size / 2 - (2 - col) * (size + 14)) or (w / 2 + (col - 1) * (size + 12))
      local y = land and (h * 0.5 + (row - 0.5) * (size + 14)) or (h * 0.62 + row * (size + 12))
      nova.sprite("gem_" .. k, x, y, { w = size, h = size, rotation = (i % 2 == 0 and 0.05 or -0.05) })
    end
    return
  end
  if screen == "title" or screen == "starting" then
    gems_row(w / 2 - 5 * 36, 372, 62, 10, self.t, 5)
  elseif screen == "menu" or screen == "pace" then
    -- a showcase of the six blocks, three over two, on the right
    local e = ease_out(self.entered / 0.5)
    for i, k in ipairs(GEMS) do
      local col, row = (i - 1) % 3, (i - 1) // 3
      local x = 640 + col * 86 + (1 - e) * 40
      local y = 380 + row * 86 + math.sin(self.t * 2 + i) * 4
      nova.sprite("gem_" .. k, x, y, { w = 72, h = 72, rotation = math.sin(self.t * 1.3 + i * 1.7) * 0.07, color = { 255, 255, 255, math.floor(255 * e) } })
    end
  end
end

local function logo(t, y)
  ui.center("NEBULA", y + math.sin(t * 1.2) * 3, 74, ui.color.cyan)
  ui.center("SWAP", y + 84 + math.sin(t * 1.2 + 0.6) * 3, 74, ui.color.gold)
end

function Title:draw_ui()
  local w = nova.view()
  if transition.busy() then transition.draw(); return end
  -- the slide in and out
  local e = ease_out(self.entered / 0.3)
  ui.ox, ui.alpha = (1 - e) * 50, e
  if self.leave then
    local k = math.min(1, self.leave)
    ui.ox, ui.alpha = -k * 40, 1 - k
  end
  local enter = self.entered
  local screen = self.screen
  if screen == "icon" then return end
  if screen == "boxart" then
    local _, h = nova.view()
    if w > h then
      ui.text(w * 0.05, h * 0.38, "NEBULA", 70, ui.color.cyan)
      ui.text(w * 0.05 + 4, h * 0.38 + 76, "SWAP", 70, ui.color.gold)
    else
      ui.center("NEBULA", h * 0.1, 56, ui.color.cyan)
      ui.center("SWAP", h * 0.1 + 62, 56, ui.color.gold)
    end
    return
  end
  if screen == "title" then
    logo(self.t, 78)
    if math.floor(self.t * 1.6) % 2 == 0 then ui.center("PRESS START", 300, 20, ui.color.white) end
    ui.center("Made by Jasper Milan", 502, 11, ui.color.dim)
    ui.hints({ { "pad_a", "Start" } })
  elseif screen == "menu" then
    ui.center("NEBULA SWAP", 40, 40, ui.color.cyan, { cx = 270 })
    ui.menu(MENU, self.choice, 150, { width = 360, cx = 270, id = "main", enter = enter })
    local m = MODES[self.choice]
    if m then self:draw_mode_card(m) else self:draw_card("OPTIONS", "Volume, anti-aliasing, screen shake and vibration.") end
    ui.hints({ { "pad_a", "Accept" }, { "pad_b", "Back" } })
  elseif screen == "pace" then
    local m = self.pace_mode == "versus" and MODES[3] or MODES[1]
    ui.center(m.name, 40, ui.fit(m.name, 36, 420), ui.color.cyan, { cx = 270 })
    local items = {}
    for i, d in ipairs(state.DIFFICULTIES) do items[i] = d.name end
    ui.menu(items, self.choice, 150, { width = 360, cx = 270, id = "pace", enter = enter })
    local d = state.DIFFICULTIES[self.choice]
    local extra
    if self.pace_mode == "endless" then extra = "BEST  " .. state.best("endless_" .. d.id)
    else extra = "WINS  " .. nova.save.get("wins_" .. d.id, 0) end
    ui.panel(480, 70, 440, 150, 215)
    ui.text(500, 86, string.upper(d.name), 24, ui.color.gold)
    ui.text(500, 126, d.blurb, 13, ui.color.white, { width = 400 })
    ui.text(500, 190, extra, 14, ui.color.cyan)
    ui.hints({ { "pad_a", "Start" }, { "pad_b", "Back" } })
  elseif screen == "puzzles" then
    self:draw_puzzles(enter)
  elseif screen == "options" then
    ui.center("OPTIONS", 40, 38, ui.color.cyan)
    local function pct(v) return string.format("< %d >", math.floor(v * 10 + 0.5)) end
    local function onoff(v) return v and "< On >" or "< Off >" end
    ui.menu({
      { "Music volume", pct(state.music_volume) },
      { "Sound volume", pct(state.sfx_volume) },
      { "Smooth edges (AA)", onoff(state.smooth) },
      { "Screen shake", onoff(state.shake) },
      { "Vibration", onoff(state.vibration) },
    }, self.choice, 120, { width = 520, id = "options", enter = enter })
    ui.hints({ { "pad_a", "Change" }, { "pad_b", "Back" } })
  end
  ui.ox, ui.alpha = 0, 1
  -- every screen fades up from the backdrop as it opens
  transition.draw()
end

function Title:draw_card(name, text)
  ui.panel(480, 70, 440, 220, 215)
  ui.text(500, 86, name, 22, ui.color.gold)
  ui.text(500, 124, text, 13, ui.color.white, { width = 400 })
end

function Title:draw_mode_card(m)
  self:draw_card(m.name, m.blurb)
  if m.id == "endless" then
    ui.text(500, 246, "BEST  " .. state.best("endless_normal"), 13, ui.color.cyan)
  elseif m.id == "puzzle" then
    local done = 0
    for i = 1, #puzzles do if state.puzzle_done(i) then done = done + 1 end end
    ui.text(500, 246, "CLEARED  " .. done .. " / " .. #puzzles, 13, ui.color.cyan)
  else
    ui.text(500, 246, "WINS  " .. nova.save.get("wins_normal", 0), 13, ui.color.cyan)
  end
end

function Title:draw_puzzles(enter)
  ui.center("PUZZLES", 30, 38, ui.color.cyan)
  local cw, ch, gap = 120, 92, 14
  local total = COLS_P * cw + (COLS_P - 1) * gap
  local x0 = (nova.view() - total) / 2
  local unlocked = state.puzzles_unlocked()
  for i = 1, #puzzles do
    local col, row = (i - 1) % COLS_P, (i - 1) // COLS_P
    local a = ease_out((enter - (i - 1) * 0.03) / 0.3)
    local x, y = x0 + col * (cw + gap), 96 + row * (ch + gap) + (1 - a) * 24
    local on = i == self.choice
    local locked = i > unlocked
    local done = state.puzzle_done(i)
    local old = ui.alpha
    ui.alpha = old * a
    if on then nova.ui.panel("ui/btn_yellow", x - 5 + ui.ox, y - 5, cw + 10, ch + 10, { slice = { 6, 6, 6, 6 }, scale = 1.5, color = { 255, 255, 255, math.floor(255 * ui.alpha) } }) end
    if on then nova.ui.rect(x + 3 + ui.ox, y + 3, cw - 6, ch - 6, { 16, 26, 70, math.floor(255 * ui.alpha) }) end
    ui.panel(x, y, cw, ch, locked and 150 or 235, done and { 18, 70, 96 } or nil)
    local n = tostring(i)
    ui.text(x + 14, y + 12, n, 28, locked and ui.color.dim or (on and ui.color.gold or ui.color.white))
    ui.label(x + 14, y + 64, locked and "LOCKED" or (puzzles[i].moves .. (puzzles[i].moves == 1 and " MOVE" or " MOVES")), locked and ui.color.dim or ui.color.cyan)
    if done then ui.right("CLEAR", x + cw - 12, y + 20, 11, ui.color.green) end
    ui.alpha = old
  end
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Play" }, { "pad_b", "Back" } })
end

return Title

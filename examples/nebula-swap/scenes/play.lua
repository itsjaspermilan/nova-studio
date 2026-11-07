-- A game: Endless, Puzzle or a Garbage battle against the computer (state.mode says which). One scene holds the countdown, the play, the pause and the
-- results, so the board and the music carry on through them.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local Board = require("lib.board")
local View = require("lib.view")
local AI = require("lib.ai")
local backdrop = require("lib.backdrop")
local transition = require("lib.transition")
local puzzles = require("lib.puzzles")

local Play = nova.scene {}

local PAUSE_ITEMS = { "Resume", "Restart", "Quit to menu" }
local PALETTE = { endless = "endless", puzzle = "puzzle", versus = "versus" }

function Play:enter()
  local mode = state.mode
  self.mode = mode
  self.t = 0
  self.phase = "intro" -- intro, play, paused, over
  self.intro = mode == "puzzle" and 1.6 or 3.4
  self.count = 4
  self.choice = 1
  self.pause_choice = 1
  self.result_t = 0
  self.dim = 0
  self.auto = nil
  local d = state.DIFFICULTIES[state.difficulty]
  local seed = math.floor(nova.time() * 1000) % 100000 + 1
  if mode == "endless" then
    self.board = Board.new({ mode = "endless", seed = seed, level = d.level, colours = state.difficulty == 1 and 5 or 6 })
    self.view = View.new(self.board, 312, 36, 40, "")
  elseif mode == "puzzle" then
    local p = puzzles[state.puzzle]
    self.board = Board.new({ mode = "puzzle", puzzle = p, seed = state.puzzle })
    self.view = View.new(self.board, 312, 36, 40, "")
  else
    self.board = Board.new({ mode = "versus", seed = seed, level = 2 + state.difficulty * 2, colours = 5 })
    self.rival = Board.new({ mode = "versus", seed = seed + 17, level = 2 + state.difficulty * 2, colours = 5 })
    self.view = View.new(self.board, 190, 52, 34, "")
    self.rview = View.new(self.rival, 566, 52, 34, "")
    self.ai = AI.new(self.rival, AI.LEVELS[state.difficulty])
  end
  self.held = { up = 0, down = 0, left = 0, right = 0 }
  state.apply_volumes()
  audio.music(mode == "versus" and "versus" or (mode == "puzzle" and "puzzle" or "play"), { fade = 0.8 })
  transition.reveal(0.45)
end

function Play:leave() end

-- ---- input ---------------------------------------------------------------------------------------------------------------------

-- a direction that repeats while it is held
function Play:direction(name, dt)
  if nova.input.pressed(name) then self.held[name] = 0.22; return true end
  if nova.input.down(name) then
    self.held[name] = self.held[name] - dt
    if self.held[name] <= 0 then self.held[name] = 0.07; return true end
  else
    self.held[name] = 0
  end
  return false
end

function Play:player_input(dt)
  local b = self.board
  if b.over or b.won then return false end
  if self:direction("up", dt) then b:move_cursor(1, 0); audio.sfx("menu_move", { volume = 0.5 }) end
  if self:direction("down", dt) then b:move_cursor(-1, 0); audio.sfx("menu_move", { volume = 0.5 }) end
  if self:direction("left", dt) then b:move_cursor(0, -1); audio.sfx("menu_move", { volume = 0.5 }) end
  if self:direction("right", dt) then b:move_cursor(0, 1); audio.sfx("menu_move", { volume = 0.5 }) end
  if nova.input.pressed("swap") or nova.input.pressed("a") or nova.input.pressed("b") then
    if not b:swap() then audio.sfx("nope") end
  end
  return nova.input.down("raise")
end

-- ---- the update ------------------------------------------------------------------------------------------------------------------

function Play:handle_events(board, view, other, other_view, is_player)
  local events = board:take_events()
  view:handle(events)
  local pop_n = 0
  for _, e in ipairs(events) do
    if e.type == "swap" then
      if is_player then audio.sfx("swap") end
    elseif e.type == "match" then
      if e.chain >= 2 then audio.sfx("chain", { pitch = 1 + 0.1 * (e.chain - 2) })
      elseif e.n >= 4 then audio.sfx("combo", { pitch = 1 + 0.04 * (e.n - 4) }) end
    elseif e.type == "pop" then
      pop_n = pop_n + 1
      if pop_n <= 3 and is_player then audio.sfx("pop", { pitch = 0.9 + 0.06 * (e.order or 0) * 2, volume = 0.7 }) end
    elseif e.type == "garbage_land" then
      if is_player then
        audio.sfx("garbage_land")
        if state.vibration then nova.input.rumble(0.6, 0.18) end
      end
    elseif e.type == "garbage_break" then
      audio.sfx("garbage_break", { volume = is_player and 1 or 0.5 })
    elseif e.type == "send" and other then
      local piece = board:send_or_cancel(e.w, e.h)
      if piece then other:receive(piece.w, piece.h) end
    elseif e.type == "over" then
      self:finish(board == self.board and false or true)
    elseif e.type == "won" then
      self:finish(true)
    end
  end
end

function Play:finish(won)
  if self.phase == "over" then return end
  self.phase = "over"
  self.result_t = 0
  self.won = won
  local b = self.board
  local r = { mode = self.mode, won = won, score = b.score, time = b.time, level = b.level, max_chain = b.max_chain, max_combo = b.max_combo, cleared = b.cleared }
  if self.mode == "endless" then
    r.record = state.submit("endless_" .. state.DIFFICULTIES[state.difficulty].id, b.score)
    r.best = state.best("endless_" .. state.DIFFICULTIES[state.difficulty].id)
  elseif self.mode == "puzzle" then
    if won then
      local used = b.moves_total - b.moves_left
      local prev = state.puzzle_done(state.puzzle)
      if not prev or used < prev then state.set_puzzle_done(state.puzzle, used) end
      r.used = used
    end
  else
    if won then
      local k = "wins_" .. state.DIFFICULTIES[state.difficulty].id
      nova.save.set(k, nova.save.get(k, 0) + 1)
    end
  end
  state.result = r
  audio.sfx(won and "win" or "lose")
  audio.stop_music(0.6)
  nova.log(string.format("nebula: over mode=%s won=%s score=%d chain=%d combo=%d", self.mode, tostring(won), b.score, b.max_chain, b.max_combo))
end

function Play:update(dt)
  self.t = self.t + dt
  transition.update(dt)
  if transition.busy() then
    -- (the board waits behind the wipe)
    return
  end
  if nova.input.pressed("autoplay") then
    self.auto = not self.auto and AI.new(self.board, "hard") or nil
    nova.log("nebula: autoplay " .. tostring(self.auto ~= nil))
  end
  if self.phase == "intro" then
    self.intro = self.intro - dt
    local n = math.ceil(self.intro)
    if self.mode ~= "puzzle" and n ~= self.count and n >= 0 and n <= 3 then
      self.count = n
      audio.sfx(n > 0 and "beep" or "combo", { pitch = n > 0 and 1 or 1.2 })
    end
    if self.intro <= 0 then self.phase = "play"; nova.log("nebula: go") end
    self.view:update(dt)
    if self.rview then self.rview:update(dt) end
    self.dim = math.max(0, self.dim - dt * 2)
    return
  end
  if self.phase == "paused" then return self:update_pause(dt) end
  if self.phase == "over" then return self:update_over(dt) end
  if nova.input.pressed("pause") then
    self.phase = "paused"
    self.pause_choice = 1
    audio.sfx("pause")
    nova.music.volume(state.music_volume * 0.35)
    return
  end
  local raising = false
  if self.auto then
    self.auto:update(dt)
    raising = self.auto.raising
  else
    raising = self:player_input(dt)
  end
  if self.mode == "puzzle" and self.board.moves_left and false then end
  self.board:update(dt, raising)
  self:handle_events(self.board, self.view, self.rival, self.rview, true)
  if self.rival then
    self.ai:update(dt)
    self.rival:update(dt, self.ai.raising)
    self:handle_events(self.rival, self.rview, self.board, self.view, false)
    -- the loser is the one whose stack reaches the top
    if self.rival.over and self.phase ~= "over" then self:finish(true) end
  end
  self.view:update(dt)
  if self.rview then self.rview:update(dt) end
  if self.board.over and self.phase ~= "over" then self:finish(false) end
end

function Play:update_pause(dt)
  local choice, action = ui.navigate(self.pause_choice, #PAUSE_ITEMS)
  self.pause_choice = choice
  self.dim = math.min(1, self.dim + dt * 5)
  local resume = (action == "accept" and choice == 1) or action == "back" or nova.input.pressed("pause")
  if resume then
    audio.sfx("menu_back")
    nova.music.volume(state.music_volume)
    self.phase = "play"
  elseif action == "accept" then
    audio.sfx("menu_accept")
    if choice == 2 then
      nova.music.volume(state.music_volume)
      transition.cover(self:spec(), function() nova.goto_scene("play") end)
    else
      nova.music.volume(state.music_volume)
      audio.stop_music(0.5)
      transition.cover({ title = "NEBULA SWAP", sub = "", palette = "menu" }, function() nova.goto_scene("title", "menu") end)
    end
  end
end

function Play:results_items()
  if self.mode == "puzzle" then
    if self.won and state.puzzle < #puzzles then return { "Next puzzle", "Try again", "Puzzle list", "Main menu" }, { "next", "again", "list", "menu" } end
    return { "Try again", "Puzzle list", "Main menu" }, { "again", "list", "menu" }
  end
  return { "Play again", "Main menu" }, { "again", "menu" }
end

function Play:update_over(dt)
  self.result_t = self.result_t + dt
  self.dim = math.min(1, self.dim + dt * 1.5)
  self.view:update(dt)
  self.board:update(dt)
  self.board:take_events()
  if self.rview then self.rview:update(dt) end
  if self.result_t < 1.0 then return end
  local items, ids = self:results_items()
  self.choice = math.min(self.choice, #items)
  local choice, action = ui.navigate(self.choice, #items)
  self.choice = choice
  if action == "accept" then
    audio.sfx("menu_accept")
    local id = ids[choice]
    if id == "again" then transition.cover(self:spec(), function() nova.goto_scene("play") end)
    elseif id == "next" then state.puzzle = state.puzzle + 1; transition.cover(self:spec(true), function() nova.goto_scene("play") end)
    elseif id == "list" then transition.cover({ title = "PUZZLES", sub = "", palette = "puzzle" }, function() nova.goto_scene("title", "puzzles") end)
    else transition.cover({ title = "NEBULA SWAP", sub = "", palette = "menu" }, function() nova.goto_scene("title", "menu") end) end
  elseif action == "back" then
    audio.sfx("menu_back")
    transition.cover({ title = "NEBULA SWAP", sub = "", palette = "menu" }, function() nova.goto_scene("title", "menu") end)
  end
end

function Play:spec(next_puzzle)
  local m = self.mode
  if m == "puzzle" then return { title = "PUZZLE " .. state.puzzle, sub = state.puzzle and (#puzzles[state.puzzle].rows .. " rows"), palette = "puzzle" } end
  if m == "versus" then return { title = "GARBAGE BATTLE", sub = "vs " .. string.upper(state.DIFFICULTIES[state.difficulty].name) .. " CPU", palette = "versus" } end
  return { title = "ENDLESS", sub = string.upper(state.DIFFICULTIES[state.difficulty].name), palette = "endless" }
end

-- ---- drawing ---------------------------------------------------------------------------------------------------------------------

function Play:draw()
  backdrop.draw(self.t, self.mode, self.dim * 0.6)
  local waiting = self.phase == "intro"
  local hide = ((self.phase == "over" and self.result_t > 0.7) or self.phase == "paused") and "all" or false
  self.view:draw_world(false, (self.phase == "over" or waiting) and false or nil, hide)
  if self.rview then self.rview:draw_world(false, false, hide) end
end

local function stat(x, y, w, label, value, colour, size)
  ui.label(x, y, label)
  ui.text(x, y + 16, value, size or 22, colour or ui.color.white)
end

function Play:draw_hud_endless(w)
  local b = self.board
  ui.panel(28, 50, 250, 196, 238)
  stat(48, 66, 210, "SCORE", tostring(b.score), ui.color.gold, 26)
  stat(48, 120, 100, "LEVEL", tostring(b.level), ui.color.cyan, 22)
  stat(158, 120, 100, "TIME", ui.time(b.time), ui.color.white, 22)
  stat(48, 174, 210, "BEST", tostring(state.best("endless_" .. state.DIFFICULTIES[state.difficulty].id)), ui.color.dim, 18)
  ui.panel(598, 50, 250, 150, 238)
  stat(618, 66, 210, "BEST CHAIN", tostring(b.max_chain), ui.color.gold, 22)
  stat(618, 120, 100, "BEST COMBO", tostring(b.max_combo), ui.color.cyan, 22)
  stat(728, 120, 100, "CLEARED", tostring(b.cleared), ui.color.white, 22)
end

function Play:draw_hud_puzzle(w)
  local b = self.board
  ui.panel(28, 50, 250, 216, 238)
  ui.label(48, 66, "PUZZLE")
  ui.text(48, 82, tostring(state.puzzle) .. " / " .. #puzzles, 24, ui.color.cyan)
  ui.label(48, 126, "MOVES LEFT")
  local low = b.moves_left <= 1
  ui.text(48, 144, tostring(b.moves_left), 46, low and ui.color.red or ui.color.gold)
  ui.text(48, 220, "Clear every block.", 12, ui.color.white)
  ui.panel(598, 50, 290, 130, 238)
  ui.label(618, 66, "HOW")
  ui.text(618, 88, "Swap two neighbours.", 12, ui.color.white)
  ui.text(618, 112, "Line up three or more.", 12, ui.color.white)
  ui.text(618, 136, "Empty spaces count.", 12, ui.color.white)
end

function Play:draw_hud_versus(w)
  self.view.b = self.board
  -- (the names are drawn by the fields; the middle strip shows who is ahead)
  local b, r = self.board, self.rival
  ui.panel(420, 96, 132, 180, 215)
  ui.center("VS", 108, 20, ui.color.gold, { cx = 486 })
  ui.label(436, 148, "YOU")
  ui.text(436, 162, tostring(b.score), 16, ui.color.white)
  ui.label(436, 196, "CPU")
  ui.text(436, 210, tostring(r.score), 16, ui.color.white)
  ui.label(436, 244, "LEVEL")
  ui.text(436, 256 + 0, tostring(math.max(b.level, r.level)), 12, ui.color.cyan)
end

function Play:draw_ui()
  local w = nova.view()
  local busy = transition.busy()
  if not busy then
    local title = self.mode == "versus" and "YOU" or nil
    if self.phase ~= "paused" and self.phase ~= "over" then
      if self.mode == "endless" then self:draw_hud_endless(w)
      elseif self.mode == "puzzle" then self:draw_hud_puzzle(w)
      else self:draw_hud_versus(w) end
    end
    local d = state.DIFFICULTIES[state.difficulty]
    local head = ({ endless = "ENDLESS  " .. string.upper(d.name), puzzle = "PUZZLE " .. state.puzzle, versus = "YOU" })[self.mode]
    local meter = self.mode == "endless" and (self.board:speed() / 0.7) or nil
    local hide = ((self.phase == "over" and self.result_t > 0.7) or self.phase == "paused") and "all" or false
    self.view:draw_ui(head, self.mode == "versus" and self.board.incoming or nil, meter, hide)
    if self.rview then self.rview:draw_ui("CPU  " .. string.upper(d.name), self.rival.incoming, nil, hide) end
    if self.phase == "intro" then self:draw_intro(w) end
    if self.phase == "paused" then self:draw_pause(w) end
    if self.phase == "over" then self:draw_over(w) end
    if self.phase == "play" then
      ui.hints({ { "pad_a", "Swap" }, { "pad_l", "Raise" }, { "pad_plus", "Pause" } })
    end
  end
  transition.draw()
end

function Play:draw_intro(w)
  local n = math.ceil(self.intro)
  local cx = self.view.x + self.view:width() / 2
  if self.mode == "puzzle" then
    ui.center("PUZZLE " .. state.puzzle, 230, 30, ui.color.cyan, { cx = cx })
    ui.center(#puzzles[state.puzzle].rows .. " rows  ·  " .. puzzles[state.puzzle].moves .. " moves", 276, 13, ui.color.white, { cx = cx })
    return
  end
  if self.mode == "versus" then cx = w / 2 end
  local frac = 1 - (self.intro % 1)
  local size = math.floor(70 * (1 + 0.5 * (1 - frac) ^ 3))
  if n >= 1 and n <= 3 then ui.center(tostring(n), 210, size, ui.color.gold, { cx = cx }) elseif n < 1 then ui.center("GO!", 220, 56, ui.color.green, { cx = cx }) end
end

function Play:draw_pause(w)
  nova.ui.rect(0, 0, w, 540, { 2, 4, 20, 170 })
  ui.center("PAUSED", 120, 40, ui.color.cyan)
  ui.menu(PAUSE_ITEMS, self.pause_choice, 210, { width = 340, id = "pause" })
  ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Accept" }, { "pad_plus", "Resume" } })
end

function Play:draw_over(w)
  nova.ui.rect(0, 0, w, 540, { 2, 4, 20, math.floor(190 * math.min(1, self.result_t * 1.5)) })
  local r = state.result
  if not r then return end
  local e = math.min(1, self.result_t / 0.4)
  ui.ox = (1 - e) * 40
  ui.alpha = e
  local headline
  if r.mode == "puzzle" then headline = r.won and "CLEAR!" else headline = "OUT OF MOVES" end
  if r.mode == "versus" then headline = r.won and "YOU WIN!" or "YOU LOSE" end
  if r.mode == "endless" then headline = "GAME OVER" end
  ui.center(headline, 36, ui.fit(headline, 44, 680), r.won and ui.color.gold or (r.mode == "endless" and ui.color.cyan or ui.color.red))
  ui.panel(w / 2 - 170, 100, 340, 150, 225)
  if r.mode == "puzzle" then
    ui.label(w / 2 - 150, 118, "PUZZLE")
    ui.text(w / 2 - 150, 134, tostring(state.puzzle), 22, ui.color.cyan)
    if r.won then
      ui.label(w / 2 + 10, 118, "MOVES USED")
      ui.text(w / 2 + 10, 134, r.used .. " / " .. self.board.moves_total, 22, ui.color.gold)
    else
      ui.label(w / 2 + 10, 118, "BLOCKS LEFT")
      ui.text(w / 2 + 10, 134, tostring(self.board:count_gems()), 22, ui.color.red)
    end
  else
    ui.label(w / 2 - 150, 118, "SCORE")
    ui.text(w / 2 - 150, 134, tostring(r.score), 26, ui.color.gold)
    ui.label(w / 2 + 10, 118, r.record and "NEW BEST!" or "TIME")
    ui.text(w / 2 + 10, 134, r.record and tostring(r.best) or ui.time(r.time), 22, r.record and ui.color.green or ui.color.white)
    ui.label(w / 2 - 150, 184, "BEST CHAIN")
    ui.text(w / 2 - 150, 200, tostring(r.max_chain), 22, ui.color.cyan)
    ui.label(w / 2 + 10, 184, "BEST COMBO")
    ui.text(w / 2 + 10, 200, tostring(r.max_combo), 22, ui.color.cyan)
  end
  if self.result_t > 0.9 then
    local items = self:results_items()
    ui.menu(items, self.choice, 280, { width = 340, id = "results", enter = self.result_t - 0.9 })
    ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Accept" } })
  end
  ui.ox, ui.alpha = 0, 1
end

return Play

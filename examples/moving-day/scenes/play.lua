-- A flat to arrange: the mover walks with the d-pad and pushes what they walk into, A and Y turn the piece in front, B undoes a move (as many as you
-- like), holding X starts again. The client's wish card is on the left; when every wish holds the client is delighted and the stars are counted.
local Rules = require("lib.rules")
local View = require("lib.view")
local Card = require("lib.card")
local Fx = require("lib.fx")
local ui = require("lib.ui")
local audio = require("lib.audio")
local levels = require("lib.levels")
local state = require("lib.state")
local transition = require("lib.transition")

local Play = nova.scene {}

local REPEAT_DELAY, REPEAT_EVERY = 0.2, 0.15
local RESTART_HOLD = 0.7
local DIR_ACTIONS = { "right", "left", "down", "up" } -- in Rules.DIRS order

function Play:enter()
  self.index = state.level
  self.L = levels.get(self.index)
  self.street = levels.street_of(self.index)
  self.rules = Rules.new(self.L)
  self.s = self.rules:start()
  self.history = {}
  self.moves = 0
  self.view = View.new(self.L)
  self.card = Card.new(self.L)
  self.t = 0
  self.held = {} -- seconds each direction (and B) has been held
  self.restart_t = 0
  self.toast = nil
  self.done = nil -- the solved sequence: { t, stars, newbest }
  self.pause = nil
  View.setup(state.smooth)
  self.view:build()
  self.view:sync(self.s)
  self.granted = self.rules:granted(self.s)
  self.card:set(self.granted, true)
  -- the tips: the level's own (props.tips), shown one at a time until each is done
  self.tips = self.L.props.tips or {}
  self.tip_i, self.tip_t = 1, 0
  if state.stars(self.index) > 0 and not state.show_tips then self.tips = {} end
  audio.music(self.street.music or "morning")
  transition.reveal(0.25)
  nova.log("play: level " .. self.index .. " " .. (self.L.props.name or ""))
  self:mark()
end

function Play:leave() View.leave() end

-- ---- the moves ----

function Play:push_history()
  self.history[#self.history + 1] = { s = self.s, moves = self.moves }
end

-- what changed in the wishes: the card, the client and the pieces react
function Play:check(quiet)
  local granted, all = self.rules:granted(self.s)
  local gained, lost = 0, 0
  for k, on in ipairs(granted) do
    if on and not self.granted[k] then
      gained = gained + 1
      if not quiet then
        local i = self.rules:find(self.s, self.L.props.wishes[k].piece)
        if i then
          self.view:pop(i)
          local p = self.s.pieces[i]
          Fx.sparkle(p.x, 0.9, p.z, { 255, 230, 140 }, 14)
          Fx.hearts(p.x, 1.0, p.z, 3)
        end
      end
    elseif not on and self.granted[k] then
      lost = lost + 1
    end
  end
  self.granted = granted
  self.card:set(granted, quiet)
  if not quiet then
    if gained > 0 then
      local count = 0
      for _, on in ipairs(granted) do if on then count = count + 1 end end
      audio.sfx("snap", { pitch = 0.9 + 0.08 * count })
      self.view:react("yes")
    elseif lost > 0 then
      audio.sfx("unsnap")
      self.view:react("no")
    end
  end
  if all and not self.done then self:solved() end
end

function Play:press(d)
  local old = self.s
  local new, what = self.rules:step(old, d)
  if what.moved then
    self:push_history()
    self.s = new
    self.moves = self.moves + 1
    if what.pushed then
      audio.sfx("slide", { pitch = 0.92 + math.random() * 0.16 })
      local p = new.pieces[what.pushed]
      Fx.dust(p.x, p.z, 5, Rules.DIRS[d][1], Rules.DIRS[d][2])
    else
      audio.sfx("step", { pitch = 0.9 + math.random() * 0.2, volume = 0.8 })
    end
    self:event("move")
    if what.pushed then self:event("push") end
  elseif what.bump then
    self.s = new -- (a bump turns the mover to face it)
    if what.bump == "piece" then
      audio.sfx("bump", { pitch = 0.95 + math.random() * 0.1 })
      local p = old.pieces[what.piece]
      Fx.dust(p.x, p.z, 3)
      nova.input.rumble(0.25, 0.08)
    else
      audio.sfx("bump", { pitch = 1.4, volume = 0.5 })
    end
  end
  self.view:step(old, self.s, what, d)
  self:check()
  self:mark()
end

function Play:turn(dir)
  local old = self.s
  local new, i = self.rules:rotate(old, dir)
  if new then
    self:push_history()
    self.s = new
    self.moves = self.moves + 1
    self.view:rotate(old, new, i, dir)
    audio.sfx("turn", { pitch = dir < 0 and 1.0 or 0.9 })
    local p = new.pieces[i]
    Fx.dust(p.x, p.z, 4)
    self:event("turn")
    self:check()
  elseif i then
    self.view:wobble(i)
    audio.sfx("nope")
    self:show_toast("No room to turn it there")
  else
    audio.sfx("nope")
    self:show_toast("Face a piece of furniture to turn it")
  end
  self:mark()
end

function Play:undo()
  local h = table.remove(self.history)
  if not h then audio.sfx("nope"); return end
  self.s, self.moves = h.s, h.moves
  self.view:sync(self.s, true)
  audio.sfx("undo")
  nova.log("play: undo, " .. self.moves .. " moves")
  self:event("undo")
  self:check(true)
  self:mark()
end

function Play:restart()
  if #self.history == 0 then return end
  self:push_history() -- (a restart can be undone too)
  self.s = self.rules:start()
  self.moves = 0
  self.view:sync(self.s, true)
  audio.sfx("restart")
  nova.log("play: start again")
  self:check(true)
  self:mark()
  self:show_toast("Fresh start")
end

-- the floor marks: the piece the mover faces (what A and Y would turn)
function Play:mark()
  local marks = {}
  local d = Rules.DIRS[self.s.f]
  local i = self.rules:occupant(self.s, self.s.px + d[1], self.s.pz + d[2])
  if i and not self.rules:wall(self.s.px, self.s.pz, self.s.px + d[1], self.s.pz + d[2]) and not self.done then
    local p = self.s.pieces[i]
    local fx, fz = Rules.front(p.q)
    for _, c in ipairs(Rules.cells(p.kind, p.x, p.z, p.q)) do
      marks[#marks + 1] = { x = c[1], z = c[2] }
      -- and a chevron on the floor in front of it: the way it faces
      if c[3] and self.rules:floor(c[1] + fx, c[2] + fz) and not self.rules:wall(c[1], c[2], c[1] + fx, c[2] + fz) then
        marks[#marks + 1] = { x = c[1] + fx * 0.8, z = c[2] + fz * 0.8, chevron = math.atan(fx, -fz) }
      end
    end
  end
  self.view.marks = marks
end

function Play:show_toast(text) self.toast = { text = text, t = 0 } end

-- ---- tips (the tutorial) ----

function Play:event(kind)
  local tip = self.tips[self.tip_i]
  if tip and tip["until"] == kind then self.tip_i, self.tip_t = self.tip_i + 1, 0 end
end

-- ---- solved ----

function Play:solved()
  local stars = self.rules:stars_for(self.moves)
  local newbest = state.record(self.index, self.moves, stars)
  if self.index == 1 then state.set_tutorial_done() end
  self.done = { t = 0, stars = stars, newbest = newbest, sel = 1, shown = 0 }
  self.view:celebrate()
  self.view.mover.cheer = 0
  self.view.marks = {}
  audio.sfx("happy")
  local c = self.L.client
  if c then Fx.hearts(c.x, 1.4, c.z, 6) end
  Fx.confetti(self.view.cx, 1.5, self.view.cz, 48)
  nova.log(string.format("play: solved level %d in %d moves, %d stars (par %s)", self.index, self.moves, stars, tostring(self.L.props.par)))
end

function Play:result_items()
  local items = {}
  if self.index < levels.count() then items[#items + 1] = "Next flat" end
  items[#items + 1] = "Play again"
  items[#items + 1] = "Choose a flat"
  return items
end

function Play:go(scene, spec, arg)
  transition.cover(spec or { title = "", sub = "", color = self.street.color }, function() nova.goto_scene(scene, arg) end)
end

function Play:play_level(i)
  state.level = i
  local L = levels.get(i)
  local street = levels.street_of(i)
  self:go("play", { title = L.props.name, sub = street.name .. "  ·  Flat " .. i, color = street.color })
end

function Play:update_done(dt)
  local d = self.done
  d.t = d.t + dt
  self.view.mover.cheer = d.t % 1.1
  if d.t > 1.3 then
    local shown = math.min(d.stars, math.floor((d.t - 1.6) / 0.35) + 1)
    if shown > d.shown and d.t > 1.6 then
      d.shown = shown
      audio.sfx("star", { pitch = 0.9 + 0.12 * shown })
    end
  end
  if d.t < 1.8 or transition.busy() then return end
  local items = self:result_items()
  local sel, act = ui.navigate(d.sel, #items)
  d.sel = sel
  if act == "accept" then
    audio.sfx("menu_accept")
    local item = items[d.sel]
    if item == "Next flat" then self:play_level(self.index + 1)
    elseif item == "Play again" then self:play_level(self.index)
    else state.focus = self.index; self:go("title", { title = "", sub = "", color = self.street.color }, "streets") end
  end
end

-- ---- the pause menu ----

local PAUSE = { "Carry on", "Start again", "Choose a flat", "Title screen" }

function Play:update_pause()
  local p = self.pause
  p.t = p.t + 1 / 60
  if nova.input.pressed("start") or nova.input.pressed("b") then self.pause = nil; audio.sfx("menu_back"); return end
  local sel, act = ui.navigate(p.sel, #PAUSE)
  p.sel = sel
  if act == "accept" then
    audio.sfx("menu_accept")
    local item = PAUSE[p.sel]
    self.pause = nil
    if item == "Start again" then self:restart()
    elseif item == "Choose a flat" then state.focus = self.index; self:go("title", nil, "streets")
    elseif item == "Title screen" then self:go("title") end
  end
end

-- ---- every step ----

function Play:update(dt)
  self.t = self.t + dt
  transition.update(dt)
  self.view:update(dt)
  self.card:update(dt)
  self.tip_t = self.tip_t + dt
  if self.toast then self.toast.t = self.toast.t + dt; if self.toast.t > 2.2 then self.toast = nil end end
  if self.done then self:update_done(dt); return end
  if transition.busy() then return end
  if self.pause then self:update_pause(); return end
  if nova.input.pressed("start") then self.pause = { sel = 1, t = 0 }; audio.sfx("page"); return end
  if nova.input.pressed("autoplay") and self.L.props.solution then self.auto = { presses = self.L.props.solution, i = 1, t = 0 }; self:restart() end
  if self.auto then
    self.auto.t = self.auto.t + dt
    if self.auto.t >= 0.16 then
      self.auto.t = 0
      local ch = self.auto.presses:sub(self.auto.i, self.auto.i)
      self.auto.i = self.auto.i + 1
      if ch == "" then self.auto = nil
      elseif ch == "a" then self:turn(-1)
      elseif ch == "y" then self:turn(1)
      else for k, key in ipairs(Rules.KEYS) do if key == ch then self:press(k) end end end
    end
    return
  end
  -- the d-pad, with a repeat while held (the newest press wins)
  for d, action in ipairs(DIR_ACTIONS) do
    if nova.input.pressed(action) then self.held[action] = 0; self:press(d)
    elseif nova.input.down(action) and self.held[action] then
      local before = self.held[action]
      self.held[action] = before + dt
      local after = self.held[action]
      if after >= REPEAT_DELAY and math.floor((after - REPEAT_DELAY) / REPEAT_EVERY) ~= math.floor((before - REPEAT_DELAY) / REPEAT_EVERY) or (before < REPEAT_DELAY and after >= REPEAT_DELAY) then self:press(d) end
    else self.held[action] = nil end
  end
  if nova.input.pressed("a") then self:turn(-1) end
  if nova.input.pressed("y") then self:turn(1) end
  -- B undoes, and keeps undoing while held
  if nova.input.pressed("b") then self.held.b = 0; self:undo()
  elseif nova.input.down("b") and self.held.b then
    local before = self.held.b
    self.held.b = before + dt
    if self.held.b >= 0.35 and math.floor((self.held.b - 0.35) / 0.09) ~= math.floor((before - 0.35) / 0.09) then self:undo() end
  else self.held.b = nil end
  -- X held starts again
  if nova.input.down("x") then
    self.restart_t = self.restart_t + dt
    if self.restart_t >= RESTART_HOLD then self.restart_t = -99; self:restart() end
  else
    if self.restart_t > 0 and self.restart_t < 0.25 then self:show_toast("Hold X to start again") end
    self.restart_t = 0
  end
end

function Play:draw()
  local w, h = nova.view()
  self.view:camera(w, h, 330 / w)
  self.view:draw()
end

-- ---- the screen ----

local function star_row(x, y, size, lit)
  for k = 1, 3 do ui.star(x + (k - 1) * (size + 4), y, size, k <= lit) end
end

function Play:draw_hud(w, h)
  -- the card
  self.card:draw(14, 14, 300)
  -- the moves and the stars still in reach
  local st = self.L.props.stars or { 0, 0 }
  local pw, ph = 236, 92
  local px = w - pw - 14
  ui.panel(px, 14, pw, ph, "ink")
  ui.text(px + 18, 26, "Moves", ui.SMALL, ui.color.cream)
  ui.text(px + 18, 46, tostring(self.moves), ui.NUMBER, ui.color.white, { shadow = true })
  local lit = self.rules:stars_for(self.moves)
  for k = 1, 3 do
    local on = k <= lit
    ui.star(px + 120 + (k - 1) * 36, 44, 32, on)
  end
  local next_limit = (lit == 3 and st[1]) or (lit == 2 and st[2]) or nil
  if next_limit then
    ui.right(string.format("%d for %s", next_limit, lit == 3 and "3 stars" or "2 stars"), px + pw - 16, 68, ui.SMALL, { 220, 236, 236 })
  end
  -- what the buttons do
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Turn" }, { "pad_b", "Undo" }, { "pad_x", "Restart" } })
  -- X held: a ring that fills
  if self.restart_t > 0.05 then
    local k = math.min(1, self.restart_t / RESTART_HOLD)
    ui.panel(w / 2 - 150, h / 2 - 36, 300, 72, "ink", 230)
    ui.bar(w / 2 - 120, h / 2 + 8, 240, k, "red")
    ui.center("Starting again...", h / 2 - 26, ui.MEDIUM, ui.color.cream)
  end
end

-- the tip: under the card, on a teal note that slides in from the left and bobs
function Play:draw_tip(w, h)
  local tip = self.tips[self.tip_i]
  if not tip then return end
  local e = math.min(1, self.tip_t / 0.35)
  local slide = (1 - e) ^ 3
  local text = tip.text or ""
  local pads = tip.pads or {}
  local size = ui.MEDIUM
  local bw = 300
  local inner = bw - 36
  local lines = math.max(1, math.ceil(ui.width(text, size) / (inner * 0.92)))
  local bh = 24 + (#pads > 0 and 44 or 0) + lines * 30
  local bx = 14 - slide * 340
  local by = 14 + Card.height(#self.L.props.wishes) + 16 + math.sin(self.t * 3) * 2
  local old = ui.alpha
  ui.alpha = e
  ui.panel(bx, by, bw, bh, "ink")
  local y = by + 14
  if #pads > 0 then
    local x = bx + 18
    for _, p in ipairs(pads) do ui.pad(p, x, y, 36); x = x + 44 end
    y = y + 44
  end
  ui.text(bx + 18, y, text, size, ui.color.cream, { width = inner })
  ui.alpha = old
end

function Play:draw_done(w, h)
  local d = self.done
  if d.t < 1.0 then
    -- "Lovely!" over the flat
    local k = math.min(1, d.t / 0.4)
    local s = 1 + (1 - k) * 0.6
    ui.center("Lovely!", h * 0.42 - 30 * s, math.floor(ui.TITLE * s), ui.color.white, { shadow = true, cx = 330 + (w - 330) / 2 })
    return
  end
  local e = math.min(1, (d.t - 1.0) / 0.4)
  local slide = (1 - e) ^ 3
  local pw, ph = 420, 360
  local px, py = 330 + (w - 330 - pw) / 2, (h - ph) / 2 + slide * h
  ui.panel(px, py, pw, ph, "card")
  ui.ribbon(px + 40, py - 18, pw - 80, 56, ui.color.coral, "Flat finished!", ui.LARGE)
  -- the stars, popping in one by one
  for k = 1, 3 do
    local on = k <= d.shown
    local pop = on and math.max(0, 1 - (d.t - 1.6 - (k - 1) * 0.35) / 0.3) or 0
    local size = 70 + pop * 30
    ui.star(px + pw / 2 + (k - 2) * 92, py + 92, size, on)
  end
  ui.center(string.format("%d moves", self.moves), py + 140, ui.LARGE, ui.color.ink, { cx = px + pw / 2 })
  local par = self.L.props.par
  local st = self.L.props.stars or { 0, 0 }
  local line = d.stars < 3 and string.format("%d moves or fewer for three stars", st[1]) or (par and self.moves <= par and "As few as the computer found!" or "Three stars!")
  ui.center(line, py + 176, ui.SMALL, ui.color.dim, { cx = px + pw / 2 })
  if d.newbest and state.best(self.index) == self.moves and d.t > 1.6 then
    ui.badge(px + pw - 40, py + 60, 70, ui.color.leaf)
    ui.in_box("Best!", px + pw - 75, py + 25, 70, 70, ui.SMALL, ui.color.white, { shadow = true })
  end
  if d.t >= 1.8 then ui.menu(self:result_items(), d.sel, py + 214, { width = 300, row = 52, size = ui.MEDIUM, cx = px + pw / 2, enter = d.t - 1.8, id = "result" }) end
  ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Accept" } })
end

function Play:draw_ui()
  local w, h = nova.view()
  if not self.done then
    self:draw_hud(w, h)
    self:draw_tip(w, h)
    if self.toast then
      local a = math.min(1, (2.2 - self.toast.t) / 0.3, self.toast.t / 0.15)
      local old = ui.alpha
      ui.alpha = a
      local tw = ui.width(self.toast.text, ui.MEDIUM) + 44
      ui.panel(330 + (w - 330 - tw) / 2, 128, tw, 50, "ink", 235)
      ui.center(self.toast.text, 141, ui.MEDIUM, ui.color.cream, { cx = 330 + (w - 330) / 2 })
      ui.alpha = old
    end
  else
    self.card:draw(14, 14, 300)
    self:draw_done(w, h)
  end
  if self.pause then
    nova.ui.rect(0, 0, w, h, { 30, 26, 44, 150 })
    local pw = 420
    ui.panel(w / 2 - pw / 2, 110, pw, 330, "card")
    ui.ribbon(w / 2 - 140, 92, 280, 56, ui.color.teal, "Paused", ui.LARGE)
    ui.menu(PAUSE, self.pause.sel, 170, { width = 340, row = 62, size = ui.MEDIUM, enter = self.pause.t, id = "pause" })
    ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Accept" }, { "pad_plus", "Carry on" } })
  end
  transition.draw()
end

return Play

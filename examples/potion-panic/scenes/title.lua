-- The front of the game: the title card, the main menu, the potion book (every level, a page for each biome), the story cards, Free Brew (a level to pick, then the rules) and the
-- options. They are screens of one scene, so the music carries on; a screen settles into place as it opens and lifts away as it closes. Behind them is a wizard's workbench at night,
-- with the cauldron bubbling: nothing of any level is shown before you play it.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local data = require("lib.data")
local Kitchen = require("lib.kitchen")
local View = require("lib.view")
local transition = require("lib.transition")

local Title = nova.scene {}

local MENU = { "Story", "Free brew", "Options" }
local BLURB = {
  "Twelve levels in four regions, and a shop to save. Begin with the Primer.",
  "Any level you have beaten, with rules of your own.",
  "Volume, anti-aliasing and vibration.",
}

local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end

local function default_rules()
  local r = {}
  for k, v in pairs(Kitchen.DEFAULT_RULES) do r[k] = v end
  return r
end

-- the rules of Free Brew: { key, label, values = { { value, text } ... } }
local RULES = {
  { "time", "Time", { { 0, "Level's own" }, { 120, "2 minutes" }, { 180, "3 minutes" }, { 300, "5 minutes" }, { 600, "10 minutes" } } },
  { "pace", "Orders", { { 1, "Relaxed" }, { 2, "Normal" }, { 3, "Rush" } } },
  { "recipes", "Potions", { { "level", "The level's" }, { "easy", "Easy ones" }, { "all", "Anything" } } },
  { "burn", "Burning", { { true, "On" }, { false, "Off" } } },
  { "slippery", "Floors", { { false, "As they are" }, { true, "All icy" } } },
  { "hazards", "Hazards", { { true, "On" }, { false, "Off" } } },
  { "value", "Potion value", { { 1, "x1" }, { 2, "x2" }, { 3, "x3" } } },
}

-- ---- the book's pages ------------------------------------------------------------------------------------------------------------
-- 1 the Primer, 2 to 5 a biome each (three levels), 6 the notebook. Pages 1 and 2 are a spread, 3 and 4, 5 and 6.
local PAGES = 6

local function page_levels(p)
  if p < 2 or p > 5 then return nil end
  local list = {}
  for i, lv in ipairs(data.levels) do if lv.biome == p - 1 then list[#list + 1] = i end end
  return list
end

local function entries_on(p)
  if p == 1 then return 1 end
  if p >= 2 and p <= 5 then return 3 end
  return 0
end

local function total_stars()
  local n = 0
  for i = 1, #data.levels do n = n + state.stars(i) end
  return n
end

-- ---- entering and leaving ----------------------------------------------------------------------------------------------------------

function Title:enter(screen)
  self.screen = screen or "title"
  self.choice = 1
  self.t = 0
  self.entered = 0
  self.lifting = nil
  self.pending = nil
  state.rules = state.rules or default_rules()
  self.page, self.entry = 1, 1
  self.spread = 1
  self.flip = nil
  if self.screen == "book" or self.screen == "map" then self.screen = "book"; self:open_book() end
  if self.screen == "rules" then self.choice = 1 end
  if self.screen == "story" then self:begin_story(state.pending_story or "intro", "book") end
  View.setup_apothecary(state.smooth)
  audio.music("menu", { fade = 0.8 })
  state.apply_volumes()
  transition.reveal(0.35)
end

function Title:leave() View.leave() end

-- the book opens at the page of the level to play next (the Primer first of all)
function Title:open_book()
  if not state.tutorial_done() then self.page, self.entry = 1, 1
  else
    local n = state.next_level()
    local lv = data.levels[n]
    self.page = lv.biome + 1
    local list = page_levels(self.page)
    for k, i in ipairs(list) do if i == n then self.entry = k end end
  end
  self.spread = (self.page + 1) // 2
end

function Title:go(screen, choice)
  if self.lifting then return end
  self.pending, self.pending_choice = screen, choice
  self.lifting = 0
end

-- ---- the story ---------------------------------------------------------------------------------------------------------------------

function Title:begin_story(key, after)
  self.story = { key = key, cards = data.story[key], i = 1, chars = 0, after = after }
  self.screen = "story"
  audio.sfx("book_open")
end

function Title:end_story()
  local s = self.story
  state.set_seen(s.key)
  state.pending_story = nil
  self.story = nil
  if s.after == "start" then self:start_level()
  elseif s.after == "book" then self:go("book")
  else self:go("menu") end
end

function Title:update_story(dt)
  local s = self.story
  local text = s.cards[s.i][2]
  local before = math.floor(s.chars)
  s.chars = math.min(#text, s.chars + dt * 55)
  if math.floor(s.chars) ~= before and math.floor(s.chars) % 4 == 0 then audio.sfx("menu_move", { volume = 0.25, pitch = 1.5 }) end
  if nova.input.pressed("a") or nova.input.pressed("start") then
    if s.chars < #text then s.chars = #text
    else
      audio.sfx("page")
      if s.i < #s.cards then s.i, s.chars = s.i + 1, 0 else self:end_story() end
    end
  elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then
    self:end_story()
  end
end

-- ---- starting ------------------------------------------------------------------------------------------------------------------------

function Title:start_level()
  local level = (state.level == 0) and data.tutorial or data.levels[state.level]
  local biome = data.biomes[level.biome]
  audio.stop_music(0.6)
  audio.sfx("whoosh")
  transition.cover({ title = string.upper(level.name), sub = (state.level == 0) and "Learn the craft" or biome.name, color = biome.banner }, function() nova.goto_scene("play") end)
  self.screen = "starting"
end

local function first_of_biome(i)
  return i == 1 or data.levels[i - 1].biome ~= data.levels[i].biome
end

-- ---- the update ----------------------------------------------------------------------------------------------------------------------

function Title:update(dt)
  self.t = self.t + dt
  self.entered = self.entered + dt
  transition.update(dt)
  if nova.input.pressed("selftest") then require("lib.selftest").run() end
  if self.sim then
    if not self.sim:step(400) then self.sim = nil end
  elseif nova.input.pressed("autoplay") and self.screen == "title" then
    self.sim = require("lib.selftest").bot_job()
  end
  if self.screen == "boxart" or self.screen == "icon" then return end
  if self.screen == "title" and nova.input.pressed("art_box") then self.screen = "boxart"; return end
  if self.screen == "title" and nova.input.pressed("art_icon") then self.screen = "icon"; return end
  if transition.busy() then return end
  if self.lifting then
    self.lifting = self.lifting + dt / 0.16
    if self.lifting >= 1 then
      self.screen, self.choice, self.entered, self.lifting = self.pending, self.pending_choice or 1, 0, nil
      self.pending = nil
      if self.screen == "book" then self:open_book() end
    end
    return
  end
  if self.flip then
    self.flip.t = self.flip.t + dt / 0.5
    if self.flip.t >= 0.5 and self.spread ~= self.flip.to then self.spread = self.flip.to end
    if self.flip.t >= 1 then self.flip = nil end
  end
  local screen = self.screen
  if screen == "title" then
    if nova.input.pressed("start") or nova.input.pressed("a") then audio.sfx("menu_accept"); self:go("menu") end
  elseif screen == "menu" then
    local choice, action = ui.navigate(self.choice, #MENU)
    self.choice = choice
    if action == "back" then audio.sfx("menu_back"); self:go("title")
    elseif action == "accept" then
      audio.sfx("menu_accept")
      if choice == 1 then
        state.mode = "campaign"
        if not state.seen("intro") then self:begin_story("intro", "book") else self:go("book") end
      elseif choice == 2 then
        state.mode = "free"
        self:go("free", math.max(1, math.min(state.level or 1, #data.levels)))
      else
        self:go("options")
      end
    end
  elseif screen == "story" then
    self:update_story(dt)
  elseif screen == "book" then
    self:update_book()
  elseif screen == "free" then
    self:update_free()
  elseif screen == "rules" then
    self:update_rules()
  elseif screen == "options" then
    local choice, action = ui.navigate(self.choice, 4)
    self.choice = choice
    local step = (action == "right" and 0.1) or (action == "left" and -0.1) or 0
    local flip = action == "accept" or step ~= 0
    if choice == 1 and step ~= 0 then state.music_volume = math.max(0, math.min(1, state.music_volume + step)); state.save_options(); audio.sfx("menu_move") end
    if choice == 2 and step ~= 0 then state.sfx_volume = math.max(0, math.min(1, state.sfx_volume + step)); state.save_options(); audio.sfx("menu_move") end
    if choice == 3 and flip then state.smooth = not state.smooth; state.save_options(); View.setup_apothecary(state.smooth); audio.sfx("menu_move") end
    if choice == 4 and flip then state.vibration = not state.vibration; state.save_options(); audio.sfx("menu_move"); if state.vibration then nova.input.rumble(0.6, 0.15) end end
    if action == "back" then audio.sfx("menu_back"); self:go("menu", 3) end
  end
end

-- turning to another page (the book flips when the page is on another spread)
function Title:turn_to(p)
  p = math.max(1, math.min(PAGES, p))
  if p == self.page then return end
  local old_spread = (self.page + 1) // 2
  local new_spread = (p + 1) // 2
  self.page = p
  self.entry = math.max(1, math.min(self.entry, math.max(1, entries_on(p))))
  audio.sfx("menu_move")
  if new_spread ~= old_spread then
    self.flip = { t = 0, to = new_spread, dir = new_spread > old_spread and 1 or -1 }
    audio.sfx("page")
  end
end

function Title:update_book()
  if self.flip then return end
  -- (a shortcut for the tests: F9 in the book marks the Primer as done)
  if nova.input.pressed("autoplay") and not state.tutorial_done() then
    state.set_tutorial_done()
    nova.log("potion: primer skipped")
    self:open_book()
    return
  end
  if nova.input.pressed("left") or nova.input.pressed("l1") then self:turn_to(self.page - 1) end
  if nova.input.pressed("right") or nova.input.pressed("r1") then self:turn_to(self.page + 1) end
  local n = entries_on(self.page)
  if n > 0 then
    if nova.input.pressed("up") then self.entry = (self.entry - 2) % n + 1; audio.sfx("menu_move") end
    if nova.input.pressed("down") then self.entry = self.entry % n + 1; audio.sfx("menu_move") end
  end
  if nova.input.pressed("b") or nova.input.pressed("menu_back") then audio.sfx("menu_back"); self:go("menu", 1); return end
  if nova.input.pressed("a") or nova.input.pressed("start") then
    if self.page == 1 then
      audio.sfx("menu_accept")
      state.level = 0
      self:start_level()
    elseif self.page >= 2 and self.page <= 5 then
      local i = page_levels(self.page)[self.entry]
      if state.unlocked(i) then
        audio.sfx("menu_accept")
        state.level = i
        local b = data.levels[i].biome
        if first_of_biome(i) and not state.seen("biome" .. b) then self:begin_story("biome" .. b, "start") else self:start_level() end
      else
        audio.sfx("nope")
      end
    end
  end
end

function Title:update_free()
  local n = #data.levels
  local i = self.choice
  local moved = i
  if nova.input.pressed("right") then moved = i + 1 end
  if nova.input.pressed("left") then moved = i - 1 end
  if nova.input.pressed("down") then moved = i + 4 end
  if nova.input.pressed("up") then moved = i - 4 end
  if moved ~= i and moved >= 1 and moved <= n then self.choice = moved; audio.sfx("menu_move") end
  if nova.input.pressed("b") or nova.input.pressed("menu_back") then audio.sfx("menu_back"); self:go("menu", 2); return end
  if nova.input.pressed("a") or nova.input.pressed("start") then
    if state.stars(self.choice) >= 1 then
      audio.sfx("menu_accept")
      state.level = self.choice
      self:go("rules")
    else
      audio.sfx("nope")
    end
  end
end

function Title:update_rules()
  local rows = #RULES + 1
  local choice, action = ui.navigate(self.choice, rows)
  self.choice = choice
  local r = state.rules
  if choice <= #RULES then
    local def = RULES[choice]
    local step = (action == "right" and 1) or (action == "left" and -1) or (action == "accept" and 1) or 0
    if step ~= 0 then
      local at = 1
      for i, v in ipairs(def[3]) do if v[1] == r[def[1]] then at = i end end
      at = (at - 1 + step) % #def[3] + 1
      r[def[1]] = def[3][at][1]
      audio.sfx("menu_move")
    end
  elseif action == "accept" then
    audio.sfx("menu_accept")
    self:start_level()
  end
  if action == "back" then audio.sfx("menu_back"); self:go("free", state.level) end
end

-- ---- drawing -----------------------------------------------------------------------------------------------------------------------

function Title:draw()
  local w, h = nova.view()
  local screen = self.screen
  local shift = 0
  if screen == "menu" or screen == "options" then shift = 2.6 end
  if screen == "icon" or screen == "boxart" then shift = (screen == "boxart" and w > h) and -2.4 or 0 end
  View.apothecary(self.t, shift, w, h)
end

function Title:draw_logo(y, size)
  ui.center("POTION", y, size, ui.color.cream, { font = "display", shadow = true })
  ui.center("PANIC", y + size * 1.05, size, ui.color.gold, { font = "display", shadow = true })
end

function Title:draw_ui()
  local w, h = nova.view()
  if transition.busy() then transition.draw(); return end
  local screen = self.screen
  if screen == "icon" then return end
  if screen == "boxart" then
    if w > h then
      ui.text(w * 0.06, h * 0.12, "POTION", 84, ui.color.cream, { font = "display", shadow = true })
      ui.text(w * 0.06, h * 0.12 + 92, "PANIC", 84, ui.color.gold, { font = "display", shadow = true })
    else
      ui.center("POTION", h * 0.05, 70, ui.color.cream, { font = "display", shadow = true })
      ui.center("PANIC", h * 0.05 + 76, 70, ui.color.gold, { font = "display", shadow = true })
    end
    return
  end
  if screen == "starting" then return end
  local e = ease_out(self.entered / 0.32)
  ui.oy, ui.alpha = (1 - e) * -26, e
  if self.lifting then
    local k = math.min(1, self.lifting)
    ui.oy, ui.alpha = -k * 20, 1 - k
  end
  local enter = self.entered
  if screen == "title" then
    ui.panel(w / 2 - 300, 14, 600, 212, "ink", 235)
    self:draw_logo(24 + math.sin(self.t * 1.2) * 2, ui.TITLE)
    if math.floor(self.t * 1.6) % 2 == 0 then ui.center("PRESS START", 440, ui.LARGE, ui.color.cream, { font = "display", shadow = true }) end
    ui.center("Made by Jasper Milan", 508, ui.SMALL, ui.color.lilac, { shadow = true })
    ui.hints({ { "pad_a", "Start" } })
  elseif screen == "menu" then
    ui.panel(30, 20, 420, 130, "ink", 235)
    ui.text(52, 24, "POTION", ui.HEAD, ui.color.cream, { font = "display", shadow = true })
    ui.text(52, 76, "PANIC", ui.HEAD, ui.color.gold, { font = "display", shadow = true })
    ui.menu(MENU, self.choice, 176, { width = 400, cx = 240, id = "main", enter = enter, row = 78 })
    ui.panel(30, 408, 440, 70, "ink", 235)
    ui.text(46, 418, BLURB[self.choice], ui.SMALL, ui.color.cream, { width = 408 })
    ui.hints({ { "pad_a", "Accept" }, { "pad_b", "Back" } })
  elseif screen == "story" then
    self:draw_story(w)
  elseif screen == "book" then
    self:draw_book(w, h)
  elseif screen == "free" then
    self:draw_free(w, enter)
  elseif screen == "rules" then
    self:draw_rules(w, enter)
  elseif screen == "options" then
    ui.panel(30, 20, 420, 70, "ink", 235)
    ui.in_box("OPTIONS", 30, 20, 420, 70, ui.HEAD - 6, ui.color.cream, { font = "display" })
    local function pct(v) return string.format("< %d >", math.floor(v * 10 + 0.5)) end
    local function onoff(v) return v and "< On >" or "< Off >" end
    ui.menu({
      { "Music", pct(state.music_volume) },
      { "Sounds", pct(state.sfx_volume) },
      { "Smooth edges", onoff(state.smooth) },
      { "Vibration", onoff(state.vibration) },
    }, self.choice, 110, { width = 520, cx = 300, id = "options", enter = enter, row = 78, size = ui.LARGE })
    ui.hints({ { "pad_a", "Change" }, { "pad_b", "Back" } })
  end
  ui.oy, ui.alpha = 0, 1
  transition.draw()
end

-- ---- the story ----------------------------------------------------------------------------------------------------------------------

function Title:draw_story(w)
  local s = self.story
  if not s then return end
  local card = s.cards[s.i]
  ui.panel(36, 286, w - 72, 190, "page")
  ui.panel(36, 240, 330, 58, "ink")
  ui.in_box(card[1], 36, 240, 330, 58, ui.MEDIUM, ui.color.cream, { font = "display" })
  local shown = card[2]:sub(1, math.floor(s.chars))
  ui.text(66, 312, shown, ui.MEDIUM, ui.color.ink, { width = w - 132 })
  if s.chars >= #card[2] then ui.right((s.i < #s.cards) and ">" or "", w - 70, 430, ui.LARGE, ui.color.wine) end
  ui.hints({ { "pad_a", "Next" }, { "pad_b", "Skip" } })
end

-- ---- the potion book ---------------------------------------------------------------------------------------------------------------

local PAGE_W, PAGE_H = 420, 414
local PX_L, PX_R, PY = 58, 482, 36

-- one page: its content, for the spread being shown
function Title:draw_page(p, x, y)
  local w = PAGE_W
  ui.panel(x, y, w, PAGE_H, "page")
  if p == 1 then
    ui.text(x + 28, y + 22, "The Primer", ui.HEAD - 8, ui.color.ink, { font = "display" })
    nova.ui.rect(x + 28 + ui.ox, y + 72 + ui.oy, w - 56, 3, ui.tint(ui.color.wine, 0.6))
    ui.text(x + 28, y + 90, "Every trick of the craft, one step at a time. Start here.", ui.MEDIUM, ui.color.ink, { width = w - 56 })
    self:draw_entry(x + 16, y + 236, w - 32, 96, "T", "The Primer", state.tutorial_done() and 3 or 0, nil, true, self.page == 1 and self.entry == 1, not state.tutorial_done() and "Start here" or nil)
  elseif p >= 2 and p <= 5 then
    local biome = data.biomes[p - 1]
    ui.text(x + 28, y + 18, biome.short, ui.HEAD - 8, ui.color.ink, { font = "display" })
    nova.ui.rect(x + 28 + ui.ox, y + 68 + ui.oy, w - 56, 3, ui.tint(ui.color.wine, 0.6))
    ui.text(x + 28, y + 76, biome.quirk, ui.SMALL, ui.color.dim, { width = w - 56 })
    for k, i in ipairs(page_levels(p)) do
      local lv = data.levels[i]
      local open = state.unlocked(i)
      self:draw_entry(x + 16, y + 112 + (k - 1) * 98, w - 32, 90, tostring(k), open and lv.name or "???", state.stars(i), open and state.best(i) or nil, open, self.page == p and self.entry == k)
    end
  else
    ui.text(x + 28, y + 18, "Notebook", ui.HEAD - 8, ui.color.ink, { font = "display" })
    nova.ui.rect(x + 28 + ui.ox, y + 68 + ui.oy, w - 56, 3, ui.tint(ui.color.wine, 0.6))
    ui.text(x + 28, y + 90, "Stars", ui.MEDIUM, ui.color.dim)
    ui.right(total_stars() .. " / " .. #data.levels * 3, x + w - 28, y + 90, ui.MEDIUM, ui.color.ink, { font = "display" })
    ui.text(x + 28, y + 128, "Levels cleared", ui.MEDIUM, ui.color.dim)
    ui.right(state.cleared_count() .. " / " .. #data.levels, x + w - 28, y + 128, ui.MEDIUM, ui.color.ink, { font = "display" })
    ui.text(x + 28, y + 180, "Guild seals", ui.MEDIUM, ui.color.dim)
    for b, biome in ipairs(data.biomes) do
      local done = false
      local last
      for i, lv in ipairs(data.levels) do if lv.biome == b then last = i end end
      done = state.stars(last) >= 1
      local sx = x + 40 + (b - 1) * 92
      nova.ui.sprite("ui/iconCircle_brown", sx + 26 + ui.ox, y + 262 + ui.oy, { w = 64, h = 64, color = ui.tint(done and { biome.banner[1] + 40, biome.banner[2] + 40, biome.banner[3] + 40, 255 } or { 90, 80, 90, 200 }) })
      ui.in_box(biome.short:sub(1, 1), sx - 6, y + 236, 64, 52, ui.LARGE, done and ui.color.white or ui.color.dim, { font = "display" })
      ui.in_box(biome.short, sx - 20, y + 304, 92, 30, ui.SMALL, ui.color.ink)
    end
    ui.text(x + 28, y + 354, "Beaten levels open in Free Brew.", ui.SMALL, ui.color.dim, { width = w - 56 })
  end
end

-- a line in the book: a numeral, a name, stars, the best score; `open` false for a sealed level
function Title:draw_entry(x, y, w, h, numeral, name, stars, best, open, selected, note)
  if selected then
    ui.panel(x, y, w, h, "light")
    local bob = math.sin(self.t * 6) * 3
    nova.ui.sprite("ui/cursorGauntlet_bronze", x + 28 + bob + ui.ox, y + h / 2 + ui.oy, { w = 38, h = 38, color = ui.tint({ 255, 255, 255, 255 }) })
  end
  local nx = x + 58
  ui.in_box(numeral, nx, y + (h - 56) / 2, 56, 56, ui.LARGE, open and ui.color.ink or ui.color.dim, { font = "display" })
  local tx = nx + 70
  ui.text(tx, y + 12, name, ui.fit(name, ui.MEDIUM + 2, x + w - tx - 70, "serif"), open and ui.color.ink or ui.color.dim)
  if open then
    for s = 1, 3 do ui.star(tx + 14 + (s - 1) * 34, y + 62, 30, s <= stars) end
    if best and best > 0 then ui.right(tostring(best), x + w - 14, y + 18, ui.SMALL, ui.color.wine) end
    if note then ui.right(note, x + w - 14, y + h - 30, ui.SMALL, ui.color.wine) end
  else
    nova.ui.sprite("ui/iconCircle_brown", tx + 14 + ui.ox, y + 70 + ui.oy, { w = 28, h = 28, color = ui.tint({ 170, 48, 78, 255 }) })
    ui.text(tx + 36, y + 56, "Sealed", ui.SMALL, ui.color.wine)
  end
end

function Title:draw_book(w, h)
  -- the covers
  ui.panel(PX_L - 18, PY - 14, PAGE_W * 2 + 66, PAGE_H + 28, "leather")
  local spread = self.spread
  local left, right = spread * 2 - 1, spread * 2
  self:draw_page(left, PX_L, PY)
  self:draw_page(right, PX_R, PY)
  -- the spine's shadow and a ribbon
  nova.ui.rect(PX_R - 6 + ui.ox, PY + 6 + ui.oy, 6, PAGE_H - 12, ui.tint({ 60, 40, 50 }, 0.35))
  nova.ui.rect(PX_R + ui.ox, PY + 6 + ui.oy, 5, PAGE_H - 12, ui.tint({ 255, 255, 255 }, 0.12))
  nova.ui.rect(PX_R + 56 + ui.ox, PY + PAGE_H - 6 + ui.oy, 22, 40, ui.tint(ui.color.wine))
  -- a page turning
  if self.flip then
    local t = self.flip.t
    local dir = self.flip.dir
    local c = math.cos(math.pi * t)
    local wd = math.max(2, math.abs(c) * PAGE_W)
    local on_right = (dir > 0) == (t < 0.5)
    local x = on_right and PX_R or (PX_R - wd)
    ui.panel(x, PY, wd, PAGE_H, "light")
    nova.ui.rect(x + ui.ox, PY + 4 + ui.oy, wd, PAGE_H - 8, ui.tint({ 60, 40, 50 }, 0.1 + 0.25 * (1 - math.abs(c))))
  end
  -- the pips of the pages
  for p = 1, PAGES do
    local on = p == self.page
    nova.ui.rect(w / 2 - PAGES * 11 + (p - 1) * 22 + ui.ox, PY + PAGE_H + 20 + ui.oy, on and 14 or 8, on and 14 or 8, ui.tint(on and ui.color.gold or ui.color.lilac, on and 1 or 0.5))
  end
  ui.hints({ { "pad_dpad", "Page" }, { "pad_a", "Brew" }, { "pad_b", "Back" } })
end

-- ---- free brew -----------------------------------------------------------------------------------------------------------------------

function Title:draw_free(w, enter)
  ui.text(36, 14, "FREE BREW", ui.HEAD - 8, ui.color.cream, { font = "display", shadow = true })
  local cw, ch, gap = 214, 118, 12
  local cols = 4
  local x0 = (w - (cols * cw + (cols - 1) * gap)) / 2
  for i, lv in ipairs(data.levels) do
    local col, row = (i - 1) % cols, (i - 1) // cols
    local a = ease_out((enter - (i - 1) * 0.03) / 0.3)
    local x, y = x0 + col * (cw + gap), 74 + row * (ch + gap)
    local open = state.stars(i) >= 1
    local sel = i == self.choice
    local old = ui.alpha
    ui.alpha = old * a
    if sel then ui.panel(x - 6, y - 6, cw + 12, ch + 12, "light") end
    ui.panel(x, y, cw, ch, open and "page" or "ink")
    local c = open and ui.color.ink or ui.color.lilac
    ui.text(x + 16, y + 10, tostring(i), ui.LARGE, c, { font = "display" })
    ui.text(x + 16, y + 48, open and lv.name or "???", ui.fit(open and lv.name or "???", ui.SMALL + 1, cw - 32), c)
    if open then
      for s = 1, 3 do ui.star(x + 30 + (s - 1) * 30, y + 92, 26, s <= state.stars(i)) end
    else
      ui.text(x + 16, y + 82, "Sealed", ui.SMALL, ui.color.lilac)
    end
    ui.alpha = old
  end
  if state.cleared_count() == 0 then
    ui.panel(w / 2 - 330, 440, 660, 56, "ink")
    ui.in_box("Beat a level in the Story first.", w / 2 - 330, 440, 660, 56, ui.MEDIUM, ui.color.cream)
  end
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Choose" }, { "pad_b", "Back" } })
end

function Title:draw_rules(w, enter)
  local lv = data.levels[state.level]
  ui.text(36, 8, "YOUR RULES", ui.HEAD - 8, ui.color.cream, { font = "display", shadow = true })
  local r = state.rules
  local items = {}
  for i, def in ipairs(RULES) do
    local text = ""
    for _, v in ipairs(def[3]) do if v[1] == r[def[1]] then text = "< " .. v[2] .. " >" end end
    items[i] = { def[2], text }
  end
  items[#items + 1] = "Start brewing"
  ui.menu(items, self.choice, 64, { width = 600, cx = 346, id = "rules", enter = enter, row = 53, size = ui.MEDIUM, value_size = ui.MEDIUM })
  ui.panel(660, 70, 270, 214, "page")
  ui.text(678, 86, lv.name, ui.fit(lv.name, ui.MEDIUM, 236, "display"), ui.color.ink, { font = "display", width = 240 })
  ui.text(678, 150, "BEST", ui.SMALL, ui.color.dim)
  ui.text(678, 176, tostring(state.free_best(state.level)), ui.NUMBER, ui.color.wine, { font = "display" })
  ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Change" }, { "pad_b", "Back" } })
end

return Title

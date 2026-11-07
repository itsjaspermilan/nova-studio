-- The front of the game: the title card, the main menu, the campaign map, the story cards, Free Brew (a level to pick, then the rules) and the options.
-- They are screens of one scene, so the music carries on; a screen settles down into place as it opens and lifts away as it closes. Behind them stands a
-- live workshop of the biome you are looking at.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local data = require("lib.data")
local Kitchen = require("lib.kitchen")
local View = require("lib.view")
local transition = require("lib.transition")

local Title = nova.scene {}

local MENU = { "Story campaign", "Free brew", "Options" }
local BLURB = {
  "Four regions, twelve levels and a shop to save. Earn a star on a level to open the next.",
  "Any level you have beaten, with rules of your own: the clock, the orders, the potions, the floor.",
  "Volume, anti-aliasing and vibration.",
}

local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end

local function default_rules()
  local r = {}
  for k, v in pairs(Kitchen.DEFAULT_RULES) do r[k] = v end
  return r
end

-- the options of Free Brew's rules: { key, label, values = { { value, text } ... } }
local RULES = {
  { "time", "Time", { { 0, "Level's own" }, { 120, "2 minutes" }, { 180, "3 minutes" }, { 300, "5 minutes" }, { 600, "10 minutes" } } },
  { "pace", "Orders", { { 1, "Relaxed" }, { 2, "Normal" }, { 3, "Rush" } } },
  { "recipes", "Potions", { { "level", "The level's" }, { "easy", "Easy ones only" }, { "all", "Anything the crates make" } } },
  { "burn", "Burning", { { true, "Brews can burn" }, { false, "Brews wait" } } },
  { "slippery", "Floors", { { false, "As they are" }, { true, "All icy" } } },
  { "hazards", "Hazards", { { true, "On" }, { false, "Off" } } },
  { "value", "Potion value", { { 1, "x1" }, { 2, "x2" }, { 3, "x3" } } },
}

function Title:enter(screen)
  self.screen = screen or "title"
  self.choice = 1
  self.t = 0
  self.entered = 0
  self.lifting = nil
  self.pending = nil
  self.previews = {}
  self.biome = 1
  state.rules = state.rules or default_rules()
  if self.screen == "map" then self.choice = state.level or state.next_level() end
  if self.screen == "rules" then self.choice = 1 end
  if self.screen == "story" then self:begin_story(state.pending_story or "intro", "map") end
  self:set_biome(self.screen == "map" and data.levels[self.choice].biome or 1)
  audio.music("menu", { fade = 0.8 })
  state.apply_volumes()
  transition.reveal(0.35)
end

function Title:leave() View.leave() end

-- a live workshop for the backdrop: the first level of a biome, with a brew bubbling
function Title:set_biome(b)
  self.biome = b
  local biome = data.biomes[b]
  local first
  for _, lv in ipairs(data.levels) do if lv.biome == b then first = lv; break end end
  if not self.previews[b] then
    local k = Kitchen.new(first, nil, b)
    for _, st in ipairs(k.stations) do
      if st.kind == "cauldron" then st.state, st.recipe, st.timer, st.total = "brewing", first.recipes[1], 0, 1e9; st.items = {} end
      if st.kind == "counter" and not st.item then st.item = { k = "bottle" } break end
    end
    self.previews[b] = k
  end
  self.kitchen = self.previews[b]
  View.setup(biome, state.smooth)
end

-- go to another screen: this one lifts away first
function Title:go(screen, choice)
  if self.lifting then return end
  self.pending, self.pending_choice = screen, choice
  self.lifting = 0
end

-- ---- the story --------------------------------------------------------------------------------------------------------------------

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
  elseif s.after == "map" then self:go("map", state.level or state.next_level())
  else self:go("menu") end
end

function Title:update_story(dt)
  local s = self.story
  local text = s.cards[s.i][2]
  local before = math.floor(s.chars)
  s.chars = math.min(#text, s.chars + dt * 60)
  if math.floor(s.chars) ~= before and math.floor(s.chars) % 4 == 0 then audio.sfx("menu_move", { volume = 0.25, pitch = 1.5 }) end
  if nova.input.pressed("a") or nova.input.pressed("start") then
    if s.chars < #text then s.chars = #text
    else
      audio.sfx("page")
      if s.i < #s.cards then s.i, s.chars = s.i + 1, 0 else self:end_story() end
    end
  elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then
    -- skip the lot
    self:end_story()
  end
end

-- ---- starting ----------------------------------------------------------------------------------------------------------------------

function Title:start_level()
  local level = data.levels[state.level]
  local biome = data.biomes[level.biome]
  audio.stop_music(0.6)
  audio.sfx("whoosh")
  transition.cover({ title = string.upper(level.name), sub = biome.name, color = biome.banner }, function() nova.goto_scene("play") end)
  self.screen = "starting"
end

-- the first level of a biome opens with its story card, once
local function first_of_biome(i)
  return i == 1 or data.levels[i - 1].biome ~= data.levels[i].biome
end

-- ---- the update ---------------------------------------------------------------------------------------------------------------------

function Title:update(dt)  self.t = self.t + dt
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
      if self.screen == "map" then self:set_biome(data.levels[self.choice].biome) end
      if self.screen ~= "map" and self.screen ~= "story" and self.biome ~= 1 then self:set_biome(1) end
    end
    return
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
        state.level = math.min(state.next_level(), #data.levels)
        if not state.seen("intro") then self:begin_story("intro", "map") else self:go("map", state.level) end
      elseif choice == 2 then
        state.mode = "free"
        self:go("free", math.min(state.level or 1, #data.levels))
      else
        self:go("options")
      end
    end
  elseif screen == "story" then
    self:update_story(dt)
  elseif screen == "map" then
    self:update_map()
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
    if choice == 3 and flip then state.smooth = not state.smooth; state.save_options(); View.setup(data.biomes[self.biome], state.smooth); audio.sfx("menu_move") end
    if choice == 4 and flip then state.vibration = not state.vibration; state.save_options(); audio.sfx("menu_move"); if state.vibration then nova.input.rumble(0.6, 0.15) end end
    if action == "back" then audio.sfx("menu_back"); self:go("menu", 3) end
  end
end

function Title:update_map()
  local n = #data.levels
  local i = self.choice
  local moved = i
  if nova.input.pressed("right") then moved = i + 1 end
  if nova.input.pressed("left") then moved = i - 1 end
  if nova.input.pressed("r1") or nova.input.pressed("down") then moved = math.min(n, i + 3) end
  if nova.input.pressed("l1") or nova.input.pressed("up") then moved = math.max(1, i - 3) end
  if moved ~= i and moved >= 1 and moved <= n then
    self.choice = moved
    audio.sfx("menu_move")
    local b = data.levels[moved].biome
    if b ~= self.biome then self:set_biome(b) end
  end
  if nova.input.pressed("b") or nova.input.pressed("menu_back") then audio.sfx("menu_back"); self:go("menu", 1); return end
  if nova.input.pressed("a") or nova.input.pressed("start") then
    if state.unlocked(self.choice) then
      audio.sfx("menu_accept")
      state.level = self.choice
      local b = data.levels[self.choice].biome
      if first_of_biome(self.choice) and not state.seen("biome" .. b) then self:begin_story("biome" .. b, "start") else self:start_level() end
    else
      audio.sfx("nope")
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
  if moved ~= i and moved >= 1 and moved <= n then
    self.choice = moved
    audio.sfx("menu_move")
    local b = data.levels[moved].biome
    if b ~= self.biome then self:set_biome(b) end
  end
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
  if self.screen == "icon" or self.screen == "boxart" then
    -- (the store pictures: the workshop of the meadow, close in, with the cauldron bubbling)
    View.setup(data.biomes[1], state.smooth)
    View.showcase(data.biomes[1], 2.3, self.screen == "icon" and "icon" or (w > h and "wide" or "portrait"), w, h)
    return
  end
  local k = self.kitchen
  local shift = (self.screen == "title" or self.screen == "starting") and 0 or ((self.screen == "map" or self.screen == "story") and 0 or 2.2)
  View.camera(k, self.screen == "map" and 1.6 or 0.9, w, h, shift, math.sin(self.t * 0.25) * 1.6)
  View.scenery(k, data.biomes[self.biome], self.t)
  View.draw(k, data.biomes[self.biome], self.t)
end

local function logo(t, y)
  local w = nova.view()
  ui.panel(w / 2 - 330, y - 10, 660, 150, "brown")
  ui.center("POTION", y + 8, 58, ui.color.cream, { font = "display", shadow = true })
  ui.center("PANIC", y + 68, 58, ui.color.gold, { font = "display", shadow = true })
end

function Title:draw_ui()
  local w = nova.view()
  if transition.busy() then transition.draw(); return end
  local screen = self.screen
  if screen == "icon" then return end
  if screen == "boxart" then
    local _, h = nova.view()
    if w > h then
      ui.panel(w * 0.04, h * 0.1, 410, 200, "brown")
      ui.text(w * 0.04 + 36, h * 0.1 + 18, "POTION", 74, ui.color.cream, { font = "display", shadow = true })
      ui.text(w * 0.04 + 36, h * 0.1 + 96, "PANIC", 74, ui.color.gold, { font = "display", shadow = true })
    else
      ui.panel(w / 2 - 230, h * 0.06, 460, 190, "brown")
      ui.center("POTION", h * 0.06 + 16, 60, ui.color.cream, { font = "display", shadow = true })
      ui.center("PANIC", h * 0.06 + 88, 60, ui.color.gold, { font = "display", shadow = true })
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
    logo(self.t, 90 + math.sin(self.t * 1.2) * 3)
    if math.floor(self.t * 1.6) % 2 == 0 then ui.center("PRESS START", 320, 20, ui.color.cream, { font = "display", shadow = true }) end
    ui.center("Made by Jasper Milan", 504, 11, ui.color.cream, { shadow = true })
    ui.hints({ { "pad_a", "Start" } })
  elseif screen == "menu" then
    ui.heading("POTION PANIC", 60, 34, 38, ui.color.cream, { shadow = true })
    ui.menu(MENU, self.choice, 130, { width = 340, cx = 230, id = "main", enter = enter, row = 58 })
    ui.panel(60, 330, 340, 130, "beige")
    ui.text(80, 346, BLURB[self.choice], 14, ui.color.ink, { width = 300 })
    if self.choice == 1 then ui.text(80, 424, "Cleared " .. state.cleared_count() .. " of " .. #data.levels, 13, ui.color.wine, { font = "display" }) end
    ui.hints({ { "pad_a", "Accept" }, { "pad_b", "Back" } })
  elseif screen == "story" then
    self:draw_story(w)
  elseif screen == "map" then
    self:draw_map(w, enter)
  elseif screen == "free" then
    self:draw_free(w, enter)
  elseif screen == "rules" then
    self:draw_rules(w, enter)
  elseif screen == "options" then
    ui.heading("OPTIONS", w / 2 - ui.width("OPTIONS", 38, "display") / 2, 36, 38, ui.color.cream, { shadow = true })
    local function pct(v) return string.format("< %d >", math.floor(v * 10 + 0.5)) end
    local function onoff(v) return v and "< On >" or "< Off >" end
    ui.menu({
      { "Music volume", pct(state.music_volume) },
      { "Sound volume", pct(state.sfx_volume) },
      { "Smooth edges", onoff(state.smooth) },
      { "Vibration", onoff(state.vibration) },
    }, self.choice, 120, { width = 480, id = "options", enter = enter, row = 56 })
    ui.hints({ { "pad_a", "Change" }, { "pad_b", "Back" } })
  end
  ui.oy, ui.alpha = 0, 1
  transition.draw()
end

function Title:draw_story(w)
  local s = self.story
  if not s then return end
  local card = s.cards[s.i]
  ui.panel(w / 2 - 340, 330, 680, 160, "beige")
  ui.panel(w / 2 - 340, 300, 230, 40, "brown")
  ui.text(w / 2 - 322, 309, card[1], 15, ui.color.cream, { font = "display" })
  local shown = card[2]:sub(1, math.floor(s.chars))
  ui.text(w / 2 - 310, 352, shown, 17, ui.color.ink, { width = 620 })
  ui.text(w / 2 + 300, 462, (s.i < #s.cards) and ">" or "", 14, ui.color.wine)
  ui.hints({ { "pad_a", "Next" }, { "pad_b", "Skip" } })
end

function Title:draw_map(w, enter)
  ui.heading("THE MAP", 36, 18, 30, ui.color.cream, { shadow = true })
  local n = #data.levels
  local perb = 3
  -- the four regions across the screen, three levels each
  for b, biome in ipairs(data.biomes) do
    local cx = 120 + (b - 1) * 240
    local on = biome == data.biomes[self.biome]
    ui.panel(cx - 100, 62, 200, 34, on and "beige" or "brown")
    ui.text(cx - 100 + (200 - ui.width(biome.short, 14, "display")) / 2, 70, biome.short, 14, on and ui.color.ink or ui.color.cream, { font = "display" })
  end
  for i = 1, n do
    local lv = data.levels[i]
    local b = lv.biome
    local cx = 120 + (b - 1) * 240 + ((i - 1) % perb - 1) * 66
    local cy = 150 + math.sin(i * 1.3) * 12 + ((i - 1) % perb) * 6
    local locked = not state.unlocked(i)
    local stars = state.stars(i)
    local sel = i == self.choice
    local size = sel and 50 + math.sin(self.t * 5) * 2 or 42
    local c = locked and { 120, 100, 86, 255 } or { 255, 255, 255, 255 }
    ui.icon("ui/buttonSquare_" .. (sel and "beige" or "brown"), cx - size / 2, cy - size / 2, size, c)
    ui.text(cx - ui.width(tostring(i), 16, "display") / 2, cy - 11, tostring(i), 16, (sel and not locked) and ui.color.ink or ui.color.cream, { font = "display" })
    if stars > 0 then
      for s = 1, 3 do ui.star(cx + (s - 2) * 14, cy + size / 2 + 8, 14, s <= stars) end
    elseif locked then
      ui.icon("ui/iconCross_brown", cx - 8, cy + size / 2 - 2, 16, { 255, 255, 255, 200 })
    end
  end
  -- the card of the level
  local lv = data.levels[self.choice]
  local biome = data.biomes[lv.biome]
  ui.panel(w / 2 - 320, 300, 640, 190, "beige")
  ui.text(w / 2 - 296, 316, lv.name, ui.fit(lv.name, 24, 400, "display"), ui.color.ink, { font = "display" })
  ui.text(w / 2 - 296, 346, biome.name, 12, ui.color.dim)
  local x = w / 2 - 296
  ui.text(x, 372, "BREWS", 11, ui.color.dim)
  for _, id in ipairs(lv.recipes) do
    local r = data.recipes[id]
    ui.flask(x, 390, 18, r.color)
    ui.text(x + 26, 392, r.name, 13, ui.color.ink)
    x = x + 26 + ui.width(r.name, 13) + 22
  end
  local goal = lv.stars
  ui.text(w / 2 - 296, 430, "STARS AT", 11, ui.color.dim)
  for i = 1, 3 do
    ui.star(w / 2 - 296 + 66 + (i - 1) * 96, 436, 16, state.stars(self.choice) >= i)
    ui.text(w / 2 - 296 + 80 + (i - 1) * 96, 429, tostring(goal[i]), 14, ui.color.ink, { font = "display" })
  end
  ui.text(w / 2 + 130, 316, "BEST", 11, ui.color.dim)
  ui.text(w / 2 + 130, 332, tostring(state.best(self.choice)), 24, ui.color.wine, { font = "display" })
  if not state.unlocked(self.choice) then ui.text(w / 2 + 70, 440, "Earn a star on the level before.", 12, ui.color.wine, { width = 230 }) end
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Brew" }, { "pad_b", "Back" } })
end

function Title:draw_free(w, enter)
  ui.heading("FREE BREW", w / 2 - ui.width("FREE BREW", 36, "display") / 2, 22, 36, ui.color.cream, { shadow = true })
  local cleared = state.cleared_count()
  local cw, ch, gap = 150, 100, 14
  local cols = 4
  local total = cols * cw + (cols - 1) * gap
  local x0 = (w - total) / 2
  for i, lv in ipairs(data.levels) do
    local col, row = (i - 1) % cols, (i - 1) // cols
    local a = ease_out((enter - (i - 1) * 0.03) / 0.3)
    local x, y = x0 + col * (cw + gap), 80 + row * (ch + gap)
    local open = state.stars(i) >= 1
    local sel = i == self.choice
    local old = ui.alpha
    ui.alpha = old * a
    if sel then ui.panel(x - 5, y - 5, cw + 10, ch + 10, "light") end
    ui.panel(x, y, cw, ch, open and "beige" or "brown")
    local c = open and ui.color.ink or ui.color.dim
    ui.text(x + 14, y + 12, tostring(i), 24, c, { font = "display" })
    ui.text(x + 14, y + 46, lv.name, ui.fit(lv.name, 13, cw - 24), c, { width = cw - 24 })
    if open then
      for s = 1, 3 do ui.star(x + 20 + (s - 1) * 18, y + 82, 15, s <= state.stars(i)) end
      ui.text(x + cw - 14 - ui.width(tostring(state.free_best(i)), 12), y + 76, tostring(state.free_best(i)), 12, ui.color.wine)
    else
      ui.text(x + 14, y + 76, "locked", 12, ui.color.dim)
    end
    ui.alpha = old
  end
  if cleared == 0 then
    ui.panel(w / 2 - 250, 440, 500, 40, "beige")
    ui.center("Beat a level in the campaign to brew it here.", 450, 14, ui.color.ink)
  end
  ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Choose" }, { "pad_b", "Back" } })
end

function Title:draw_rules(w, enter)
  local lv = data.levels[state.level]
  ui.heading("YOUR RULES", 40, 24, 32, ui.color.cream, { shadow = true })
  local r = state.rules
  local items = {}
  for i, def in ipairs(RULES) do
    local text = ""
    for _, v in ipairs(def[3]) do if v[1] == r[def[1]] then text = "< " .. v[2] .. " >" end end
    items[i] = { def[2], text }
  end
  items[#items + 1] = "Start brewing"
  ui.menu(items, self.choice, 84, { width = 520, cx = 310, id = "rules", enter = enter, row = 48, size = 15 })
  ui.panel(600, 84, 330, 190, "beige")
  ui.text(620, 100, lv.name, ui.fit(lv.name, 22, 290, "display"), ui.color.ink, { font = "display" })
  ui.text(620, 130, data.biomes[lv.biome].name, 12, ui.color.dim)
  ui.text(620, 158, "BEST HERE", 11, ui.color.dim)
  ui.text(620, 174, tostring(state.free_best(state.level)), 28, ui.color.wine, { font = "display" })
  ui.text(620, 220, "Rules change what a game is worth to you, not your stars.", 12, ui.color.ink, { width = 290 })
  ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Change" }, { "pad_b", "Back" } })
end

return Title

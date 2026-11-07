-- A game: one level, from the countdown to the results. state.mode says whether it is the campaign or Free Brew (with state.rules); state.level 0 is the tutorial.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local data = require("lib.data")
local Kitchen = require("lib.kitchen")
local View = require("lib.view")
local Bot = require("lib.bot")
local Tutorial = require("lib.tutorial")
local transition = require("lib.transition")

local Play = nova.scene {}

local PAUSE_ITEMS = { "Resume", "Recipes", "Restart", "Leave" }
local INK = { 96, 58, 130 }

local function level_spec(level)
  local biome = data.biomes[level.biome]
  return { title = string.upper(level.name), sub = level.tutorial and "Learn the craft" or biome.name, color = biome.banner }
end

function Play:enter()
  local level = (state.level == 0) and data.tutorial or data.levels[state.level]
  self.level = level
  self.biome = data.biomes[level.biome]
  self.tutorial = level.tutorial
  self.free = state.mode == "free" and not self.tutorial
  local rules = self.free and state.rules or nil
  self.k = Kitchen.new(level, rules, math.floor(nova.time() * 1000) % 100000 + 1)
  self.k.playing = true
  self.tut = self.tutorial and Tutorial.new(self.k) or nil
  self.t = 0
  self.phase = "intro"
  self.intro = 3.6
  self.count = 5
  self.pause_choice = 1
  self.choice = 1
  self.result_t = 0
  self.pops = {}
  self.work_t = 0
  self.bot = nil
  self.flash, self.shake, self.bubble_t = 0, 0, 1
  View.setup(self.biome, state.smooth)
  audio.music(self.biome.music, { fade = 0.8 })
  state.apply_volumes()
  transition.reveal(0.4)
end

function Play:leave() View.leave() end

-- ---- input -------------------------------------------------------------------------------------------------------------------------

function Play:read_input()
  if self.bot then return self.bot:update(1 / 60) end
  return {
    mx = nova.input.axis("move_x"), mz = nova.input.axis("move_y"),
    grab = nova.input.pressed("grab"), work = nova.input.down("work"), dash = nova.input.pressed("dash"), throw = nova.input.pressed("throw"),
  }
end

-- ---- events --------------------------------------------------------------------------------------------------------------------------

function Play:pop(text, st_or_pos, color)
  local x, z = st_or_pos.cx or st_or_pos.x, st_or_pos.cz or st_or_pos.z
  self.pops[#self.pops + 1] = { text = text, x = x, y = 1.2, z = z, age = 0, color = color or ui.color.cream }
end

function Play:handle_events(events)
  local k = self.k
  for _, e in ipairs(events) do
    local t = e.type
    if t == "grab" then
      audio.sfx("grab")
      if e.st and e.st.kind == "crate" then self:pop(data.ingredients[e.st.ing].name, e.st, ui.color.cream) end
    elseif t == "drop" then audio.sfx("drop")
    elseif t == "nope" then audio.sfx("nope")
    elseif t == "pot_add" then audio.sfx("pot_add")
    elseif t == "brew_start" then audio.sfx("brew_start"); audio.sfx("pour")
    elseif t == "brew_done" then audio.sfx("ding"); self:pop("Ready!", e.st, ui.color.gold)
    elseif t == "burnt" then audio.sfx("fail"); self:pop("Burnt!", e.st, ui.color.wine)
    elseif t == "warn" then audio.sfx("beep", { pitch = 0.7 }); self:pop("Hurry!", e.st, { 255, 150, 110 })
    elseif t == "fill" then audio.sfx("bottle")
    elseif t == "serve" then
      audio.sfx("coins"); audio.sfx("ding", { pitch = 1.2 })
      for _, st in ipairs(k.stations) do if st.kind == "hatch" then self:pop("+" .. e.points, st, ui.color.gold) end end
    elseif t == "reject" then audio.sfx("nope")
    elseif t == "bin" then audio.sfx("drop", { pitch = 0.7 }); if e.item and e.item.k == "potion" then audio.sfx("shatter") end
    elseif t == "expire" then audio.sfx("fail"); self:pop("-10", { x = 0.5, z = 0.5 }, ui.color.wine)
    elseif t == "order" then audio.sfx("order")
    elseif t == "lava" then
      audio.sfx("splash"); if state.vibration then nova.input.rumble(0.7, 0.25) end
      self.flash, self.shake = 1, 0.5
      self:pop("Ouch!", { x = k.chef.x, z = k.chef.z }, { 255, 140, 100 })
    elseif t == "dash" then audio.sfx("dash")
    elseif t == "throw" then audio.sfx("whoosh", { pitch = 1.3 })
    elseif t == "shatter" then audio.sfx("shatter"); self:pop("Crash!", e, ui.color.wine)
    elseif t == "lost" then audio.sfx("splash", { volume = 0.5 }); self:pop("Lost!", e, ui.color.wine)
    elseif t == "step" then audio.sfx("step", { pitch = 0.9 + (k.t * 7) % 0.3, volume = 0.6 })
    elseif t == "time_up" then self:finish()
    end
  end
  -- grinding and stirring sounds while B is held
  if k.chef.work >= 1 then
    self.work_t = self.work_t - 1 / 60
    if self.work_t <= 0 then audio.sfx(k.chef.work == 2 and "bubble" or "grind"); self.work_t = k.chef.work == 2 and 0.3 or 0.34 end
  else
    self.work_t = 0
  end
end

function Play:finish()
  if self.phase == "over" then return end
  self.phase = "over"
  self.result_t = 0
  local k = self.k
  if self.tutorial then
    state.result = { tutorial = true, score = k.score, stars = 3, served = k.stats.served, expired = 0, burnt = k.stats.burnt }
    state.set_tutorial_done()
    audio.stop_music(0.4)
    audio.sfx("star")
    self:after(0.8, function() audio.music("results", { fade = 1.0 }) end)
    nova.log("potion: over level=tut")
    return
  end
  local stars = k:stars()
  local r = { score = k.score, stars = stars, served = k.stats.served, expired = k.stats.expired, burnt = k.stats.burnt, tips = k.stats.tips, level = state.level, free = self.free }
  if self.free then
    r.best = state.free_best(state.level)
    r.record = state.free_record(state.level, k.score)
  else
    r.record = state.record(state.level, k.score, stars)
    r.best = state.best(state.level)
  end
  state.result = r
  audio.stop_music(0.4)
  audio.sfx(stars >= 1 and "star" or "fail")
  self:after(0.8, function() audio.music("results", { fade = 1.0 }) end)
  nova.log(string.format("potion: over level=%s score=%d stars=%d served=%d expired=%d", self.level.id, k.score, stars, k.stats.served, k.stats.expired))
end

-- ---- the update ----------------------------------------------------------------------------------------------------------------------

function Play:update(dt)
  self.t = self.t + dt
  transition.update(dt)
  if transition.busy() then return end
  if nova.input.pressed("autoplay") and not self.tutorial then
    self.bot = (not self.bot) and Bot.new(self.k) or nil
    nova.log("potion: autoplay " .. tostring(self.bot ~= nil))
  end
  if self.phase == "intro" then
    self.intro = self.intro - dt
    local n = math.ceil(self.intro)
    if n ~= self.count and n >= 0 and n <= 3 then
      self.count = n
      audio.sfx("beep", { pitch = n > 0 and 1 or 1.4 })
    end
    if self.intro <= 0 then self.phase = "play"; nova.log("potion: go") end
    return
  end
  if self.phase == "paused" then return self:update_pause(dt) end
  if self.phase == "over" then return self:update_over(dt) end
  if nova.input.pressed("pause") then
    self.phase = "paused"
    self.pause_choice = 1
    audio.sfx("page")
    nova.music.volume(state.music_volume * 0.35)
    return
  end
  self.k:update(dt, self:read_input())
  local events = self.k:take_events()
  self:handle_events(events)
  if self.tut and self.tut:update(events) then self:finish() end
  local left = self.k.time_left
  if not self.tutorial and left <= 10 and left > 0 and math.floor(left) ~= self.last_tick then
    self.last_tick = math.floor(left)
    audio.sfx("beep", { volume = 0.6 })
  end
  for i = #self.pops, 1, -1 do
    local p = self.pops[i]
    p.age = p.age + dt
    if p.age > 1.1 then table.remove(self.pops, i) end
  end
  self.flash = math.max(0, self.flash - dt * 2.5)
  self.shake = math.max(0, self.shake - dt * 2)
  -- the pots murmur while they brew
  self.bubble_t = self.bubble_t - dt
  if self.bubble_t <= 0 then
    for _, st in ipairs(self.k.stations) do
      if st.kind == "cauldron" and st.state == "brewing" then audio.sfx("bubble", { volume = 0.5, pitch = 0.9 + math.random() * 0.3 }); break end
    end
    self.bubble_t = 1.6
  end
end

function Play:update_pause(dt)
  local choice, action = ui.navigate(self.pause_choice, #PAUSE_ITEMS)
  self.pause_choice = choice
  if self.show_recipes then
    if action == "accept" or action == "back" or nova.input.pressed("pause") then audio.sfx("menu_back"); self.show_recipes = false end
    return
  end
  if (action == "accept" and choice == 1) or action == "back" or nova.input.pressed("pause") then
    audio.sfx("menu_back")
    nova.music.volume(state.music_volume)
    self.phase = "play"
  elseif action == "accept" and choice == 2 then
    audio.sfx("page")
    self.show_recipes = true
  elseif action == "accept" then
    audio.sfx("menu_accept")
    nova.music.volume(state.music_volume)
    if choice == 3 then
      transition.cover(level_spec(self.level), function() nova.goto_scene("play") end)
    else
      audio.stop_music(0.5)
      transition.cover({ title = "POTION PANIC", sub = "", color = INK }, function() nova.goto_scene("title", self.free and "rules" or "book") end)
    end
  end
end

function Play:results_items()
  if self.tutorial then return { "To the book", "Practise again" }, { "book", "again" } end
  if self.free then return { "Brew again", "Change the rules", "Main menu" }, { "again", "rules", "menu" } end
  local r = state.result
  local items, ids = {}, {}
  if r.stars >= 1 and state.level < #data.levels then items[#items + 1] = "Next level"; ids[#ids + 1] = "next" end
  if r.stars >= 1 and state.level == #data.levels and not state.seen("end") then items[#items + 1] = "Continue"; ids[#ids + 1] = "end" end
  items[#items + 1] = "Brew again"; ids[#ids + 1] = "again"
  items[#items + 1] = "The book"; ids[#ids + 1] = "book"
  return items, ids
end

function Play:update_over(dt)
  self.result_t = self.result_t + dt
  if self.result_t < 1.6 then return end
  local items, ids = self:results_items()
  self.choice = math.min(self.choice, #items)
  local choice, action = ui.navigate(self.choice, #items)
  self.choice = choice
  if action == "accept" then
    audio.sfx("menu_accept")
    local id = ids[choice]
    if id == "again" then transition.cover(level_spec(self.level), function() nova.goto_scene("play") end)
    elseif id == "next" then
      state.level = state.level + 1
      transition.cover(level_spec(data.levels[state.level]), function() nova.goto_scene("play") end)
    elseif id == "end" then
      state.pending_story = "end"
      transition.cover({ title = "THE END", sub = "", color = INK }, function() nova.goto_scene("title", "story") end)
    elseif id == "rules" then transition.cover({ title = "FREE BREW", sub = "", color = INK }, function() nova.goto_scene("title", "rules") end)
    elseif id == "book" then transition.cover({ title = "THE BOOK", sub = "", color = INK }, function() nova.goto_scene("title", "book") end)
    else transition.cover({ title = "POTION PANIC", sub = "", color = INK }, function() nova.goto_scene("title", "menu") end) end
  elseif action == "back" then
    audio.sfx("menu_back")
  end
end

-- ---- drawing ---------------------------------------------------------------------------------------------------------------------------

function Play:draw()
  local w, h = nova.view()
  -- the camera swoops in from further away as the countdown runs, and shudders when the apprentice burns
  local zoom, orbit = 1, 0
  if self.phase == "intro" then
    local k = math.max(0, self.intro / 3.6)
    zoom = 1 + 0.45 * k * k
    orbit = k * 2.5
  end
  if self.shake > 0 then orbit = orbit + math.sin(self.t * 60) * self.shake * 0.25 end
  View.camera(self.k, 1.0, w, h, 0, orbit, zoom * 1.04)
  View.scenery(self.k, self.biome, self.t)
  View.draw(self.k, self.biome, self.t)
end

-- an order: the flask, the ingredients (a darker tile with dust means ground first) and how long is left
local function order_card(o, x, y, k, t)
  local recipe = data.recipes[o.recipe]
  local w, h = 150, 112
  local frac0 = o.t / o.total
  local e = math.min(1, (o.age or 1) / 0.35)
  y = y - (1 - (1 - (1 - e) ^ 3)) * 130
  if frac0 < 0.2 then x = x + math.sin(t * 38) * 1.6 end
  local held = k.chef.held
  local match = held and held.k == "potion" and held.recipe == o.recipe
  if match then
    ui.panel(x - 5, y - 5, w + 10, h + 10, "light")
    ui.icon("ui/iconCheck_bronze", x + w - 36, y + 8, 28)
  end
  ui.panel(x, y, w, h, "page")
  ui.flask(x + 14, y + 12, 26, recipe.color)
  local ix = x + 12
  for _, it in ipairs(recipe.items) do
    local ing = data.ingredients[it[1]]
    if it[2] then
      ui.icon("ui/panelInset_brown", ix - 1, y + 44, 44)
      ui.icon(ing.icon, ix + 1, y + 43, 42)
      nova.ui.rect(ix + 5 + ui.ox, y + 78 + ui.oy, 6, 3, { 232, 214, 168, math.floor(255 * ui.alpha) })
      nova.ui.rect(ix + 15 + ui.ox, y + 79 + ui.oy, 5, 3, { 232, 214, 168, math.floor(255 * ui.alpha) })
      nova.ui.rect(ix + 26 + ui.ox, y + 78 + ui.oy, 6, 3, { 232, 214, 168, math.floor(255 * ui.alpha) })
    else
      ui.icon(ing.icon, ix, y + 42, 44)
    end
    ix = ix + 44
  end
  local frac = o.t / o.total
  ui.bar(x + 10, y + 88, w - 20, frac, frac > 0.5 and "green" or (frac > 0.25 and "yellow" or "red"))
end

function Play:draw_hud(w)
  local k = self.k
  if self.tut then
    local text, n = self.tut:text()
    ui.panel(10, 8, 640, 118, "page")
    ui.text(28, 18, "THE PRIMER  " .. n .. " / " .. Tutorial.COUNT, ui.SMALL, ui.color.wine, { font = "display" })
    ui.text(28, 46, text, ui.MEDIUM, ui.color.ink, { width = 604 })
  else
    local x = 10
    for _, o in ipairs(k.orders) do
      order_card(o, x, 8, k, self.t)
      x = x + 158
    end
    if #k.orders == 0 then
      ui.panel(10, 8, 330, 64, "page")
      ui.in_box("Waiting for orders...", 10, 8, 330, 64, ui.MEDIUM, ui.color.ink)
    end
    -- the clock and the score
    local pw = 214
    local px = w - pw - 10
    ui.panel(px, 8, pw, 122, "ink")
    ui.text(px + 16, 12, "TIME", ui.SMALL, ui.color.lilac)
    ui.text(px + 16, 32, ui.time(k.time_left), ui.NUMBER, k.time_left <= 10 and { 255, 130, 110 } or ui.color.cream, { font = "display" })
    ui.text(px + 118, 12, "SCORE", ui.SMALL, ui.color.lilac)
    ui.text(px + 118, 32, tostring(k.score), ui.NUMBER, ui.color.gold, { font = "display" })
    for i = 1, 3 do ui.star(px + 28 + (i - 1) * 30, 96, 26, k.score >= self.level.stars[i]) end
    local nxt = k:stars() >= 3 and "all!" or tostring(self.level.stars[k:stars() + 1])
    ui.right(nxt, px + pw - 14, 84, ui.SMALL, ui.color.lilac)
  end
  -- what A and B would do where the apprentice is facing
  if self.phase == "play" then
    local pr = k:prompt()
    if pr.a or pr.b then
      local text_a, text_b = pr.a, pr.b
      local wa = text_a and (ui.width(text_a, ui.MEDIUM) + 52) or 0
      local wb = text_b and (ui.width(text_b, ui.MEDIUM) + 52) or 0
      ui.panel(10, 420, wa + wb + 30, 58, "ink")
      local x0 = 24
      if text_a then ui.pad("pad_a", x0, 431, 36); ui.text(x0 + 44, 433, text_a, ui.MEDIUM, ui.color.cream); x0 = x0 + wa end
      if text_b then ui.pad("pad_b", x0, 431, 36); ui.text(x0 + 44, 433, text_b, ui.MEDIUM, ui.color.cream) end
    end
  end
  -- floating text
  for _, p in ipairs(self.pops) do
    local sx, sy = View.project(p.x, p.y + p.age * 0.7, p.z, w, 540)
    local a = math.max(0, 1 - p.age / 1.1)
    local old = ui.alpha
    ui.alpha = a
    ui.text(sx - ui.width(p.text, ui.LARGE, "display") / 2, sy, p.text, ui.LARGE, p.color, { font = "display", shadow = true })
    ui.alpha = old
  end
end

function Play:draw_ui()
  local w = nova.view()
  if transition.busy() then transition.draw(); return end
  local phase = self.phase
  if phase == "paused" then
    nova.ui.rect(0, 0, w, 540, { 14, 8, 30, 200 })
    if self.show_recipes then
      self:draw_recipes(w)
      ui.hints({ { "pad_a", "Close" } })
    else
      ui.center("PAUSED", 60, ui.HEAD, ui.color.cream, { font = "display", shadow = true })
      ui.menu(PAUSE_ITEMS, self.pause_choice, 150, { width = 420, id = "pause", row = 78, size = ui.LARGE })
      ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Accept" }, { "pad_plus", "Resume" } })
    end
  elseif phase == "over" then
    self:draw_over(w)
  else
    self:draw_hud(w)
    if phase == "intro" then self:draw_intro(w) else
      ui.hints({ { "pad_a", "Grab" }, { "pad_b", "Work" }, { "pad_x", "Dash" }, { "pad_y", "Throw" } })
    end
  end
  if self.flash > 0 and not transition.busy() then nova.ui.rect(0, 0, w, 540, { 255, 90, 40, math.floor(120 * self.flash) }) end
  transition.draw()
end

-- the recipe book: every potion of the level, the ingredients (a darker tile with dust means ground first) and how long it brews
function Play:draw_recipes(w)
  ui.center("RECIPES", 14, ui.HEAD - 8, ui.color.cream, { font = "display", shadow = true })
  local list = self.k.recipes
  local rows = #list
  local rh = math.min(78, math.floor(380 / math.max(1, rows)))
  local y = 78
  ui.panel(w / 2 - 400, y - 12, 800, rows * rh + 24, "page")
  for i, id in ipairs(list) do
    local r = data.recipes[id]
    local ry = y + (i - 1) * rh
    local icon = math.min(52, rh - 8)
    ui.flask(w / 2 - 376, ry + (rh - 40) / 2, 28, r.color)
    ui.text(w / 2 - 330, ry + (rh - ui.MEDIUM) / 2 - 2, r.name, ui.fit(r.name, ui.MEDIUM, 300), ui.color.ink)
    local ix = w / 2 + 6
    for _, it in ipairs(r.items) do
      local ing = data.ingredients[it[1]]
      if it[2] then ui.icon("ui/panelInset_brown", ix - 2, ry + (rh - icon) / 2 - 2, icon + 4) end
      ui.icon(ing.icon, ix, ry + (rh - icon) / 2, icon)
      ix = ix + icon + 10
    end
    ui.right(r.brew .. " s", w / 2 + 380, ry + (rh - ui.SMALL) / 2, ui.SMALL, ui.color.dim)
  end
  ui.center("A dark tile means: grind it in the mortar first.", y + rows * rh + 24, ui.SMALL, ui.color.cream, { shadow = true })
end

function Play:draw_intro(w)
  local n = math.ceil(self.intro)
  local name = string.upper(self.level.name)
  ui.panel(w / 2 - 330, 150, 660, 270, "page")
  ui.center(name, 168, ui.fit(name, ui.HEAD - 8, 580, "display"), ui.color.ink, { font = "display" })
  local tip = data.tips[self.level.id]
  if tip then ui.text(w / 2 - 300, 232, tip, ui.MEDIUM, ui.color.ink, { width = 600, align = "center" }) end
  local count = (n >= 1 and n <= 3) and tostring(n) or (n < 1 and "BREW!" or "")
  if count ~= "" then ui.center(count, 340, ui.NUMBER + 10, ui.color.wine, { font = "display" }) end
end

function Play:draw_over(w)
  local r = state.result
  nova.ui.rect(0, 0, w, 540, { 14, 8, 30, math.floor(205 * math.min(1, self.result_t * 1.2)) })
  local e = math.min(1, self.result_t / 0.5)
  ui.oy = (1 - e) * -40
  ui.alpha = e
  if r.tutorial then
    ui.center("PRIMER COMPLETE!", 28, ui.HEAD, ui.color.cream, { font = "display", shadow = true })
    ui.panel(w / 2 - 280, 120, 560, 150, "page")
    ui.center("You know the whole craft.", 150, ui.LARGE, ui.color.ink)
    ui.center("The Story is open: the first region awaits.", 196, ui.MEDIUM, ui.color.dim)
    if self.result_t > 1.4 then
      local items = self:results_items()
      ui.menu(items, self.choice, 300, { width = 420, id = "results", enter = self.result_t - 1.4, row = 78, size = ui.LARGE })
      ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Accept" } })
    end
    ui.oy, ui.alpha = 0, 1
    return
  end
  local head = (r.stars >= 1) and (self.free and "WELL BREWED!" or "LEVEL CLEARED!") or "THE SHOP IS QUIET"
  if self.free and r.stars < 1 then head = "TIME'S UP" end
  ui.center(head, 8, ui.fit(head, ui.HEAD, 700, "display"), ui.color.cream, { font = "display", shadow = true })
  ui.panel(w / 2 - 250, 72, 500, 252, "page")
  for i = 1, 3 do
    local on = r.stars >= i and self.result_t > 0.5 + i * 0.35
    local size = on and (56 + 14 * math.max(0, 1 - (self.result_t - 0.5 - i * 0.35) * 5)) or 56
    ui.star(w / 2 + (i - 2) * 76, 112, size, on)
    if on and math.abs(self.result_t - 0.5 - i * 0.35) < 0.02 then audio.sfx("star", { pitch = 0.9 + i * 0.12 }) end
  end
  ui.center(tostring(r.score), 150, ui.NUMBER + 14, ui.color.ink, { font = "display" })
  local line = string.format("%d served   %d missed   %d burnt", r.served, r.expired, r.burnt)
  ui.center(line, 212, ui.SMALL + 1, ui.color.ink)
  if r.record then ui.center("A NEW BEST!", 238, ui.MEDIUM, ui.color.wine, { font = "display" }) else ui.center("Best  " .. r.best, 238, ui.MEDIUM, ui.color.dim) end
  local tip
  if r.burnt > 0 then tip = "A finished brew burns: bottle it quickly."
  elseif r.expired >= 2 then tip = "Start the next brew while one cooks."
  elseif not r.free and r.stars < 3 then tip = string.format("%d more for the next star.", math.max(0, self.level.stars[math.min(3, r.stars + 1)] - r.score))
  else tip = "A perfect shift!" end
  ui.center(tip, 280, ui.SMALL + 1, ui.color.ink)
  if self.result_t > 1.4 then
    local items = self:results_items()
    ui.menu(items, self.choice, 336, { width = 400, id = "results", enter = self.result_t - 1.4, row = 66, size = ui.MEDIUM + 1 })
    ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Accept" } })
  end
  ui.oy, ui.alpha = 0, 1
end

return Play

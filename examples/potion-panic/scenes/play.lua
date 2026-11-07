-- A game: one level, from the countdown to the results. state.mode says whether it is the campaign or Free Brew (with state.rules).
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local data = require("lib.data")
local Kitchen = require("lib.kitchen")
local View = require("lib.view")
local Bot = require("lib.bot")
local transition = require("lib.transition")

local Play = nova.scene {}

local PAUSE_ITEMS = { "Resume", "Recipes", "Restart", "Leave" }

local function level_spec(level)
  local biome = data.biomes[level.biome]
  return { title = string.upper(level.name), sub = biome.name, color = biome.banner }
end

function Play:enter()
  local level = data.levels[state.level]
  self.level = level
  self.biome = data.biomes[level.biome]
  self.free = state.mode == "free"
  local rules = self.free and state.rules or nil
  self.k = Kitchen.new(level, rules, math.floor(nova.time() * 1000) % 100000 + 1)
  self.k.playing = true
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
  self.warned = false
  self.flash = 0
  self.shake = 0
  self.bubble_t = 1
  View.setup(self.biome, state.smooth)
  audio.music(self.biome.music, { fade = 0.8 })
  state.apply_volumes()
  transition.reveal(0.4)
end

function Play:leave() View.leave() end

-- ---- input ---------------------------------------------------------------------------------------------------------------------

function Play:read_input()
  if self.bot then return self.bot:update(1 / 60) end
  return {
    mx = nova.input.axis("move_x"), mz = nova.input.axis("move_y"),
    grab = nova.input.pressed("grab"), work = nova.input.down("work"), dash = nova.input.pressed("dash"), throw = nova.input.pressed("throw"),
  }
end

-- ---- events ----------------------------------------------------------------------------------------------------------------------

function Play:pop(text, st_or_pos, color)
  local x, z = st_or_pos.cx or st_or_pos.x, st_or_pos.cz or st_or_pos.z
  self.pops[#self.pops + 1] = { text = text, x = x, y = 1.2, z = z, age = 0, color = color or ui.color.cream }
end

function Play:handle_events()
  local k = self.k
  for _, e in ipairs(k:take_events()) do
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
    elseif t == "bin" then audio.sfx("drop", { pitch = 0.7 }); if e.item.k == "potion" then audio.sfx("shatter") end
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
  -- grinding sounds while B is held at the mortar
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

-- ---- the update --------------------------------------------------------------------------------------------------------------------

function Play:update(dt)
  self.t = self.t + dt
  transition.update(dt)
  if transition.busy() then return end
  if nova.input.pressed("autoplay") then
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
  self:handle_events()
  if self.k.time_left <= 10 and not self.warned then self.warned = true end
  if self.k.time_left <= 10 and self.k.time_left > 0 and math.floor(self.k.time_left) ~= self.last_tick then
    self.last_tick = math.floor(self.k.time_left)
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
      transition.cover({ title = "POTION PANIC", sub = "", color = { 96, 58, 130 } }, function() nova.goto_scene("title", self.free and "rules" or "map") end)
    end
  end
end

function Play:results_items()
  if self.free then return { "Brew again", "Change the rules", "Main menu" }, { "again", "rules", "menu" } end
  local r = state.result
  local items, ids = {}, {}
  if r.stars >= 1 and state.level < #data.levels then items[#items + 1] = "Next level"; ids[#ids + 1] = "next" end
  if r.stars >= 1 and state.level == #data.levels and not state.seen("end") then items[#items + 1] = "Continue"; ids[#ids + 1] = "end" end
  items[#items + 1] = "Brew again"; ids[#ids + 1] = "again"
  items[#items + 1] = "Map"; ids[#ids + 1] = "map"
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
      transition.cover({ title = "THE END", sub = "", color = { 96, 58, 130 } }, function() nova.goto_scene("title", "story") end)
    elseif id == "rules" then transition.cover({ title = "FREE BREW", sub = "", color = { 96, 58, 130 } }, function() nova.goto_scene("title", "rules") end)
    elseif id == "map" then transition.cover({ title = "THE MAP", sub = "", color = { 96, 58, 130 } }, function() nova.goto_scene("title", "map") end)
    else transition.cover({ title = "POTION PANIC", sub = "", color = { 96, 58, 130 } }, function() nova.goto_scene("title", "menu") end) end
  elseif action == "back" then
    audio.sfx("menu_back")
  end
end

-- ---- drawing -------------------------------------------------------------------------------------------------------------------------

function Play:draw()
  local w, h = nova.view()
  -- the camera swoops in from further away as the countdown runs, and shudders when the apprentice burns
  local zoom, orbit = 1, 0
  if self.phase == "intro" then
    local k = math.max(0, self.intro / 3.6)
    zoom = 1 + 0.45 * k * k
    orbit = (1 - k) * 0 + k * 2.5
  end
  if self.shake > 0 then orbit = orbit + math.sin(self.t * 60) * self.shake * 0.25 end
  View.camera(self.k, 0.35, w, h, 0, orbit, zoom)
  View.scenery(self.k, self.biome, self.t)
  View.draw(self.k, self.biome, self.t)
end

local function order_card(o, x, y, k, t)
  local recipe = data.recipes[o.recipe]
  local w, h = 122, 84
  local frac0 = o.t / o.total
  local e = math.min(1, (o.age or 1) / 0.35)
  y = y - (1 - (1 - (1 - e) ^ 3)) * 100
  if frac0 < 0.2 then x = x + math.sin(t * 38) * 1.6 end
  local held = k.chef.held
  local match = held and held.k == "potion" and held.recipe == o.recipe
  if match then
    ui.panel(x - 5, y - 5, w + 10, h + 10, "light")
    ui.icon("ui/iconCheck_bronze", x + w - 22, y + 8, 18)
  end
  ui.panel(x, y, w, h, "beige")
  ui.flask(x + 10, y + 12, 20, recipe.color)
  local name = recipe.name
  ui.text(x + 38, y + 10, name, ui.fit(name, 12, w - 46), ui.color.ink)
  -- the ingredients, a small picture each; a ground one is on a dark tile with a little dust
  local ix = x + 36
  for _, it in ipairs(recipe.items) do
    local ing = data.ingredients[it[1]]
    if it[2] then
      ui.icon("ui/panelInset_brown", ix - 1, y + 30, 32)
      ui.icon(ing.icon, ix + 1, y + 29, 30)
      nova.ui.rect(ix + 3 + ui.ox, y + 54 + ui.oy, 4, 3, { 232, 214, 168, math.floor(255 * ui.alpha) })
      nova.ui.rect(ix + 9 + ui.ox, y + 55 + ui.oy, 3, 3, { 232, 214, 168, math.floor(255 * ui.alpha) })
      nova.ui.rect(ix + 17 + ui.ox, y + 54 + ui.oy, 4, 3, { 232, 214, 168, math.floor(255 * ui.alpha) })
    else
      ui.icon(ing.icon, ix, y + 28, 32)
    end
    ix = ix + 28
  end
  local frac = o.t / o.total
  ui.bar(x + 10, y + 62, w - 20, frac, frac > 0.5 and "green" or (frac > 0.25 and "yellow" or "red"))
end

function Play:draw_hud(w)
  local k = self.k
  local x = 14
  for _, o in ipairs(k.orders) do
    order_card(o, x, 8, k, self.t)
    x = x + 130
  end
  if #k.orders == 0 then
    ui.panel(14, 8, 200, 40, "beige")
    ui.text(30, 20, "Waiting for orders...", 13, ui.color.ink)
  end
  -- the clock and the score, on a wooden plaque, with the stars to reach
  local pw = 200
  local px = w - pw - 14
  ui.panel(px, 8, pw, 84, "brown")
  ui.text(px + 18, 16, "TIME", 11, { 226, 204, 170 })
  ui.text(px + 18, 28, ui.time(k.time_left), 26, k.time_left <= 10 and { 255, 130, 110 } or ui.color.cream, { font = "display" })
  ui.text(px + 110, 16, "SCORE", 11, { 226, 204, 170 })
  ui.text(px + 110, 28, tostring(k.score), 26, ui.color.gold, { font = "display" })
  for i = 1, 3 do ui.star(px + 28 + (i - 1) * 24, 74, 20, k.score >= self.level.stars[i]) end
  ui.text(px + 112, 66, "next star " .. self.level.stars[math.min(3, k:stars() + 1)], 11, { 226, 204, 170 })
  -- what A and B would do where the apprentice is facing
  if self.phase == "play" then
    local pr = k:prompt()
    if pr.a or pr.b then
      local line = 0
      local text_a, text_b = pr.a, pr.b
      local wa = text_a and (ui.width(text_a, 14) + 40) or 0
      local wb = text_b and (ui.width(text_b, 14) + 40) or 0
      local pw = wa + wb + 28
      ui.panel(14, 492, pw, 40, "brown")
      local x0 = 30
      if text_a then ui.pad("pad_a", x0, 499, 26); ui.text(x0 + 34, 506, text_a, 14, ui.color.cream); x0 = x0 + wa + 8 end
      if text_b then ui.pad("pad_b", x0, 499, 26); ui.text(x0 + 34, 506, text_b, 14, ui.color.cream) end
    end
  end
  -- floating text
  for _, p in ipairs(self.pops) do
    local sx, sy = View.project(p.x, p.y + p.age * 0.7, p.z, w, 540)
    local a = math.max(0, 1 - p.age / 1.1)
    local old = ui.alpha
    ui.alpha = a
    ui.text(sx - ui.width(p.text, 18, "display") / 2, sy, p.text, 18, p.color, { font = "display", shadow = true })
    ui.alpha = old
  end
end

function Play:draw_ui()
  local w = nova.view()
  if transition.busy() then transition.draw(); return end
  local phase = self.phase
  if phase == "paused" then
    nova.ui.rect(0, 0, w, 540, { 20, 10, 6, 190 })
    if self.show_recipes then
      self:draw_recipes(w)
      ui.hints({ { "pad_a", "Close" } })
    else
      ui.center("PAUSED", 90, 40, ui.color.cream, { font = "display", shadow = true })
      ui.menu(PAUSE_ITEMS, self.pause_choice, 170, { width = 320, id = "pause", row = 56 })
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
  ui.center("RECIPES", 28, 34, ui.color.cream, { font = "display", shadow = true })
  local list = self.k.recipes
  local rows = #list
  local rh = math.min(64, math.floor(380 / math.max(1, rows)))
  local y = 90
  ui.panel(w / 2 - 330, y - 14, 660, rows * rh + 28, "beige")
  for i, id in ipairs(list) do
    local r = data.recipes[id]
    local ry = y + (i - 1) * rh
    ui.flask(w / 2 - 308, ry + 6, 22, r.color)
    ui.text(w / 2 - 270, ry + 8, r.name, 15, ui.color.ink, { font = "display" })
    local ix = w / 2 - 20
    for _, it in ipairs(r.items) do
      local ing = data.ingredients[it[1]]
      if it[2] then ui.icon("ui/panelInset_brown", ix - 1, ry - 2, 40) end
      ui.icon(ing.icon, ix + (it[2] and 1 or 0), ry - (it[2] and 3 or 2), 38)
      ix = ix + 46
    end
    ui.text(w / 2 + 250, ry + 10, r.brew .. " s", 13, ui.color.dim)
  end
  ui.center("A dark tile means: grind it in the mortar first.", y + rows * rh + 30, 13, ui.color.cream, { shadow = true })
end

function Play:draw_intro(w)
  local n = math.ceil(self.intro)
  local name = string.upper(self.level.name)
  ui.panel(w / 2 - 250, 190, 500, 150, "beige")
  ui.center(name, 206, ui.fit(name, 30, 440, "display"), ui.color.ink, { font = "display" })
  local tip = data.tips[self.level.id]
  if tip then ui.text(w / 2 - 220, 252, tip, 14, ui.color.ink, { width = 440, align = "center" }) end
  local count = (n >= 1 and n <= 3) and tostring(n) or (n < 1 and "BREW!" or "")
  if count ~= "" then ui.center(count, 292, 36, ui.color.wine, { font = "display" }) end
end

function Play:draw_over(w)
  local r = state.result
  nova.ui.rect(0, 0, w, 540, { 20, 10, 6, math.floor(190 * math.min(1, self.result_t * 1.2)) })
  local e = math.min(1, self.result_t / 0.5)
  ui.oy = (1 - e) * -40
  ui.alpha = e
  local head = (r.stars >= 1) and (self.free and "WELL BREWED!" or "LEVEL CLEARED!") or "THE SHOP IS QUIET"
  if self.free and r.stars < 1 then head = "TIME'S UP" end
  ui.center(head, 22, ui.fit(head, 38, 700, "display"), ui.color.cream, { font = "display", shadow = true })
  ui.panel(w / 2 - 200, 74, 400, 224, "beige")
  -- the stars appear one by one
  for i = 1, 3 do
    local on = r.stars >= i and self.result_t > 0.5 + i * 0.35
    local size = on and (46 + 14 * math.max(0, 1 - (self.result_t - 0.5 - i * 0.35) * 5)) or 46
    ui.star(w / 2 + (i - 2) * 64, 118, size, on)
    if on and math.abs(self.result_t - 0.5 - i * 0.35) < 0.02 then audio.sfx("star", { pitch = 0.9 + i * 0.12 }) end
  end
  ui.center(tostring(r.score), 156, 40, ui.color.ink, { font = "display" })
  ui.center("SCORE", 202, 11, ui.color.dim)
  local line = string.format("%d served  ·  %d missed  ·  %d burnt", r.served, r.expired, r.burnt)
  ui.center(line, 224, 13, ui.color.ink)
  if r.record then ui.center("A NEW BEST!", 242, 12, ui.color.wine, { font = "display" }) else ui.center("BEST  " .. r.best, 242, 12, ui.color.dim) end
  -- one line of advice, from how it went
  local tip
  if r.burnt > 0 then tip = "A finished brew burns after nine seconds: bottle it first."
  elseif r.expired >= 2 then tip = "Start the next potion while one is brewing."
  elseif not r.free and r.stars < 3 then
    local goal = self.level.stars[math.min(3, r.stars + 1)]
    tip = string.format("%d more points for the next star. Grinding while a pot brews saves time.", math.max(0, goal - r.score))
  else tip = "A perfect shift!" end
  ui.text(w / 2 - 184, 266, tip, 12, ui.color.ink, { width = 368, align = "center" })
  if self.result_t > 1.4 then
    local items = self:results_items()
    ui.menu(items, self.choice, 318, { width = 300, id = "results", enter = self.result_t - 1.4, row = 44, size = 15 })
    ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Accept" } })
  end
  ui.oy, ui.alpha = 0, 1
end

return Play

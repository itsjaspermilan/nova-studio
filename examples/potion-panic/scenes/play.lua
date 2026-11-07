-- A game: one level, from the countdown to the results. state.mode says whether it is the campaign or Free Brew (with state.rules); state.level 0 is the tutorial.
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local data = require("lib.data")
local Kitchen = require("lib.kitchen")
local View = require("lib.view")
local Fx = require("lib.fx")
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
  self.fx = Fx.new(self.k)
  self.streak_pulse, self.zoom_kick, self.shown = 0, 0, 0
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
  self.pops[#self.pops + 1] = { text = text, x = x, y = 1.7, z = z, age = 0, color = color or ui.color.cream }
end

-- The apprentice talks: a line in a speech bubble over their head, and a burble of a voice (a few quick high bloops), now and then (never two
-- lines within a couple of seconds, so it stays a treat rather than chatter)
local SAY = {
  serve = { "Order up!", "Here you go!", "One potion!", "Fresh brew!" },
  streak = { "On a roll!", "Keep 'em coming!", "Brew-tiful!" },
  burnt = { "Oh no!", "Pew, smoke!", "Too long!" },
  lava = { "Yowch!", "Hot hot hot!" },
  expire = { "Sorry!", "Too slow..." },
  reject = { "Not that one..." },
  ready = { "It's ready!", "Done!" },
  washed = { "Sparkly!", "Squeaky clean!" },
}
function Play:say(kind, force)
  if not force and self.t - (self.said_at or -9) < 2.6 then return end
  local list = SAY[kind]
  self.said_at = self.t
  self.speech = { text = list[math.random(#list)], t = 0 }
  self.voice = { left = 5 + math.random(3), t = 0 }
end

function Play:handle_events(events)
  local k = self.k
  self.fx:events(events)
  for _, e in ipairs(events) do
    local t = e.type
    if t == "grab" then
      audio.sfx("grab")
      if e.st and e.st.kind == "crate" then e.st.bump = k.t end
    elseif t == "drop" then audio.sfx("drop")
    elseif t == "nope" then audio.sfx("nope")
    elseif t == "pot_add" then audio.sfx("pot_add")
    elseif t == "brew_start" then audio.sfx("brew_start"); audio.sfx("pour")
    elseif t == "brew_done" then audio.sfx("ding"); self:say("ready")
    elseif t == "burnt" then audio.sfx("fail"); self:pop("Burnt!", e.st, ui.color.wine); self:say("burnt", true)
    elseif t == "warn" then audio.sfx("beep", { pitch = 0.7 }); self:pop("Hurry!", e.st, { 255, 150, 110 })
    elseif t == "fill" then audio.sfx("bottle")
    elseif t == "washed" then audio.sfx("ding", { pitch = 1.6, volume = 0.7 }); self:say("washed")
    elseif t == "bottle_back" then audio.sfx("bottle", { pitch = 0.8, volume = 0.6 })
    elseif t == "serve" then
      audio.sfx("coins"); audio.sfx("ding", { pitch = 1.2 })
      for _, st in ipairs(k.stations) do if st.kind == "hatch" then self:pop("+" .. e.points, st, ui.color.gold); st.rung = k.t end end
      self.streak_pulse = 1
      if e.streak >= 2 then self:pop("Streak x" .. e.streak, { x = k.chef.x, z = k.chef.z }, { 255, 190, 80 }) end
      self:say(e.streak >= 3 and "streak" or "serve", true)
      self.zoom_kick = 0.05
    elseif t == "reject" then audio.sfx("nope"); self:say("reject")
    elseif t == "bin" then audio.sfx("drop", { pitch = 0.7 }); if e.item and e.item.k == "potion" then audio.sfx("shatter") end
    elseif t == "expire" then audio.sfx("fail"); self:pop("-10", { x = 0.5, z = 0.5 }, ui.color.wine); self:say("expire")
    elseif t == "order" then audio.sfx("order")
    elseif t == "lava" then
      audio.sfx("splash"); if state.vibration then nova.input.rumble(0.7, 0.25) end
      self.flash, self.shake = 1, 0.5
      self:say("lava", true)
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
    if self.work_t <= 0 then
      local w = k.chef.work
      if w == 3 then audio.sfx("bubble", { pitch = 1.5 + math.random() * 0.3, volume = 0.6 }) else audio.sfx(w == 2 and "bubble" or "grind") end
      self.work_t = (w == 1) and 0.34 or 0.3
    end
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
  -- every five seconds of play: how the device is doing (read from the log when measuring)
  self.perf_t = (self.perf_t or 0) + dt
  if self.perf_t >= 5 then
    self.perf_t = 0
    local m = nova.perf()
    nova.log(string.format("potion: perf fps=%.1f gpu=%.2f p95=%.1f max=%.1f draws=%d triangles=%d", m.fps, m.gpu_ms, m.frame_p95_ms, m.frame_max_ms, m.draws, m.triangles))
  end
  self.fx:update(dt)
  if self.speech then self.speech.t = self.speech.t + dt; if self.speech.t > 1.7 then self.speech = nil end end
  if self.voice then
    self.voice.t = self.voice.t - dt
    if self.voice.t <= 0 then
      audio.sfx("bubble", { pitch = 1.7 + math.random() * 0.7, volume = 0.42 })
      self.voice.t = 0.065 + math.random() * 0.03
      self.voice.left = self.voice.left - 1
      if self.voice.left <= 0 then self.voice = nil end
    end
  end
  self.shown = self.shown + (self.k.score - self.shown) * math.min(1, dt * 7)
  self.streak_pulse = math.max(0, self.streak_pulse - dt * 3)
  self.zoom_kick = math.max(0, self.zoom_kick - dt * 0.25)
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
  View.camera(self.k, 0.45, w, h, 0, orbit, zoom * (1.0 - self.zoom_kick))
  View.scenery(self.k, self.biome, self.t)
  View.draw(self.k, self.biome, self.t)
  View.draw_customers(self.k, self.t)
  View.passersby(self.k, self.biome, self.t)
  self.fx:lights(self.t)
end

-- an order as a paper ticket: a bar of the time left along the top, the potion, and a bubble for each ingredient (a brown one is ground first)
local function bubble(x, y, size, ing, ground)
  ui.icon("ui/disc", x, y, size, ground and { 190, 140, 100, 255 } or { 255, 255, 255, 255 })
  ui.icon(data.ingredients[ing].icon, x + size * 0.12, y + size * 0.1, size * 0.76)
  if ground then
    -- a little pestle in the corner says "grind it"
    nova.ui.rect(x + size * 0.62 + ui.ox, y + size * 0.72 + ui.oy, size * 0.3, size * 0.1, ui.tint({ 90, 60, 40 }))
    nova.ui.rect(x + size * 0.68 + ui.ox, y + size * 0.52 + ui.oy, size * 0.1, size * 0.3, ui.tint({ 90, 60, 40 }))
  end
end

local function order_card(o, x, y, k, t)
  local recipe = data.recipes[o.recipe]
  local w, h = 96, 92
  local frac0 = o.t / o.total
  local e = math.min(1, (o.age or 1) / 0.35)
  y = y - (1 - (1 - (1 - e) ^ 3)) * 110
  if frac0 < 0.2 then x = x + math.sin(t * 38) * 1.6 end
  local held = k.chef.held
  if held and held.k == "potion" and held.recipe == o.recipe then
    ui.panel(x - 4, y - 4, w + 8, h + 8, "light", 255, { 255, 214, 90 })
  end
  ui.panel(x, y, w, h, "light")
  ui.bar(x + 8, y + 7, w - 16, frac0, frac0 > 0.5 and "green" or (frac0 > 0.25 and "yellow" or "red"))
  ui.flask(x + (w - 26) / 2, y + 28, 26, recipe.color)
  local n = #recipe.items
  local bs = 27
  local bx = x + (w - n * (bs + 2) + 2) / 2
  for _, it in ipairs(recipe.items) do
    bubble(bx, y + h - bs - 6, bs, it[1], it[2])
    bx = bx + bs + 2
  end
end

-- bubbles over the stations (the screen draws what is in a pot, how far a brew has got and how long it can wait)
function Play:draw_bubbles(w)
  local k = self.k
  for _, st in ipairs(k.stations) do
    local sx, sy
    if st.kind == "cauldron" or st.kind == "mortar" then sx, sy = View.project(st.cx, 1.25, st.cz, w, 540) end
    if st.kind == "cauldron" then
      if st.state == "idle" and #st.items > 0 then
        local n = #st.items
        local bs = 34
        local x0 = sx - (n * (bs + 3) - 3) / 2
        for i, it in ipairs(st.items) do bubble(x0 + (i - 1) * (bs + 3), sy - bs, bs, it.id, it.ground) end
      elseif st.state == "brewing" or st.state == "done" then
        local recipe = data.recipes[st.recipe] or { color = { 90, 80, 50 } }
        local bob = (st.state == "done") and math.sin(self.t * 6) * 4 or 0
        ui.icon("ui/disc", sx - 23, sy - 54 + bob, 46)
        ui.flask(sx - 11, sy - 46 + bob, 22, recipe.color)
        if st.state == "brewing" then
          ui.bar(sx - 30, sy - 6, 60, st.timer / st.total, "green")
        elseif k.rules.burn then
          local left = 1 - st.timer / k.burn_after
          ui.bar(sx - 30, sy - 6, 60, left, (left < 0.34 and math.floor(self.t * 8) % 2 == 0) and "yellow" or "red")
        end
      elseif st.state == "burnt" then
        ui.icon("ui/disc", sx - 23, sy - 54, 46, { 120, 110, 110, 255 })
        ui.icon("ui/cross", sx - 14, sy - 45, 28)
      end
    elseif st.kind == "mortar" and st.item and st.item.k == "ing" then
      local bs = 38
      bubble(sx - bs / 2, sy - bs - 4, bs, st.item.id, st.item.ground)
      if not st.item.ground and st.progress > 0 then ui.bar(sx - 30, sy + 2, 60, st.progress, "yellow") end
    end
  end
end

function Play:draw_hud(w)
  local k = self.k
  if self.tut then
    -- the step's card: when the step changes the old card lifts away and fades, then the new one drops in with a little bounce
    local text, n = self.tut:text()
    local card = self.tut_card
    if not card or card.n ~= n then
      self.tut_card = { n = n, text = text, t = 0, old = card and card.text, old_n = card and card.n }
      card = self.tut_card
      if card.old then audio.sfx("page", { volume = 0.5 }) end
    end
    card.t = card.t + 1 / 60
    local function draw_card(txt, num, dy, alpha)
      local old = ui.alpha
      ui.alpha = old * alpha
      ui.panel(10, 8 + dy, 560, 86, "page")
      ui.text(26, 14 + dy, "THE PRIMER  " .. num .. " / " .. Tutorial.COUNT, ui.SMALL - 2, ui.color.wine)
      ui.text(26, 38 + dy, txt, ui.MEDIUM - 2, ui.color.ink, { width = 528 })
      ui.alpha = old
    end
    if card.old and card.t < 0.22 then
      local u = card.t / 0.22
      draw_card(card.old, card.old_n, -u * u * 60, 1 - u)
    else
      local u = math.min(1, (card.t - (card.old and 0.22 or 0)) / 0.35)
      local back = 1 + 2.2 * (u - 1) ^ 3 + 1.2 * (u - 1) ^ 2 -- (an ease that overshoots a little and settles)
      draw_card(text, n, (1 - back) * -70, math.min(1, u * 2))
    end
  else
    local x = 10
    for _, o in ipairs(k.orders) do
      order_card(o, x, 8, k, self.t)
      x = x + 102
    end
    if #k.orders == 0 then
      ui.panel(10, 8, 250, 44, "light")
      ui.in_box("Waiting for orders...", 10, 8, 250, 44, ui.SMALL, ui.color.ink)
    end
    -- the score, bottom left, with a gold coin
    ui.panel(30, 490, 176, 40, "ink")
    nova.ui.sprite("ui/disc", 34 + ui.ox, 510 + ui.oy, { w = 54, h = 54, color = ui.tint({ 250, 196, 60, 255 }) })
    nova.ui.sprite("ui/star", 34 + ui.ox, 510 + ui.oy, { w = 30, h = 30, color = ui.tint({ 255, 240, 180, 255 }) })
    ui.text(68, 494 - self.streak_pulse * 4, tostring(math.floor(self.shown + 0.5)), ui.LARGE + 2, self.streak_pulse > 0.3 and ui.color.gold or ui.color.white, { shadow = true })
    for i = 1, 3 do ui.star(146 + (i - 1) * 20, 510, 17, k.score >= self.level.stars[i]) end
    -- the streak: a badge over the score that jumps on every serve
    if k.streak >= 2 then
      local j = self.streak_pulse
      ui.ribbon(30, 458 - j * 6, 140, 28, { 240, 120, 50 }, "Streak x" .. k.streak, ui.SMALL)
    end
    -- the clock, bottom right
    local pw = 132
    ui.panel(w - pw - 12, 478, pw, 52, "ink")
    ui.right(ui.time(k.time_left), w - 26, 480, ui.LARGE + 2, k.time_left <= 10 and { 255, 130, 110 } or ui.color.white, { shadow = true })
    ui.bar(w - pw - 2, 509, pw - 20, k.time_left / (self.k.rules.time > 0 and self.k.rules.time or self.level.time), k.time_left <= 10 and "red" or "green")
  end
  self:draw_bubbles(w)
  -- what the apprentice says, in a bubble over their head that pops up and bobs
  if self.speech and k.chef.dead <= 0 then
    local s = self.speech
    local sx, sy = View.project(k.chef.x, 1.75, k.chef.z, w, 540)
    local pop = math.min(1, s.t / 0.12)
    local tw = ui.width(s.text, ui.SMALL + 1)
    local bw, bh = tw + 28, 38
    local bx, by = sx - bw / 2, sy - bh - 10 - (1 - pop) * 10 + math.sin(s.t * 6) * 1.5
    local old = ui.alpha
    ui.alpha = old * (s.t > 1.45 and (1.7 - s.t) / 0.25 or 1)
    ui.panel(bx, by, bw, bh, "light")
    nova.ui.rect(sx - 5 + ui.ox, by + bh - 3 + ui.oy, 10, 8, ui.tint({ 252, 246, 232 }))
    nova.ui.rect(sx - 2 + ui.ox, by + bh + 5 + ui.oy, 4, 4, ui.tint({ 252, 246, 232 }))
    ui.in_box(s.text, bx, by, bw, bh, ui.SMALL + 1, ui.color.ink)
    ui.alpha = old
  end
  -- floating text
  for _, p in ipairs(self.pops) do
    local sx, sy = View.project(p.x, p.y + p.age * 0.7, p.z, w, 540)
    local a = math.max(0, 1 - p.age / 1.1)
    local old = ui.alpha
    ui.alpha = a
    ui.text(sx - ui.width(p.text, ui.LARGE) / 2, sy, p.text, ui.LARGE, p.color, { shadow = true })
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
    if phase == "intro" then self:draw_intro(w) end
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
      if it[2] then ui.icon("ui/disc", ix - 2, ry + (rh - icon) / 2 - 2, icon + 4, { 190, 140, 100, 255 }) end
      ui.icon(ing.icon, ix, ry + (rh - icon) / 2, icon)
      ix = ix + icon + 10
    end
    ui.right(r.brew .. " s", w / 2 + 380, ry + (rh - ui.SMALL) / 2, ui.SMALL, ui.color.dim)
  end
  ui.center("A dark tile means: grind it in the mortar first.", y + rows * rh + 24, ui.SMALL, ui.color.cream, { shadow = true })
end

-- the start of a level: its name on the biome's ribbon, the tip on a slim card, and the count as big lettering over the kitchen (no box: each
-- number drops in, settles and fades as the next one comes)
local COUNT_COLOURS = { [3] = { 255, 120, 110 }, [2] = { 255, 186, 80 }, [1] = { 255, 230, 100 }, [0] = { 150, 236, 120 } }
function Play:draw_intro(w)
  local n = math.ceil(self.intro)
  local name = self.level.name
  local enter = math.min(1, (3.6 - self.intro) / 0.35)
  local e = 1 - (1 - enter) ^ 3
  local rw = math.min(560, ui.width(name, ui.HEAD - 6) + 90)
  ui.ribbon(w / 2 - rw / 2, 96 - (1 - e) * 60, rw, 66, self.biome.banner or { 120, 90, 160 }, name, ui.HEAD - 6)
  local tip = self.level.tip
  if tip then
    local old = ui.alpha
    ui.alpha = old * e
    ui.panel(w / 2 - 320, 172, 640, 74, "light")
    ui.text(w / 2 - 300, 184, tip, ui.SMALL + 1, ui.color.ink, { width = 600, align = "center" })
    ui.alpha = old
  end
  if n >= 0 and n <= 3 then
    local frac = n - self.intro -- (0 when a number appears, up to 1 when it goes)
    local drop = (1 - math.min(1, frac / 0.18)) ^ 2
    local fade = frac > 0.7 and (1 - (frac - 0.7) / 0.3) or 1
    local text = n >= 1 and tostring(n) or "Brew!"
    local old = ui.alpha
    ui.alpha = old * fade
    ui.text(w / 2 - ui.width(text, 120) / 2, 350 - drop * 40, text, 120, COUNT_COLOURS[n], { shadow = true, valign = "middle" })
    ui.alpha = old
  end
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

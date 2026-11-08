-- A level: built from its scene file (scenes/levels/<world>-<n>.scene.json: tilemaps named by what their tiles do, see lib/world.lua, and
-- placed objects), then played. Also the pause menu, the time trial's countdown, deaths and checkpoints, the celebration at the goal and the
-- results. `nova.goto_scene("play", level_id, mode)`: mode "normal" or "trial" (a time trial: no checkpoints, a fall restarts the level).
local levels = require("lib.levels")
local state = require("lib.state")
local world = require("lib.world")
local run = require("lib.run")
local fx = require("lib.fx")
local ui = require("lib.ui")
local hud = require("lib.hud")
local audio = require("lib.audio")
local transition = require("lib.transition")
local Backdrop = require("lib.backdrop")
local bot = require("lib.bot")

local Play = nova.scene {}

-- moves the platforms to the level's time, before anything else steps (it is spawned first)
local Clock = nova.entity { visible = false }
function Clock:update(dt) world.set_time(world.t + dt) end

local WORLD_COLOR = { grass = { 110, 200, 90 }, sand = { 240, 170, 90 }, snow = { 120, 180, 240 }, castle = { 140, 100, 210 } }
function Play.color_of(lv) return WORLD_COLOR[lv.world.id] or { 255, 200, 50 } end

function Play:enter(id, mode)
  local lv = levels.get(id) or levels.all()[1]
  self.lv, self.mode = lv, mode or "normal"
  run.start(lv, self.mode)
  run.boss = nil
  fx.reset()
  local data = nova.scene_data(lv.scene)
  local maps = {}
  self.layers = {}
  for _, tm in ipairs(data.tilemaps or {}) do
    local ts = tm.tileset
    local scale = ts.scale or 1
    local m = nova.tilemap { image = ts.image, tile_width = ts.tile_width, tile_height = ts.tile_height, scale = scale, tiles = tm.tiles, x = tm.x, y = tm.y, depth = tm.depth }
    if tm.name then self.layers[tm.name] = m end
    maps[#maps + 1] = { name = tm.name, tiles = tm.tiles, x = tm.x, y = tm.y, tile = ts.tile_width * scale }
  end
  world.build(maps)
  nova.spawn(Clock, 0, 0)
  local props = lv.props
  world.slippery = props.slippery == true
  self.backdrop = nova.spawn(Backdrop, 0, 0, { sky = props.sky or lv.world.sky or "grass", floor = world.height })
  local start
  for _, o in ipairs(data.objects or {}) do
    if o.kind == "start" then start = o
    elseif o.kind ~= "level" then nova.spawn(o.kind, o.x, o.y, o.props or {}) end
  end
  assert(start, lv.scene .. ": no \"start\" object")
  self.start = start
  self.hero = nova.spawn("hero", start.x, start.y)
  self.secret = self.layers.secret
  self.secret_found = false
  self.cx, self.cy = start.x + 120, start.y - 70
  self.look = 60
  self.t, self.banner_t = 0, 0
  self:place_camera(0, true)
  self.pause_sel, self.menu_t = 1, 0
  if self.mode == "trial" then
    self.phase, self.count = "count", 3.2
    self.hero.frozen = true
  else
    self.phase = "play"
    run.clock = true
  end
  run.on(function(what, a)
    if what == "dead" then self:on_dead(a)
    elseif what == "goal" then self:on_goal(a) end
  end)
  audio.music(props.music or lv.world.music or "grass")
  transition.reveal(0.3)
  nova.log("sunny: play " .. lv.id .. " " .. self.mode)
  if bot.active then bot.begin(self, lv) end
end

function Play:leave() nova.pause(false) end

-- ---- the camera: looks ahead the way the hero faces, follows jumps only once they go far, and rests on the ground the hero stands on
function Play:place_camera(dt, snap)
  local h = self.hero
  local b = h.b
  local w, hh = nova.view()
  self.look = self.look + ((b.face * 70) - self.look) * math.min(1, dt * 2.5)
  local tx = h.x + self.look
  local ty = self.ty or (h.y - 70)
  if b.ground or b.climbing or h.mode ~= "play" then ty = h.y - 70
  elseif h.y - 70 < ty - 110 then ty = h.y - 70 + 110
  elseif h.y - 70 > ty + 70 then ty = h.y - 70 - 70 end
  self.ty = ty
  if snap then self.cx, self.cy = tx, ty
  else
    self.cx = self.cx + (tx - self.cx) * math.min(1, dt * 7)
    self.cy = self.cy + (ty - self.cy) * math.min(1, dt * (b.vy > 600 and 9 or 4))
  end
  local x = math.max(w / 2, math.min(world.width - w / 2, self.cx))
  local y = math.max(hh / 2, math.min(world.height - hh / 2, self.cy))
  local sx, sy = fx.shake_offset(self.t, dt)
  x, y = x + sx, y + sy
  nova.cam.set(math.floor(x * 2 + 0.5) / 2, math.floor(y * 2 + 0.5) / 2)
end

function Play:update(dt)
  transition.update(dt)
  fx.update(dt)
  self.t = self.t + dt
  if self.phase ~= "paused" then self.banner_t = self.banner_t + dt end
  self.menu_t = self.menu_t + dt
  local h = self.hero
  if self.phase == "paused" then return self:update_pause() end
  if self.phase == "results" then return self:update_results(dt) end
  if self.phase == "count" then
    local before = math.ceil(self.count)
    self.count = self.count - dt
    local now = math.ceil(self.count)
    if now ~= before and now >= 1 and now <= 3 then audio.sfx(now == 3 and "ready" or now == 2 and "set" or "tick") end
    if self.count <= 0 then
      self.phase, h.frozen, run.clock = "play", false, true
      self.count_end = self.t
      audio.sfx("go")
    end
  end
  if self.phase == "play" then
    if run.clock and not run.finished then run.time = run.time + dt end
    if bot.active then bot.update(self, dt) end
    -- F9: the computer finishes this level (for tests and screenshots)
    if nova.input.pressed("autoplay") and not bot.active then bot.start_one(); bot.begin(self, self.lv) end
    if nova.input.pressed("pause") and not transition.busy() and h.mode == "play" then
      self.phase, self.pause_sel, self.menu_t = "paused", 1, 0
      nova.pause(true)
      audio.sfx("pause")
      return
    end
    if self.mode == "trial" and nova.input.pressed("restart") and not transition.busy() then return self:restart() end
  end
  -- a secret passage's cover fades while the hero is inside
  if self.secret then
    local inside = self.secret:tile_at(h.x, h.y - 30) >= 0 or self.secret:tile_at(h.x, h.y - 10) >= 0
    local target = inside and 0.18 or 1
    self.secret.alpha = self.secret.alpha + (target - self.secret.alpha) * math.min(1, dt * 6)
    if inside and not self.secret_found then
      self.secret_found = true
      audio.sfx("secret")
    end
  end
  if self.phase == "clear" then
    self.clear_t = self.clear_t + dt
    if self.clear_t > 0.25 and h.b.ground and self.hops < 2 then
      h.b.vy, h.b.ground = -620, false
      h.sqx, h.sqy = 0.75, 1.3
      self.hops = self.hops + 1
    end
    if not h.b.ground then
      h.b.vy = h.b.vy + 2200 * dt
      world.move(h.b, 0, h.b.vy * dt, false, true, false)
      h.x, h.y = h.b.x, h.b.y
      if h.b.ground then h.b.vy = 0; h.sqx, h.sqy = 1.25, 0.8; fx.dust(h.x, h.y, 4) end
    end
    if self.clear_t > (bot.active and 0.6 or 2.4) then self:show_results() end
  end
  self:place_camera(dt)
end

-- ---- deaths, the goal ---------------------------------------------------------------------------------------------------------------
function Play:on_dead(kind)
  run.deaths = run.deaths + 1
  if bot.active then bot.died(self, kind) end
  if self.mode == "trial" then return self:restart() end
  if kind == "fall" then run.lose_heart() end
  transition.cover({ color = Play.color_of(self.lv) }, function()
    if run.hearts <= 0 then run.hearts = run.max_hearts end
    local cp = run.checkpoint or self.start
    self.hero:respawn(cp.x, cp.y)
    self.ty = nil
    self:place_camera(0, true)
    transition.reveal(0.1)
  end)
end

function Play:restart()
  local id, mode = self.lv.id, self.mode
  transition.cover({ color = Play.color_of(self.lv) }, function() nova.goto_scene("play", id, mode) end)
end

function Play:on_goal(goal)
  if run.finished then return end
  run.finished, run.clock = true, false
  self.phase, self.clear_t, self.hops = "clear", 0, 0
  local h = self.hero
  h.mode, h.goal_frame = "goal", 1
  h.b.vx = 0
  audio.stop_music(0.2)
  audio.sfx("clear")
  fx.confetti(goal.x + 20, goal.y - 120, 70)
  fx.sparkle(goal.x + 20, goal.y - 100, 20)
  fx.shake(0.25)
end

function Play:show_results()
  self.phase, self.menu_t, self.res_sel = "results", 0, 1
  self.result = state.finish(self.lv, { gems = run.gems, time = run.time, coins = run.coins })
  local rec = state.record(self.lv.id)
  nova.log(string.format("sunny: finished %s %s time=%.2f gems=%d/3 stars=%d saved=%s best=%.2f", self.lv.id, self.mode, run.time,
    (run.gems[1] and 1 or 0) + (run.gems[2] and 1 or 0) + (run.gems[3] and 1 or 0), self.result.stars, tostring(rec.done), rec.best or -1))
  state.result = { id = self.lv.id, result = self.result }
  local nxt = levels.next(self.lv)
  self.res_items = {}
  if self.mode == "trial" then self.res_items[#self.res_items + 1] = { "Try again", "again" } end
  if nxt then self.res_items[#self.res_items + 1] = { "Next level", "next" } end
  if self.mode ~= "trial" then self.res_items[#self.res_items + 1] = { "Play again", "again" } end
  self.res_items[#self.res_items + 1] = { "World map", "map" }
  self.stars_shown = 0
  if self.result.new_best then self:after(1.6, function() audio.sfx("new_best") end) end
  if bot.active then bot.finished(self, self.lv) end
end

function Play:go_map()
  state.set_last(self.lv.id)
  transition.cover({ title = self.lv.world.name, color = Play.color_of(self.lv) }, function() nova.goto_scene("map") end)
end

function Play:update_results(dt)
  -- the stars pop in one after another
  local n = self.result.stars
  local due = math.floor((self.menu_t - 0.9) / 0.35) + 1
  if due > self.stars_shown and self.stars_shown < 3 then
    self.stars_shown = self.stars_shown + 1
    if self.stars_shown <= n then audio.sfx("star", { pitch = 0.9 + self.stars_shown * 0.12 }) end
  end
  if self.menu_t < 0.8 or transition.busy() then return end
  local sel, act = self.res_sel, nil
  if nova.input.pressed("left") then sel = math.max(1, sel - 1); audio.sfx("move") end
  if nova.input.pressed("right") then sel = math.min(#self.res_items, sel + 1); audio.sfx("move") end
  if nova.input.pressed("a") then act = "accept" elseif nova.input.pressed("b") then act = "back" end
  self.res_sel = sel
  if act == "accept" then
    audio.sfx("accept")
    local what = self.res_items[sel][2]
    if what == "next" then
      local nxt = levels.next(self.lv)
      state.set_last(nxt.id)
      transition.cover({ title = nxt.name, sub = nxt.label, color = Play.color_of(nxt) }, function() nova.goto_scene("play", nxt.id, "normal") end)
    elseif what == "again" then
      transition.cover({ title = self.lv.name, sub = self.lv.label, color = Play.color_of(self.lv) }, function() nova.goto_scene("play", self.lv.id, self.mode) end)
    else
      self:go_map()
    end
  elseif act == "back" then
    audio.sfx("back")
    self:go_map()
  end
end

function Play:update_pause()
  if transition.busy() then return end
  local items = { "Resume", "Restart", "World map" }
  local sel, act = ui.navigate(self.pause_sel, #items)
  self.pause_sel = sel
  if nova.input.pressed("pause") or act == "back" then act, sel = "accept", 1 end
  if act == "accept" then
    audio.sfx("accept")
    nova.pause(false)
    if sel == 1 then self.phase = "play"
    elseif sel == 2 then self.phase = "play"; self:restart()
    else self.phase = "play"; self:go_map() end
  end
end

-- ---- drawing -------------------------------------------------------------------------------------------------------------------------
function Play:draw_ui()
  local w, h = nova.view()
  hud.hints()
  fx.draw_floaters(ui)
  local slide = math.min(1, self.t / 0.5)
  if self.phase ~= "results" then hud.draw(ui.ease_out(slide)) end
  if self.phase ~= "paused" and self.phase ~= "results" then self:draw_banner() end
  if self.phase == "count" then
    local n = math.ceil(self.count)
    local k = self.count - math.floor(self.count)
    local text = n >= 1 and tostring(math.min(3, n)) or "GO!"
    local size = math.floor(ui.TITLE * (1 + k * 0.4))
    ui.center(text, h / 2 - size / 2 - 20, size, ui.color.sun)
    ui.center("Time trial", h / 2 + 60, ui.LARGE, ui.color.white)
  elseif self.phase == "play" and self.mode == "trial" and self.t - (self.count_end or 0) < 0.6 and self.count and self.count <= 0 then
    local k = (self.t - (self.count_end or 0)) / 0.6
    ui.alpha = 1 - k
    ui.center("GO!", h / 2 - 60, math.floor(ui.TITLE * (1 + k * 0.6)), ui.color.sun)
    ui.alpha = 1
  end
  if self.phase == "paused" then self:draw_pause() end
  if self.phase == "results" then self:draw_results() end
  transition.draw()
end

-- the level's number and name slide in at the start and away again
function Play:draw_banner()
  local t = self.banner_t
  if t > 3.2 then return end
  local w = nova.view()
  local k = t < 0.5 and ui.ease_back((t - 0.15) / 0.35) or (t > 2.6 and 1 - ui.ease_out((t - 2.6) / 0.5) or 1)
  if k <= 0 then return end
  local name = self.lv.name
  local size = ui.HEAD
  local tw = ui.width(name, size)
  local bw = tw + 150
  local x = -bw + k * (bw + 40)
  local y = 92
  ui.shade(x - 20, y, bw + 20, 86, 175)
  ui.icon("ui/disc", x + 56, y + 43, 70, Play.color_of(self.lv))
  ui.in_box(self.lv.label, x + 21, y + 8, 70, 70, ui.fit(self.lv.label, ui.LARGE, 60), ui.color.white)
  ui.text(x + 104, y + 43, name, size, ui.color.white, { valign = "middle" })
  if self.mode == "trial" then ui.text(x + 106, y + 86, "Time trial", ui.MEDIUM, ui.color.sun) end
end

function Play:draw_pause()
  local w, h = nova.view()
  nova.ui.rect(0, 0, w, h, { 20, 16, 40, 150 })
  local k = ui.ease_back(self.menu_t / 0.3)
  ui.center("Paused", 96 - (1 - k) * 40, ui.TITLE, ui.color.sun)
  ui.center(self.lv.label .. "  " .. self.lv.name, 186, ui.LARGE, ui.color.white)
  ui.menu({ "Resume", "Restart", "World map" }, self.pause_sel, 250, { enter = self.menu_t, id = "pause", width = 380 })
  ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "OK" }, { "pad_plus", "Resume" } })
end

function Play:draw_results()
  local w, h = nova.view()
  local t = self.menu_t
  nova.ui.rect(0, 0, w, h, { 20, 16, 40, math.floor(math.min(1, t / 0.3) * 120) })
  local k = ui.ease_back(t / 0.45)
  local pw, ph = 620, 350
  local px, py = w / 2 - pw / 2, 46 + (1 - k) * 300
  ui.panel(px, py, pw, ph)
  local head = self.mode == "trial" and "Time trial!" or (self.lv.props.boss and "Boss beaten!" or "Level clear!")
  local bob = math.sin(t * 4) * 3
  ui.center(head, py - 36 + bob, ui.HEAD + 6, ui.color.sun)
  ui.center(self.lv.label .. "  " .. self.lv.name, py + 30, ui.MEDIUM, ui.color.ink, { outline = false })
  -- the stars
  for i = 1, 3 do
    local on = i <= self.stars_shown and self.result.stars >= i
    local since = t - 0.9 - (i - 1) * 0.35
    local s = on and (since < 0.25 and 1 + (1 - since / 0.25) * 0.6 or 1) or 1
    ui.star(w / 2 + (i - 2) * 140, py + 96, (i == 2 and 74 or 64) * s, on)
  end
  local labels = { "Finished", "All 3 gems", "Star time" }
  local r = state.stars(self.lv) and select(2, state.stars(self.lv)) or {}
  for i = 1, 3 do
    ui.in_box(labels[i], w / 2 + (i - 2) * 140 - 70, py + 134, 140, 28, ui.SMALL, r[i] and ui.color.ink or ui.color.dim, { outline = false })
  end
  -- the numbers
  local y = py + 166
  local x0, x1 = px + 60, px + pw - 60
  local res = self.result
  ui.icon("ui/watch", x0 + 18, y + 16, 34)
  ui.text(x0 + 48, y + 16, "Time", ui.MEDIUM, ui.color.ink, { valign = "middle", outline = false })
  ui.right(ui.time(run.time), x1, y + 16, ui.LARGE, ui.color.ink, { valign = "middle", outline = false })
  if res.new_best then ui.text(x0 + 140, y + 16, "New best!", ui.MEDIUM, ui.color.berry, { valign = "middle", outline = false }) end
  if self.lv.target then ui.right("Star time " .. ui.time(self.lv.target), x1, y + 44, ui.SMALL, ui.color.dim, { outline = false }) end
  y = y + 58
  ui.icon("ui/hud_coin", x0 + 18, y + 16, 36)
  ui.text(x0 + 48, y + 16, "Coins", ui.MEDIUM, ui.color.ink, { valign = "middle", outline = false })
  ui.right(tostring(run.coins), x1, y + 16, ui.LARGE, ui.color.ink, { valign = "middle", outline = false })
  y = y + 48
  ui.text(x0 + 48, y + 16, "Gems", ui.MEDIUM, ui.color.ink, { valign = "middle", outline = false })
  ui.icon("ui/gem_blue", x0 + 18, y + 16, 34)
  local rec = state.record(self.lv.id)
  local GEM = { "ui/gem_blue", "ui/gem_green", "ui/gem_red" }
  for i = 1, 3 do
    local got = rec.gems[i]
    local new = false
    for _, n in ipairs(res.new_gems) do if n == i then new = true end end
    local s = new and (1 + math.max(0, math.sin(t * 6)) * 0.15) or 1
    ui.icon(GEM[i], x1 - 22 - (3 - i) * 46, y + 16, (got and 40 or 30) * s, got and { 255, 255, 255, 255 } or { 40, 40, 60, 110 })
  end
  -- the choices
  if t > 0.8 then
    local labels2 = {}
    for i, it in ipairs(self.res_items) do labels2[i] = it[1] end
    ui.button_row(labels2, self.res_sel, py + ph + 18, { enter = t - 0.8 })
  end
end

return Play

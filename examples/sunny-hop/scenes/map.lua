-- The world map (scenes/map.scene.json): a long landscape through the four worlds, with a "node" object for each level (prop: level, such as
-- "grass-2") and a "region" object where each world begins (props: id, name, music, sky). Sunny walks from node to node; A plays the level,
-- Y (or X) plays it as a time trial once it is cleared, B goes back to the title.
local levels = require("lib.levels")
local state = require("lib.state")
local ui = require("lib.ui")
local fx = require("lib.fx")
local audio = require("lib.audio")
local transition = require("lib.transition")
local Backdrop = require("lib.backdrop")
local Play = require("scenes.play")

local Map = nova.scene {}

function Map:enter()
  self.t = 0
  local data = nova.scene_data("map")
  self.nodes, self.regions = {}, {}
  for _, o in ipairs(data.objects or {}) do
    if o.kind == "node" then
      local lv = levels.get(o.props and o.props.level or "")
      assert(lv, "scenes/map.scene.json: a node names the level '" .. tostring(o.props and o.props.level) .. "', which has no scene file")
      self.nodes[#self.nodes + 1] = { x = o.x, y = o.y, lv = lv }
    end
  end
  table.sort(self.nodes, function(a, b) return a.lv.index < b.lv.index end)
  for _, w in ipairs(levels.worlds()) do self.regions[#self.regions + 1] = w end
  -- where the cursor starts: the last level played, else the first not yet cleared
  local at = 1
  for i, n in ipairs(self.nodes) do
    if state.unlocked(n.lv) then at = i end
  end
  local first_open = at
  for i, n in ipairs(self.nodes) do if state.unlocked(n.lv) and not state.record(n.lv.id).done then first_open = i; break end end
  at = first_open
  if state.last then for i, n in ipairs(self.nodes) do if n.lv.id == state.last then at = i end end end
  self.at = at
  local n = self.nodes[at]
  self.hx, self.hy = n.x, n.y
  self.walk = nil
  self.face = 1
  self.panel_t = 0
  self.backdrop = nova.spawn(Backdrop, 0, 0, { sky = n.lv.world.sky or "grass", floor = 540 })
  self.region = n.lv.world
  self.region_t = 0
  self.cx = self.hx
  self:camera(0, true)
  audio.music("map")
  -- a level just cleared: its node celebrates, and the next one opens
  self.celebrate = nil
  if state.result then
    self.celebrate = { id = state.result.id, t = 0, first = state.result.result.first_clear }
    state.result = nil
  end
  transition.reveal(0.35)
  local stars, max = state.total_stars()
  nova.log("sunny: map at " .. n.lv.id .. " stars=" .. stars .. "/" .. max)
end

function Map:camera(dt, snap)
  local w = nova.view()
  local x0 = self.nodes[1].x - 300
  local x1 = self.nodes[#self.nodes].x + 300
  self.cx = snap and self.hx or self.cx + (self.hx - self.cx) * math.min(1, dt * 5)
  local x = math.max(x0 + w / 2, math.min(x1 - w / 2, self.cx))
  nova.cam.set(math.floor(x * 2 + 0.5) / 2, 270)
end

function Map:node_unlocked(i) return self.nodes[i] and state.unlocked(self.nodes[i].lv) end

function Map:update(dt)
  transition.update(dt)
  fx.update(dt)
  self.t = self.t + dt
  self.panel_t = self.panel_t + dt
  self.region_t = self.region_t + dt
  if self.celebrate then self.celebrate.t = self.celebrate.t + dt end
  if self.walk then
    local wk = self.walk
    wk.t = wk.t + dt
    local k = math.min(1, wk.t / wk.dur)
    self.hx = wk.x0 + (wk.x1 - wk.x0) * k
    self.hy = wk.y0 + (wk.y1 - wk.y0) * k - math.sin(k * math.pi) * (20 + math.abs(wk.y1 - wk.y0) * 0.5)
    if k >= 1 then
      self.walk = nil
      self.at = wk.to
      nova.log("sunny: map at " .. self.nodes[self.at].lv.id)
      self.panel_t = 0
      audio.sfx("land", { volume = 0.6 })
      local wd = self.nodes[self.at].lv.world
      if wd ~= self.region then
        self.region, self.region_t = wd, 0
        self.backdrop.sky = wd.sky or "grass"
      end
    end
  end
  self:camera(dt)
  if transition.busy() or self.walk then return end
  local dir = (nova.input.pressed("right") or nova.input.axis("move_x") > 0.6) and 1 or ((nova.input.pressed("left") or nova.input.axis("move_x") < -0.6) and -1 or 0)
  if dir ~= 0 then
    local to = self.at + dir
    if self:node_unlocked(to) then
      local a, b = self.nodes[self.at], self.nodes[to]
      self.walk = { x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y, t = 0, dur = math.max(0.3, math.abs(b.x - a.x) / 520), to = to }
      self.face = dir
      audio.sfx("jump", { volume = 0.5 })
    elseif nova.input.pressed(dir > 0 and "right" or "left") then
      audio.sfx("nope")
    end
  end
  local node = self.nodes[self.at]
  if nova.input.pressed("a") or nova.input.pressed("jump") and not nova.input.pressed("b") then
    self:play(node.lv, "normal")
  elseif nova.input.pressed("trial") then
    if state.record(node.lv.id).done then self:play(node.lv, "trial") else audio.sfx("nope") end
  elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then
    audio.sfx("back")
    transition.cover({ title = "Sunny Hop", color = { 255, 200, 50 } }, function() nova.goto_scene("title") end)
  end
end

function Map:play(lv, mode)
  audio.sfx("accept")
  state.set_last(lv.id)
  transition.cover({ title = lv.name, sub = (mode == "trial" and "Time trial  " or "") .. lv.label, color = Play.color_of(lv) }, function()
    nova.goto_scene("play", lv.id, mode)
  end)
end

-- the path's dots, the level plates and Sunny, in the world
function Map:draw()
  for i = 1, #self.nodes - 1 do
    local a, b = self.nodes[i], self.nodes[i + 1]
    local open = self:node_unlocked(i + 1)
    local d = math.sqrt((b.x - a.x) ^ 2 + (b.y - a.y) ^ 2)
    local steps = math.floor(d / 26)
    for k = 1, steps - 1 do
      local f = k / steps
      local x = a.x + (b.x - a.x) * f
      local y = a.y + (b.y - a.y) * f - math.sin(f * math.pi) * 24 - 10
      fx.draw("ui/disc", x, y, { sx = 0.09, sy = 0.09, color = open and { 255, 250, 235, 230 } or { 60, 60, 80, 110 } })
    end
  end
  for i, n in ipairs(self.nodes) do
    local open = self:node_unlocked(i)
    local done = state.record(n.lv.id).done
    local sel = i == self.at
    local pop = 1
    if self.celebrate and self.celebrate.id == n.lv.id then pop = 1 + math.max(0, 1 - self.celebrate.t) * 0.4 * math.abs(math.sin(self.celebrate.t * 10)) end
    local s = (sel and 0.42 + math.sin(self.t * 5) * 0.02 or 0.36) * pop
    local col = done and { 255, 205, 60 } or (open and { 255, 255, 255 } or { 150, 150, 165 })
    fx.draw("ui/disc", n.x, n.y - 8, { sx = s + 0.06, sy = (s + 0.06) * 0.55, color = { 53, 53, 65, 255 } })
    fx.draw("ui/disc", n.x, n.y - 10, { sx = s, sy = s * 0.55, color = col })
    if not open then fx.draw("ui/lock_yellow", n.x, n.y - 40, { sx = 0.4, sy = 0.4 }) end
    if n.lv.props.boss and open then fx.draw("boss/crown", n.x, n.y - 46, { sx = 0.35, sy = 0.35 }) end
  end
  -- Sunny
  local walking = self.walk ~= nil
  local frame = walking and 4 or (math.floor(self.t * 1.2) % 4 == 0 and 1 or 0)
  local bob = walking and 0 or math.abs(math.sin(self.t * 3)) * 3
  fx.draw("hero", self.hx, self.hy - 52 - bob, { frame = frame, sx = 0.5 * self.face, sy = 0.5 })
end

function Map:draw_ui()
  local w, h = nova.view()
  -- level labels over the plates
  for i, n in ipairs(self.nodes) do
    local sx, sy = fx.to_screen(n.x, n.y)
    if sx > -60 and sx < w + 60 then
      local open = self:node_unlocked(i)
      if open then
        ui.in_box(n.lv.label, sx - 40, sy + 4, 80, 30, ui.SMALL, ui.color.white)
        local stars = state.stars(n.lv)
        for k = 1, 3 do ui.star(sx + (k - 2) * 20, sy + 40, 20, k <= stars) end
      end
    end
  end
  -- the world's name, when entering it
  local wd = self.region
  local k = self.region_t < 0.4 and ui.ease_back(self.region_t / 0.4) or 1
  ui.shade(w / 2 - 230, 14 - (1 - k) * 80, 460, 64, 170)
  ui.center(wd.index .. "  " .. (wd.name or wd.id), 26 - (1 - k) * 80, ui.HEAD - 6, ui.color.sun)
  local stars, max = state.total_stars()
  ui.shade(18, 18, 150, 48, 150)
  ui.star(46, 42, 34, true)
  ui.text(68, 42, stars .. "/" .. max, ui.MEDIUM, ui.color.white, { valign = "middle" })
  -- the chosen level
  local node = self.nodes[self.at]
  if node and not self.walk then
    local lv = node.lv
    local rec = state.record(lv.id)
    local e = ui.ease_back(self.panel_t / 0.3)
    local pw, ph = 560, 112
    local px, py = w / 2 - pw / 2, 96 - (1 - e) * 240
    ui.panel(px, py, pw, ph)
    ui.icon("ui/disc", px + 52, py + 56, 70, Play.color_of(lv))
    ui.in_box(lv.label, px + 17, py + 21, 70, 70, ui.fit(lv.label, ui.LARGE, 60), ui.color.white)
    ui.text(px + 102, py + 36, lv.name, ui.fit(lv.name, ui.LARGE, 300), ui.color.ink, { valign = "middle", outline = false })
    local _, got = state.stars(lv)
    for k2 = 1, 3 do ui.star(px + 112 + (k2 - 1) * 36, py + 80, 32, got[k2]) end
    local GEM = { "ui/gem_blue", "ui/gem_green", "ui/gem_red" }
    for g = 1, 3 do ui.icon(GEM[g], px + 236 + (g - 1) * 34, py + 80, rec.gems[g] and 32 or 26, rec.gems[g] and nil or { 40, 40, 60, 110 }) end
    ui.right("Best " .. (rec.best and ui.time(rec.best) or "--"), px + pw - 24, py + 38, ui.MEDIUM, ui.color.ink, { valign = "middle", outline = false })
    if lv.target then ui.right("Star time " .. ui.time(lv.target), px + pw - 24, py + 78, ui.SMALL, ui.color.dim, { valign = "middle", outline = false }) end
  end
  local hints = { { "pad_dpad", "Walk" }, { "pad_a", "Play" } }
  if node and state.record(node.lv.id).done then hints[#hints + 1] = { "pad_y", "Time trial" } end
  hints[#hints + 1] = { "pad_b", "Title" }
  ui.hints(hints)
  transition.draw()
end

return Map

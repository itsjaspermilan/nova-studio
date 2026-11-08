-- The title screen, the level select and the options. Behind the menus a finished flat turns slowly (the furthest level reached, arranged the way its
-- client wished). The level select is the streets of the town: each street a row of flats, each flat a card with its floor plan and stars.
local Rules = require("lib.rules")
local View = require("lib.view")
local ui = require("lib.ui")
local audio = require("lib.audio")
local levels = require("lib.levels")
local state = require("lib.state")
local transition = require("lib.transition")
local selftest = require("lib.selftest")

local Title = nova.scene {}

local MAIN = { "Play", "Choose a flat", "How to play", "Options" }
local OPTIONS = { "Music", "Sounds", "Smooth edges", "Back" }

function Title:enter(screen)
  self.t = 0
  self.screen = screen or "title"
  self.enter_t = 0
  self.sel = 1
  self.opt = 1
  -- the diorama: the furthest flat reached, finished
  local i = math.max(1, math.min(levels.count(), state.next_level()))
  if i < 4 then i = 4 end
  self:diorama(i)
  -- the level select's place
  self.focus = state.focus or state.next_level()
  state.focus = nil
  self.street = levels.get(self.focus).street or 1
  audio.music("menu")
  transition.reveal(0.2)
  nova.log("title: " .. self.screen)
end

function Title:leave() View.leave() end

-- a flat behind the menus, arranged the way its client wished (the solver's solution played through)
function Title:diorama(i)
  self.L = levels.get(i)
  local R = Rules.new(self.L)
  local s = R:start()
  if self.L.props.solution then s = R:replay(self.L.props.solution) end
  self.view = View.new(self.L)
  View.setup(state.smooth)
  self.view:build()
  self.view:sync(s)
  self.view:celebrate()
end

function Title:go(scene, spec, arg)
  transition.cover(spec, function() nova.goto_scene(scene, arg) end)
end

function Title:play(i, tips)
  state.level = i
  state.show_tips = tips
  local L = levels.get(i)
  local street = levels.street_of(i)
  self:go("play", { title = L.props.name, sub = street.name .. "  ·  Flat " .. i, color = street.color })
end

function Title:switch(screen)
  self.screen, self.enter_t = screen, 0
  audio.sfx("page")
end

-- ---- every step ----

function Title:update(dt)
  self.t = self.t + dt
  self.enter_t = self.enter_t + dt
  transition.update(dt)
  self.view:update(dt)
  if transition.busy() then return end
  if nova.input.pressed("selftest") then selftest.run() end
  if nova.input.pressed("art_box") then self.art = "box"; self:diorama(math.min(levels.count(), 13)) end
  if nova.input.pressed("art_icon") then self.art = "icon" end
  if self.art then return end
  if self.screen == "title" then self:update_title()
  elseif self.screen == "streets" then self:update_streets()
  elseif self.screen == "options" then self:update_options() end
end

function Title:update_title()
  local sel, act = ui.navigate(self.sel, #MAIN)
  self.sel = sel
  if act ~= "accept" then return end
  audio.sfx("menu_accept")
  local item = MAIN[self.sel]
  if item == "Play" then
    if not state.tutorial_done() then self:play(1, true) else self:play(state.next_level()) end
  elseif item == "Choose a flat" then self:switch("streets")
  elseif item == "How to play" then self:play(1, true)
  elseif item == "Options" then self.opt = 1; self:switch("options") end
end

-- the level select: a grid of the street's flats, three across
function Title:update_streets()
  local street = levels.STREETS[self.street]
  local first, last = street.first, math.min(street.last, levels.count())
  local i = self.focus
  if i < first or i > last then i = first end
  local col, row = (i - first) % 3, (i - first) // 3
  local moved = false
  if nova.input.pressed("left") then
    if col > 0 then i = i - 1 elseif self.street > 1 then self.street = self.street - 1; i = math.min(levels.STREETS[self.street].last, levels.count()) end
    moved = true
  elseif nova.input.pressed("right") then
    if i < last and col < 2 then i = i + 1 elseif self.street < #levels.STREETS and levels.STREETS[self.street + 1].first <= levels.count() then self.street = self.street + 1; i = levels.STREETS[self.street].first end
    moved = true
  elseif nova.input.pressed("up") and row > 0 then i = i - 3; moved = true
  elseif nova.input.pressed("down") and i + 3 <= last then i = i + 3; moved = true
  elseif nova.input.pressed("l1") and self.street > 1 then self.street = self.street - 1; i = levels.STREETS[self.street].first; moved = true
  elseif nova.input.pressed("r1") and self.street < #levels.STREETS and levels.STREETS[self.street + 1].first <= levels.count() then self.street = self.street + 1; i = levels.STREETS[self.street].first; moved = true end
  if moved then audio.sfx("menu_move") end
  self.focus = i
  if nova.input.pressed("a") then
    if state.unlocked(i) then audio.sfx("menu_accept"); self:play(i) else audio.sfx("nope"); self.locked_t = 0 end
  elseif nova.input.pressed("b") then self:switch("title"); audio.sfx("menu_back") end
end

function Title:update_options()
  local sel, act = ui.navigate(self.opt, #OPTIONS)
  self.opt = sel
  local item = OPTIONS[self.opt]
  local step = (act == "left" and -0.1) or (act == "right" and 0.1) or 0
  if item == "Music" and step ~= 0 then state.music_volume = math.max(0, math.min(1, state.music_volume + step)); state.save_options(); audio.sfx("menu_move") end
  if item == "Sounds" and step ~= 0 then state.sfx_volume = math.max(0, math.min(1, state.sfx_volume + step)); state.save_options(); audio.sfx("menu_move") end
  if item == "Smooth edges" and (act == "accept" or step ~= 0) then state.smooth = not state.smooth; state.save_options(); View.setup(state.smooth); audio.sfx("menu_accept") end
  if (item == "Back" and act == "accept") or act == "back" then self:switch("title"); audio.sfx("menu_back") end
end

-- ---- drawing ----

function Title:draw()
  local w, h = nova.view()
  local left = (self.screen == "streets") and 0 or 0.38
  if self.art == "box" then left = 0 end
  self.view:camera(w, h, left, self.screen == "streets" and 1.25 or 0.95, math.sin(self.t * 0.12) * 0.35)
  self.view:draw()
end

-- the logo: "Moving Day" with each letter bouncing in turn, on a kraft tag held by tape
function Title:logo(x, y, size)
  local text = "Moving Day"
  local tw = ui.width(text, size)
  ui.panel(x - 26, y - 14, tw + 52, size + 40, "kraft")
  nova.ui.sprite("ui/tape", x + tw / 2 + ui.ox, y - 12 + ui.oy, { w = 150, h = 40, color = ui.tint({ 255, 255, 255, 235 }) })
  local cx = x
  for k = 1, #text do
    local ch = text:sub(k, k)
    local cw = ui.width(ch, size)
    local bob = math.max(0, math.sin(self.t * 3 - k * 0.45)) * 7
    ui.text(cx, y + 6 - bob, ch, size, k <= 6 and ui.color.cream or { 255, 214, 120 }, { shadow = true })
    cx = cx + cw
  end
end

function Title:draw_title(w, h)
  local e = math.min(1, self.enter_t / 0.4)
  ui.ox = (1 - e) ^ 3 * -200
  self:logo(48, 44, ui.TITLE)
  ui.text(52, 140, "A cosy furniture puzzle", ui.MEDIUM, ui.color.white, { shadow = true })
  local items = {}
  for k, item in ipairs(MAIN) do items[k] = item end
  if state.tutorial_done() and state.next_level() > 1 then items[1] = "Play  ·  Flat " .. state.next_level() end
  ui.menu(items, self.sel, 196, { width = 330, row = 64, cx = 40 + 165, enter = self.enter_t, id = "main" })
  ui.ox = 0
  local stars, total = state.total_stars(), levels.count() * 3
  ui.panel(40, h - 66, 200, 48, "ink", 230)
  ui.star(68, h - 42, 34, true)
  ui.text(94, h - 42, string.format("%d / %d", stars, total), ui.MEDIUM, ui.color.cream, { valign = "middle" })
  ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "Accept" } })
end

local ROOM_COLOR = { living = { 226, 196, 150 }, bedroom = { 232, 180, 188 }, kitchen = { 242, 232, 208 }, bathroom = { 182, 214, 230 } }
local PIECE_COLOR = { box = { 190, 140, 90 }, tv = { 70, 70, 84 }, sofa = { 226, 108, 108 }, armchair = { 226, 108, 108 }, bed = { 236, 120, 140 }, plant = { 96, 170, 110 }, bathtub = { 236, 240, 244 }, washer = { 236, 240, 244 }, fridge = { 236, 240, 244 }, stove = { 200, 204, 214 } }

-- a flat's floor plan in a box: the rooms' floors, the walls, the furniture where it starts
local function plan(L, x, y, bw, bh, alpha)
  local wide, deep = L.x1 - L.x0 + 1, L.z1 - L.z0 + 1
  local c = math.floor(math.min(bw / wide, bh / deep))
  local ox, oy = x + (bw - c * wide) / 2, y + (bh - c * deep) / 2
  local function at(cx, cz) return ox + (cx - L.x0) * c, oy + (cz - L.z0) * c end
  for _, f in ipairs(L.floors) do
    local col = ROOM_COLOR[Rules.FLOORS[f.kind]]
    local px, py = at(f.x, f.z)
    nova.ui.rect(px + ui.ox, py + ui.oy, c, c, { col[1], col[2], col[3], alpha })
  end
  for _, p in ipairs(L.pieces) do
    local col = PIECE_COLOR[p.kind] or { 184, 140, 100 }
    for _, cell in ipairs(Rules.cells(p.kind, p.x, p.z, p.q)) do
      local px, py = at(cell[1], cell[2])
      nova.ui.rect(px + 2 + ui.ox, py + 2 + ui.oy, c - 4, c - 4, { col[1], col[2], col[3], alpha })
    end
  end
  for _, wl in ipairs(L.walls) do
    local px, py = at(wl.x, wl.z)
    local col = wl.kind == "window" and { 90, 170, 220, alpha } or { 70, 56, 60, alpha }
    if wl.kind ~= "doorway" then
      if wl.dz == -1 then nova.ui.rect(px + ui.ox, py - 1 + ui.oy, c, 3, col)
      elseif wl.dz == 1 then nova.ui.rect(px + ui.ox, py + c - 2 + ui.oy, c, 3, col)
      elseif wl.dx == -1 then nova.ui.rect(px - 1 + ui.ox, py + ui.oy, 3, c, col)
      else nova.ui.rect(px + c - 2 + ui.ox, py + ui.oy, 3, c, col) end
    end
  end
end

function Title:draw_streets(w, h)
  local street = levels.STREETS[self.street]
  local e = math.min(1, self.enter_t / 0.35)
  nova.ui.rect(0, 0, w, h, { 40, 34, 52, math.floor(110 * e) })
  -- the street's name on a ribbon, with arrows to the others
  ui.ribbon(w / 2 - 230, 22, 460, 62, street.color, street.name, ui.HEAD - 6)
  ui.center(street.sub, 92, ui.MEDIUM, ui.color.white, { shadow = true })
  if self.street > 1 then ui.pad("pad_l", w / 2 - 300, 34, 40) end
  if self.street < #levels.STREETS then ui.pad("pad_r", w / 2 + 260, 34, 40) end
  -- the flats
  local first, last = street.first, math.min(street.last, levels.count())
  local cw, ch, gap = 270, 176, 22
  local gx = (w - (cw * 3 + gap * 2)) / 2
  for i = first, last do
    local k = i - first
    local col, row = k % 3, k // 3
    local x, y = gx + col * (cw + gap), 134 + row * (ch + gap)
    local drop = math.max(0, 1 - math.min(1, (self.enter_t - k * 0.05) / 0.3))
    y = y + drop ^ 2 * 40
    local L = levels.get(i)
    local on = i == self.focus
    local open = state.unlocked(i)
    local lift = on and (3 + math.sin(self.t * 5) * 2) or 0
    ui.panel(x - (on and 4 or 0), y - lift - (on and 4 or 0), cw + (on and 8 or 0), ch + (on and 8 or 0), on and "light" or "card", 255)
    ui.badge(x + 26, y + 24 - lift, 40, street.color, tostring(i), ui.MEDIUM)
    local name = L.props.name or ""
    ui.text(x + 54, y + 12 - lift, name, ui.fit(name, ui.MEDIUM, cw - 64), ui.color.ink)
    plan(L, x + 16, y + 48 - lift, cw - 32, ch - 92, open and 255 or 90)
    if open then
      local stars = state.stars(i)
      for s2 = 1, 3 do ui.star(x + 22 + (s2 - 1) * 32, y + ch - 36 - lift, 28, s2 <= stars) end
      local best = state.best(i)
      if best > 0 then ui.right(best .. " moves", x + cw - 16, y + ch - 32 - lift, ui.SMALL, ui.color.dim) end
    else
      ui.icon("ui/lock", x + cw / 2 - 24, y + ch / 2 - 30 - lift, 48)
      ui.center("Finish flat " .. (i - 1) .. " first", y + ch - 36 - lift, ui.SMALL, ui.color.dim, { cx = x + cw / 2 })
    end
    if on then nova.ui.sprite("ui/pointer", x - 16 + math.sin(self.t * 6) * 3 + ui.ox, y + ch / 2 - lift + ui.oy, { w = 36, h = 36 }) end
  end
  ui.hints({ { "pad_dpad", "Choose" }, { "pad_l", "Street" }, { "pad_a", "Play" }, { "pad_b", "Back" } })
end

function Title:draw_options(w, h)
  local pw = 520
  ui.panel(w / 2 - pw / 2 + 120, 100, pw, 340, "card")
  ui.ribbon(w / 2 - 160 + 120, 80, 320, 56, ui.color.teal, "Options", ui.LARGE)
  local items = {
    { "Music", string.format("%d%%", math.floor(state.music_volume * 100 + 0.5)) },
    { "Sounds", string.format("%d%%", math.floor(state.sfx_volume * 100 + 0.5)) },
    { "Smooth edges", state.smooth and "On" or "Off" },
    "Back",
  }
  ui.menu(items, self.opt, 160, { width = 440, row = 64, cx = w / 2 + 120, enter = self.enter_t, id = "options" })
  ui.hints({ { "pad_dpad", "Choose and change" }, { "pad_b", "Back" } })
end

-- store art: the logo over the flat, nothing else (F12 box art, F11 the icon)
function Title:draw_art(w, h)
  if self.art == "icon" then
    -- a cardboard square with packing tape, the sofa, and a heart
    nova.ui.rect(0, 0, w, h, { 214, 168, 116, 255 })
    nova.ui.rect(0, h * 0.86, w, h * 0.14, { 188, 140, 92, 255 })
    nova.ui.sprite("ui/tape", w / 2, h * 0.09, { w = w * 0.9, h = w * 0.2 })
    ui.icon("ui/icon_sofa", w * 0.08, h * 0.2, w * 0.84)
    nova.ui.sprite("ui/glyph_next", w * 0.78, h * 0.26, { w = w * 0.3, h = w * 0.3 })
    return
  end
  local size = math.floor(math.min(w * 0.12, ui.TITLE * 1.4))
  local tw = ui.width("Moving Day", size)
  self:logo((w - tw) / 2, h * 0.08, size)
end

function Title:draw_ui()
  local w, h = nova.view()
  if self.art then self:draw_art(w, h); return end
  if self.screen == "title" then self:draw_title(w, h)
  elseif self.screen == "streets" then self:draw_streets(w, h)
  elseif self.screen == "options" then self:draw_title(w, h); nova.ui.rect(0, 0, w, h, { 30, 26, 44, 120 }); self:draw_options(w, h) end
  transition.draw()
end

return Title

-- The title: a meadow (scenes/title.scene.json) with Sunny and friends hopping about, the bouncing name, and the menu: Play, Options, Credits.
-- F10 runs the self-test (lib/selftest.lua), F9 lets the computer play every level (lib/bot.lua), F11 and F12 show the icon and the box art.
local ui = require("lib.ui")
local state = require("lib.state")
local audio = require("lib.audio")
local transition = require("lib.transition")
local levels = require("lib.levels")
local fx = require("lib.fx")
local Backdrop = require("lib.backdrop")
local bot = require("lib.bot")

local Title = nova.scene {}

local ITEMS = { "Play", "Options", "Credits" }

function Title:enter()
  self.t, self.menu_t = 0, 0
  self.phase = state.seen_title and "menu" or "press"
  state.seen_title = true
  self.sel, self.opt_sel = 1, 1
  nova.spawn(Backdrop, 0, 0, { sky = "meadow", floor = 540 })
  -- the hero and friends hop on the meadow's grass
  self.folk = {
    { sheet = "hero", x = 470, phase = 0, hop = 0.9, big = true },
    { sheet = "friends", tag = 0, x = 330, phase = 0.3, hop = 1.1 },
    { sheet = "friends", tag = 2, x = 610, phase = 0.6, hop = 1.3 },
    { sheet = "friends", tag = 4, x = 210, phase = 0.15, hop = 1.0 },
    { sheet = "friends", tag = 6, x = 735, phase = 0.45, hop = 1.2 },
  }
  self.ground = 432
  nova.cam.set(480, 270)
  audio.music("title")
  transition.reveal(0.2)
  self.art = nil
end

function Title:update(dt)
  transition.update(dt)
  self.t = self.t + dt
  self.menu_t = self.menu_t + dt
  nova.cam.set(480 + math.floor(math.sin(self.t * 0.12) * 120 * 2) / 2, 270)
  if nova.input.pressed("art_box") then self.art = self.art == "box" and nil or "box" end
  if nova.input.pressed("art_icon") then self.art = self.art == "icon" and nil or "icon" end
  if transition.busy() then return end
  if nova.input.pressed("selftest") then
    local ok, report = require("lib.selftest").run()
    self.report = report
    nova.log("sunny: selftest " .. (ok and "passed" or "FAILED") .. ": " .. report)
  end
  if nova.input.pressed("autoplay") then
    bot.start_all()
    local lv = levels.all()[1]
    transition.cover({ title = lv.name, sub = lv.label, color = { 110, 200, 90 } }, function() nova.goto_scene("play", lv.id, "normal") end)
    return
  end
  if self.phase == "press" then
    if nova.input.pressed("a") or nova.input.pressed("jump") or nova.input.pressed("pause") then
      self.phase, self.menu_t = "menu", 0
      audio.sfx("accept")
    end
  elseif self.phase == "menu" then
    local sel, act = ui.navigate(self.sel, #ITEMS)
    self.sel = sel
    if act == "accept" then
      audio.sfx("accept")
      if sel == 1 then
        transition.cover({ title = "Sunny Hop", sub = "The world map", color = { 255, 200, 50 } }, function() nova.goto_scene("map") end)
      elseif sel == 2 then self.phase, self.menu_t, self.opt_sel = "options", 0, 1
      else self.phase, self.menu_t = "credits", 0 end
    elseif act == "back" then self.phase, self.menu_t = "press", 0 end
  elseif self.phase == "options" then
    local n = 4
    local sel, act = ui.navigate(self.opt_sel, n)
    self.opt_sel = sel
    local step = (act == "left" and -0.1) or (act == "right" and 0.1) or 0
    if sel == 1 and step ~= 0 then state.music_volume = math.max(0, math.min(1, state.music_volume + step)); state.save_options(); audio.sfx("move") end
    if sel == 2 and step ~= 0 then state.sfx_volume = math.max(0, math.min(1, state.sfx_volume + step)); state.save_options(); audio.sfx("coin") end
    if act == "accept" and sel == 3 then
      self.confirm = (self.confirm or 0) + 1
      if self.confirm >= 2 then
        for _, k in ipairs(nova.save.keys()) do if k ~= "options" then nova.save.delete(k) end end
        state.last, self.confirm = nil, 0
        audio.sfx("disappear")
      else audio.sfx("nope") end
    elseif act == "accept" and sel == 4 or act == "back" then
      self.phase, self.menu_t, self.confirm = "menu", 0, 0
      audio.sfx("back")
    end
    if sel ~= 3 then self.confirm = 0 end
  elseif self.phase == "credits" then
    if nova.input.pressed("a") or nova.input.pressed("b") or nova.input.pressed("menu_back") then self.phase, self.menu_t = "menu", 0; audio.sfx("back") end
  end
end

function Title:draw()
  -- the folk hopping on the grass: each hops on its own beat and squashes when it lands
  for _, f in ipairs(self.folk) do
    local p = (self.t / f.hop + f.phase) % 1
    local air = p < 0.6
    local k = air and p / 0.6 or 0
    local y = self.ground - (air and math.sin(k * math.pi) * (f.big and 120 or 80) or 0)
    local sq = air and 1 or (1 + math.sin((p - 0.6) / 0.4 * math.pi) * 0.25)
    local sx = 0.5 / sq * (f.big and 1.15 or 0.9)
    local sy = 0.5 * sq * (f.big and 1.15 or 0.9) * (air and 1.05 or 1)
    local frame = f.sheet == "hero" and (air and 4 or 1) or (f.tag + (air and 1 or 0))
    local h = 96 * sy * 2
    fx.draw(f.sheet, f.x + 480 - 480, y - h / 2, { frame = frame, sx = sx * (f.x > 480 and -1 or 1), sy = sy })
  end
end

local function logo(t, y, size_override)
  local w = nova.view()
  local text = "Sunny Hop"
  local size = size_override or 104
  local adv = {}
  local tw = 0
  for i = 1, #text do adv[i] = (text:sub(i, i) == " " and size * 0.3 or ui.width(text:sub(i, i), size) + size * 0.02); tw = tw + adv[i] end
  local x = w / 2 - tw / 2
  -- each letter bobs on its own
  for i = 1, #text do
    local ch = text:sub(i, i)
    local cw = adv[i]
    local bob = math.sin(t * 3 - i * 0.55) * size * 0.07
    local col = i <= 5 and ui.color.sun or { 120, 210, 255 }
    if ch ~= " " then ui.text(x, y + bob, ch, size, col, { outline = true }) end
    x = x + cw
  end
end

function Title:draw_ui()
  local w, h = nova.view()
  if self.art then return self:draw_art() end
  local enter = ui.ease_back(self.t / 0.6)
  logo(self.t, 40 - (1 - enter) * 160)
  ui.center("a sunny little platformer", 162, ui.LARGE, ui.color.white)
  if self.phase == "press" then
    local a = 0.55 + 0.45 * math.sin(self.t * 4)
    ui.alpha = a
    ui.pad("pad_a", w / 2 - 92, 488, 40)
    ui.text(w / 2 - 64, 488, "Press to start", ui.LARGE, ui.color.white, { valign = "middle" })
    ui.alpha = 1
  elseif self.phase == "menu" then
    local stars, max = state.total_stars()
    ui.menu(ITEMS, self.sel, 222, { enter = self.menu_t, id = "title", width = 340 })
    ui.shade(18, 18, 170, 48, 150)
    ui.star(48, 42, 36, true)
    ui.text(72, 42, stars .. "/" .. max, ui.MEDIUM, ui.color.white, { valign = "middle" })
    ui.hints({ { "pad_dpad", "Choose" }, { "pad_a", "OK" } })
  elseif self.phase == "options" then
    ui.shade(w / 2 - 260, 210, 520, 300, 170)
    local pct = function(v) return math.floor(v * 100 + 0.5) .. "%" end
    local items = { { "Music", pct(state.music_volume) }, { "Sounds", pct(state.sfx_volume) }, { (self.confirm or 0) > 0 and "Sure? Press again" or "Erase progress", "" }, { "Back", "" } }
    ui.menu(items, self.opt_sel, 228, { enter = self.menu_t, id = "options", width = 460 })
    ui.hints({ { "pad_dpad", "Choose and change" }, { "pad_a", "OK" }, { "pad_b", "Back" } })
  elseif self.phase == "credits" then
    ui.shade(w / 2 - 330, 206, 660, 290, 180)
    local y = 226
    for _, line in ipairs({
      { "Made with Nova Studio", ui.LARGE, ui.color.sun },
      { "Art and sounds: Kenney (kenney.nl), CC0", ui.MEDIUM, ui.color.white },
      { "New Platformer Pack, Input Prompts,", ui.MEDIUM, ui.color.white },
      { "Music Jingles, Interface and Impact Sounds", ui.MEDIUM, ui.color.white },
      { "Music written for this game", ui.MEDIUM, ui.color.white },
      { "Thank you for playing!", ui.LARGE, ui.color.sun },
    }) do
      ui.center(line[1], y, line[2], line[3])
      y = y + line[2] + 18
    end
    ui.hints({ { "pad_b", "Back" } })
  end
  if self.report then ui.text(16, 520 - 30, self.report, ui.SMALL, ui.color.white) end
  transition.draw()
end

-- F11: the app's icon (square), F12: the box art (any shape), drawn over the meadow scene by the game itself (scripts/sunny/art.sh)
function Title:draw_art()
  local w, h = nova.view()
  if self.art == "icon" then
    nova.ui.rect(0, 0, w, h, { 110, 196, 255, 255 })
    ui.icon("fx/glow", w / 2, h * 0.62, h * 1.2, { 255, 240, 160, 200 })
    nova.ui.sprite("hero", w / 2, h * 0.5, { frame = 4, w = h * 1.05, h = h * 1.05 })
    return
  end
  local size = math.floor(math.min(w * 0.17, h * 0.2))
  logo(self.t, h * 0.08, size)
  ui.center("a sunny little platformer", h * 0.08 + size * 1.25, math.floor(size * 0.32), ui.color.white)
end

return Title

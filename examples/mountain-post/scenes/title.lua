-- The title card: the name over a painted valley, the song beginning, and a small menu of plain choices: Start (into the post office) and
-- Controls (the page of what each button does, lib/cards.lua). Up and down choose, A confirms.
local ui = require("lib.ui")
local words = require("lib.words")
local music = require("lib.music")
local cards = require("lib.cards")

local Title = nova.scene {}

local CHOICES = { "start", "controls" }
Title.CHOICES = CHOICES

function Title:enter()
  self.t, self.leaving, self.choice = 0, nil, 1
  nova.see_through() -- (the valley's cut-away round the postmaster stays until changed: quitting to the title clears it)
  music.start("title")
end

function Title:update(dt)
  self.t = self.t + dt
  music.update(dt, {})
  if cards.active() then cards.update(dt); return end -- (the Controls page)
  if self.leaving then
    self.leaving = self.leaving + dt
    if self.leaving > 0.6 then nova.goto_scene("office") end
    return
  end
  if self.t <= 0.4 then return end
  local n = #CHOICES
  if self.t > 1.0 then
    if nova.input.pressed("menu_down") then self.choice = self.choice % n + 1; nova.sound.play("tick", { volume = 0.35 })
    elseif nova.input.pressed("menu_up") then self.choice = (self.choice - 2) % n + 1; nova.sound.play("tick", { volume = 0.35 }) end
  end
  if nova.input.pressed("pause") or (nova.input.pressed("confirm") and CHOICES[self.choice] == "start") then
    self.leaving = 0
    nova.sound.play("bell", { volume = 0.5 })
  elseif nova.input.pressed("confirm") and self.t > 1.0 then
    nova.sound.play("tick", { volume = 0.45, pitch = 1.2 })
    cards.open("controls")
  end
end

function Title:draw_ui()
  local w, h = nova.view("exact")
  nova.ui.sprite("ui/title_bg", w / 2, h / 2, { w = math.max(w, h * 16 / 9), h = math.max(h, w * 9 / 16) })
  local a = math.min(1, self.t / 1.2)
  -- (a soft shade behind the name, so the cream letters stand out of the bright sky)
  ui.band(h * 0.36, w, a)
  nova.ui.sprite("ui/logo", w / 2, h * 0.36, { w = ui.s(660), h = ui.s(192), color = { 255, 255, 255, math.floor(255 * a) } })
  if self.t > 1.0 and not cards.active() then
    -- the two choices as plain keys (the chosen one red), rising and settling once as they appear
    local e = math.min(1, (self.t - 1.0) / 0.3)
    cards.buttons(w / 2, h * 0.62 + (1 - e) * 10, ui.s(240), { words.press, words.pause.controls }, self.choice, e)
  end
  cards.draw(w, h)
  ui.fade(self.leaving and self.leaving / 0.6 or math.max(0, 1 - self.t / 0.8), w, h)
end

return Title

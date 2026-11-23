-- The title card: the name over a painted valley, the song beginning, A to start (a prompt chip of the UI kit). A goes into the post office.
local ui = require("lib.ui")
local words = require("lib.words")

local Title = nova.scene {}

function Title:enter()
  self.t, self.leaving = 0, nil
  nova.see_through() -- (the valley's cut-away round the postmaster stays until changed: quitting to the title clears it)
  nova.music.play("fernhollow", { volume = 0.36, fade = 1.5 })
end

function Title:update(dt)
  self.t = self.t + dt
  if self.leaving then
    self.leaving = self.leaving + dt
    if self.leaving > 0.6 then nova.goto_scene("office") end
    return
  end
  if self.t > 0.4 and (nova.input.pressed("confirm") or nova.input.pressed("pause")) then
    self.leaving = 0
    nova.sound.play("bell", { volume = 0.5 })
  end
end

function Title:draw_ui()
  local w, h = nova.view("exact")
  nova.ui.sprite("ui/title_bg", w / 2, h / 2, { w = math.max(w, h * 16 / 9), h = math.max(h, w * 9 / 16) })
  local a = math.min(1, self.t / 1.2)
  -- (a soft shade behind the name, so the cream letters stand out of the bright sky)
  ui.band(h * 0.36, w, a)
  nova.ui.sprite("ui/logo", w / 2, h * 0.36, { w = ui.s(660), h = ui.s(192), color = { 255, 255, 255, math.floor(255 * a) } })
  if self.t > 1.0 then
    -- A to start, on a prompt chip of the kit (the A button's cap and the word), rising and settling once as it appears
    local e = math.min(1, (self.t - 1.0) / 0.3)
    local word = words.press
    ui.chip(w / 2 - ui.chip_width("A", word) / 2, h * 0.79 + (1 - e) * 10, "A", word, { alpha = e, down = nova.input.down("confirm") })
  end
  ui.fade(self.leaving and self.leaving / 0.6 or math.max(0, 1 - self.t / 0.8), w, h)
end

return Title

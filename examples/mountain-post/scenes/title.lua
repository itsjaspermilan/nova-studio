-- The title card: the name over a painted valley, the song beginning, "Press A". A goes into the post office.
local ui = require("lib.ui")
local words = require("lib.words")

local Title = nova.scene {}

function Title:enter()
  self.t, self.leaving = 0, nil
  nova.music.play("fernhollow", { volume = 0.36, fade = 1.5 })
end

function Title:update(dt)
  self.t = self.t + dt
  if self.leaving then
    self.leaving = self.leaving + dt
    if self.leaving > 0.6 then nova.goto_scene("office") end
    return
  end
  if self.t > 0.4 and (nova.input.pressed("act") or nova.input.pressed("pause")) then
    self.leaving = 0
    nova.sound.play("bell", { volume = 0.5 })
  end
end

function Title:draw_ui()
  local w, h = nova.view("exact")
  nova.ui.sprite("ui/title_bg", w / 2, h / 2, { w = math.max(w, h * 16 / 9), h = math.max(h, w * 9 / 16) })
  local a = math.min(1, self.t / 1.2)
  nova.ui.sprite("ui/logo", w / 2, h * 0.36, { w = 720, h = 240, color = { 255, 255, 255, math.floor(255 * a) } })
  if self.t > 1.0 then
    local pulse = 0.65 + 0.35 * math.sin(self.t * 3)
    -- "Press" and the A button's glyph
    local word = words.press:gsub(" A$", "")
    local tw = nova.ui.text_width(word, { font = "rounded", size = 28 })
    nova.ui.text(w / 2 - (tw + 40) / 2, h * 0.72, word, { font = "rounded", size = 28, color = { 255, 248, 232, math.floor(255 * pulse) }, shadow = { 0, 0, 0, 120 } })
    ui.glyph(w / 2 + (tw + 40) / 2 - 16, h * 0.72 + 17, "A", 32)
  end
  ui.fade(self.leaving and self.leaving / 0.6 or math.max(0, 1 - self.t / 0.8), w, h)
end

return Title

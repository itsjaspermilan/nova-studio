local state = require("lib.state")

local Win = nova.scene {}

function Win:enter()
  nova.music.stop(0.3)
  nova.sound.play("win")
  self.record = state.finish()
  nova.log(string.format("win: %.1f s, %d slain, %d hearts", state.time, state.slain, state.hearts))
  self.t = 0
  nova.burst(480, 200, { count = 60, speed = { 80, 320 }, life = { 0.8, 1.6 }, size = 7, size_end = 0, color = { 255, 214, 120, 255 }, color_end = { 255, 120, 60, 0 }, gravity = 260, screen = true })
end

function Win:update(dt)
  self.t = self.t + dt
  if self.t > 1 and nova.input.pressed("attack") then
    nova.sound.play("accept")
    nova.goto_scene("title")
  end
end

function Win:draw_ui()
  local w = nova.view()
  nova.rect(0, 0, w, 540, { 20, 18, 31, 255 })
  nova.ui.text(0, 110, "YOU ESCAPED", { font = "display", size = 60, align = "center", width = w, color = { 255, 214, 120 }, shadow = true })
  nova.ui.text(0, 210, string.format("%s   ·   %d slain   ·   %d hearts left", state.format_time(state.time), state.slain, state.hearts), { size = 24, align = "center", width = w })
  if self.record then nova.ui.text(0, 260, "a new best time!", { size = 22, align = "center", width = w, color = { 120, 230, 140 } }) end
  if self.t > 1 then nova.ui.text(0, 410, "press Z or Space", { size = 24, align = "center", width = w, shadow = true }) end
end

return Win

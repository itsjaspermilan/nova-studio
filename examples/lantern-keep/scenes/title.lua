local state = require("lib.state")

local Title = nova.scene {}

function Title:enter()
  nova.music.play("keep", { volume = 0.4 })
  self.t = 0
end

function Title:update(dt)
  self.t = self.t + dt
  if nova.input.pressed("attack") or nova.input.pressed("start") then
    nova.sound.play("accept")
    state.new_game()
    nova.goto_scene("room1")
  end
end

function Title:draw_ui()
  local w = nova.view()
  nova.ui.text(0, 90, "LANTERN KEEP", { font = "display", size = 64, align = "center", width = w, color = { 255, 214, 120 }, shadow = true })
  nova.ui.text(0, 168, "three rooms, one key each, and whatever lives in the dark", { size = 20, align = "center", width = w, color = { 200, 195, 225 } })
  if math.floor(self.t * 1.6) % 2 == 0 then
    nova.ui.text(0, 440, "press Z or Space", { size = 26, align = "center", width = w, shadow = true })
  end
  local best = state.best()
  if best then nova.ui.text(0, 492, "best time  " .. state.format_time(best), { size = 18, align = "center", width = w, color = { 255, 214, 120 } }) end
end

return Title

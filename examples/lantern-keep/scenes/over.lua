local state = require("lib.state")

local Over = nova.scene {}

function Over:enter()
  nova.music.stop(0.3)
  nova.sound.play("lose")
  nova.log(string.format("over: room %d, %.1f s", state.room, state.time))
  self.t = 0
end

function Over:update(dt)
  self.t = self.t + dt
  if self.t > 0.8 and nova.input.pressed("attack") then
    nova.sound.play("accept")
    nova.goto_scene("title")
  end
end

function Over:draw_ui()
  local w = nova.view()
  nova.rect(0, 0, w, 540, { 20, 18, 31, 255 })
  nova.ui.text(0, 130, "THE KEEP WINS", { font = "display", size = 58, align = "center", width = w, color = { 238, 59, 85 }, shadow = true })
  nova.ui.text(0, 230, string.format("Room %d of %d   ·   %d slain   ·   %s", state.room, #state.rooms, state.slain, state.format_time(state.time)), { size = 22, align = "center", width = w })
  if self.t > 0.8 then nova.ui.text(0, 410, "press Z or Space", { size = 24, align = "center", width = w, shadow = true }) end
end

return Over

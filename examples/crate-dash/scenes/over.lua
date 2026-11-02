local state = require("lib.state")

local Over = nova.scene {}

function Over:enter()
  nova.spawn("ground", 0, 440)
  self:go(function()
    nova.wait(0.8)
    nova.wait_until(function() return nova.input.down("throttle") or nova.input.down("action") end)
    nova.goto_scene("title")
  end)
end

function Over:draw_ui()
  local w, h = nova.view()
  local function centered(y, text, scale, color)
    nova.ui.text((w - nova.ui.text_width(text, scale)) / 2, y, text, { scale = scale, color = color })
  end
  centered(150, "GAME OVER", 6, { 255, 110, 110 })
  centered(240, "SCORE " .. state.score .. "   BEST " .. state.best, 3)
  centered(320, "JUMP TO PLAY AGAIN", 3, { 160, 200, 255 })
end

return Over

local state = require("lib.state")

local Over = nova.scene { drop = -220, shake = 0, fade = 0 }

function Over:enter()
  nova.sound.play("over")
  nova.spawn("ground", 0, 440)
  -- animations/over_in.anim.json moves this scene's drop, shake and fade, which draw_ui reads.
  -- Another round can start once the card is in.
  self:play_anim("over_in", { on_finish = function() self.ready = true end })
  self:go(function()
    nova.wait_until(function() return self.ready and nova.input.pressed("jump") end)
    nova.goto_scene("title")
  end)
end

function Over:draw_ui()
  local w, h = nova.view()
  local function centered(y, text, scale, color, dx)
    nova.ui.text((w - nova.ui.text_width(text, scale)) / 2 + (dx or 0), y, text, { scale = scale, color = color })
  end
  centered(150 + self.drop, "GAME OVER", 6, { 255, 110, 110 }, self.shake)
  local a = math.floor(255 * self.fade)
  centered(240, "SCORE " .. state.score .. "   BEST " .. state.best, 3, { 255, 255, 255, a })
  centered(320, "JUMP TO PLAY AGAIN", 3, { 160, 200, 255, a })
end

return Over

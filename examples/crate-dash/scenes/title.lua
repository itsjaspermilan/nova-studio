local state = require("lib.state")

local Title = nova.scene {}

function Title:enter()
  state.score, state.lives = 0, 3
  self.hero.floor = 440
  -- A script that can wait: pause briefly, then wait for a button.
  self:go(function()
    nova.wait(0.4)
    nova.wait_until(function() return nova.input.down("throttle") or nova.input.down("action") end)
    nova.goto_scene("play")
  end)
  -- The prompt blinks, using a repeating timer.
  self:every(0.5, function() self.prompt.visible = not self.prompt.visible end)
end

return Title

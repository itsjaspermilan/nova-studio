local state = require("lib.state")

local Play = nova.scene {}

function Play:enter()
  state.score, state.lives = 0, 3
  local w = nova.view()
  self:every(0.7, function() nova.spawn("crate", math.random(24, w - 24), -20) end)
  self:every(1.6, function() nova.spawn("star", math.random(24, w - 24), -10) end)
  -- Things speed up: tween a field of the scene itself.
  self.pace = 1
  self:tween({ pace = 2.2 }, 60, "linear")
end

function Play:update(dt)
  state.best = math.max(state.best, state.score)
end

function Play:draw_ui()
  nova.ui.text(44, 18, tostring(state.score), { scale = 3 })
  for i = 1, state.lives do
    nova.ui.sprite("player", 34 + i * 26, 74, { scale = 0.7 })
  end
end

return Play

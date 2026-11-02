-- file: entities/score.lua
-- Shows how many coins have been collected. "screen = true" draws it on the screen, not in the world.
local Score = nova.entity {
  tags = { "score" },
  screen = true,
  points = 0,
}

function Score:add(n)
  self.points = self.points + n
end

function Score:draw()
  nova.ui.text(self.x, self.y, "Coins: " .. self.points, { size = 28, color = { 255, 230, 120 } })
end

return Score

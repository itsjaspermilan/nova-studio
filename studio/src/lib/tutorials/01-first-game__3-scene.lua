-- file: scenes/title.lua
-- The scene sets the level up when it starts.
local Title = nova.scene {}

function Title:enter()
  nova.spawn("score", 24, 130)
  for i = 1, 6 do
    nova.spawn("coin", 160 + i * 110, 370) -- just above the player's head: jump to reach them
  end
end

return Title

-- file: scenes/title.lua
-- A level wider than the screen: the camera follows the hero and stops at the level's edges.
local Title = nova.scene {}

function Title:enter()
  nova.cam.limit(0, 0, 1920, 540)   -- the level is 1920 wide (set the scene's Width to match)
  nova.cam.follow(self.hero, 0.1)   -- "hero" is the name given to the player in the scene editor
  nova.spawn("score", 24, 130)
  for i = 1, 12 do
    nova.spawn("coin", 160 + i * 140, 370)
  end
end

return Title

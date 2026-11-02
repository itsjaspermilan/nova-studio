-- A scene. Everything in title.scene.json is built before enter() runs; anything given a "name"
-- there (like "hero") is available here as self.hero.
local Title = nova.scene {}

function Title:enter()
  self.score = 0
end

return Title

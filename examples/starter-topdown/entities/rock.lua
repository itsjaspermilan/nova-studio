-- A solid thing that is not a tile. The hero's own code stops at anything tagged "solid" (entities/hero.lua).
-- Its box is the lower part of the picture, so the hero can stand behind its top.
local Rock = nova.entity {
  sprite = "rock",
  tags = { "solid" },
  pivot = { 0.5, 1 },
  hitbox = { -7, -7, 14, 5 },
  sx = 3, sy = 3,
}

function Rock:create()
  self.depth = -self.y -- sorted with the hero: he is drawn in front when he stands lower on the screen
end

return Rock

-- A one-way platform: jumped up through, stood on, dropped through with down. It is not solid; entities/hero.lua looks
-- for things tagged "plank" and lands on their top edge (y). `pivot = { 0.5, 0 }` puts x, y at the middle of its top.
local Plank = nova.entity {
  sprite = "plank",
  tags = { "plank" },
  pivot = { 0.5, 0 },
  sx = 3, sy = 3,
  half = 72, -- half its width in units: the sprite is 48 pixels wide, drawn 3 times bigger
}

function Plank:create() self.depth = 5 end

return Plank

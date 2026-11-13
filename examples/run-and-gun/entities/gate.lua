-- A marker for the level generator: where a chunk of level (scenes/chunks/*.scene.json) is joined to the next. Put one with side "in" on the ground at the chunk's left edge and one
-- with side "out" on the ground at its right edge; the generator lines up each chunk's "in" with the "out" of the one before it. It is not drawn in the game.
local Gate = nova.entity {
  tags = { "gate" },
  velocity = false,
  settings = { side = { "in", choices = { "in", "out" }, help = "in: where the player comes into this chunk. out: where it leaves" } },
}

return Gate

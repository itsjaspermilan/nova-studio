-- A spot to walk to: a tiny marker with a hitbox, not solid, not drawn. The routes (tools/bossbot.lua) move it where the test player should
-- stand next and `walk_to` it. Nothing in the game uses it.
return nova.entity { tags = { "spot" }, velocity = false, hitbox = { -6, -6, 12, 12 } }

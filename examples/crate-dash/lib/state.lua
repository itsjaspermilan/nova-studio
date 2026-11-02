-- Shared game state. require() returns the same table everywhere, so this is a simple
-- place for things that outlive a scene.
return { score = 0, best = 0, lives = 3 }

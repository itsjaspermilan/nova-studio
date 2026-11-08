-- A piece of a kitchen placed in a level's scene file (a counter, a crate, a floor tile, a wall...): the entity class names its model.
-- `static` hands a placed piece to the engine's own scenery, which draws it with no script running for it each frame. Potion Panic's play
-- scene reads the level files itself (lib/levels.lua) and adds the pieces the same way.
return nova.entity { static = true }

-- A piece of a flat placed in a level's scene file (a floor tile, a wall, a rug, a sofa...): the entity class names its model. Moving Day's play
-- scene reads the level files itself (lib/rules.lua) and draws and moves the pieces; in the studio's scene editor each shows as its model, on the
-- 1 m grid, turned by its `ry`.
return nova.entity { static = true }

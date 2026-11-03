-- A fixed piece of scenery placed by a scene file (a tree, a road piece, a barrier...): the entity class says which model,
-- `static` hands it to the engine's world, which draws it only when it is near the camera and blocks cars with the
-- collision circles made in the model editor. A scene object can set `ry` (turn, radians) and `sx` (size) in its properties.
return nova.entity { static = true }

-- a lamp post, its lamp hanging 0.42 in front (+z) at 2.06 high and glowing by itself; give the scene a light there.
-- Scenery: it never moves, and is drawn only near the camera. solid = true: its own shape blocks bodies (nova.solid.move) and the camera.
return nova.entity { model = "lantern", static = true, solid = true }

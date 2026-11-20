-- a ruined wall 4 m long (along x), high at one end and fallen at the other, with rubble; solid as it is shaped.
-- Scenery: it never moves, and is drawn only near the camera. solid = true: its own shape blocks bodies (nova.solid.move) and the camera.
return nova.entity { model = "broken_wall", static = true, solid = true }

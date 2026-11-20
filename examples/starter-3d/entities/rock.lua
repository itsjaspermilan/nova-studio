-- a medium rock; solid as it is shaped (a circle of 0.64 for a plain collider).
-- Scenery: it never moves, and is drawn only near the camera. solid = true: its own shape blocks bodies (nova.solid.move) and the camera.
return nova.entity { model = "rock", static = true, solid = true }

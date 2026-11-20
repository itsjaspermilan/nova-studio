-- a crate 0.82 a side; solid as it is shaped (too high to step onto, low enough to jump on).
-- Scenery: it never moves, and is drawn only near the camera. solid = true: its own shape blocks bodies (nova.solid.move) and the camera.
return nova.entity { model = "crate", static = true, solid = true }

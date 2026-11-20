-- a stone pillar 3.28 high on a base 1 m square and 0.4 high; solid as it is shaped (a circle of 0.6 for a plain collider).
-- Scenery: it never moves, and is drawn only near the camera. solid = true: its own shape blocks bodies (nova.solid.move) and the camera.
return nova.entity { model = "pillar", static = true, solid = true }

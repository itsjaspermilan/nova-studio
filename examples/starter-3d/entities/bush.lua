-- a bush; it blocks as a circle of 0.5.
-- Scenery: it never moves, and is drawn only near the camera. Its model's collision circle blocks bodies moved with nova.solid.move, and its whole shape the camera.
return nova.entity { model = "bush", static = true, sway = 0.08 }

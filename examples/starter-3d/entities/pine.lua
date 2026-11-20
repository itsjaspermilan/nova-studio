-- a pine; its trunk blocks (a circle of 0.3).
-- Scenery: it never moves, and is drawn only near the camera. Its model's collision circle blocks bodies moved with nova.solid.move, and its whole shape the camera.
return nova.entity { model = "pine", static = true, sway = 0.14 }

-- a broadleaf tree; its trunk blocks (a circle of 0.36), you walk under its crown.
-- Scenery: it never moves, and is drawn only near the camera. Its model's collision circle blocks bodies moved with nova.solid.move, and its whole shape the camera.
return nova.entity { model = "tree", static = true, sway = 0.2 }

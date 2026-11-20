-- an arch to walk through along z: the opening is 2.5 wide and 3.69 high, between two piers; solid as it is shaped.
-- Scenery: it never moves, and is drawn only near the camera. solid = true: its own shape blocks bodies (nova.solid.move) and the camera.
return nova.entity { model = "arch", static = true, solid = true }

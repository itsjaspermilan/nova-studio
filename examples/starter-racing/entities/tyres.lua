-- a detailed tyre stack.
-- Scenery: it never moves, and is drawn only near the camera. on_ground = true: it stands on the ground under its x, z (a scene's y is the height above it). solid = true: its own shape blocks bodies (nova.solid.move) and the camera.
return nova.entity { model = "tyres", static = true, solid = true, on_ground = true }

-- a tuft of grass; nothing blocks.
-- Scenery: it never moves, and is drawn only near the camera. on_ground = true: it stands on the ground under its x, z (a scene's y is the height above it).
return nova.entity { model = "grass", static = true, sway = 0.5, on_ground = true }

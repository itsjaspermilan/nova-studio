-- Run and Gun: a side-scrolling shooter in the style of the arcade classics. D-pad or left stick runs and aims (up, diagonals, down),
-- B (bottom) jumps (again in the air once; down and B drops through a ledge; against a wall it jumps off it), Y (left) or R2 fires, R1 switches between the rifle (long range)
-- and the shotgun (short range), X (top) strikes in melee and parries (it sends shots back and stops a lunge), A (right) dashes, L1 or L2 holds you still to aim,
-- up at a ladder climbs it, Start restarts. Hold the stick towards a wall in the air to slide down it, shooting out.
-- The level is a scene file (scenes/level1.scene.json): open it in the scene editor to move things. The player is a sprite sheet (sprites/player.png): open it in the sprite editor.
nova.start("level1")

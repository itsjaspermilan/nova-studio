-- The frame of each sheet in sprites/ that is a pose, by name: where an animation is two frames, the second is the name and a 2 (walk, walk2).
-- Made by scripts/make-run-and-gun-kenney.mjs. The player is drawn by animation tag (entities/player.lua); the enemies by these.
return {
  player = { idle = 0, idle2 = 1, run = 2, run2 = 3, jump = 4, fall = 5, double_jump = 6, double_jump2 = 7, double_jump3 = 8, wall_slide = 9, wall_jump = 10, climb = 11, climb2 = 12, prone = 13, dash = 14, hurt = 15, melee = 16, melee2 = 17, melee3 = 18 },
  soldier = { idle = 0, idle2 = 1, walk = 2, walk2 = 3, jump = 4, hurt = 5, aim = 6, shoot = 7, duck = 8 },
  zombie = { idle = 0, idle2 = 1, walk = 2, walk2 = 3, windup = 4, lunge = 5, hurt = 6, jump = 7 },
}

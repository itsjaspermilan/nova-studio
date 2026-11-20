-- The runner's numbers. Tuning the feel is editing this file, never the entity.
-- World units: a tile is 16 px drawn 3x = 48 units; a frame is 1/60 s (the game steps at 60 Hz).
local TILE = 48

return {
  tile = TILE,

  health = 12,                 -- points; 6 hearts in halves
  walk_speed = 170,            -- units/s (3.5 tiles/s)

  -- Baton chain: three hits, the third knocks back. Frames are 1/60 s.
  attack = {
    chain = {
      { damage = 2, knockback = 0,   reach = "short", arc = "swing" },
      { damage = 2, knockback = 0,   reach = "short", arc = "swing", flip = true },
      { damage = 4, knockback = 260, reach = "long",  arc = "heavy" },
    },
    startup_frames = 5,        -- press to the hit appearing
    active_frames = 4,         -- how long the arc can hurt
    recovery_frames = 8,       -- after the active frames, before the next hit may start (or a roll cancels)
    chain_window_frames = 14,  -- after a hit ends, a press still continues the chain
    move_mult = 0.25,          -- walking while swinging
    hitstop_frames = 3,        -- the game stops this long on a hit
    shake = 6,                 -- units = 2 art pixels at 3x, for shake_frames
    shake_frames = 6,
    -- Hit areas, in world units from the runner's hips, per direction: x0, y0, w, h of the box in front of him.
    area = {
      short = { reach = 12, length = 66, half_width = 33 },
      long  = { reach = 12, length = 84, half_width = 42 },
    },
    hips = 14,                 -- the arc and its box sit this far above the feet
  },

  -- The dash roll.
  roll = {
    distance_tiles = 3.2,
    time = 0.28,
    untouchable = 0.22,
    cooldown = 0.6,            -- from the start of a roll to the next one
  },

  -- Aim and shoot.
  aim = {
    walk_mult = 0.35,
    sight_length = 260,        -- units
    deadzone = 0.3,
    shot_damage = 3,
    shot_speed = 720,
    shot_range = 900,
    shot_cooldown = 0.2,
  },
  charge = {
    pips = 3,
    shot_cost = 1,             -- pips
    baton_refund = 1 / 3,      -- pips given back by each baton hit
  },

  input_buffer_frames = 8,     -- a press is remembered this long (also through a hit-stop)

  blink = 0.8,                 -- seconds untouchable after a hit
  printed_again = 1.6,         -- seconds of the "printed again" beat before the room restarts

  -- Volumes by purpose (sounds/<name>.wav)
  sfx = { swing = 0.8, hit = 0.8, roll = 0.7, shot = 0.6, empty = 0.4, hurt = 0.8, enemy_tell = 0.7, enemy_die = 0.7, scrap = 0.4 },
  music = { track = "undertow", volume = 0.3 },
}

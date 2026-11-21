-- The runner's numbers. Tuning the feel is editing this file, never the entity.
-- World units: a tile is 16 px drawn 3x = 48 units; a frame is 1/60 s (the game steps at 60 Hz).
local TILE = 48

return {
  tile = TILE,

  health = 12,                 -- points; 6 hearts in halves
  run_speed = 310,             -- units/s (6.5 tiles/s): a runner runs, not walks. (Owner, handheld, 2026-11-21: "needs to move faster": 235 before.)
  -- The feet and the ground. The sheet's run clip is drawn as 8 frames of 45 ms (0.36 s a cycle), a stride that matches 235 units a second:
  -- 84.6 units of ground a cycle. The clip's speed is run_speed over that stride, so changing run_speed alone keeps the feet from skating.
  run_cycle = 0.36,            -- seconds one cycle of the run clip lasts as drawn
  run_stride = 84.6,           -- the ground one cycle covers as drawn (units)
  walk_cycle = 0.57,           -- the walk clip (6 frames of 95 ms) as drawn, and the ground a cycle covers at 0.35 of the old run speed (aiming)
  walk_stride = 46.9,
  camera_follow = 11,          -- how hard the camera chases the runner (per second): the lag when running is run_speed / this (28 units; 9 gave 26 at the old speed)

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
      short = { reach = 12, length = 92, half_width = 48 },
      long  = { reach = 12, length = 116, half_width = 58 },
      dash  = { reach = 12, length = 150, half_width = 65 },   -- the dash attack: 150 long by 130 wide
    },
    hips = 14,                 -- the arc and its box sit this far above the feet
    -- The dash attack: attack (X) during a roll, or up to `window` seconds after it ends, instead of the first baton hit. One a roll.
    -- The runner lunges on the way the roll went; the slash is a wide, long box in front of him from where the hit comes out.
    dash = {
      window = 0.15,           -- seconds after a roll ends that a press still makes it (a press during the roll is kept and the lunge starts as the roll ends)
      distance_tiles = 1.6, time = 0.14,   -- the lunge: 76.8 units in 0.14 s (548 units/s)
      damage = 5, knockback = 320,
      startup_frames = 3,      -- the lunge has begun; then the box hurts for active_frames (every enemy in it once)
      active_frames = 5,
      recovery_frames = 14,    -- after the lunge ends: a commitment (a roll may cut it, as with the other hits, once the box has gone)
      hitstop_frames = 7,      -- (a normal hit: 3)
      shake = 11, shake_frames = 9,   -- (a normal hit: 6, 6)
    },
  },

  -- The dash roll.
  roll = {
    distance_tiles = 4.2,
    time = 0.34,
    untouchable = 0.27,
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
  sfx = {
    swing = 0.8, dash_attack = 0.9, hit = 0.8, roll = 0.7, shot = 0.6, empty = 0.4, hurt = 0.8, enemy_tell = 0.7, enemy_die = 0.7, scrap = 0.4,
    -- slice 2
    door_shut = 0.8, door_open = 0.7, door_unlock = 0.5, wave_warn = 0.5,
    tell_thrower = 0.7, throw = 0.6, bottle_smash = 0.7, fire_start = 0.6,
    rev_up = 0.7, wall_thud = 0.8, tell_mimic = 0.7, can_spit = 0.6, tell_tout = 0.6, tout_off = 0.7,
    card_rise = 0.6, card_take = 0.55, zap = 0.6, ricochet = 0.5, stun = 0.6,
    -- slice 3a
    blast = 0.8, tram_bell = 0.7, tram_pass = 0.6, sign_drop = 0.7, buy = 0.6,
    -- slice 3b: Mother Coil, the Den, the Workbench
    tell_lanes = 0.7, junk_drag = 0.6, tell_car = 0.7, car_slam = 0.9, tell_magnet = 0.7, magnet_slam = 0.9,
    drum_open = 0.8, drum_clang = 0.5, stripes_on = 0.7, boss_burst = 0.8, boss_die = 0.9, boss_bark = 0.4,
    -- slice 4: sets, jinxes and the new cards
    set_done = 0.8, jinx_take = 0.7, brownout = 0.8, phase_slow = 0.7, slug_ready = 0.5, ally_rise = 0.7, key_pay = 0.5, bounty_pay = 0.7,
    printed = 0.7, lullaby_blip = 0.4, menu_move = 0.4, menu_select = 0.6, move_in = 0.7, revive = 0.8, reroll = 0.6, wreck_break = 0.6,
  },
  music = { track = "undertow", volume = 0.3, boss = "mother_coil", boss_volume = 0.55, den = "den", den_volume = 0.5 },
}

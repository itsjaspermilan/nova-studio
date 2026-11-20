-- Enemy numbers. Frames are 1/60 s, distances world units (a tile is 48).
-- Every attack is ONE row (`area`, `attack`, `lob`...): the tell zone drawn on the ground and the box that hurts come from the
-- same numbers. Every tell lasts at least 0.4 s (a test holds them to it).
return {
  scrapper = {
    health = 8,
    speed = 95,
    aggro = 420,               -- sees the runner from this far
    attack_range = 64,         -- starts its wind-up when the runner's feet are this near (along its facing)
    tell = 0.5,                -- wind-up seconds with a visible tell (design: at least 0.4)
    swing_frames = 6,          -- how long the pipe's box hurts
    recover = 0.7,
    damage = 2,
    area = { reach = 10, length = 70, half_width = 36 },
    hips = 14,
    knock_resist = false,
    stagger = 0.35,            -- seconds a knock-back (third hit) stuns it
    flash = 0.12,
    drops = 3,                 -- scrap pickups
  },

  -- Bottle Thrower: keeps its distance and lobs a bottle; the landing spot is marked while the bottle flies, and the
  -- landing leaves fire that hurts anyone.
  bottle_thrower = {
    health = 6,
    speed = 85,
    aggro = 640,
    keep_min = 230,            -- backs away when the runner is nearer than this
    keep_max = 400,            -- walks closer when the runner is further than this
    tell = 0.6,                -- the arm goes up (orange flash, its own sound); the bottle leaves at the end
    recover = 1.2,
    hips = 14,
    stagger = 0.3,
    drops = 2,
    lob = { time = 0.9, range = 520, height = 110 },        -- the bottle's flight (seconds), the farthest it will throw, the arc's height
    fire = { time = 2.0, radius = 40, damage = 1, every = 0.5 }, -- the patch it leaves: how long, how wide, damage to each victim every `every` seconds
  },

  -- Rat-drone: a toy car with a blade. Revs up (the lane it will take is drawn), charges straight, stunned if it meets a wall.
  rat_drone = {
    health = 5,
    speed = 70,                -- creeping up on the runner
    aggro = 560,
    start_dist = 300,          -- begins its rev-up when the runner is this near
    tell = 0.6,                -- the rev-up
    charge = { speed = 430, max_time = 0.85, lane_half = 24, damage = 2 }, -- the lane is (speed x max_time) long and this wide; hurts on contact only while charging
    stun = 1.0,                -- seconds stunned after a wall or cover
    crash_damage = 2,          -- what the crash does to it
    recover = 0.6,
    hips = 10,
    drops = 2,
  },

  -- Mimic Vendor: a vending machine that is not. Does nothing until the runner is within `wake`, then flickers and spits cans.
  mimic_vendor = {
    health = 14,
    wake = 144,                -- 3 tiles
    tell = 0.5,                -- the flicker
    open_time = 0.45,          -- the mouth is open
    recover = 1.3,
    hips = 20,
    drops = 4,
    cans = { fan = { -0.5, 0, 0.5 }, speed = 280, range = 420, damage = 2 }, -- three directions (radians off the runner's direction at the flicker's start)
  },

  -- Tout: a hologram barker that cannot hurt. Everything within `range` moves `mult` faster while it shouts, until a hit switches it off.
  tout = {
    health = 1,
    speed = 60,
    keep = 220,                -- drifts away when the runner is nearer than this
    range = 240,               -- 5 tiles
    mult = 1.3,
    pulse_every = 3.0,
    pulse_tell = 0.5,          -- the shout: a ring spreads over this long
    hips = 14,
    drops = 0,
  },

  dummy = { flash = 0.15 },
  scrap = { pickup_delay = 0.35, friction = 6 },
}

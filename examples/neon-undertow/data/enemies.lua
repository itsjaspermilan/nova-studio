-- Enemy numbers. Frames are 1/60 s, distances world units (a tile is 48).
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
  dummy = { flash = 0.15 },
  scrap = { pickup_delay = 0.35, friction = 6 },
}

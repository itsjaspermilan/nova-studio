-- Boss numbers: Mother Coil, the Gutter Market's scrapyard queen. Distances are world units (a tile is 48), times seconds.
-- Every attack is ONE row here: its tell (never under 0.6 s, a test holds them to it), its hurt area and its damage. The pictures
-- are drawn from these numbers (the lanes, the shadows, the ring), never the other way round.
local T = 48
return {
  mother_coil = {
    name = "Mother Coil", title = "queen of the scrapyard",
    health = 96,                 -- only the drum takes damage, only in its window
    half = 0.5,                  -- the stripe phase starts at this share of her health
    scrap = 120, guarantee = "rare",
    intro = 1.8,                 -- seconds from the doors shutting to her first attack (her name, her first bark)
    pause = 1.2,                 -- between attacks
    sequence = { "lanes", "slam", "cars", "slam" },
    cab = { w = 5 * T, h = 2 * T },          -- the cab's solid footprint: she sits at the top, the floor starts under it
    drum = { window = 2.5, w = 84, h = 84 }, -- exposed this long after each magnet slam; the only time she takes damage

    -- (1) the magnet drags junk across the floor in lanes: the lanes light up `tell` seconds before. Rows are the lanes' centres as
    -- shares of the floor's height; between two lanes there is always a gap wider than a runner twice over.
    lanes = {
      tell = 0.8, width = 84, length = 3 * T, speed = 820, damage = 2,
      layouts = { { 0.14, 0.50, 0.86 }, { 0.30, 0.66, 0.94 }, { 0.06, 0.42, 0.78 } },
    },

    -- (2) cars drop: a shadow grows for `tell` seconds, then the slam hurts within `radius`, and the wreck stays as cover.
    cars = {
      count = 3, gap = 0.55, tell = 1.0, radius = 1.5 * T, damage = 3,
      near = 0, far = 5 * T,           -- how far from the runner (at the cast) a car may land
      wreck = { health = 8, w = 1.5 * T, h = T, max = 4 },
    },

    -- (3) the magnet slams where the runner stands: it follows for `track`, then locks for `lock` (the ring is drawn in full), then slams.
    slam = { track = 0.5, lock = 0.9, radius = 1.5 * T, damage = 3, follow = 520, linger = 0.5 },

    -- half health: the floor is magnetised in vertical stripes. A shot inside a stripe turns `omega` radians a second (the sign is the
    -- stripe's polarity), a Rat-drone inside one is pulled `pull` units a second along it. Her pauses shrink.
    stripes = {
      charge = 1.5, width = 3 * T, omega = 2.6, pull = 150,
      centres = { 0.24, 0.50, 0.76 },      -- shares of the floor's width
    },
    phase2 = { pause = 0.6, drones = { every = 13, max = 2, kind = "rat_drone" } },

    die = { burst = 2.6 },
    -- her barks (a line now and then, over the cab): scrapyard queen, loves her crane, rude about print quality
    barks = {
      wake = { "WHO SCUFFED MY YARD? Oh. A print. A cheap one.", "Mind the floor, sweetheart. It is mostly me." },
      lanes = { "SWEEP!", "Tidy up, tidy up!" },
      cars = { "Free cars! Some assembly!", "Parking is NOT included." },
      slam = { "Hold still, I'm a professional.", "Come here, little fridge magnet." },
      hurt = { "Not the drum! I just had it polished!", "Ow! That's a load-bearing drum!" },
      phase2 = { "Fine. FINE. Magnets on, manners off.", "I did NOT want to turn the floor on." },
      die = { "My... crane... you can have the cheap seats...", "Tell my crane... I loved it more than you." },
    },
  },
}

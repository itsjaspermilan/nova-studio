-- How a fight room behaves (numbers only; the waves are in data/waves.lua, the cards in data/cards.lua).
return {
  doors_shut_at = 0.3,        -- seconds after entering that the doors shut
  warn = 0.9,                 -- how long a spawn point shows its warning mark before the enemies appear
  spawn_ring = 34,            -- several enemies at one point stand on a ring this wide
  clear_delay = 0.4,          -- seconds from the last kill to the doors unlocking (its sounds get their own moment)
  clear_beat = 0.8,           -- seconds from the last kill to the cards rising
  cards = 3,                  -- cards in an offer
  card_gap = 160,             -- units between the cards on the floor
  card_reach = 78,            -- how near the runner stands to be "by" a card
  rise = 0.7,                 -- seconds a card takes to rise
  sink = 0.5,                 -- and to sink
  banner = 2.4,               -- seconds the "cleared" banner stays
  -- keys a cleared room pays at once, kept even if the run ends in the next room (the bank and Loose Change come on top)
  keys = { fight = 1, elite = 3, gauntlet = 2, boss = 10 },
}

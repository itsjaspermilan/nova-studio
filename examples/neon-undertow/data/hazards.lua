-- The Gutter Market's pieces and its hazard. Distances are world units (a tile is 48), times are seconds. Nothing here is a
-- picture's size: the art can change and these stay true.
local T = 48
return {
  tile = T,

  -- A stall: cover with health (a counter `tiles` long; baton, shots and blasts hurt it). It breaks and is gone.
  stall = { health = 8, thick = T },

  -- An explosive barrel: any hit lights a fuse; when it runs out the blast hurts everyone within `radius` (the runner, enemies,
  -- stalls, other barrels, which then light their own fuse).
  barrel = { w = 34, h = 26, fuse = 1.0, radius = 2 * T, runner = 3, enemy = 6, prop = 6 },

  -- A puddle: a wet patch `w` x `h` (centred on the puddle). A neon sign hangs near it.
  puddle = { w = 132, h = 80 },
  -- A sign: shot at, it drops. `touch` is the square (half-width) it lands on: every puddle touching that square goes live.
  sign = { w = 40, h = 64, touch = 72 },
  -- A live puddle: for `time` seconds anyone standing in it takes `damage` once each `every` seconds.
  live = { time = 4.0, every = 1.0, damage = 1 },

  -- The tram: every `period` seconds it crosses the room along its rail: a bell and a flashing rail for `warn` seconds before.
  -- It is `length` long and `half` is half the width of the rail it flattens; anything on it takes `damage` (enemies too).
  tram = { period = 12, warn = 1.5, speed = 1100, length = 288, half = 48, damage = 6, margin = 14 },
}

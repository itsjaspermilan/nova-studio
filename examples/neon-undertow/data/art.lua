-- Frame numbers of the district tileset (sprites/gutter.png, tileset_make's "gutter market" in the detailed style) that entities draw
-- themselves: the pieces the game moves, breaks or lights (a stall that can be broken, a barrel that explodes, a sign that drops).
-- A tile is 32 px drawn at 1.5: 48 world units, so these are drawn at one tile each.
return {
  tiles = "gutter",
  stall = { base = { 781, 784 }, awning = { 782, 783 } },     -- a counter is a row of these pairs: left, right, left...
  barrel = 786,
  signs = { 790, 792, 794, 796, 798 },                        -- the hanging signs' own tiles (bowl, arrow, eye, cross, bars)
  vending = 787, vending_top = 788, server = 805, server_top = 806, terminal = 802, bench = 807, lamp = 799, lamp_top = 800, shutter = 822,
  -- the icon sheet (sprites/ui.png)
  ui = { heart_full = 0, heart_half = 1, heart_empty = 2, charge_full = 3, charge_empty = 4, scrap = 5, keycard = 6, card_back = 7, lock = 23, jinx = 27 },
}

-- Nebula Swap's puzzles: made by scripts/nebula/puzzles.mjs. Each can be cleared in exactly `moves` swaps (a solver checked, and found no shorter way).
-- rows run from the top row to the bottom; a digit is a kind of block and a dot is empty. `solution` is one way to win, as { row, column } of the left block of each swap.
return {
  { moves = 1, rows = { "..11..", ".2122." }, solution = { { 1, 2 } } },
  { moves = 1, rows = { "....1.", "...12.", "..221." }, solution = { { 1, 5 } } },
  { moves = 2, rows = { "..1...", "..2.1.", ".12.2." }, solution = { { 1, 3 }, { 1, 4 } } },
  { moves = 2, rows = { "....1.", "....2.", ".2211." }, solution = { { 2, 4 }, { 1, 5 } } },
  { moves = 2, rows = { ".1....", ".12...", ".221.." }, solution = { { 2, 2 }, { 1, 1 } } },
  { moves = 3, rows = { "...32.", "..312.", ".1231." }, solution = { { 2, 3 }, { 1, 3 }, { 1, 4 } } },
  { moves = 3, rows = { ".1....", ".1....", "32....", "31232." }, solution = { { 1, 3 }, { 2, 2 }, { 1, 1 } } },
  { moves = 3, rows = { ".3....", ".2....", ".2.1..", "23.131" }, solution = { { 1, 1 }, { 1, 4 }, { 1, 3 } } },
  { moves = 3, rows = { "...3..", "...1..", "...1..", "..221.", "..332." }, solution = { { 3, 3 }, { 4, 3 }, { 4, 2 } } },
  { moves = 4, rows = { "1.....", "1.....", "3..1..", "2.211.", "1.332." }, solution = { { 2, 5 }, { 3, 1 }, { 1, 4 }, { 2, 1 } } },
  { moves = 4, rows = { "...1..", "...2..", "...1..", "..22..", "2.23..", "1233.." }, solution = { { 2, 1 }, { 4, 3 }, { 1, 4 }, { 1, 1 } } },
  { moves = 4, rows = { "...31.", ".33233", ".22131" }, solution = { { 3, 4 }, { 1, 4 }, { 1, 5 }, { 1, 4 } } },
  { moves = 4, rows = { "2.....", "3.2...", "323...", "131331" }, solution = { { 1, 1 }, { 1, 5 }, { 1, 4 }, { 1, 3 } } },
  { moves = 5, rows = { "...4..", "...3..", "...32.", "..223.", "..211.", "2.4241" }, solution = { { 3, 4 }, { 3, 3 }, { 1, 3 }, { 1, 2 }, { 1, 5 } } },
  { moves = 5, rows = { "..2...", "..344.", "..114.", "4.242.", "4.331." }, solution = { { 2, 4 }, { 4, 2 }, { 3, 2 }, { 1, 1 }, { 1, 3 } } },
  { moves = 5, rows = { ".2....", "23....", "14....", "14342.", "21322." }, solution = { { 1, 1 }, { 1, 5 }, { 4, 2 }, { 1, 3 }, { 1, 2 } } },
}

// Makes Nebula Swap's puzzles (examples/nebula-swap/lib/puzzles.lua): random boards, kept only if a solver finds that they can be cleared in exactly
// the number of swaps the puzzle allows (never fewer, so that the limit is a real limit). The solver plays by the game's rules for a puzzle:
// swap two neighbours (one may be empty), blocks fall, three or more in a line clear together, and it repeats until nothing is left to match.
//   node scripts/nebula/puzzles.mjs [seed]
import fs from "node:fs";

const COLS = 6;
let seed = Number(process.argv[2] ?? 7);
const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
const pick = (n) => Math.floor(rand() * n);

// a board is an array of columns, each an array of colours from the bottom up
function settle(cols) {
  for (;;) {
    const h = Math.max(0, ...cols.map((c) => c.length));
    const dead = new Set();
    const at = (c, r) => cols[c][r];
    for (let r = 0; r < h; r++) {
      let c = 0;
      while (c < COLS) {
        const k = at(c, r);
        if (k == null || k === 0) { c++; continue; }
        let e = c;
        while (e + 1 < COLS && at(e + 1, r) === k) e++;
        if (e - c + 1 >= 3) for (let x = c; x <= e; x++) dead.add(x * 32 + r);
        c = e + 1;
      }
    }
    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < cols[c].length) {
        const k = cols[c][r];
        if (!k) { r++; continue; }
        let e = r;
        while (e + 1 < cols[c].length && cols[c][e + 1] === k) e++;
        if (e - r + 1 >= 3) for (let y = r; y <= e; y++) dead.add(c * 32 + y);
        r = e + 1;
      }
    }
    if (dead.size === 0) return cols;
    cols = cols.map((col, c) => col.filter((_, r) => !dead.has(c * 32 + r)));
  }
}
const key = (cols) => cols.map((c) => c.join("")).join("|");

// every swap: row r, columns c and c+1; a column's blocks stack from the bottom, so a hole in the middle of a column cannot exist before settling
function moves(cols) {
  const out = [];
  const h = Math.max(0, ...cols.map((c) => c.length));
  for (let r = 0; r < h; r++) for (let c = 0; c < COLS - 1; c++) {
    const a = cols[c][r] ?? 0, b = cols[c + 1][r] ?? 0;
    if (a === b) continue;
    const next = cols.map((col) => col.slice());
    // rows are sparse while swapping: use 0 for empty and then close the holes by gravity
    const put = (col, row, v) => { while (col.length <= row) col.push(0); col[row] = v; };
    put(next[c], r, b); put(next[c + 1], r, a);
    for (const col of next) { while (col.length && col[col.length - 1] === 0) col.pop(); }
    const fallen = next.map((col) => col.filter((v) => v !== 0));
    out.push([r, c, settle(fallen)]);
  }
  return out;
}
const empty = (cols) => cols.every((c) => c.length === 0);

function solvable(cols, depth, memo) {
  if (empty(cols)) return true;
  if (depth === 0) return false;
  const k = key(cols) + ":" + depth;
  if (memo.has(k)) return memo.get(k);
  // every colour must be left in threes or it cannot clear
  const counts = {};
  for (const c of cols) for (const v of c) counts[v] = (counts[v] ?? 0) + 1;
  let ok = false;
  if (Object.values(counts).every((n) => n >= 3)) {
    for (const [, , next] of moves(cols)) if (solvable(next, depth - 1, memo)) { ok = true; break; }
  }
  memo.set(k, ok);
  return ok;
}
// the swaps of one way to clear the board in exactly `depth` swaps (or fewer), as [row, column] pairs counted from 1 at the bottom left
function solution(cols, depth, memo = new Set()) {
  if (empty(cols)) return [];
  if (depth === 0) return null;
  const k = key(cols) + ":" + depth;
  if (memo.has(k)) return null;
  for (const [r, c, next] of moves(cols)) {
    const rest = solution(next, depth - 1, memo);
    if (rest) return [[r + 1, c + 1], ...rest];
  }
  memo.add(k);
  return null;
}
function minimum(cols, limit) {
  const memo = new Map();
  for (let d = 1; d <= limit; d++) if (solvable(cols, d, memo)) return d;
  return null;
}

function make(depth) {
  const colours = depth <= 2 ? 2 : depth <= 4 ? 3 : 4;
  for (let tries = 0; tries < 200000; tries++) {
    const per = depth <= 1 ? 3 : 3;
    const blocks = [];
    for (let k = 1; k <= colours; k++) for (let i = 0; i < per; i++) blocks.push(k);
    if (depth >= 4) blocks.push(...Array(3).fill(1 + pick(colours)));
    for (let i = blocks.length - 1; i > 0; i--) { const j = pick(i + 1); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
    const cols = Array.from({ length: COLS }, () => []);
    const width = depth <= 2 ? 4 : 6;
    const start = Math.floor((COLS - width) / 2);
    for (const k of blocks) cols[start + pick(width)].push(k);
    if (Math.max(...cols.map((c) => c.length)) > 7) continue;
    if (key(settle(cols.map((c) => c.slice()))) !== key(cols)) continue; // it must start with no match in it
    const m = minimum(cols, depth);
    if (m === depth) return cols;
  }
  throw new Error("no puzzle found for depth " + depth);
}

const plan = [1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5].slice(0, Number(process.argv[3] ?? 16));
const out = [];
for (const d of plan) {
  const cols = make(d);
  const h = Math.max(...cols.map((c) => c.length));
  const rows = [];
  for (let r = h - 1; r >= 0; r--) rows.push(cols.map((c) => (c[r] ? String(c[r]) : ".")).join(""));
  out.push({ rows, moves: d, solution: solution(cols, d) });
  console.error("puzzle", out.length, "moves", d, "blocks", cols.flat().length);
}
const lua = ["-- Nebula Swap's puzzles: made by scripts/nebula/puzzles.mjs. Each can be cleared in exactly `moves` swaps (a solver checked, and found no shorter way).",
  "-- rows run from the top row to the bottom; a digit is a kind of block and a dot is empty. `solution` is one way to win, as { row, column } of the left block of each swap.", "return {"];
for (const p of out) lua.push(`  { moves = ${p.moves}, rows = { ${p.rows.map((r) => `"${r}"`).join(", ")} }, solution = { ${p.solution.map(([r, c]) => `{ ${r}, ${c} }`).join(", ")} } },`);
lua.push("}");
fs.writeFileSync(new URL("../../examples/nebula-swap/lib/puzzles.lua", import.meta.url), lua.join("\n") + "\n");

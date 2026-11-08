// Moving Day's solver: finds the fewest moves that make every wish on a level's card come true (a search from push to push over
// every piece's place and turn and where the mover stands: a step, a push or a turn of a piece costs one, turning to face something costs nothing), proves that
// every level can be solved, and sets the stars from it.
//   scripts/env.sh node scripts/moving-day/solve.mjs [--write] [scene files...]     (default: every examples/moving-day/scenes/levels/*.scene.json)
// --write puts into each level object's props: `par` (the fewest moves), `stars` ([moves for three stars, moves for two]; any solve is one star)
// and `solution` (the presses: r l d u for the d-pad, a and y for the turns), which the game's self-test replays through its own rules.
import fs from "node:fs";
import path from "node:path";
import { Game, readLevel, DIRS, cells } from "./rules.mjs";

const args = process.argv.slice(2);
const write = args.includes("--write");
const LEVELS = new URL("../../examples/moving-day/scenes/levels/", import.meta.url).pathname;
let files = args.filter((a) => !a.startsWith("--"));
if (!files.length) files = fs.readdirSync(LEVELS).filter((f) => f.endsWith(".scene.json")).map((f) => path.join(LEVELS, f));

const KEY = ["r", "l", "d", "u"];

export function search(L, limit = 4e6, weight = 0) {
  const g = new Game(L);
  // the floor's cells as numbers, and each cell's neighbour that way (or -1 past a wall or off the floor)
  const coords = [...L.floor.keys()].map((k) => k.split(",").map(Number));
  const index = new Map(coords.map(([x, z], i) => [`${x},${z}`, i]));
  const nb = coords.map(([x, z]) => DIRS.map(([dx, dz]) => { const j = index.get(`${x + dx},${z + dz}`); return j !== undefined && !g.wall(x, z, x + dx, z + dz) ? j : -1; }));
  const kinds = L.pieces.map((p) => p.kind);
  const key = (s) => {
    const groups = {};
    s.pieces.forEach((p, i) => (groups[kinds[i]] ??= []).push(index.get(`${p.x},${p.z}`) * 4 + p.q));
    let out = String.fromCharCode(index.get(`${s.px},${s.pz}`) * 4 + s.f + 64);
    for (const kind of Object.keys(groups).sort()) out += groups[kind].sort((a, b) => a - b).map((c) => String.fromCharCode(c + 64)).join("");
    return out;
  };
  const start = g.start();
  // A search from push to push: between two pushes (or turns of a piece) the mover walks the shortest way, found by a flood fill over the free
  // cells, so each state is the arrangement just after a push and where the mover stands and faces. Costs are the game's moves (a step, a push or
  // a turn is one; a bump that only turns the mover is free), and states come off the queue cheapest first, so the first solved one is the best.
  const seen = new Map([[key(start), { cost: 0, prev: null, presses: "" }]]);
  const h = (st) => (weight ? weight * L.props.wishes.filter((w) => !g.wish(st, w)).length : 0);
  const buckets = [];
  buckets[h(start)] = [start];
  let expanded = 0;
  const trail = (k) => { let out = ""; for (let n = seen.get(k); n.prev !== null; n = seen.get(n.prev)) out = n.presses + out; return out; };
  const offer = (s, cost, prevKey, presses) => {
    const k = key(s), old = seen.get(k);
    if (old && old.cost <= cost) return;
    seen.set(k, { cost, prev: prevKey, presses });
    (buckets[cost + h(s)] ??= []).push(s);
  };
  for (let f = 0; f < buckets.length; f++) {
    const bucket = buckets[f];
    if (!bucket) continue;
    for (let b = 0; b < bucket.length; b++) {
      const s = bucket[b];
      const k = key(s);
      const cost = seen.get(k).cost;
      if (cost + h(s) !== f) continue;
      if (g.solved(s)) return { par: cost, solution: trail(k), states: seen.size, expanded };
      if (++expanded > limit) return { par: null, states: seen.size, expanded };
      const occ = new Int32Array(coords.length).fill(-1);
      s.pieces.forEach((p, i) => { for (const [x, z] of cells(p.kind, p.x, p.z, p.q)) occ[index.get(`${x},${z}`)] = i; });
      // the flood fill: distance and the way in to every free cell the mover can reach
      const here = index.get(`${s.px},${s.pz}`);
      const dist = new Int32Array(coords.length).fill(-1), via = new Int8Array(coords.length).fill(-1);
      const queue = [here];
      dist[here] = 0;
      for (let q = 0; q < queue.length; q++) {
        const c = queue[q];
        for (let d = 0; d < 4; d++) { const n = nb[c][d]; if (n >= 0 && occ[n] < 0 && dist[n] < 0) { dist[n] = dist[c] + 1; via[n] = d; queue.push(n); } }
      }
      const path = (c) => { let out = ""; while (c !== here) { const d = via[c]; out = KEY[d] + out; c = nb[c][d ^ 1]; } return out; };
      for (const c of queue) {
        const [cx, cz] = coords[c];
        for (let d = 0; d < 4; d++) {
          const t = nb[c][d];
          if (t < 0 || occ[t] < 0) continue;
          const at = { ...s, px: cx, pz: cz, f: d };
          const push = g.step(at, d);
          if (push.moved) offer(push.s, cost + dist[c] + 1, k, path(c) + KEY[d]);
          // a turn of the piece needs the mover facing it: they bumped it (it would not move), or they walked into this cell that way, or stand there already
          let face = -1, presses = "";
          if (!push.moved) { face = dist[c]; presses = path(c) + KEY[d]; }
          else if (c === here && s.f === d) { face = 0; presses = ""; }
          else { const back = nb[c][d ^ 1]; if (back >= 0 && dist[back] >= 0) { face = dist[back] + 1; presses = path(back) + KEY[d]; } }
          if (face < 0) continue;
          for (const [dir, press] of [[-1, "a"], [1, "y"]]) {
            const r = g.rotate(at, dir);
            if (r && r.s) offer(r.s, cost + face + 1, k, presses + press);
          }
        }
      }
    }
    buckets[f] = null;
  }
  return { par: null, states: seen.size, expanded };
}

// The fewest moves when the full search can finish (`exact`); in a big flat where it cannot, the best of searches that are steered towards the wishes
// (each wish not yet granted counts as `weight` moves still to make), which still proves the level can be solved and gives a number of moves a player can match.
export function solve(L, limit = 4e5) {
  const exact = search(L, limit, 0);
  if (exact.par !== null) return { ...exact, exact: true };
  let best = null;
  for (const weight of [12, 6, 3]) {
    const r = search(L, 1.5e6, weight);
    if (r.par !== null && (!best || r.par < best.par)) best = r;
  }
  return best ? { ...best, exact: false } : { par: null, states: exact.states };
}

// the presses replayed: counts the moves (a press that moved something) and says whether it ends solved
export function replay(L, presses) {
  const g = new Game(L);
  let s = g.start(), moves = 0;
  for (const ch of presses) {
    if (ch === "a" || ch === "y") { const r = g.rotate(s, ch === "a" ? -1 : 1); if (r && r.s) { s = r.s; moves++; } }
    else { const r = g.step(s, KEY.indexOf(ch)); s = r.s; if (r.moved) moves++; }
  }
  return { moves, solved: g.solved(s), state: s };
}

// three stars within a few moves of the best, two within half as many again
export const starsFor = (par) => [par + Math.max(2, Math.round(par * 0.12)), Math.round(par * 1.5) + 4];

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = 0;
  for (const file of files.sort((a, b) => (parseInt(path.basename(a)) || 0) - (parseInt(path.basename(b)) || 0))) {
    const L = readLevel(file);
    const t0 = Date.now();
    const r = solve(L);
    const name = path.basename(file);
    if (r.par === null) { console.log(`${name}: NO SOLUTION found (${r.states} states)`); failed++; continue; }
    const check = replay(L, r.solution);
    if (!check.solved || check.moves !== r.par) { console.log(`${name}: the replay disagrees (${check.moves} moves, solved ${check.solved})`); failed++; continue; }
    const stars = starsFor(r.par);
    console.log(`${name.padEnd(22)} par ${String(r.par).padStart(3)}  stars ${stars.join("/")}  ${r.exact ? "fewest" : "best found"}  ${String(r.states).padStart(8)} states  ${Date.now() - t0} ms  ${L.props.name ?? ""}`);
    if (write) {
      const scene = JSON.parse(fs.readFileSync(file, "utf8"));
      const level = scene.objects.find((o) => o.kind === "level");
      level.props.par = r.par;
      level.props.stars = stars;
      level.props.solution = r.solution;
      fs.writeFileSync(file, JSON.stringify(scene, null, 2) + "\n");
    }
  }
  if (failed) { console.log(`${failed} level(s) failed`); process.exit(1); }
  console.log(`every level can be solved${write ? " (par, stars and solution written)" : ""}`);
}

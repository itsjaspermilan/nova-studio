// Draws the Gutter Market's rooms as scene_write arguments (painted tile maps plus placed objects), and writes each scene's one-line
// script. Run: scripts/env.sh node examples/neon-undertow/tools/gutter.mjs <outdir> [--write]  (--write calls scene_write for each).
// A room is a scene file: nothing about its shape is in Lua. (This script is only the way the maps were drawn: the scene files are the
// truth, edit them in the scene editor or with scene_write.) Everything is in tiles: the tile size (48 units) is the one number here.
// Each map is checked as it is drawn: every cell the runner can stand on is reachable from the door, the spawn points, the card spot and
// the exit are open with room round them, and a sealed pocket is walled up.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { T as TILE, PAINT, paintGrid, damageRows } from "./paint.mjs";
import { compare } from "./solid_check.mjs";
const outdir = process.argv[2];
fs.mkdirSync(outdir, { recursive: true });
const T = 48;
const root = new URL("../", import.meta.url).pathname;
// (the painting is tools/paint.mjs: the terrains and props of the district tileset; this file only draws the shapes)
// How each room looks, beyond the shapes: the wear (0 plain to 1 wrecked), the corners that are wrecked (tiles x0, y0, x1, y1), and the kinds of
// marking the road may carry (alleys get none).
const LOOK = {
  s1_square: { wear: 0.4, damage: [[1, 20, 6, 22], [33, 1, 38, 3]] },
  s1_street: { wear: 0.4, features: ["no markings"] },
  s1_cross: { wear: 0.4, damage: [[1, 1, 11, 9]] },
  s2_maze: { wear: 0.5, features: ["no markings"] },
  s2_stalls: { wear: 0.45, features: ["no markings"] },
  s2_ring: { wear: 0.4, damage: [[28, 20, 34, 24]] },
  s3_tram: { wear: 0.45, damage: [[1, 1, 8, 6]] },
  s3_flood: { wear: 0.55, damage: [[1, 17, 7, 22], [30, 1, 36, 6]] },
  s3_underpass: { wear: 0.55, features: ["no markings"], damage: [[14, 1, 17, 6]] },
  elite: { wear: 0.5, damage: [[1, 1, 6, 6], [33, 19, 38, 24]] },
  s5_courts: { wear: 0.45, damage: [[26, 1, 30, 5]] },
  s5_market: { wear: 0.4, features: ["no markings"] },
  s5_depot: { wear: 0.5, damage: [[1, 18, 8, 24]] },
  stranger: { wear: 0.2 },
  walk: { wear: 0.2 },
  boss: { wear: 0.85, damage: [[1, 12, 14, 20], [30, 5, 42, 12]] },
  s7_yard: { wear: 0.5, damage: [[1, 1, 12, 8]] },
  s7_junction: { wear: 0.5, damage: [[26, 15, 33, 19]] },
  s7_hall: { wear: 0.5, features: ["no markings"], damage: [[1, 12, 13, 18]] },
};
const SOLID_CHARS = new Set(["#", "C"]);
const written = [];

class Map2 {
  constructor(name, W, H, { entry, exit, kind = "fight" }) {
    Object.assign(this, { name, W, H, entry, exit, kind });
    this.g = Array.from({ length: H }, () => Array.from({ length: W }, () => "#"));
    this.objects = [];
    this.blocked = new Set();   // cells an entity blocks (stalls, barrels, counters)
    this.marks = {};            // named points in tiles, to check
    this.counts = {};
  }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.g[y][x] = c; }
  fill(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  open(x0, y0, x1, y1) { this.fill(x0, y0, x1, y1, ","); }
  paved(x0, y0, x1, y1) { this.fill(x0, y0, x1, y1, "="); }
  wall(x0, y0, x1, y1) { this.fill(x0, y0, x1, y1, "#"); }
  crate(x, y) { this.set(x, y, "C"); }
  crates(...pts) { for (const [x, y] of pts) this.crate(x, y); }
  obj(o) { this.objects.push(o); }
  center(x, y) { return [(x + 0.5) * T, (y + 0.5) * T]; }
  stall(x, y, len = 3, dir = "h") {
    const [cx, cy] = dir === "h" ? [(x + len / 2) * T, (y + 0.5) * T] : [(x + 0.5) * T, (y + len / 2) * T];
    this.obj({ kind: "stall", x: cx, y: cy, props: { tiles: len, dir } });
    for (let i = 0; i < len; i++) this.blocked.add(dir === "h" ? `${x + i},${y}` : `${x},${y + i}`);
  }
  barrel(x, y) {
    this.obj({ kind: "barrel", x: (x + 0.5) * T, y: (y + 1) * T - 8 });
    this.blocked.add(`${x},${y}`);
  }
  barrels(...pts) { for (const [x, y] of pts) this.barrel(x, y); }
  puddle(x, y, dx = 0, dy = 0) { this.obj({ kind: "puddle", x: (x + 0.5) * T + dx, y: (y + 0.5) * T + dy }); }
  sign(x, y, puddles = []) {
    this.obj({ kind: "sign", x: (x + 0.5) * T, y: (y + 1) * T - 6 });
    for (const [dx, dy] of puddles) this.puddle(x + dx, y + dy);
  }
  rail(dir, a, line, from, to) {
    // a rail band two tiles wide along row/col `line` (its centre line is the boundary between `line - 1` and `line`), from tile `from` to `to`
    const span = (to - from + 1) * T;
    const o = dir === "h" ? { x: from * T, y: line * T } : { x: line * T, y: from * T };
    this.obj({ kind: "rail", ...o, props: { dir, span } });
    this.obj({ kind: "tram", ...o, props: { dir, span, phase: a } });
  }
  marker(name, x, y) { this.obj({ kind: "marker", name, x: (x + 0.5) * T, y: (y + 0.5) * T }); this.marks[name] = [x, y]; }
  free(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H && !SOLID_CHARS.has(this.g[y][x]) && !this.blocked.has(`${x},${y}`); }

  finish() {
    const { W, H } = this;
    // the door gaps (a vertical wall, two cells tall) and the runner
    const gap = (side, row) => { const x = side === "W" ? 0 : W - 1; this.fill(x, row, x, row + 1, "="); };
    gap(this.entry.side, this.entry.row); gap(this.exit.side, this.exit.row);
    const doorXY = (d) => [d.side === "W" ? T / 2 : W * T - T / 2, (d.row + 1) * T];
    const [ix, iy] = doorXY(this.entry), [ox, oy] = doorXY(this.exit);
    this.obj({ kind: "door", name: "door_in", x: ix, y: iy });
    this.obj({ kind: "door", name: "door_out", x: ox, y: oy, props: { exit: true } });
    const sx = this.entry.side === "W" ? 4 : W - 5;
    this.obj({ kind: "runner", name: "runner", x: (sx + 0.5) * T, y: iy - 10 });
    this.marks.start = [sx, this.entry.row];
    this.marks.exit = [this.exit.side === "W" ? 1 : W - 2, this.exit.row];
    this.marks.entry = [this.entry.side === "W" ? 1 : W - 2, this.entry.row];
    // loose crates never sit on a spawn point, the card row or a door: they are cleared away
    for (const [name, [x, y]] of Object.entries(this.marks)) {
      const r = /^sp_|^npc$|^cards$/.test(name) ? 1 : 0, wide = name === "cards" ? 3 : r;
      for (let dy = -r; dy <= r; dy++) for (let dx = -wide; dx <= wide; dx++) if (this.g[y + dy]?.[x + dx] === "C") this.g[y + dy][x + dx] = ",";
    }
    // reachability from the start
    const seen = new Set();
    const q = [[sx, this.entry.row]];
    if (!this.free(sx, this.entry.row)) throw new Error(`${this.name}: the runner starts in a solid cell`);
    seen.add(`${sx},${this.entry.row}`);
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (this.free(nx, ny) && !seen.has(k)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    // a pocket the runner cannot reach is walled up (and counted)
    let sealed = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (this.free(x, y) && !seen.has(`${x},${y}`)) { this.g[y][x] = "#"; sealed++; }
    // named points: open, reachable, with room round them
    for (const [name, [x, y]] of Object.entries(this.marks)) {
      if (!seen.has(`${x},${y}`)) throw new Error(`${this.name}: ${name} at ${x},${y} cannot be reached`);
      if (/^sp_|^cards$|^npc$/.test(name)) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!this.free(x + dx, y + dy)) throw new Error(`${this.name}: ${name} at ${x},${y} has no room round it (${x + dx},${y + dy})`);
        }
      }
      if (name === "cards") {
        for (let dx = -3; dx <= 3; dx++) if (!this.free(x + dx, y)) throw new Error(`${this.name}: the cards need room along the row (${x + dx},${y})`);
      }
    }
    for (const side of [this.entry, this.exit]) {
      const x = side.side === "W" ? 1 : W - 2;
      for (const r of [side.row, side.row + 1]) if (!seen.has(`${x},${r}`)) throw new Error(`${this.name}: a door cannot be reached`);
    }
    // the objects must stand on open ground
    for (const o of this.objects) {
      if (["puddle", "sign", "barrel", "stall"].includes(o.kind)) {
        const cx = Math.floor(o.x / T), cy = Math.floor((o.y - (o.kind === "barrel" || o.kind === "sign" ? 8 : 0)) / T);
        if (o.kind !== "stall" && SOLID_CHARS.has(this.g[cy]?.[cx])) throw new Error(`${this.name}: a ${o.kind} in a wall at ${cx},${cy}`);
      }
    }
    for (const o of this.objects.filter((o) => o.kind === "rail")) {
      const h = o.props.dir === "h", band = 48 + 14 + 24;
      const along = (v) => (h ? v.x : v.y), across = (v) => (h ? v.y : v.x);
      for (const p of this.objects) {
        if (!["stall", "barrel", "counter"].includes(p.kind)) continue;
        const half = p.kind === "barrel" ? 0 : ((p.props.dir === "h") === h ? 0 : (p.props.tiles * T) / 2);
        const thick = p.kind === "stall" ? (p.props.dir === "h") === h ? T / 2 : (p.props.tiles * T) / 2 : 0;
        if (Math.abs(across(p) - across(o)) < band + thick) throw new Error(`${this.name}: a ${p.kind} at ${Math.floor(p.x / T)},${Math.floor(p.y / T)} stands on a rail`);
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!SOLID_CHARS.has(this.g[y][x])) continue;
        const c = h ? (y + 0.5) * T : (x + 0.5) * T, a = h ? (x + 0.5) * T : (y + 0.5) * T;
        if (Math.abs(c - across(o)) < band && a > along(o) && a < along(o) + o.props.span && this.g[y][x] === "C") throw new Error(`${this.name}: a crate at ${x},${y} stands on a rail`);
      }
    }
    const total = this.g.flat().filter((c) => !SOLID_CHARS.has(c)).length;
    const look = LOOK[this.name] || {};
    const style = this.kind === "quiet" && this.name !== "boss" ? "quiet" : this.name === "boss" ? "yard" : "street";
    const painted = paintGrid({
      name: this.name, g: this.g, style, seed: this.name.length * 7 + 1,
      puddles: this.objects.filter((o) => o.kind === "puddle").map((o) => [o.x, o.y]),
      rails: this.objects.filter((o) => o.kind === "rail").map((o) => ({ dir: o.props.dir, x: o.x, y: o.y, span: o.props.span })),
    });
    const tilemap = { name: "ground", tileset: "gutter", scale: 1.5, seed: this.name.length * 7 + 1, wear: look.wear ?? 0.4, district: "gutter market", paint: PAINT, tiles: painted.tiles };
    if (look.damage) tilemap.damage = damageRows(W, H, look.damage);
    // (no hatched boxes: on a plaza or a yard the maker's "two roads cross" hatching covers the whole floor and reads as a pattern)
    tilemap.features = [...(look.features || []), ...(this.name === "boss" ? ["no markings"] : []), "no hatch"];
    const scene = {
      version: 1, width: W * T, height: H * T, background: [5, 6, 15], objects: [...this.objects, ...painted.lights],
      tilemaps: [tilemap],
    };
    fs.writeFileSync(`${outdir}/${this.name}.json`, JSON.stringify({ name: `tmp_gutter_${this.name}`, scene }));
    written.push(this.name);
    console.log(`${this.name}: ${W}x${H}, ${total} open cells${sealed ? `, ${sealed} sealed cells walled up` : ""}`);
  }
}

const dump = (m) => {
  const g = m.g.map((r) => r.map((c) => (c === "," ? "." : c === "=" ? "-" : c)));
  for (const k of m.blocked) { const [x, y] = k.split(",").map(Number); g[y][x] = "S"; }
  for (const o of m.objects) {
    const x = Math.floor(o.x / T), y = Math.floor((o.y - 2) / T);
    if (o.kind === "marker") g[y][x] = o.name.startsWith("sp_") ? o.name[3] : o.name[0].toUpperCase();
    if (o.kind === "puddle") g[y][x] = "p";
    if (o.kind === "sign") g[y][x] = "g";
    if (o.kind === "runner") g[y][x] = "@";
  }
  return g.map((r) => r.join("")).join("\n");
};
const done = (m) => { try { m.finish(); } catch (e) { console.log("ERROR " + e.message); if (process.argv.includes("--dump")) console.log(dump(m)); process.exitCode = 1; } };
const room = (name, W, H, entry, exit, kind) => new Map2(name, W, H, { entry, exit, kind });
const E = (side, row) => ({ side, row });
const spawns = (m, pts) => pts.forEach(([x, y], i) => m.marker(`sp_${i + 1}`, x, y));

// =================================================================================================================================
// SLOT 1: the first fights, no hazard
// =================================================================================================================================
{ // an open square: a paved plaza in a wide yard, stall rows, and a building in each corner
  const m = room("s1_square", 40, 24, E("W", 11), E("E", 11));
  m.open(1, 1, 38, 22); m.paved(13, 8, 26, 15); m.paved(1, 11, 4, 12); m.paved(35, 11, 38, 12);
  m.wall(1, 1, 6, 3); m.wall(33, 1, 38, 3); m.wall(1, 20, 6, 22); m.wall(33, 20, 38, 22);
  for (const [x, y] of [[7, 6], [7, 17], [30, 6], [30, 17]]) m.stall(x, y, 3, "h");
  m.crates([11, 10], [11, 13], [28, 10], [28, 13], [18, 17], [24, 5], [15, 4], [22, 19]);
  m.barrels([12, 6], [27, 17], [20, 3]);
  m.puddle(14, 7); m.puddle(25, 17); m.puddle(9, 14); m.puddle(32, 9);
  spawns(m, [[9, 4], [30, 19], [30, 4], [9, 19]]); m.marker("cards", 20, 12);
  done(m);
}
{ // a long street with shop-front alcoves and a side alley
  const m = room("s1_street", 44, 20, E("W", 9), E("E", 9));
  m.open(1, 6, 42, 13);
  m.open(8, 3, 11, 5); m.open(22, 1, 26, 5); m.open(34, 4, 37, 5);       // alcoves north
  m.open(14, 14, 18, 16); m.open(28, 14, 31, 18);                         // alcoves south
  m.paved(1, 9, 3, 10); m.paved(40, 9, 42, 10); m.paved(1, 6, 42, 6);
  m.stall(16, 7, 3, "v"); m.stall(28, 9, 3, "v"); m.stall(36, 7, 3, "v");
  m.crates([10, 11], [24, 7], [24, 12], [33, 12], [5, 7], [40, 12], [9, 3], [35, 4], [29, 17], [15, 15]);
  m.barrels([12, 12], [22, 2], [31, 7]);
  m.puddle(6, 12); m.puddle(20, 10); m.puddle(33, 8); m.puddle(41, 8);
  spawns(m, [[38, 7], [24, 3], [16, 15], [30, 16]]); m.marker("cards", 21, 10);
  done(m);
}
{ // a crossroads: two streets, four corner buildings, dead ends north and south
  const m = room("s1_cross", 36, 26, E("W", 12), E("E", 12));
  m.open(1, 10, 34, 15); m.open(15, 1, 20, 24);
  m.paved(15, 10, 20, 15); m.paved(1, 12, 3, 13); m.paved(32, 12, 34, 13);
  m.open(12, 8, 14, 9); m.open(21, 8, 23, 9); m.open(12, 16, 14, 17); m.open(21, 16, 23, 17);   // the corners are cut
  m.stall(6, 10, 3, "h"); m.stall(26, 15, 3, "h"); m.stall(15, 4, 3, "v"); m.stall(20, 18, 3, "v");
  m.crates([10, 14], [24, 11], [16, 2], [19, 22], [4, 15], [31, 10], [13, 8], [22, 17]);
  m.barrels([18, 6], [17, 20], [8, 15], [29, 11]);
  m.puddle(8, 13); m.puddle(27, 12); m.puddle(17, 22); m.puddle(18, 3);
  spawns(m, [[17, 2], [18, 23], [31, 12], [9, 13]]); m.marker("cards", 17, 12);
  done(m);
}

// =================================================================================================================================
// SLOT 2: two kinds together
// =================================================================================================================================
{ // an alley maze: blocks of buildings with three-wide alleys between, some closed off, one block taken out for a small plaza
  const m = room("s2_maze", 36, 24, E("W", 8), E("E", 14));
  m.open(1, 1, 34, 22);
  for (const x of [4, 11, 18, 25]) for (const y of [4, 10, 16]) {
    if (x === 11 && y === 10) continue;                                 // the plaza
    m.wall(x, y, x + 3, y + 2);
  }
  m.wall(15, 4, 17, 6); m.wall(22, 10, 24, 12); m.wall(8, 16, 10, 18); m.wall(29, 13, 31, 13); m.wall(26, 7, 28, 7);   // alleys closed off
  m.paved(11, 10, 14, 12);
  m.crates([2, 5], [20, 8], [24, 14], [10, 20], [33, 5], [17, 2], [31, 20], [3, 18]);
  m.barrels([18, 8], [11, 8], [27, 14], [19, 20]);
  m.stall(9, 7, 2, "h"); m.stall(25, 19, 2, "h");
  m.puddle(3, 9); m.puddle(32, 14); m.puddle(15, 21);
  spawns(m, [[31, 2], [31, 20], [3, 20], [18, 2]]); m.marker("cards", 13, 11);
  done(m);
}
{ // a market hall: shopfronts along the north and south walls with alleys between them, three rows of stalls staggered in the hall
  const m = room("s2_stalls", 42, 22, E("W", 10), E("E", 10));
  m.open(1, 1, 40, 20); m.paved(1, 10, 4, 11); m.paved(37, 10, 40, 11);
  m.wall(1, 1, 12, 3); m.wall(16, 1, 27, 3); m.wall(31, 1, 40, 3); m.wall(1, 18, 8, 20); m.wall(12, 18, 29, 20); m.wall(33, 18, 40, 20);
  for (const x of [4, 10, 18, 24, 32, 37]) m.stall(x, 5, 4, "h");
  for (const x of [7, 13, 19, 25, 31]) m.stall(x, 9, 4, "h");
  for (const x of [4, 10, 16, 26, 32, 37]) m.stall(x, 13, 4, "h");
  m.barrels([6, 7], [36, 15], [20, 7], [24, 15]);
  m.crates([2, 4], [39, 4], [2, 17], [39, 17], [22, 6], [21, 16]);
  m.puddle(10, 11); m.puddle(30, 11); m.puddle(21, 7);
  spawns(m, [[14, 2], [29, 2], [10, 19], [31, 19]]); m.marker("cards", 22, 11);
  done(m);
}
{ // a ring road round a central block with a small courtyard inside it
  const m = room("s2_ring", 36, 26, E("W", 12), E("E", 12));
  m.open(1, 1, 34, 24);
  m.wall(11, 8, 24, 17);
  m.open(15, 11, 20, 14); m.open(16, 15, 19, 17); m.paved(15, 11, 20, 14);   // the courtyard inside, with a gate to the south road
  m.paved(1, 12, 3, 13); m.paved(32, 12, 34, 13);
  m.stall(4, 5, 3, "h"); m.stall(29, 5, 3, "h"); m.stall(4, 20, 3, "h"); m.stall(29, 20, 3, "h"); m.stall(8, 9, 3, "v"); m.stall(27, 14, 3, "v");
  m.barrels([17, 12], [18, 12], [5, 14], [32, 9]);
  m.crates([2, 2], [33, 2], [2, 23], [33, 23], [14, 3], [21, 22], [9, 6], [26, 19]);
  m.puddle(7, 12); m.puddle(28, 13); m.puddle(17, 21);
  spawns(m, [[18, 3], [18, 22], [31, 12], [9, 21]]); m.marker("cards", 17, 4);
  done(m);
}

// =================================================================================================================================
// SLOT 3: the hazard switches on: signs and puddles, a tram in two of the three rooms
// =================================================================================================================================
{ // the tram crossing: a rail runs the length of the room between two station buildings; the way on is across it
  const m = room("s3_tram", 44, 20, E("W", 14), E("E", 4));
  m.open(1, 1, 42, 18); m.paved(1, 14, 4, 15); m.paved(39, 4, 42, 5);
  m.wall(1, 1, 8, 6); m.wall(35, 12, 42, 18); m.wall(17, 3, 26, 5); m.wall(17, 14, 26, 16);
  m.stall(11, 3, 3, "h"); m.stall(29, 3, 3, "h"); m.stall(11, 15, 3, "h"); m.stall(29, 15, 3, "h"); m.stall(33, 5, 3, "v");
  m.barrels([14, 7], [28, 7], [10, 12], [27, 12], [31, 17]);
  m.crates([2, 7], [41, 7], [16, 17], [27, 1], [37, 9]);
  m.sign(10, 7, [[-1, 1], [2, 1]]); m.sign(28, 7, [[1, 1], [-2, 1]]); m.sign(14, 17, [[-1, -1], [2, -1]]); m.sign(31, 13, [[1, 1], [-2, 1]]);
  m.puddle(4, 17); m.puddle(40, 8);
  m.rail("h", 2, 10, 1, 42);
  spawns(m, [[38, 8], [13, 13], [22, 7], [29, 17]]); m.marker("cards", 22, 12);
  done(m);
}
{ // the flooded square: a chamfered plaza round a dry fountain, four signs, puddles all over
  const m = room("s3_flood", 38, 24, E("E", 5), E("W", 17));
  m.open(1, 1, 36, 22);
  for (let i = 0; i < 6; i++) { m.wall(1, 1 + i, 6 - i, 1 + i); m.wall(31 + i, 1 + i, 36, 1 + i); m.wall(1, 22 - i, 6 - i, 22 - i); m.wall(31 + i, 22 - i, 36, 22 - i); }
  m.wall(17, 10, 20, 13); m.paved(15, 8, 22, 15); m.wall(17, 10, 20, 13);
  m.paved(33, 5, 36, 6); m.paved(1, 17, 4, 18);
  m.crates([11, 6], [26, 17], [10, 17], [27, 6], [17, 4], [20, 19]);
  m.barrels([8, 12], [29, 11], [13, 21], [23, 3]);
  m.stall(8, 8, 3, "v"); m.stall(29, 14, 3, "v");
  m.sign(18, 6, [[-1, 1], [1, 1], [-2, 3]]); m.sign(18, 17, [[0, 1], [2, 0], [-2, 0]]); m.sign(12, 11, [[-1, 1], [0, 2]]); m.sign(25, 12, [[1, 1], [0, -2]]);
  m.puddle(8, 19); m.puddle(30, 8); m.puddle(5, 12); m.puddle(33, 15);
  spawns(m, [[8, 4], [30, 19], [8, 19], [30, 4]]); m.marker("cards", 15, 20);
  done(m);
}
{ // the underpass: a tall room with a vertical rail down a trench in the middle; two arcades of pillars either side, crossed at gaps
  const m = room("s3_underpass", 32, 26, E("W", 20), E("E", 4));
  m.open(1, 1, 30, 24); m.paved(1, 20, 4, 21); m.paved(27, 4, 30, 5);
  m.wall(12, 1, 13, 24); m.wall(18, 1, 19, 24);
  m.open(12, 5, 13, 8); m.open(12, 12, 13, 15); m.open(12, 19, 13, 22);          // west arcade gaps
  m.open(18, 3, 19, 6); m.open(18, 10, 19, 13); m.open(18, 17, 19, 20);          // east arcade gaps
  m.paved(14, 1, 17, 24);
  m.stall(4, 6, 3, "v"); m.stall(7, 15, 3, "h"); m.stall(24, 8, 3, "h"); m.stall(26, 16, 3, "v");
  m.barrels([8, 3], [9, 11], [5, 20], [22, 5], [26, 12], [23, 21]);
  m.crates([2, 2], [2, 23], [10, 17], [29, 23], [29, 2], [21, 15]);
  m.sign(7, 9, [[1, 1], [-2, 1]]); m.sign(5, 18, [[1, 1]]); m.sign(25, 6, [[1, 1], [-2, 1]]); m.sign(28, 20, [[-1, 1], [-2, -1]]);
  m.puddle(4, 13); m.puddle(26, 14); m.puddle(10, 22);
  m.rail("v", 5, 16, 1, 24);
  spawns(m, [[26, 3], [5, 22], [26, 23], [6, 3]]); m.marker("cards", 7, 21);
  done(m);
}

// =================================================================================================================================
// SLOT 4: the elite arena
// =================================================================================================================================
{ // the arena: gateways in two flanking walls lead into a central hall with four pillars; antechambers with cut corners either side
  const m = room("elite", 40, 26, E("W", 12), E("E", 12), "elite");
  m.open(1, 1, 38, 24); m.paved(10, 6, 29, 19); m.paved(1, 12, 3, 13); m.paved(36, 12, 38, 13);
  for (let i = 0; i < 6; i++) { m.wall(1, 1 + i, 6 - i, 1 + i); m.wall(33 + i, 1 + i, 38, 1 + i); m.wall(1, 24 - i, 6 - i, 24 - i); m.wall(33 + i, 24 - i, 38, 24 - i); }
  m.wall(8, 5, 8, 10); m.wall(8, 15, 8, 20); m.wall(31, 5, 31, 10); m.wall(31, 15, 31, 20);
  for (const [x, y] of [[15, 10], [23, 10], [15, 14], [23, 14]]) m.wall(x, y, x + 1, y + 1);
  m.stall(11, 3, 3, "h"); m.stall(26, 21, 3, "h");
  m.barrels([3, 8], [36, 8], [3, 17], [36, 17], [19, 4], [19, 21]);
  m.crates([10, 12], [29, 12], [2, 11], [37, 14], [20, 8], [19, 16]);
  m.sign(11, 19, [[1, 1], [-1, 1]]); m.sign(28, 5, [[-1, 1], [1, 1]]); m.sign(34, 11, [[1, 1]]); m.sign(5, 14, [[1, 1]]);
  m.puddle(6, 7); m.puddle(33, 19); m.puddle(21, 2);
  spawns(m, [[27, 12], [27, 8], [11, 5], [11, 20]]); m.marker("cards", 20, 12);
  done(m);
}

// =================================================================================================================================
// SLOT 5: bigger rooms, waves from two doors (sp_1 and sp_2 are the far ends)
// =================================================================================================================================
{ // twin courts joined by a narrow gate: shopfronts and a fountain in the west one, a bus shelter and chamfered corners in the east one
  const m = room("s5_courts", 44, 26, E("W", 12), E("E", 12));
  m.open(1, 1, 17, 24); m.open(26, 1, 42, 24); m.open(18, 10, 25, 15);
  m.paved(1, 12, 4, 13); m.paved(39, 12, 42, 13); m.paved(18, 10, 25, 15);
  m.open(43, 3, 43, 5); m.open(43, 20, 43, 22);                          // two doors in the far wall
  m.wall(5, 4, 10, 6); m.wall(5, 19, 10, 21); m.wall(9, 11, 12, 14); m.paved(8, 10, 13, 15); m.wall(9, 11, 12, 14);   // shopfronts and a fountain
  for (let i = 0; i < 5; i++) { m.wall(26, 1 + i, 30 - i, 1 + i); m.wall(26, 24 - i, 30 - i, 24 - i); }               // cut corners (west side of the east court)
  m.wall(34, 9, 38, 10); m.wall(34, 15, 38, 16);                                                                       // a bus shelter's walls
  m.stall(2, 8, 3, "v"); m.stall(2, 16, 3, "v"); m.stall(14, 5, 3, "v"); m.stall(14, 18, 3, "v"); m.stall(32, 12, 3, "v"); m.stall(36, 3, 3, "h"); m.stall(36, 22, 3, "h");
  m.barrels([15, 9], [15, 16], [31, 8], [31, 17], [19, 10], [24, 15]);
  m.crates([2, 3], [2, 22], [4, 9], [4, 17], [27, 12], [40, 8], [40, 17]);
  m.sign(7, 8, [[1, 1], [-1, 2]]); m.sign(6, 17, [[1, 1], [2, -1]]); m.sign(37, 7, [[1, 1], [-1, 1]]); m.sign(37, 18, [[0, 1], [-2, 0]]);
  m.puddle(14, 12); m.puddle(30, 13); m.puddle(40, 14);
  spawns(m, [[42, 4], [42, 21], [30, 12], [13, 22]]); m.marker("cards", 20, 12);
  done(m);
}
{ // the long market: a central aisle between two combs of stalls, cross lanes every eight tiles
  const m = room("s5_market", 44, 24, E("W", 11), E("E", 11));
  m.open(1, 9, 42, 14); m.paved(1, 11, 4, 12); m.paved(39, 11, 42, 12);
  for (const x of [6, 14, 22, 30, 38]) { m.open(x, 4, x + 3, 8); m.open(x + 1, 15, x + 4, 19); }
  for (const x of [6, 14, 22, 30, 38]) { m.stall(x + 1, 4, 4, "v"); m.stall(x + 2, 15, 4, "v"); }
  m.open(1, 1, 42, 3); m.open(1, 20, 42, 22);
  m.barrels([9, 8], [26, 17], [33, 8], [18, 16], [40, 13]);
  m.crates([2, 7], [41, 7], [2, 17], [41, 17], [12, 4], [28, 19], [20, 5], [36, 20]);
  m.sign(11, 10, [[1, 1], [-1, 1]]); m.sign(27, 13, [[1, -1], [-1, -1]]); m.sign(35, 10, [[0, 1], [2, 1]]); m.sign(19, 13, [[1, 0], [-2, -1]]);
  m.puddle(7, 13); m.puddle(31, 10); m.puddle(40, 13);
  spawns(m, [[40, 10], [24, 2], [24, 21], [30, 13]]); m.marker("cards", 22, 11);
  done(m);
}
{ // the bus depot: a long shed in the middle with a tunnel through it, a rail through the tunnel
  const m = room("s5_depot", 42, 26, E("W", 5), E("E", 19));
  m.open(1, 1, 40, 24); m.paved(1, 5, 4, 6); m.paved(37, 19, 40, 20);
  m.wall(10, 7, 31, 17); m.open(10, 11, 31, 12); m.paved(10, 11, 31, 12);          // the shed, and the tunnel through it
  m.open(14, 7, 17, 7); m.open(24, 17, 27, 17);                                      // loading bays
  m.stall(7, 7, 3, "v"); m.stall(35, 6, 3, "v"); m.stall(5, 19, 3, "h"); m.stall(33, 22, 3, "h"); m.stall(13, 3, 3, "h"); m.stall(26, 21, 3, "h");
  m.barrels([3, 9], [38, 14], [20, 4], [23, 23], [9, 20], [32, 3]);
  m.crates([2, 2], [39, 23], [8, 2], [34, 22], [2, 17], [39, 8]);
  m.sign(7, 3, [[1, 1], [-1, 1]]); m.sign(34, 4, [[1, 1], [-2, 2]]); m.sign(8, 21, [[1, 1]]); m.sign(30, 20, [[0, 1], [2, 1]]);
  m.puddle(3, 8); m.puddle(37, 16); m.puddle(20, 19);
  m.rail("h", 8, 12, 1, 40);
  spawns(m, [[39, 3], [39, 23], [4, 22], [20, 2]]); m.marker("cards", 20, 21);
  done(m);
}

// =================================================================================================================================
// SLOT 6: the stranger's room; the shop and bank; the boss placeholder
// =================================================================================================================================
{ // a noodle stand under an awning, a wide quiet corner of the market
  const m = room("stranger", 30, 18, E("W", 8), E("E", 8), "quiet");
  m.open(1, 1, 28, 16); m.paved(8, 4, 21, 13); m.paved(1, 8, 3, 9); m.paved(26, 8, 28, 9);
  m.stall(11, 4, 4, "h"); m.stall(16, 4, 4, "h"); m.stall(11, 13, 2, "h");
  m.crates([2, 2], [27, 2], [2, 15], [27, 15], [6, 11], [24, 6]);
  m.puddle(6, 6); m.puddle(23, 12); m.puddle(14, 15);
  m.marker("npc", 18, 8);
  done(m);
}
{ // after the boss door: a long hall, the shop's three stalls along the north wall, the bank across from them
  const m = room("walk", 44, 18, E("W", 8), E("E", 8), "quiet");
  m.open(1, 1, 42, 16); m.paved(1, 8, 4, 9); m.paved(39, 8, 42, 9); m.paved(8, 3, 26, 5); m.paved(32, 10, 38, 14);
  m.obj({ kind: "counter", name: "shop_heal", x: 11 * T, y: 3.5 * T, props: { item: "heal", tiles: 3 } });
  m.obj({ kind: "counter", name: "shop_reroll", x: 18 * T, y: 3.5 * T, props: { item: "reroll", tiles: 3 } });
  m.obj({ kind: "counter", name: "shop_jinx", x: 25 * T, y: 3.5 * T, props: { item: "jinx", tiles: 3 } });
  m.obj({ kind: "counter", name: "bank", x: 35 * T, y: 13.5 * T, props: { item: "bank", tiles: 3 } });
  for (const [x, y, n] of [[9, 3, 3], [16, 3, 3], [23, 3, 3], [34, 13, 3]]) for (let i = 0; i < n; i++) m.blocked.add(`${x + i},${y}`);
  m.crates([2, 2], [41, 2], [2, 15], [41, 15], [14, 12], [28, 13]);
  m.puddle(7, 12); m.puddle(30, 6);
  done(m);
}
{ // Mother Coil's arena: a wide yard, her crane cab over the north wall (the floor starts under it), doors at both ends.
  // Nothing stands in the yard: the junk lanes, the car shadows and the magnet need the whole floor; her wrecks are the only cover.
  const m = room("boss", 44, 22, E("W", 11), E("E", 11), "quiet");
  m.open(1, 5, 42, 20); m.paved(1, 11, 4, 12); m.paved(39, 11, 42, 12);
  m.marker("sp_1", 3, 18); m.marker("sp_2", 40, 18); m.marker("cards", 22, 16);
  m.obj({ kind: "mother_coil", name: "coil", x: 22 * T, y: 5 * T });
  done(m);
}

// =================================================================================================================================
// SLOT 7: the gauntlet
// =================================================================================================================================
{ // the yard with a central block: a warehouse in the middle, a rail down the west side
  const m = room("s7_yard", 40, 26, E("W", 12), E("E", 12));
  m.open(1, 1, 38, 24); m.paved(1, 12, 4, 13); m.paved(35, 12, 38, 13);
  m.wall(14, 7, 25, 18); m.open(14, 12, 25, 13); m.paved(14, 12, 25, 13);          // an opening through the block
  m.stall(11, 3, 3, "h"); m.stall(29, 22, 3, "h"); m.stall(30, 6, 3, "v"); m.stall(10, 18, 3, "v");
  m.barrels([11, 9], [32, 15], [12, 22], [27, 3], [11, 6], [28, 20]);
  m.crates([2, 2], [37, 2], [2, 23], [37, 23], [20, 4], [20, 21], [34, 10], [3, 15]);
  m.sign(11, 7, [[1, 1], [-1, 2]]); m.sign(32, 18, [[-1, 1], [1, 1]]); m.sign(21, 5, [[-1, 1], [2, 0]]); m.sign(21, 20, [[1, -1], [-2, 0]]);
  m.puddle(11, 15); m.puddle(33, 8); m.puddle(11, 21);
  m.rail("v", 6, 6, 1, 24);
  spawns(m, [[35, 3], [35, 22], [4, 22], [16, 3]]); m.marker("cards", 20, 2);
  done(m);
}
{ // the junction: two rails cross in the middle, buildings in the four corners
  const m = room("s7_junction", 38, 26, E("W", 4), E("E", 20));
  m.open(1, 1, 36, 24); m.paved(1, 4, 4, 5); m.paved(33, 20, 36, 21);
  for (const [x, y, w, h] of [[4, 6, 8, 5], [26, 6, 8, 5], [4, 15, 8, 5], [26, 15, 8, 5]]) m.wall(x, y, x + w - 1, y + h - 1);
  m.paved(15, 10, 22, 15);
  m.stall(14, 3, 3, "h"); m.stall(22, 22, 3, "h"); m.stall(14, 18, 3, "v"); m.stall(23, 4, 3, "v");
  m.barrels([2, 16], [35, 16], [16, 2], [21, 23], [12, 10], [24, 10]);
  m.crates([2, 2], [35, 2], [2, 23], [35, 23], [13, 8], [24, 21]);
  m.sign(12, 6, [[1, 1], [2, 0]]); m.sign(25, 18, [[-1, 1], [-1, -1]]); m.sign(3, 22, [[1, -1]]); m.sign(34, 3, [[-1, 1], [0, 2]]);
  m.puddle(12, 22); m.puddle(24, 9); m.puddle(15, 4);
  m.rail("h", 0, 13, 1, 36); m.rail("v", 6, 19, 1, 24);
  spawns(m, [[32, 3], [32, 23], [5, 23], [18, 6]]); m.marker("cards", 9, 22);
  done(m);
}
{ // the hall: two long partitions make the way a zigzag; pillars in two rows, barricades
  const m = room("s7_hall", 44, 20, E("W", 9), E("E", 9));
  m.open(1, 1, 42, 18); m.paved(1, 9, 4, 10); m.paved(39, 9, 42, 10);
  m.wall(14, 1, 15, 11); m.wall(29, 8, 30, 18);
  for (const x of [8, 20, 26, 35]) { m.wall(x, 5, x + 1, 6); m.wall(x + 3, 13, x + 4, 14); }
  m.stall(23, 1, 5, "v"); m.stall(17, 14, 5, "v"); m.stall(35, 1, 4, "v"); m.stall(9, 14, 4, "v");
  m.barrels([12, 9], [27, 10], [6, 3], [40, 17], [22, 11], [38, 6]);
  m.crates([2, 2], [41, 17], [2, 17], [41, 2], [16, 8], [30, 11]);
  m.sign(11, 8, [[1, 1], [-1, 1]]); m.sign(26, 7, [[1, 1], [2, 0]]); m.sign(21, 12, [[-1, 1], [1, 1]]); m.sign(38, 10, [[-1, 0]]);
  m.puddle(7, 11); m.puddle(33, 16); m.puddle(11, 3);
  spawns(m, [[41, 4], [41, 15], [26, 3], [24, 17]]); m.marker("cards", 19, 9);
  done(m);
}

// every scene gets its one-line script (the fight room base, or the quiet room's)
const QUIET = new Set(["stranger", "walk"]);
const HAND = new Set(["boss"]);   // (scenes/gutter/boss.lua is written by hand: lib/bossroom.lua)
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
fs.mkdirSync(`${root}scenes/gutter`, { recursive: true });
for (const name of written) {
  if (HAND.has(name) || (only && name !== only)) continue;
  const base = QUIET.has(name) ? "lib.quietroom" : "lib.fightroom";
  fs.writeFileSync(`${root}scenes/gutter/${name}.lua`,
    `-- ${name}: the room's shape, doors and spawn points are in ${name}.scene.json; everything else is ${base.replace(".", "/")}.lua.\nreturn nova.scene(require("${base}"), { room = "gutter.${name}" })\n`);
}
// scene_write cannot write into a folder (its names are letters, digits, - and _): each scene is written under a temporary name and moved to
// scenes/gutter/ (the folder is the district; the scene's name is then `gutter.<name>`).
if (process.argv.includes("--write")) {
  for (const name of written) {
    if (only && name !== only) continue;
    const res = execFileSync("scripts/nova-tool", ["--project", root.replace(/\/$/, ""), "scene_write", `@${outdir}/${name}.json`], { encoding: "utf8", cwd: root + "../.." });
    fs.renameSync(`${root}scenes/tmp_gutter_${name}.scene.json`, `${root}scenes/gutter/${name}.scene.json`);
    console.log(name + ": " + res.split("\n").filter((l) => /warning|error/i.test(l)).slice(0, 4).join(" "));
  }
  // the proof that only the looks changed: every room's solid cells are exactly the old ones
  const bad = compare(written.filter((n) => !only || n === only).map((n) => `gutter/${n}.scene.json`));
  if (bad) { console.log(`${bad} room(s) differ in what is solid`); process.exitCode = 1; }
}

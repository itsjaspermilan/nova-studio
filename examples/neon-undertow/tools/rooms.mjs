// Draws the three slice-2 rooms (market_a, market_b, test_lab) as scene_write arguments (painted tile maps plus placed objects).
// Run: scripts/env.sh node examples/neon-undertow/tools/rooms.mjs <outdir> [--write]  (--write calls scene_write for each and checks the solid cells).
// A room is a scene file: nothing about its shape is in Lua. (This script is only the way the maps were drawn: the scene files are
// the truth, edit them in the scene editor or with scene_write.)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { PAINT, paintGrid, damageRows } from "./paint.mjs";
import { compare } from "./solid_check.mjs";
const root = new URL("../", import.meta.url).pathname;
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const T = 48;

function grid(w, h, fill) { return Array.from({ length: h }, () => Array.from({ length: w }, () => fill)); }
function rect(g, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; }
const px = (col) => col * T + T / 2;   // the middle of a tile column
const py = (row) => row * T + T / 2;


// (the painting is tools/paint.mjs: the district's terrains and props, the same solid cells as before; --write calls scene_write and then checks that)
const written = [];
function writeScene(name, w, h, g, objects, damage) {
  const painted = paintGrid({ name, g, style: "street", seed: name.length * 7 + 1, puddles: objects.filter((o) => o.kind === "puddle").map((o) => [o.x, o.y]) });
  const tilemap = { name: "ground", tileset: "gutter", scale: 1.5, seed: name.length * 7 + 1, wear: 0.4, district: "gutter market", paint: PAINT, tiles: painted.tiles };
  if (damage) tilemap.damage = damageRows(w, h, damage);
  tilemap.features = ["no hatch"];
  const scene = { version: 1, width: w * T, height: h * T, background: [5, 6, 15], objects: [...objects, ...painted.lights], tilemaps: [tilemap] };
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify({ name, scene }));
  written.push(name);
}
const marker = (name, col, row) => ({ kind: "marker", name, x: px(col), y: py(row) });
const puddle = (x, y) => ({ kind: "puddle", x, y });

// ---------------------------------------------------------------- room A: the open market square, 40 x 24 tiles
{
  const W = 40, H = 24;
  const g = grid(W, H, ",");
  rect(g, 0, 0, W - 1, 0, "#"); rect(g, 0, H - 1, W - 1, H - 1, "#");
  rect(g, 0, 0, 0, H - 1, "#"); rect(g, W - 1, 0, W - 1, H - 1, "#");
  rect(g, 13, 8, 26, 15, "=");                       // the paved square in the middle
  rect(g, 0, 11, 0, 12, "=");                        // the door gaps
  rect(g, W - 1, 11, W - 1, 12, "=");
  rect(g, 1, 11, 3, 12, "=");                        // paved in front of the doors
  rect(g, W - 4, 11, W - 2, 12, "=");
  // stalls: a counter of three with a crate or a barrel at one end; they are cover, and they can be walked round
  const stall = (x, y, end) => { rect(g, x, y, x + 2, y, "W"); g[y][end === "L" ? x - 1 : x + 3] = end === "L" ? "C" : "B"; };
  stall(7, 6, "R"); stall(7, 17, "R"); stall(30, 6, "L"); stall(30, 17, "L");
  stall(15, 4, "R"); stall(22, 19, "L");
  // a few loose crates and barrels
  for (const [x, y] of [[11, 10], [11, 13], [28, 10], [28, 13], [4, 3], [35, 20], [18, 17], [24, 5]]) g[y][x] = "C";
  for (const [x, y] of [[5, 19], [34, 4], [20, 2], [19, 21]]) g[y][x] = "B";
  const objects = [
    { kind: "runner", name: "runner", x: px(5), y: py(11) },
    { kind: "door", name: "door_w", x: T / 2, y: 12 * T },
    { kind: "door", name: "door_e", x: W * T - T / 2, y: 12 * T, props: { exit: true, leads_to: "market_b" } },
    marker("sp_w", 6, 3), marker("sp_n", 20, 4), marker("sp_s", 20, 20), marker("sp_e", 33, 12),
    marker("cards", 20, 12),
    puddle(14 * T, 7 * T), puddle(25 * T, 17 * T), puddle(9 * T, 14 * T + 20), puddle(32 * T, 9 * T), puddle(19 * T, 9 * T + 10), puddle(30 * T, 14 * T),
  ];
  writeScene("market_a", W, H, g, objects, [[1, 1, 8, 6]]);
}

// ---------------------------------------------------------------- room B: a long street with a side alley, 44 x 22 tiles
{
  const W = 44, H = 22;
  const g = grid(W, H, "#");
  rect(g, 1, 8, W - 2, 14, ",");                     // the street: seven tiles wide, end to end
  rect(g, 1, 8, W - 2, 8, "=");                      // a paved strip along the shop fronts
  rect(g, 19, 1, 23, 7, ",");                        // the alley going north, five tiles wide
  rect(g, 19, 6, 23, 7, "=");
  rect(g, 0, 10, 0, 11, "=");                        // the door gaps
  rect(g, W - 1, 10, W - 1, 11, "=");
  // cover along the street
  rect(g, 8, 12, 10, 12, "W"); g[12][11] = "B";
  rect(g, 30, 10, 32, 10, "W"); g[10][29] = "C";
  rect(g, 14, 9, 15, 9, "C");
  rect(g, 35, 13, 36, 13, "C");
  for (const [x, y] of [[26, 13], [12, 10], [39, 9], [4, 13]]) g[y][x] = "C";
  for (const [x, y] of [[16, 13], [40, 12], [27, 9]]) g[y][x] = "B";
  // the alley: a stall and crates
  rect(g, 20, 3, 22, 3, "W");
  for (const [x, y] of [[19, 1], [23, 1], [19, 5], [23, 5]]) g[y][x] = "C";
  g[1][21] = "B";
  const objects = [
    { kind: "runner", name: "runner", x: px(4), y: py(10) },
    { kind: "door", name: "door_w", x: T / 2, y: 11 * T },
    { kind: "door", name: "door_e", x: W * T - T / 2, y: 11 * T, props: { exit: true, leads_to: "slice_end" } },
    marker("sp_e", 38, 11), marker("sp_mid", 26, 12), marker("sp_alley", 21, 4),
    marker("cards", 22, 11),
    puddle(6 * T, 12 * T), puddle(18 * T, 11 * T + 20), puddle(33 * T, 12 * T + 20), puddle(21 * T, 8 * T + 10), puddle(41 * T, 10 * T + 10),
  ];
  writeScene("market_b", W, H, g, objects, [[30, 12, 42, 14]]);
}

// ---------------------------------------------------------------- the card lab: 30 x 18, bare, for the routes that prove cards and enemies
{
  const W = 30, H = 18;
  const g = grid(W, H, "=");
  rect(g, 0, 0, W - 1, 0, "#"); rect(g, 0, H - 1, W - 1, H - 1, "#");
  rect(g, 0, 0, 0, H - 1, "#"); rect(g, W - 1, 0, W - 1, H - 1, "#");
  rect(g, 14, 6, 14, 9, "#");                        // a wall to hide behind: Ricochet's test
  rect(g, 6, 14, 8, 14, "W");                        // cover for the Rat-drone's crash
  const objects = [
    { kind: "runner", name: "runner", x: px(3), y: py(8) },
    { kind: "dummy", name: "d1", x: px(20), y: py(8) },
    { kind: "dummy", name: "d2", x: px(22), y: py(4) },
    { kind: "dummy", name: "d3", x: px(22), y: py(12) },
    marker("sp_a", 24, 8), marker("sp_b", 24, 14), marker("cards", 15, 11),
  ];
  writeScene("test_lab", W, H, g, objects);
}

if (process.argv.includes("--write")) {
  for (const name of written) console.log(name + ": " + execFileSync("scripts/nova-tool", ["--project", root.replace(/\/$/, ""), "scene_write", `@${out}/${name}.json`], { encoding: "utf8", cwd: root + "../.." }).split("\n").filter((l) => /warning|error/i.test(l)).join(" "));
  const bad = compare(written.map((n) => n + ".scene.json"));
  if (bad) { console.log(`${bad} room(s) differ in what is solid`); process.exitCode = 1; }
}

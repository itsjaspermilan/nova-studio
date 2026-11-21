// Draws the Den (the hub) as scene_write arguments and writes it. Run: scripts/env.sh node examples/neon-undertow/tools/den.mjs <outdir> [--write]
// A scene file is the truth afterwards (edit it in the scene editor): this is only how it was drawn. Everything is in tiles (48 units).
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { PAINT, paintGrid, damageRows } from "./paint.mjs";
import { compare } from "./solid_check.mjs";
const outdir = process.argv[2];
fs.mkdirSync(outdir, { recursive: true });
const T = 48, W = 30, H = 18;
const root = new URL("../", import.meta.url).pathname;
const g = Array.from({ length: H }, () => Array.from({ length: W }, () => "#"));   // (the old characters: # wall, , floor, = walkway, w flood water, which was solid: server racks stand there now)
const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
fill(1, 3, 28, 16, ",");                       // the flooded server room's floor
fill(1, 3, 28, 4, "=");                         // the racks' walkway
fill(2, 12, 7, 15, "=");                        // the print bed's dais
fill(13, 15, 27, 16, "=");                      // the stalls' row
fill(12, 8, 15, 9, "w"); fill(19, 10, 22, 12, "w"); fill(8, 6, 9, 7, "w");   // flood water (solid)
fill(27, 9, 28, 10, "=");                       // in front of the door
const obj = (o) => o;
const objects = [
  { kind: "den_thing", name: "bed", x: 4.5 * T, y: 14.2 * T, props: { thing: "bed" } },
  { kind: "den_thing", name: "screen", x: 14.5 * T, y: 4 * T, props: { thing: "screen" } },
  { kind: "den_thing", name: "codex", x: 18.5 * T, y: 4 * T, props: { thing: "codex" } },
  { kind: "den_thing", name: "bench", x: 23 * T, y: 4 * T, props: { thing: "bench" } },
  { kind: "den_thing", name: "rundoor", x: 29.5 * T, y: 10 * T, props: { thing: "door" } },
  ...["patch", "old_sal", "wren", "koss", "null"].map((who, i) => ({ kind: "den_thing", name: "stall_" + who, x: (14.5 + i * 3.2) * T, y: 16 * T, props: { thing: "stall", who } })),
  { kind: "runner", name: "runner", x: 4.5 * T, y: 13.6 * T },
];
// the flooded server room: metal plate, grating along the racks' walkway, racks, cables, vents and a puddle or two
const painted = paintGrid({ name: "den", g, style: "den", seed: 5, puddles: [[6.5 * T, 9.5 * T], [17 * T, 13.5 * T], [24 * T, 8.5 * T], [11 * T, 13.5 * T]] });
const tilemap = { name: "ground", tileset: "gutter", scale: 1.5, seed: 5, wear: 0.45, district: "gutter market", paint: PAINT, tiles: painted.tiles, damage: damageRows(W, H, [[20, 14, 28, 16]]), features: ["no markings"] };
const scene = { version: 1, width: W * T, height: H * T, background: [5, 6, 15], objects: [...objects, ...painted.lights], tilemaps: [tilemap] };
fs.writeFileSync(`${outdir}/den.json`, JSON.stringify({ name: "den", scene }));
console.log(`den: ${W}x${H}`);
if (process.argv.includes("--write")) {
  console.log(execFileSync("scripts/nova-tool", ["--project", root.replace(/\/$/, ""), "scene_write", `@${outdir}/den.json`], { encoding: "utf8", cwd: root + "../.." }).split("\n").slice(0, 3).join("\n"));
  if (compare(["den.scene.json"])) process.exitCode = 1;
}

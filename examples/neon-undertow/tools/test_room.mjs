// The slice-1 test room (scenes/test_room.scene.json): a bare yard with a dummy, a Scrapper, cover and two puddles.
// Run: scripts/env.sh node examples/neon-undertow/tools/test_room.mjs <outdir> [--write]  (--write calls scene_write and checks the solid cells)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { T, PAINT, paintGrid, damageRows } from "./paint.mjs";
import { compare } from "./solid_check.mjs";
const root = new URL("../", import.meta.url).pathname;
const outdir = process.argv[2];
fs.mkdirSync(outdir, { recursive: true });
const rows = [];
const W = 30, H = 18;
for (let y = 0; y < H; y++) {
  let r = "";
  for (let x = 0; x < W; x++) {
    let c = ",";
    if (y === 0 || y === H - 1 || x === 0 || x === W - 1) c = "#";
    else if (y <= 2 || y >= 15) c = "=";
    r += c;
  }
  rows.push(r.split(""));
}
const put = (x, y, c) => (rows[y][x] = c);
[[6, 6], [7, 6], [6, 7]].forEach(([x, y]) => put(x, y, "C"));         // cover: crates and barrels
[[22, 5], [22, 6], [23, 5]].forEach(([x, y]) => put(x, y, "B"));
[[14, 11], [15, 11], [14, 12]].forEach(([x, y]) => put(x, y, "C"));
[[10, 13]].forEach(([x, y]) => put(x, y, "B"));
[[24, 12], [25, 12]].forEach(([x, y]) => put(x, y, "C"));
[[18, 3], [18, 4]].forEach(([x, y]) => put(x, y, "#"));               // a pillar of wall in the north
const objects = [
  { kind: "runner", name: "runner", x: 4.5 * T, y: 9.5 * T },
  { kind: "dummy", name: "dummy", x: 9.5 * T, y: 9.5 * T },
  { kind: "scrapper", name: "scrapper", x: 24.5 * T, y: 9.5 * T },
  { kind: "puddle", x: 12 * T, y: 8 * T + 16 },
  { kind: "puddle", x: 19.5 * T, y: 13.5 * T },
];
const painted = paintGrid({ name: "test_room", g: rows, style: "street", seed: 4, puddles: objects.filter((o) => o.kind === "puddle").map((o) => [o.x, o.y]) });
const tilemap = { name: "ground", tileset: "gutter", scale: 1.5, seed: 4, wear: 0.4, district: "gutter market", paint: PAINT, tiles: painted.tiles, damage: damageRows(W, H, [[1, 12, 6, 16]]), features: ["no hatch"] };
const scene = { version: 1, width: W * T, height: H * T, background: [5, 6, 15], objects: [...objects, ...painted.lights], tilemaps: [tilemap] };
fs.writeFileSync(`${outdir}/test_room.json`, JSON.stringify({ name: "test_room", scene }));
if (process.argv.includes("--write")) {
  console.log(execFileSync("scripts/nova-tool", ["--project", root.replace(/\/$/, ""), "scene_write", `@${outdir}/test_room.json`], { encoding: "utf8", cwd: root + "../.." }).split("\n").slice(0, 3).join("\n"));
  if (compare(["test_room.scene.json"])) process.exitCode = 1;
}

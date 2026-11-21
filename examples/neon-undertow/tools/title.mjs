// The title screen's backdrop (scenes/title.scene.json): a rainy street corner at night, 20 x 12 tiles, with signs, a vending machine, a lamp and
// a puddle, lit by `light` objects. The title (scenes/title.lua) dims it and draws its menu over it. Nothing here is solid or played on.
// Run: scripts/env.sh node examples/neon-undertow/tools/title.mjs <outdir> [--write]
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { T, PAINT } from "./paint.mjs";
const root = new URL("../", import.meta.url).pathname;
const outdir = process.argv[2];
fs.mkdirSync(outdir, { recursive: true });
const rows = [
  "CCCCCCMMMMMMMMCCCCCC",
  "CCHCCCMMMMHMMMCCCHCC",
  "CCCCCCMMMMMMMMCCCCCC",
  "ppppppppppppppppppUp",
  "pVpbppLppppbppLpppcp",
  "pppppppppppppppppppp",
  "aaaaaauaaaaaaaaaauaa",
  "rrrrrrrrrrrrrrrrrrrr",
  "aaaaaaaaaaaauuaaaaaa",
  "aaauuaaaaaaaaaaaaaaa",
  "pppppppppppppppppppp",
  "MMMMMMMMMMMMMMMMMMMM",
];
const paint = { ...PAINT, O: "sign_bowl on pavement", Y: "sign_eye on pavement", X: "sign_cross on pavement", Z: "sign_arrow on pavement", U: "puddle", p: "pavement", c: "cargo_crate on pavement", b: "bin on pavement", V: "vending_machine on pavement", L: "street_lamp on pavement" };
rows[3] = "ppOpppppYpppppXpppZp";
const light = (x, y, color, radius, intensity, glow = 0, glow_y = 0) => ({ kind: "light", x, y, props: { color, radius, squash: 0.62, intensity, glow, glow_y } });
const objects = [
  light(1 * T + 24, 4 * T + 20, [150, 215, 255], 170, 1.7), light(6.5 * T, 4 * T + 24, [150, 215, 255], 170, 1.7, 22, 84), light(14.5 * T, 4 * T + 24, [150, 215, 255], 170, 1.7, 22, 84),
  light(2.5 * T, 3.6 * T, [255, 63, 164], 190, 2.2, 34, 50), light(8.5 * T, 3.6 * T, [255, 63, 164], 190, 2.2, 34, 50), light(14.5 * T, 3.6 * T, [53, 230, 255], 190, 2.2, 34, 50), light(18.5 * T, 3.6 * T, [53, 230, 255], 190, 2.2, 34, 50),
];
const scene = { version: 1, width: 20 * T, height: 12 * T, background: [5, 6, 15], objects, tilemaps: [{ name: "ground", tileset: "gutter", scale: 1.5, seed: 9, wear: 0.45, district: "gutter market", paint, tiles: rows }] };
fs.writeFileSync(`${outdir}/title.json`, JSON.stringify({ name: "title", scene }));
if (process.argv.includes("--write")) {
  console.log(execFileSync("scripts/nova-tool", ["--project", root.replace(/\/$/, ""), "scene_write", `@${outdir}/title.json`], { encoding: "utf8", cwd: root + "../.." }).split("\n").slice(0, 3).join("\n"));
}
